# Microsoft Entra setup

## 1. Register a single-tenant web application

In the institution's Microsoft Entra tenant, an authorised administrator creates an app registration:

- Supported account type: **Accounts in this organisational directory only**.
- Platform: **Web**, not SPA.
- Redirect URI: `https://YOUR-APP.azurewebsites.net/auth/microsoft/callback`.
- Optional separate development registration: `http://localhost:3000/auth/microsoft/callback`.
- Implicit access-token and ID-token grants: leave disabled.
- Create a confidential-client secret, record its expiry and install it securely in App Service/Key Vault.

Set `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, and `ENTRA_CLIENT_SECRET` in App Service. These are **not** Power BI report/app identifiers. No Microsoft Graph or Power BI permissions are requested; sign-in uses `openid profile email`. Institutional consent policy can still require administrator approval.

## 2. Create app roles

Add these app roles, allowed member type **Users/Groups**:

| Display name | Value | Purpose |
|---|---|---|
| TeamUp colleague | `TeamUp.User` | Access the collaboration hub |
| TeamUp administrator | `TeamUp.Admin` | Access the hub and import funding |

The administrator role is sufficient for sign-in; an administrator does not also need the colleague role. Do not create application/service-principal roles with the same intent.

In the Enterprise application, set **Assignment required = Yes** and assign the relevant staff or approved group to the appropriate role. Group-based assignment can depend on the organisation's licensing/policy. Assign yourself the administrator role before your first funding import.

The application enforces these role claims as well as the configured tenant. Signing in with an arbitrary email address does not confer access or administrator privileges. No default administrator is embedded in the source.

## 3. Ownership and sessions

OIDC verifies issuer, audience, signature, expiry, state, nonce and PKCE. The application checks `tid` and `oid`, then maps the immutable tenant/object pair to a PostgreSQL UUID. Email addresses are display/contact information, not ownership credentials.

Microsoft tokens are not stored. The browser receives an opaque, HttpOnly session cookie; PostgreSQL stores only its hash. Sessions last eight hours by default. Local role assignments update at subsequent login; immediately revoke sessions or disable the local user if access must stop sooner.

Apply institutional Conditional Access and MFA policies to the Enterprise application. Review guest assignments explicitly; a guest is not excluded merely because their email has a different domain, so app-role assignment is the access boundary.

## Troubleshooting

- `AADSTS50011`: the registered Web redirect URI must exactly match `APP_ORIGIN + /auth/microsoft/callback`.
- Sign-in returns a generic error: verify the tenant/client IDs, secret expiry and role assignment.
- No import button: sign out/in after receiving `TeamUp.Admin`.
- Callback expires: restart sign-in; transactions last ten minutes and are browser-bound/single-use.
- Deployment identity vs login identity: GitHub's `AZURE_CLIENT_ID` is normally a **separate deployment identity** from the app's `ENTRA_CLIENT_ID`.

## Primary references

- https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
- https://learn.microsoft.com/en-us/entra/identity-platform/howto-add-app-roles-in-apps
- https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference
