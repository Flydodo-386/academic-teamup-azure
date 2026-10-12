# Security

Do not post secrets, tokens, database exports, staff data, or unpublished ideas in GitHub issues. Report security concerns privately to the repository maintainer using GitHub Private vulnerability reporting where enabled.

This is a pilot-ready software handover, not an institution-approved production service. Complete the institution's security, privacy and hosting review before handling confidential research information.

## Default boundaries

- Every collaboration, funding and profile API requires a server-side session.
- Microsoft OIDC verifies issuer, audience, signature, state, nonce and PKCE.
- A single configured Entra tenant and assigned app roles control access.
- Ownership uses immutable tenant/object identifiers mapped to an internal UUID, never email addresses.
- Mutation requests require a same-origin CSRF token.
- Funding imports require `TeamUp.Admin`; no administrator is granted by default.
- Opportunity removal is a soft archive; private interests are not erased or made public.
- SQL uses parameter binding. Imported links are restricted to HTTP/HTTPS.
- Production session cookies are `__Host-`, Secure, HttpOnly and SameSite=Lax.
- Only hashes of random session cookies are stored in PostgreSQL. Microsoft tokens are not persisted.
- Production database connections require certificate-verified TLS; TLS verification is never disabled.
- Development login is explicit, loopback-only, off by default and forbidden in production.
- GitHub deployment uses OIDC, not a committed Azure credential.

## Administrator responsibilities

Enable Conditional Access/MFA where applicable, keep Entra app-role assignments narrow, rotate the application secret before expiry, review dependencies, set a retention policy and verify backups. Tenant role changes are applied at the next login; sessions expire after eight hours by default. Revoke sessions/disable a local user for immediate removal.

Read `docs/OPERATIONS.md` for revocation, backup, recovery, rollback and retention guidance.
