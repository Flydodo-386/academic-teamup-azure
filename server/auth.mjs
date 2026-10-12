import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import * as oidc from "openid-client";
import { z } from "zod";

export const hash = (value) => createHash("sha256").update(value).digest("hex");
const token = () => randomBytes(32).toString("base64url");
export const sessionCookie = (config) => config.production ? "__Host-teamup" : "teamup";
const loginCookie = (config) => config.production ? "__Host-teamup-login" : "teamup-login";
const cookieOptions = (config, maxAge) => ({ httpOnly: true, secure: config.production, sameSite: "lax", path: "/", maxAge });
export const csrfFor = (sessionToken) => hash(`teamup-csrf:${sessionToken}`);

export function identityFromClaims(claims, config) {
  if (!claims || typeof claims.tid !== "string" || claims.tid.toLowerCase() !== config.tenantId) throw new Error("Tenant is not allowed.");
  const oid = z.string().uuid().parse(claims.oid).toLowerCase();
  const roles = Array.isArray(claims.roles) ? claims.roles.filter((role) => typeof role === "string") : [];
  if (config.requiredRole && !roles.includes(config.requiredRole) && !roles.includes(config.adminRole)) throw new Error("The account is not assigned to TeamUp.");
  const email = typeof claims.email === "string" ? claims.email : typeof claims.preferred_username === "string" ? claims.preferred_username : "";
  const name = typeof claims.name === "string" ? claims.name : email || "Academic colleague";
  return { tenantId: config.tenantId, objectId: oid, email: email.slice(0, 320), name: name.slice(0, 160), roles };
}

async function upsertUser(db, identity) {
  const result = await db.query(`
    INSERT INTO users (id, tenant_id, entra_object_id, email, display_name, roles)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    ON CONFLICT (tenant_id, entra_object_id) DO UPDATE SET
      email = EXCLUDED.email, display_name = EXCLUDED.display_name, roles = EXCLUDED.roles, updated_at = NOW()
    RETURNING *
  `, [randomUUID(), identity.tenantId, identity.objectId, identity.email, identity.name, JSON.stringify(identity.roles)]);
  const user = result.rows[0];
  if (user.disabled) throw new Error("The account is disabled.");
  return user;
}

export async function establishSession(db, config, res, identity, previousToken) {
  const user = await upsertUser(db, identity);
  const raw = token();
  const expiresAt = new Date(Date.now() + config.sessionHours * 3600000);
  await db.transaction(async (tx) => {
    if (previousToken) await tx.query("DELETE FROM sessions WHERE token_hash = $1", [hash(previousToken)]);
    await tx.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)", [hash(raw), user.id, expiresAt]);
  });
  res.cookie(sessionCookie(config), raw, cookieOptions(config, config.sessionHours * 3600000));
  return user;
}

export function sessionMiddleware(db, config) {
  return async (req, res, next) => {
    const raw = req.cookies?.[sessionCookie(config)];
    if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return next();
    const result = await db.query(`
      SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > NOW() AND NOT u.disabled
    `, [hash(raw)]);
    const user = result.rows[0];
    if (user && user.tenant_id === config.tenantId && (!config.requiredRole || user.roles.includes(config.requiredRole) || user.roles.includes(config.adminRole))) {
      req.user = { id: user.id, email: user.email, name: user.display_name, isAdmin: user.roles.includes(config.adminRole) };
      req.csrfToken = csrfFor(raw);
    }
    next();
  };
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Sign in with your institution's Microsoft account.", signInUrl: "/auth/login" });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) return res.status(403).json({ error: "A TeamUp administrator role is required." });
  next();
}

export function csrfMiddleware(config) {
  return (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    if (req.headers.origin !== config.origin) return res.status(403).json({ error: "This action must be submitted from TeamUp." });
    const supplied = req.headers["x-csrf-token"] || req.body?._csrf;
    const expected = typeof req.csrfToken === "string" ? Buffer.from(req.csrfToken) : Buffer.alloc(0);
    const received = typeof supplied === "string" ? Buffer.from(supplied) : Buffer.alloc(0);
    if (!expected.length || received.length !== expected.length || !timingSafeEqual(received, expected)) {
      return res.status(403).json({ error: "Your session security check failed. Refresh the page and try again." });
    }
    next();
  };
}

