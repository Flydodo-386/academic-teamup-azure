import { Router } from "express";
import { z } from "zod";
import { csrfMiddleware, requireAdmin, requireUser } from "./auth.mjs";
import { importFunding } from "./funding.mjs";

const list = (value) => {
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,;|]/) : [];
  return [...new Set(items.filter((item) => typeof item === "string").map((item) => item.trim().slice(0, 80)).filter(Boolean))].slice(0, 12);
};
const shortText = (max) => z.string().trim().max(max);
const opportunitySchema = z.object({
  kind: z.enum(["Grant", "Paper"]), title: shortText(240).min(5), summary: shortText(5000).min(20),
  seeking: shortText(500).min(3), deadline: shortText(120).optional().default(""),
  tags: z.union([shortText(1000), z.array(shortText(80)).max(12)]).optional().default(""),
  visibility: z.enum(["school", "private"]).optional().default("school"),
});
const interestSchema = z.object({ role: shortText(100).min(2), message: shortText(2000).min(10), isPrivate: z.boolean().optional().default(true) });
const profileSchema = z.object({
  name: shortText(160).min(2), school: shortText(160).optional().default(""), department: shortText(160).optional().default(""),
  bio: shortText(1000).optional().default(""),
  interests: z.union([shortText(1000), z.array(shortText(80)).max(12)]),
  expertise: z.union([shortText(1000), z.array(shortText(80)).max(12)]).optional().default(""),
  collaborationTypes: z.union([shortText(1000), z.array(shortText(80)).max(12)]).optional().default(""),
});
const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("") || "TU";
function id(value) {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) throw Object.assign(new Error("Invalid opportunity."), { status: 400 });
  return Number(value);
}
function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw Object.assign(new Error(`Check these fields: ${[...new Set(result.error.issues.map((issue) => issue.path.join(".")))].join(", ")}.`), { status: 400 });
  return result.data;
}

