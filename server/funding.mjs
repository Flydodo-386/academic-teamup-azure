import { createHash } from "node:crypto";
import { safeWebUrl } from "./config.mjs";

const normalise = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
function pick(row, ...names) {
  const map = new Map(Object.entries(row).map(([key, value]) => [normalise(key), value]));
  for (const name of names) if (map.has(normalise(name))) return map.get(normalise(name));
  return "";
}
function text(value, limit = 1000) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string" && typeof value !== "number") throw new Error("Funding cells must contain text or numbers.");
  return String(value).trim().slice(0, limit);
}

export function normaliseFundingRow(row) {
  if (!row || Array.isArray(row) || typeof row !== "object") throw new Error("Invalid funding row.");
  const title = text(pick(row, "Funder & Call", "Funder and Call", "Title", "Funding opportunity"), 240);
  if (title.length < 3) throw new Error("Each funding row needs a Funder & Call or Title column.");
  const dateAdded = text(pick(row, "Date added"), 100);
  const closingDate = text(pick(row, "Closing date", "Deadline"), 100) || "Check call";
  const funderUrl = safeWebUrl(text(pick(row, "Funder Website", "Funder URL"), 2000));
  const minValue = text(pick(row, "Min Application Value GPB", "Min Application Value GBP", "Minimum value"), 100);
  const maxValue = text(pick(row, "Max Application Value GPB", "Max Application Value GBP", "Maximum value"), 100);
  const additionalInfo = text(pick(row, "Additional Information", "Summary", "Description"), 5000);
  const researchProfessionalUrl = safeWebUrl(text(pick(row, "Link to Research Professional", "Research Professional URL"), 2000));
  const basis = researchProfessionalUrl || `${title.toLowerCase().replace(/\s+/g, " ")}|${closingDate.toLowerCase()}|${funderUrl}`;
  const sourceKey = createHash("sha256").update(basis).digest("hex");
  return { sourceKey, title, dateAdded, closingDate, funderUrl, minValue, maxValue, additionalInfo, researchProfessionalUrl };
}

export async function importFunding(db, userId, rawRows) {
  if (!Array.isArray(rawRows) || !rawRows.length || rawRows.length > 2500) throw new Error("Import between 1 and 2,500 funding rows.");
  // Validate the complete batch before writing anything; duplicate keys within an import merge too.
  const rows = [...new Map(rawRows.map((row) => { const parsed = normaliseFundingRow(row); return [parsed.sourceKey, parsed]; })).values()];
  return db.transaction(async (tx) => {
    for (const row of rows) {
      await tx.query(`
        INSERT INTO funding_opportunities (source_key, title, date_added, closing_date, funder_url, min_value, max_value, additional_info, research_professional_url, imported_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (source_key) DO UPDATE SET title = EXCLUDED.title, date_added = EXCLUDED.date_added,
          closing_date = EXCLUDED.closing_date, funder_url = EXCLUDED.funder_url, min_value = EXCLUDED.min_value,
          max_value = EXCLUDED.max_value, additional_info = EXCLUDED.additional_info,
          research_professional_url = EXCLUDED.research_professional_url, imported_by = EXCLUDED.imported_by, imported_at = NOW()
      `, [row.sourceKey, row.title, row.dateAdded, row.closingDate, row.funderUrl, row.minValue, row.maxValue, row.additionalInfo, row.researchProfessionalUrl, userId]);
    }
    await tx.query("INSERT INTO audit_events (actor_id, action, record_id) VALUES ($1, 'funding.import', $2)", [userId, String(rows.length)]);
    return rows.length;
  });
}