export function authRouter(db, config) {
  const router = Router();
  let configurationPromise;
  const getConfiguration = () => {
    configurationPromise ??= oidc.discovery(
      new URL(`https://login.microsoftonline.com/${config.tenantId}/v2.0`),
      config.clientId, { id_token_signed_response_alg: "RS256" }, oidc.ClientSecretPost(config.clientSecret),
      { execute: [oidc.enableNonRepudiationChecks], timeout: 10 },
    ).catch((error) => { configurationPromise = undefined; throw error; });
    return configurationPromise;
  };

  router.get("/login", async (req, res) => {
    if (req.user) return res.redirect("/");
    try {
      const configuration = await getConfiguration();
      const state = oidc.randomState(), nonce = oidc.randomNonce(), binding = token();
      const verifier = oidc.randomPKCECodeVerifier();
      const challenge = await oidc.calculatePKCECodeChallenge(verifier);
      await db.query("DELETE FROM oauth_transactions WHERE expires_at < NOW()");
      await db.query("INSERT INTO oauth_transactions (state_hash, binding_hash, code_verifier, nonce, expires_at) VALUES ($1, $2, $3, $4, $5)", [hash(state), hash(binding), verifier, nonce, new Date(Date.now() + 600000)]);
      res.cookie(loginCookie(config), binding, cookieOptions(config, 600000));
      const url = oidc.buildAuthorizationUrl(configuration, {
        redirect_uri: `${config.origin}/auth/microsoft/callback`, scope: "openid profile email",
        response_mode: "query", code_challenge: challenge, code_challenge_method: "S256", state, nonce,
      });
      res.redirect(url.href);
    } catch {
      console.error("Microsoft sign-in could not start; check tenant/application configuration.");
      res.redirect("/login?error=configuration");
    }
  });

  router.get("/microsoft/callback", async (req, res) => {
    res.clearCookie(loginCookie(config), cookieOptions(config, 0));
    try {
      const state = typeof req.query.state === "string" ? req.query.state : "";
      const binding = req.cookies?.[loginCookie(config)];
      if (!state || !binding || state.length > 512) throw new Error("Invalid sign-in transaction.");
      // Atomically consume a browser-bound, expiring transaction; callbacks cannot be replayed.
      const result = await db.query("DELETE FROM oauth_transactions WHERE state_hash = $1 AND binding_hash = $2 AND expires_at > NOW() RETURNING code_verifier, nonce", [hash(state), hash(binding)]);
      if (!result.rows.length) throw new Error("Sign-in expired or did not match this browser.");
      const transaction = result.rows[0];
      const url = new URL(req.originalUrl, config.origin);
      const tokens = await oidc.authorizationCodeGrant(await getConfiguration(), url, {
        pkceCodeVerifier: transaction.code_verifier, expectedState: state, expectedNonce: transaction.nonce, idTokenExpected: true,
      });
      const identity = identityFromClaims(tokens.claims(), config);
      await establishSession(db, config, res, identity, req.cookies?.[sessionCookie(config)]);
      // No Microsoft access/refresh/ID tokens are stored or sent to the browser.
      res.redirect("/");
    } catch {
      console.warn("Microsoft sign-in was rejected or could not be completed.");
      res.redirect("/login?error=signin");
    }
  });

  router.post("/logout", requireUser, csrfMiddleware(config), async (req, res) => {
    await db.query("DELETE FROM sessions WHERE token_hash = $1", [hash(req.cookies[sessionCookie(config)])]);
    res.clearCookie(sessionCookie(config), cookieOptions(config, 0));
    res.redirect(303, "/login");
  });

  if (config.developmentLogin && !config.production) {
    router.get("/dev-login", async (req, res) => {
      // Deliberately explicit, loopback-only developer helper; production rejects this configuration.
      const address = req.socket.remoteAddress;
      if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address)) return res.sendStatus(403);
      const identity = { tenantId: config.tenantId, objectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "developer@example.test", name: "Local Developer", roles: [config.requiredRole, config.adminRole].filter(Boolean) };
      await establishSession(db, config, res, identity, req.cookies?.[sessionCookie(config)]);
      res.redirect("/");
    });
  }
  return router;
}
