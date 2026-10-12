# TeamUp Azure 1.1.0

Independent first release, prepared 12 October 2026.

## Changes from the hosted prototype

- Replaced Sites/Vinext/Cloudflare code with a standalone Node/Express backend and React/Vite frontend.
- Replaced platform identity headers with single-tenant Entra OIDC sign-in and stable identity ownership.
- Replaced D1 with PostgreSQL migrations, sessions and transactional imports.
- Kept grant/paper posts, private interest messages, researcher profiles, search, funding import and owner removal.
- Added owner-visible interest messages, explicit administrator roles, CSRF checks and PostgreSQL audit events.
- Removed all seeded posts/funding data and institution-specific embedded report URLs.
- Included Docker, GitHub CI/CD, Azure templates and setup/security/operations guides.
- Left the existing hosted demo unchanged.

## Verified locally

- Frontend strict TypeScript check and optimized production build.
- 12 API, PostgreSQL-engine, session, role and OIDC checks.
- Production dependency audit: zero known vulnerabilities at packaging time.
- Azure Bicep infrastructure and firewall templates compile successfully.

The database tests use PGlite's embedded PostgreSQL engine. OIDC tests use locally signed tokens and mocked HTTPS token/JWKS endpoints; they are not a live institutional Microsoft login. No Azure subscription or GitHub repository was used to provision, push or deploy this release.

Docker execution, Azure deployment, live Entra login and institutional browser/accessibility acceptance require the target environment. Docker is not available in the packaging environment; the GitHub CI workflow builds the container and recompiles the Bicep templates.
