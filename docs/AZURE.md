# Deploy to Azure App Service + PostgreSQL

This procedure creates chargeable resources. Use an approved subscription/resource group, set a budget alert and confirm current regional/SKU availability with your Azure administrator. No Azure resources were created while generating this package.

## 1. Prepare identities

Create the single-tenant Entra application and app roles described in `ENTRA.md`. The login registration can be in your institution's tenant while the hosting subscription belongs to another approved tenant; keep `ENTRA_*` (user login) separate from `AZURE_*` (GitHub deployment).

The person provisioning infrastructure needs resource deployment and the authority to assign the app's managed identity `AcrPull`. GitHub's deployment identity needs only scoped ACR/App Service deployment permissions, not these provisioning rights.

## 2. Provision the hosting resources

The optional `infra/main.bicep` creates:

- Linux App Service plan and container web app.
- Azure Container Registry (Basic), with admin-password authentication disabled.
- System-assigned App Service identity and an `AcrPull` role assignment.
- PostgreSQL Flexible Server 16, a `teamup` database and 14-day backup retention.

The defaults are small pilot SKUs, not high-availability sizing. Select a region permitted by the institution's data-location policy (e.g. UK South if approved) and confirm SKU availability. The PostgreSQL server has a public endpoint but **no open firewall rule**. See the private-networking note below for institutions requiring private endpoints.

Create a fresh, approved resource group, sign into Azure normally and select the correct subscription. Copy `infra/parameters.example.json` to `infra/parameters.local.json` and fill the bootstrap database password in that ignored file. Better: use an Azure Key Vault parameter reference instead of a local password value. Do not commit the filled file or pass a password in shell command arguments.

```bash
az bicep build --file infra/main.bicep
az deployment group what-if --resource-group YOUR-RESOURCE-GROUP \
  --template-file infra/main.bicep --parameters @infra/parameters.local.json
az deployment group create --resource-group YOUR-RESOURCE-GROUP \
  --name teamup-bootstrap --template-file infra/main.bicep \
  --parameters @infra/parameters.local.json
```

Review `what-if` before creation. The first web app intentionally references a not-yet-pushed `teamup:bootstrap` image, so it is not expected to serve the application until the first GitHub deployment. Templates do not create an Entra registration or install runtime secrets.

Record the non-secret deployment outputs: app name/origin, callback URI, registry name/login server, PostgreSQL server/hostname and App Service possible outbound addresses. Register the exact callback URI with Entra.

## 3. Restrict PostgreSQL networking

In PostgreSQL **Networking**, allow only the App Service's current/possible outbound IPv4 addresses. Do not enable “Allow public access from any Azure service” or a full Internet range.

For reproducible rules, create an ignored `infra/firewall.local.json` containing the PostgreSQL server name and an `allowedIps` array copied from the app's actual outbound-address list, then run:

```bash
az deployment group what-if --resource-group YOUR-RESOURCE-GROUP \
  --template-file infra/firewall.bicep --parameters @infra/firewall.local.json
az deployment group create --resource-group YOUR-RESOURCE-GROUP \
  --template-file infra/firewall.bicep --parameters @infra/firewall.local.json
```

Remove superseded firewall rules when the address list shrinks; incremental template deployment does not delete omitted rules. Recheck addresses after plan/region/network changes. Add a temporary, explicit operator IP only when needed for database setup, then remove that rule.

For an institutional production service, use the institution's approved private-network deployment (App Service VNet integration, PostgreSQL private networking and private DNS). The supplied low-cost pilot template does **not** provision that private topology.

## 4. Create a dedicated database login

Connect as the bootstrap administrator to the `teamup` database using verified TLS. Create a dedicated application role, then set its password interactively:

```sql
CREATE ROLE teamup_app LOGIN;
GRANT CONNECT ON DATABASE teamup TO teamup_app;
GRANT USAGE, CREATE ON SCHEMA public TO teamup_app;
```

