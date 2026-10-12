import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { apiRouter } from "./api.mjs";
import { authRouter, sessionMiddleware } from "./auth.mjs";

export function createApp(db, config) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxyHops);
  app.use(helmet({
    contentSecurityPolicy: { directives: { "default-src": ["'self'"], "script-src": ["'self'"], "style-src": ["'self'"], "img-src": ["'self'", "data:"], "connect-src": ["'self'"], "frame-ancestors": ["'none'"], "form-action": ["'self'"], "upgrade-insecure-requests": config.production ? [] : null } },
    strictTransportSecurity: config.production ? undefined : false,
  }));
  app.use((req, res, next) => {
    res.setHeader("X-Request-Id", randomUUID());
    if (req.path.startsWith("/api/") || req.path.startsWith("/auth/") || req.path === "/login" || req.path === "/") res.setHeader("Cache-Control", "private, no-store");
    next();
  });
  app.get("/health/live", (req, res) => res.json({ status: "ok" }));
  app.get("/health/ready", async (req, res) => {
    try { await db.query("SELECT name FROM schema_migrations LIMIT 1"); res.json({ status: "ready" }); }
    catch { res.status(503).json({ status: "unavailable" }); }
  });
  app.use(cookieParser());
  app.use(express.json({ limit: "8mb" }));
  app.use(express.urlencoded({ extended: false, limit: "4kb" }));
  app.use(sessionMiddleware(db, config));
  app.use("/auth", rateLimit({ windowMs: 60000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false }), authRouter(db, config));
  app.use("/api", rateLimit({ windowMs: 60000, limit: 180, standardHeaders: "draft-8", legacyHeaders: false, skip: () => !config.production }), apiRouter(db, config));
  app.use("/api", (req, res) => res.status(404).json({ error: "Endpoint not found." }));

  app.get("/login", (req, res) => {
    if (req.user) return res.redirect("/");
    const message = req.query.error ? "Sign-in could not be completed. Your administrator can check the app registration and assigned roles." : "Use the Microsoft account assigned to this academic collaboration hub.";
    res.type("html").send(`<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/login.css"><title>Sign in — TeamUp</title></head><body><main><span class="brand">TeamUp</span><h1>Research moves faster together.</h1><p>${message}</p><a href="/auth/login">Sign in with Microsoft</a>${config.developmentLogin ? '<a class="dev" href="/auth/dev-login">Local developer sign-in (development only)</a>' : ""}<small>Access is restricted to assigned institution accounts.</small></main></body></html>`);
  });
  const publicDirectory = fileURLToPath(new URL("../public/", import.meta.url));
  const distDirectory = fileURLToPath(new URL("../dist/", import.meta.url));
  app.use(express.static(publicDirectory));
  app.use("/assets", express.static(resolve(distDirectory, "assets"), { maxAge: "1y", immutable: true }));
  app.get("/", (req, res) => {
    if (!req.user) return res.redirect("/login");
    res.sendFile(resolve(distDirectory, "index.html"));
  });
  app.use((req, res) => res.status(404).send("Not found"));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status && Number.isInteger(error.status) && error.status >= 400 && error.status < 500 ? error.status : 500;
    if (status === 500) console.error(`Request failed (${res.getHeader("X-Request-Id")}): ${error.code || error.name || "Error"}`);
    res.status(status).json({ error: status === 500 ? "The request could not be completed. Please try again." : error.message || "Invalid request." });
  });
  return app;
}
