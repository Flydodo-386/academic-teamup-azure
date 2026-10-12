import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import * as oidc from "openid-client";
import { identityFromClaims } from "../server/auth.mjs";
import { loadConfig, safeWebUrl } from "../server/config.mjs";

const tenantId = "11111111-1111-4111-8111-111111111111";
const clientId = "22222222-2222-4222-8222-222222222222";
const config = { tenantId, requiredRole: "TeamUp.User", adminRole: "TeamUp.Admin" };
const claims = { tid: tenantId, oid: "33333333-3333-4333-8333-333333333333", name: "A researcher", preferred_username: "researcher@example.test", roles: ["TeamUp.User"] };

test("tenant, stable object ID and app-role checks fail closed", () => {
  assert.equal(identityFromClaims(claims, config).objectId, claims.oid);
  assert.throws(() => identityFromClaims({ ...claims, tid: clientId }, config));
  assert.throws(() => identityFromClaims({ ...claims, oid: "not-an-id" }, config));
  assert.throws(() => identityFromClaims({ ...claims, roles: [] }, config));
  assert.equal(identityFromClaims({ ...claims, roles: ["TeamUp.Admin"] }, config).name, claims.name);
});

test("production disallows HTTP, non-TLS databases and development login", () => {
  const env = { APP_ORIGIN: "https://teamup.example", DATABASE_URL: "postgresql://example.test/teamup", ENTRA_TENANT_ID: tenantId, ENTRA_CLIENT_ID: clientId, ENTRA_CLIENT_SECRET: "test-only-secret", NODE_ENV: "production" };
  assert.equal(loadConfig(env).databaseTls, true);
  assert.throws(() => loadConfig({ ...env, APP_ORIGIN: "http://localhost:3000" }));
  assert.throws(() => loadConfig({ ...env, DATABASE_TLS: "false" }));
  assert.throws(() => loadConfig({ ...env, ENABLE_DEV_LOGIN: "true" }));
  assert.equal(safeWebUrl("javascript:alert(1)"), "");
  assert.equal(safeWebUrl("https://user:password@example.test"), "");
});

test("OIDC code flow validates signed ID tokens, state, nonce and audience", async () => {
  const issuer = "https://issuer.example.test";
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" };
  let tokenClaims = { ...claims, iss: issuer, sub: "test-subject", aud: clientId, nonce: "test-nonce", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600 };
  let tamperSignature = false;
  function jwt(payload) {
    const parts = [Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key" })).toString("base64url"), Buffer.from(JSON.stringify(payload)).toString("base64url")];
    const input = parts.join(".");
    return `${input}.${sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url")}`;
  }
  const configuration = new oidc.Configuration({ issuer, token_endpoint: `${issuer}/token`, authorization_endpoint: `${issuer}/authorize`, jwks_uri: `${issuer}/jwks` }, clientId, { id_token_signed_response_alg: "RS256" }, oidc.ClientSecretPost("test-only-secret"));
  oidc.enableNonRepudiationChecks(configuration);
  configuration[oidc.customFetch] = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/jwks")) return Response.json({ keys: [jwk] });
    assert.ok(url.endsWith("/token"));
    assert.equal(new URLSearchParams(init.body).get("code_verifier"), "a".repeat(43));
    let idToken = jwt(tokenClaims);
    if (tamperSignature) {
      const parts = idToken.split(".");
      const signature = Buffer.from(parts[2], "base64url");
      signature[0] ^= 1;
      parts[2] = signature.toString("base64url");
      idToken = parts.join(".");
    }
    return Response.json({ token_type: "Bearer", access_token: "test-only-token", id_token: idToken, expires_in: 600 });
  };
  const checks = { pkceCodeVerifier: "a".repeat(43), expectedState: "test-state", expectedNonce: "test-nonce", idTokenExpected: true };
  const callback = new URL("https://teamup.example/auth/microsoft/callback?code=test-code&state=test-state");
  const tokens = await oidc.authorizationCodeGrant(configuration, callback, checks);
  assert.equal(tokens.claims().oid, claims.oid);
  await assert.rejects(() => oidc.authorizationCodeGrant(configuration, callback, { ...checks, expectedState: "incorrect" }));
  tokenClaims = { ...tokenClaims, nonce: "incorrect" };
  await assert.rejects(() => oidc.authorizationCodeGrant(configuration, callback, checks));
  tokenClaims = { ...tokenClaims, nonce: "test-nonce", aud: "incorrect-client" };
  await assert.rejects(() => oidc.authorizationCodeGrant(configuration, callback, checks));
  tokenClaims = { ...tokenClaims, aud: clientId };
  tamperSignature = true;
  await assert.rejects(() => oidc.authorizationCodeGrant(configuration, callback, checks));
});
