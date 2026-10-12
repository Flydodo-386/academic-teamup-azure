import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import request from "supertest";
import { migrate } from "../server/migrate.mjs";
import { createApp } from "../server/app.mjs";
import { establishSession, csrfFor } from "../server/auth.mjs";

const tenantId = "11111111-1111-4111-8111-111111111111";
const config = {
  origin: "http://localhost:3000", tenantId, clientId: "22222222-2222-4222-8222-222222222222",
  clientSecret: "test-only-not-a-real-secret", requiredRole: "TeamUp.User", adminRole: "TeamUp.Admin",
  production: false, developmentLogin: false, sessionHours: 8, trustProxyHops: 0,
  institutionName: "Test institution", fundingCalendarUrl: "",
};
let engine, db, app;
const accounts = {};

before(async () => {
  engine = new PGlite();
  const adapt = (driver) => ({
    async query(sql, values = []) {
      // PGlite executes one prepared statement at a time; schema SQL uses exec.
      if (!values.length && /^\s*CREATE TABLE users/.test(sql)) { await driver.exec(sql); return { rows: [], rowCount: 0 }; }
      const result = await driver.query(sql, values);
      return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
    },
  });
  db = { ...adapt(engine), transaction: (work) => engine.transaction((tx) => work(adapt(tx))) };
  await migrate(db);
  app = createApp(db, config);
  for (const [name, roles] of [["owner", ["TeamUp.User"]], ["colleague", ["TeamUp.User"]], ["admin", ["TeamUp.Admin"]]]) {
    let cookie;
    const user = await establishSession(db, config, { cookie(key, raw) { cookie = raw; } }, { tenantId, objectId: randomUUID(), email: `${name}@example.test`, name, roles });
    accounts[name] = { user, cookie: `teamup=${cookie}`, raw: cookie, csrf: csrfFor(cookie) };
  }
});
after(async () => { await engine?.close(); });

function as(name, method, path, payload) {
  const account = accounts[name];
  const call = request(app)[method](path).set("Cookie", account.cookie);
  if (method !== "get") call.set("Origin", config.origin).set("X-CSRF-Token", account.csrf);
  return payload === undefined ? call : call.send(payload);
}
const validPost = { kind: "Paper", title: "Research collaboration test", summary: "An opportunity to collaborate on a research project.", seeking: "Statistical methods", tags: "statistics, experiments" };

test("migrations are repeatable and a clean installation contains no demo or personal data", async () => {
  await migrate(db);
  assert.equal((await as("owner", "get", "/api/opportunities")).body.opportunities.length, 0);
  assert.equal((await as("owner", "get", "/api/grants")).body.source, "empty");
  assert.equal((await as("owner", "get", "/api/profiles")).body.profiles.length, 0);
});

test("anonymous and forged platform identity headers never grant API access", async () => {
  for (const path of ["/api/me", "/api/opportunities", "/api/grants", "/api/profiles"]) {
    assert.equal((await request(app).get(path)).status, 401);
    assert.equal((await request(app).get(path).set("oai-authenticated-user-email", "owner@example.test").set("x-ms-client-principal", "fake")).status, 401);
  }
  assert.equal((await request(app).get("/")).headers.location, "/login");
});

test("mutations reject missing CSRF tokens and foreign origins", async () => {
  assert.equal((await request(app).post("/api/opportunities").set("Cookie", accounts.owner.cookie).set("Origin", config.origin).send(validPost)).status, 403);
  assert.equal((await request(app).post("/api/opportunities").set("Cookie", accounts.owner.cookie).set("Origin", "https://foreign.example").set("X-CSRF-Token", accounts.owner.csrf).send(validPost)).status, 403);
  assert.equal((await request(app).post("/api/opportunities").set("Cookie", accounts.owner.cookie).set("Origin", config.origin).set("X-CSRF-Token", "é".repeat(64)).send(validPost)).status, 403);
});

test("post creation, private interests, stable-ID ownership, soft removal and reload", async () => {
  const created = await as("owner", "post", "/api/opportunities", validPost);
  assert.equal(created.status, 201);
  const id = created.body.id;
  const ownerBoard = await as("owner", "get", "/api/opportunities");
  assert.equal(ownerBoard.body.opportunities.find((row) => row.id === id).canRemove, true);
  const otherBoard = await as("colleague", "get", "/api/opportunities");
  assert.equal(otherBoard.body.opportunities.find((row) => row.id === id).canRemove, false);
  assert.equal((await as("colleague", "post", `/api/opportunities/${id}/interests`, { role: "Co-author", message: "I can contribute statistical modelling.", isPrivate: true })).status, 200);
  assert.equal((await as("owner", "get", `/api/opportunities/${id}/interests`)).body.interests.length, 1);
  assert.equal((await as("admin", "get", `/api/opportunities/${id}/interests`)).body.interests.length, 0);
  assert.equal((await as("colleague", "delete", `/api/opportunities/${id}`)).status, 404);
  // Changing email cannot transfer ownership to another identity.
  await db.query("UPDATE users SET email = 'colleague@example.test' WHERE id = $1", [accounts.owner.user.id]);
  assert.equal((await as("colleague", "delete", `/api/opportunities/${id}`)).status, 404);
  assert.equal((await as("owner", "delete", `/api/opportunities/${id}`)).status, 200);
  assert.ok(!(await as("owner", "get", "/api/opportunities")).body.opportunities.some((row) => row.id === id));
  assert.equal((await db.query("SELECT status FROM opportunities WHERE id = $1", [id])).rows[0].status, "closed");
  assert.equal((await db.query("SELECT COUNT(*)::integer AS count FROM interests WHERE opportunity_id = $1", [id])).rows[0].count, 1);
  assert.equal((await as("colleague", "post", `/api/opportunities/${id}/interests`, { role: "Co-author", message: "Another contribution message." })).status, 404);
});

