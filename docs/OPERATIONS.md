# TeamUp operations and recovery

## Before a School pilot

Assign named service and database owners. Complete the institution's security/privacy assessment, agree approved hosting and data location, configure a budget alert, set a retention period and test restoration. Publish only non-confidential project summaries and obtain permission before importing internal Research Office listings into this separate service.

Funding import does not grant redistribution rights. SharePoint/Power BI viewing permission is not permission to expose an exported table publicly. The app's default is staff-role-restricted access, not a public website.

## Funding imports

An assigned administrator exports the Power BI **Further Details** table to `.xlsx` (not legacy `.xls`) or CSV, then imports it. The header row must contain recognisable names from `sample-data/funding-import-template.csv`.

- Maximum 5 MB selected file; maximum 2,500 rows per import.
- The entire batch validates before database writes.
- Matching Research Professional URLs update existing calls; otherwise title + closing date + funder URL is used.
- Duplicate rows within a file merge.
- Imports add/update records; they do **not** delete calls missing from the latest export.
- Changed closing dates without a stable source URL can create a second record; review manually.
- The displayed timestamp is the actual latest import time, not the time a user refreshed the page.

There is no automatic Power BI or Microsoft Graph feed in this release.

## Immediate access revocation

Entra assignment changes prevent subsequent logins. Existing local sessions expire within `SESSION_HOURS` but are not automatically notified of role changes. For immediate revocation, an authorised database operator can set the exact user's `disabled` flag and remove their sessions, identifying them by stable tenant/object IDs, not by an ambiguous name/email.

```sql
BEGIN;
UPDATE users SET disabled = TRUE WHERE tenant_id = 'EXACT-TENANT-UUID' AND entra_object_id = 'EXACT-OBJECT-UUID';
DELETE FROM sessions WHERE user_id IN (
  SELECT id FROM users WHERE tenant_id = 'EXACT-TENANT-UUID' AND entra_object_id = 'EXACT-OBJECT-UUID'
);
COMMIT;
```

Review the exact target before running administrative SQL. Removing all sessions is a different operation and is not implied by a one-user revocation.

## Restore an archived opportunity

Owner removal sets `status='closed'` and preserves existing interest messages. Confirm the exact record and owner, then an authorised operator can restore that one record:

```sql
UPDATE opportunities SET status = 'open', updated_at = NOW()
WHERE id = EXACT_NUMERIC_ID AND owner_id = 'EXACT-OWNER-UUID' AND status = 'closed';
```

There is no anonymous restore or account-wide reset endpoint. A user can delete their profile through the protected API; their opportunity archive and interest records follow the institution's retention process.

## Backups, migrations and rollback

- Azure PostgreSQL point-in-time backup is the authoritative data backup. Configure retention and test restoration into a separate server.
- Immutable commit-tagged ACR images allow redeploying an earlier application version.
- Startup migrations use a transaction, advisory lock and stored checksum; applied migration files must not be edited.
- Add new, backward-compatible migration files. Rolling back an image does not roll back database schema.
- Review schema changes before deployment; use a maintenance window and a backup where appropriate.
- The small Bicep template disables HA/geo-redundancy. Adopt the institution's approved resilience topology for production.

## Retention and logs

Expired sessions and sign-in transactions are cleaned hourly and can also be purged with `npm run db:cleanup`. Agree a separate retention/deletion policy for profiles, opportunities, expressions of interest, funding imports and audit events. No destructive all-record retention policy is scheduled by default.

Audit events record actions and IDs, not unpublished summaries or private message bodies. Avoid logging request bodies, cookies, OAuth callback URLs, ID/access tokens, database URLs or Microsoft secrets. Never commit a database export to GitHub.

## Current operational limits

- Authentication/API/database tests run locally; real tenant consent and Azure deployment remain environment-specific acceptance checks.
- Rate limits are process-local. For multiple instances or broad deployment, add an approved shared store or Azure edge/WAF rate limits. Sessions themselves are PostgreSQL-backed and shared across instances.
- The board/directory is intended for a School-sized pilot; no cursor pagination or full-text index tuning is implemented yet.
- No outbound email, subscription digests, automatic grant ingestion or document uploads are implemented.
- Review accessibility with your institution's testing process before launch.