export function apiRouter(db, config) {
  const router = Router();
  router.use(requireUser, csrfMiddleware(config));

  router.get("/me", (req, res) => res.json({ viewer: req.user, csrfToken: req.csrfToken, institutionName: config.institutionName, fundingCalendarUrl: config.fundingCalendarUrl }));

  router.get("/opportunities", async (req, res) => {
    const rows = await db.query(`
      SELECT o.*, u.display_name AS owner_name, COUNT(i.id)::integer AS interest_count
      FROM opportunities o JOIN users u ON u.id = o.owner_id LEFT JOIN interests i ON i.opportunity_id = o.id
      WHERE o.status = 'open' AND (o.visibility = 'school' OR o.owner_id = $1)
      GROUP BY o.id, u.display_name ORDER BY o.created_at DESC, o.id DESC
    `, [req.user.id]);
    res.json({ viewer: req.user, opportunities: rows.rows.map((row) => ({
      id: row.id, kind: row.kind, title: row.title, summary: row.summary, tags: row.tags,
      seeking: row.seeking, deadline: row.deadline, stage: row.stage, visibility: row.visibility,
      owner: row.owner_name, ownerInitials: initials(row.owner_name), ownerTone: row.kind === "Paper" ? "avatarPlum" : "avatarGold",
      interest: row.interest_count, accent: row.kind === "Grant" ? "grantAccent" : "paperAccent",
      createdAt: row.created_at, canRemove: row.owner_id === req.user.id,
    })) });
  });

  router.post("/opportunities", async (req, res) => {
    const input = parse(opportunitySchema, req.body);
    const created = await db.transaction(async (tx) => {
      const result = await tx.query(`
        INSERT INTO opportunities (owner_id, kind, title, summary, tags, seeking, deadline, stage, visibility)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9) RETURNING id
      `, [req.user.id, input.kind, input.title, input.summary, JSON.stringify(list(input.tags)), input.seeking, input.deadline || "Open collaboration", input.kind === "Paper" ? "New idea" : "Team formation", input.visibility]);
      const opportunityId = result.rows[0].id;
      await tx.query("INSERT INTO audit_events (actor_id, action, record_id) VALUES ($1, 'opportunity.create', $2)", [req.user.id, String(opportunityId)]);
      return opportunityId;
    });
    res.status(201).json({ id: created });
  });

  router.delete("/opportunities/:id", async (req, res) => {
    const opportunityId = id(req.params.id);
    const removed = await db.transaction(async (tx) => {
      const result = await tx.query("UPDATE opportunities SET status = 'closed', updated_at = NOW() WHERE id = $1 AND owner_id = $2 AND status = 'open' RETURNING id", [opportunityId, req.user.id]);
      if (!result.rows.length) return false;
      await tx.query("INSERT INTO audit_events (actor_id, action, record_id) VALUES ($1, 'opportunity.remove', $2)", [req.user.id, String(opportunityId)]);
      return true;
    });
    if (!removed) return res.status(404).json({ error: "Post not found, already removed, or not owned by you." });
    res.json({ ok: true, id: opportunityId, removed: true });
  });

  async function visibleOpportunity(opportunityId, userId) {
    const result = await db.query("SELECT id, owner_id FROM opportunities WHERE id = $1 AND status = 'open' AND (visibility = 'school' OR owner_id = $2)", [opportunityId, userId]);
    return result.rows[0];
  }

  router.get("/opportunities/:id/interests", async (req, res) => {
    const opportunityId = id(req.params.id);
    const opportunity = await visibleOpportunity(opportunityId, req.user.id);
    if (!opportunity) return res.status(404).json({ error: "Post not found." });
    const result = await db.query(`
      SELECT i.id, i.role, i.message, i.is_private, i.created_at, u.display_name, u.email
      FROM interests i JOIN users u ON u.id = i.user_id WHERE i.opportunity_id = $1
      AND ($2::boolean OR i.user_id = $3 OR NOT i.is_private) ORDER BY i.created_at DESC
    `, [opportunityId, opportunity.owner_id === req.user.id, req.user.id]);
    res.json({ interests: result.rows.map((row) => ({ id: row.id, role: row.role, message: row.message, isPrivate: row.is_private, name: row.display_name, email: row.email, createdAt: row.created_at })) });
  });

  router.post("/opportunities/:id/interests", async (req, res) => {
    const opportunityId = id(req.params.id);
    const input = parse(interestSchema, req.body);
    const stored = await db.transaction(async (tx) => {
      // Lock against concurrent removal so no new expression can attach to a closed post.
      const opportunity = await tx.query("SELECT id FROM opportunities WHERE id = $1 AND status = 'open' AND (visibility = 'school' OR owner_id = $2) FOR UPDATE", [opportunityId, req.user.id]);
      if (!opportunity.rows.length) return false;
      await tx.query(`
        INSERT INTO interests (opportunity_id, user_id, role, message, is_private) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (opportunity_id, user_id) DO UPDATE SET role = EXCLUDED.role, message = EXCLUDED.message, is_private = EXCLUDED.is_private, updated_at = NOW()
      `, [opportunityId, req.user.id, input.role, input.message, input.isPrivate]);
      return true;
    });
    if (!stored) return res.status(404).json({ error: "Post not found or already removed." });
    res.json({ ok: true });
  });

  router.get("/profiles", async (req, res) => {
    const rows = await db.query("SELECT p.*, u.email FROM profiles p JOIN users u ON u.id = p.user_id WHERE NOT u.disabled ORDER BY LOWER(p.name)");
    res.json({ viewer: req.user, profiles: rows.rows.map((row) => ({
      id: row.user_id, email: row.email, name: row.name, school: row.school, department: row.department,
      bio: row.bio, interests: row.interests, expertise: row.expertise, collaborationTypes: row.collaboration_types,
      updatedAt: row.updated_at, isViewer: row.user_id === req.user.id,
    })) });
  });

  router.post("/profiles", async (req, res) => {
    const input = parse(profileSchema, req.body);
    const interests = list(input.interests);
    if (!interests.length) return res.status(400).json({ error: "Add at least one research interest." });
    await db.query(`
      INSERT INTO profiles (user_id, name, school, department, bio, interests, expertise, collaboration_types)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)
      ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name, school = EXCLUDED.school, department = EXCLUDED.department,
        bio = EXCLUDED.bio, interests = EXCLUDED.interests, expertise = EXCLUDED.expertise, collaboration_types = EXCLUDED.collaboration_types, updated_at = NOW()
    `, [req.user.id, input.name, input.school, input.department, input.bio, JSON.stringify(interests), JSON.stringify(list(input.expertise)), JSON.stringify(list(input.collaborationTypes))]);
    res.json({ ok: true });
  });

  router.delete("/profiles/me", async (req, res) => {
    await db.query("DELETE FROM profiles WHERE user_id = $1", [req.user.id]);
    res.json({ ok: true });
  });

  router.get("/grants", async (req, res) => {
    const rows = await db.query("SELECT * FROM funding_opportunities ORDER BY imported_at DESC, LOWER(title)");
    const syncedAt = rows.rows[0]?.imported_at || null;
    res.json({ source: rows.rows.length ? "imported" : "empty", syncedAt, grants: rows.rows.map((row) => ({
      id: `import-${row.id}`, title: row.title, funder: "Research Office",
      scheme: row.min_value || row.max_value ? [row.min_value && `Min ${row.min_value}`, row.max_value && `Max ${row.max_value}`].filter(Boolean).join(" · ") : "Funding call",
      deadline: row.closing_date, status: row.date_added ? `Added ${row.date_added}` : "Imported funding call",
      themes: ["Funding opportunity"], summary: row.additional_info || "See the funding record for full details.",
      url: row.research_professional_url || row.funder_url || null, minValue: row.min_value, maxValue: row.max_value,
    })) });
  });

  router.post("/grants", requireAdmin, async (req, res) => {
    try {
      const imported = await importFunding(db, req.user.id, req.body?.rows);
      res.json({ imported });
    } catch (error) {
      if (error instanceof Error && !error.code) return res.status(400).json({ error: error.message });
      throw error;
    }
  });

  return router;
}