test("private opportunity visibility is enforced on the server", async () => {
  const created = await as("owner", "post", "/api/opportunities", { ...validPost, visibility: "private" });
  assert.equal(created.status, 201);
  const id = created.body.id;
  assert.ok((await as("owner", "get", "/api/opportunities")).body.opportunities.some((row) => row.id === id));
  assert.ok(!(await as("colleague", "get", "/api/opportunities")).body.opportunities.some((row) => row.id === id));
  assert.equal((await as("colleague", "get", `/api/opportunities/${id}/interests`)).status, 404);
});

test("profiles persist, are bound to user IDs and can be removed by their author", async () => {
  const profile = { name: "Researcher", interests: "Optimisation, decision science", expertise: "Experiments" };
  assert.equal((await as("owner", "post", "/api/profiles", profile)).status, 200);
  const loaded = await as("owner", "get", "/api/profiles");
  assert.equal(loaded.body.profiles[0].isViewer, true);
  assert.deepEqual(loaded.body.profiles[0].interests, ["Optimisation", "decision science"]);
  assert.equal((await as("colleague", "get", "/api/profiles")).body.profiles[0].isViewer, false);
  assert.equal((await as("owner", "delete", "/api/profiles/me")).status, 200);
  assert.equal((await as("owner", "get", "/api/profiles")).body.profiles.length, 0);
});

test("funding import is admin-only, atomic, duplicate-safe and filters unsafe links", async () => {
  const rows = [{ "Funder & Call": "Test funding call", "Closing date": "31 Dec 2027", "Link to Research Professional": "https://funding.example/call/123", "Additional Information": "Initial description" }];
  assert.equal((await as("owner", "post", "/api/grants", { rows })).status, 403);
  assert.equal((await as("admin", "post", "/api/grants", { rows: [...rows, ...rows] })).body.imported, 1);
  assert.equal((await as("admin", "post", "/api/grants", { rows: [{ ...rows[0], "Additional Information": "Updated description" }] })).status, 200);
  const feed = await as("owner", "get", "/api/grants");
  assert.equal(feed.body.grants.length, 1);
  assert.equal(feed.body.grants[0].summary, "Updated description");
  const before = (await db.query("SELECT COUNT(*)::integer AS count FROM funding_opportunities")).rows[0].count;
  assert.equal((await as("admin", "post", "/api/grants", { rows: [{ "Title": "Should not be written" }, { "No title": "Invalid" }] })).status, 400);
  assert.equal((await db.query("SELECT COUNT(*)::integer AS count FROM funding_opportunities")).rows[0].count, before);
  assert.equal((await as("admin", "post", "/api/grants", { rows: [{ "Title": "Safe link example", "Funder Website": "javascript:alert(1)" }] })).status, 200);
  assert.equal((await as("owner", "get", "/api/grants")).body.grants.find((row) => row.title === "Safe link example").url, null);
});

test("expired and disabled sessions are denied", async () => {
  await db.query("UPDATE sessions SET expires_at = NOW() - INTERVAL '1 second' WHERE user_id = $1", [accounts.colleague.user.id]);
  assert.equal((await as("colleague", "get", "/api/me")).status, 401);
  await db.query("UPDATE users SET disabled = TRUE WHERE id = $1", [accounts.owner.user.id]);
  assert.equal((await as("owner", "get", "/api/me")).status, 401);
});

test("logout revokes the server session; health endpoints and production assets are served", async () => {
  const me = await as("admin", "get", "/api/me");
  assert.equal(me.body.viewer.isAdmin, true);
  assert.equal(me.body.csrfToken, accounts.admin.csrf);
  assert.equal((await as("admin", "get", "/")).status, 200);
  const response = await as("admin", "post", "/auth/logout", { _csrf: accounts.admin.csrf });
  assert.equal(response.status, 303);
  assert.equal((await as("admin", "get", "/api/me")).status, 401);
  assert.equal((await request(app).get("/health/live")).status, 200);
  assert.equal((await request(app).get("/health/ready")).status, 200);
  assert.equal((await request(app).get("/auth/dev-login")).status, 404);
});
