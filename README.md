# TeamUp — Azure edition 1.1

A standalone internal collaboration hub for grant applications and research papers. This version runs on **Azure App Service (Linux container)**, uses **Microsoft Entra ID** for sign-in and **PostgreSQL** for persistent data. It has no OpenAI, Sites, Cloudflare, or ChatGPT runtime dependency.

## What is included

- Grant/paper opportunity posts, topic search and filters.
- Creator-only post removal with confirmation; records are archived for recovery.
- Private expressions of interest, visible to the author and opportunity owner.
- Searchable researcher profiles and contact links.
- Administrator-only Power BI **Excel/CSV export** import with duplicate merging.
- “Form team” from a funding call.
- Single-tenant Entra OIDC sign-in, PKCE, signed-token verification and app roles.
- Server-side PostgreSQL sessions, CSRF protection, migrations and health checks.
- Dockerfile, Azure Bicep provisioning templates and GitHub Actions CI/deployment.

The database starts empty. The removed paper examples and other demo records are **not** seeded. This release contains **no existing user data or credentials** and does not copy the live demo's database.

## Start here

1. [Upload to GitHub](docs/GITHUB.md).
2. [Set up Microsoft Entra](docs/ENTRA.md).
3. [Deploy to Azure](docs/AZURE.md).
4. [Operate and maintain the app](docs/OPERATIONS.md).

An authorised Entra administrator must register the application and assign users/roles. Owning a GitHub repository does not itself grant university authentication or Power BI access. The app only imports authorised report exports; there is no scraping or automatic Power BI query.

## Local development

Requirements: Node.js 24+, npm, and a local PostgreSQL 16+ instance (Docker is optional).

```bash
npm ci
cp .env.example .env
docker compose up -d postgres
npm run build
npm start
```

Configure your own Entra development registration in `.env` and register `http://localhost:3000/auth/microsoft/callback` as a **Web** redirect URI. Alternatively, for loopback-only UI testing, set `ENABLE_DEV_LOGIN=true` with `NODE_ENV=development`, then visit `/login` and choose the clearly labelled local developer sign-in. This helper cannot run in production. The all-zero placeholder Entra IDs in `.env.example` are not real registrations.

Open `http://localhost:3000`. Startup applies pending, checksummed migrations using a PostgreSQL advisory lock. `npm run dev` restarts the backend on changes; rebuild the client after frontend edits (`npm run build`).

To test the backend without Docker/PostgreSQL/Entra credentials:

```bash
npm ci
npm run check
```

Tests use PGlite's embedded PostgreSQL engine and a locally signed mock OIDC provider. They do not contact your tenant or change production data.

## Architecture

| Layer | Implementation |
|---|---|
| Dashboard | React + Vite, preserving the TeamUp design |
| Server | Node.js 24 + Express 5 |
| Sign-in | Entra OIDC authorization-code flow through `openid-client` |
| Sessions and records | PostgreSQL (`pg`) |
| Deployment | Non-root Docker image on Azure App Service |
| CI/CD | GitHub Actions with Azure OIDC federation |

Node/Express replaces the Sites/Vinext server so the application is host-independent. Funding ingestion remains Excel/CSV-first. The runtime never trusts `oai-*` or `x-ms-client-principal` request headers as user identity.

## Configuration

See `.env.example` and `docs/AZURE.md`. Never commit a filled `.env`, a database dump, client secret, or a local parameters file. Production refuses HTTP origins, disabled database TLS, or enabled development login.

`APP_ORIGIN` must match the browser's exact origin and registered redirect URI. All write requests must carry the session CSRF token and that origin. Reverse-proxy rewriting must preserve the configured public origin.

## Release verification and limits

The release checklist is in `RELEASE-NOTES.md`. The initial automated suite covers migrations, persistence, ownership, private interests, profiles, import deduplication, session revocation, CSRF, tenant roles and signed OIDC-token checks. A real Entra login and Azure deployment still require your authorised registration, subscription and secrets; they were not performed while packaging this source.

This is a deployable first release for an institutional pilot, not a completed privacy/security approval or an enterprise scalability certification. No background email notifications, automatic grant synchronisation, or detailed project-management system are included.

MIT licence — see `LICENSE`.