In `psql`, `\password teamup_app` prompts without putting the password in a committed SQL file or shell arguments. Use the approved secret-management procedure. The app owns its migration-created tables; it does not require the server administrator role. More hardened deployments can split migration/runtime roles and disable automatic startup migrations after adopting an approved migration pipeline; that is not the default supplied mode.

Set the runtime connection string with this role. Percent-encode reserved characters in username/password:

```text
postgresql://teamup_app:ENCODED_PASSWORD@YOUR-SERVER.postgres.database.azure.com:5432/teamup
```

`DATABASE_TLS=true` configures certificate-verified TLS independently of URI `sslmode`. Node's default CA store is used; set `DATABASE_CA_FILE` only for an institution-approved CA bundle installed in the container. Never set `rejectUnauthorized=false`.

## 5. Configure App Service settings

Install these in **App Service → Environment variables**, or use Key Vault references for secrets. Do not add a filled settings file to GitHub.

| Setting | Required value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `WEBSITES_PORT` | `3000` for the supplied legacy custom-container configuration |
| `APP_ORIGIN` | Exact HTTPS browser origin |
| `INSTITUTION_NAME` | School/institution display name |
| `DATABASE_URL` | Dedicated application PostgreSQL login URL (secret) |
| `DATABASE_TLS` | `true` |
| `ENTRA_TENANT_ID` | Login tenant GUID |
| `ENTRA_CLIENT_ID` | Login Web app registration GUID |
| `ENTRA_CLIENT_SECRET` | Login registration secret (secret) |
| `REQUIRED_ENTRA_ROLE` | `TeamUp.User` |
| `ADMIN_ENTRA_ROLE` | `TeamUp.Admin` |
| `ENABLE_DEV_LOGIN` | `false` |
| `SESSION_HOURS` | `8` (or approved value, 1–24) |
| `TRUST_PROXY_HOPS` | `1` for a single App Service proxy; verify your topology |
| `FUNDING_CALENDAR_URL` | Optional institutional source link |

Use the built-in Microsoft sign-in inside the application. Do **not** replace it with raw Easy Auth headers. App Service Authentication/Easy Auth is not required for this implementation; adding it as a second gate needs a deliberate integration and callback-path review.

The template uses the established Linux custom-container mode (`linuxFxVersion = DOCKER|...`). If your institution uses App Service's newer sidecar-based container model, map the app container port through that model's configuration instead of relying on `WEBSITES_PORT`.

## 6. Configure GitHub deployment and publish

Follow `GITHUB.md` for the `production` environment, Azure OIDC federation and scoped deployment identity. App Service pulls the private registry image using its own managed identity; allow a few minutes for a new role assignment to propagate.

Run the manual deployment workflow. The image starts as a non-root user, applies checksummed migrations transactionally and serves on port 3000. No data is stored in the container filesystem.

## 7. Acceptance checklist

- `GET /health/ready` returns `200` and `{"status":"ready"}`.
- Anonymous `/` redirects to `/login`; anonymous data APIs return `401`.
- An assigned colleague signs in; an unassigned account is refused.
- An administrator sees/imports funding; ordinary colleagues cannot import.
- Create a profile, post an opportunity, submit interest as a second account.
- The owner sees the private interest; an unrelated colleague does not.
- The author removes a post; it stays off the board after refresh.
- Restart/redeploy the container and confirm data remains.
- Test backup restoration before collecting confidential research information.

Actual Entra login, Docker image execution and Azure deployment must be tested in your authorised environment. Local packaging cannot establish your tenant permissions, subscription quotas, firewall connectivity or regional resource availability.

## Primary references

- https://learn.microsoft.com/en-us/azure/app-service/deploy-container-github-action
- https://learn.microsoft.com/en-us/azure/app-service/configure-custom-container
- https://learn.microsoft.com/en-us/azure/postgresql/security/security-tls
- https://learn.microsoft.com/en-us/azure/templates/microsoft.dbforpostgresql/2024-08-01/flexibleservers
