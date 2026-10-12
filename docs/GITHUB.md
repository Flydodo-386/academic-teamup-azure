# Share the project through GitHub

Create an empty repository in your own or the institution's authorised GitHub account. Start **private** if institutional code-sharing policy is not yet clear. This package contains only application code/templates, but any data you subsequently upload remains sensitive and must not be added to Git.

From the extracted project directory:

```bash
git init -b main
git add .
git commit -m "Initial standalone TeamUp Azure release"
git remote add origin https://github.com/YOUR-ACCOUNT/teamup.git
git push -u origin main
```

Use GitHub's normal sign-in/credential manager for the push. Do not paste a token into a URL or commit it. Alternatively, GitHub Desktop can publish the extracted folder as a new repository.

The release deliberately does not contain `.git` history from the hosted demo, Sites manifests, tenant IDs, user records, or secrets. Do not include the parent ZIP file in the repository.

## CI

`ci.yml` runs the frontend type-check/build, backend/database/OIDC tests, production dependency audit, Bicep compilation and Docker image build. A successful local check is not a substitute for a successful CI run on your new repository.

## Optional deployment workflow

`deploy-azure.yml` runs only when manually dispatched from `main`; publishing this repository does **not** create resources or deploy automatically.

Create a GitHub environment called `production`, with required reviewers where your GitHub plan supports them. Configure the following environment settings after Azure provisioning:

| Name | Type | Value |
|---|---|---|
| `AZURE_CLIENT_ID` | Secret | Federated Azure deployment identity client ID |
| `AZURE_TENANT_ID` | Secret | Deployment identity tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Secret | Hosting subscription ID |
| `AZURE_ACR_NAME` | Variable | Container registry resource name |
| `AZURE_ACR_LOGIN_SERVER` | Variable | e.g. `registry.azurecr.io` |
| `AZURE_WEBAPP_NAME` | Variable | App Service name |
| `TEAMUP_APP_ORIGIN` | Variable | e.g. `https://your-app.azurewebsites.net` |

Configure a Microsoft Entra federated identity credential for:

- Issuer: `https://token.actions.githubusercontent.com`.
- Subject: `repo:YOUR-ACCOUNT/YOUR-REPOSITORY:environment:production`.
- Audience: `api://AzureADTokenExchange`.

Assign the deployment identity only the necessary scopes: push images to the designated ACR (AcrPush for a conventional registry) and update the designated App Service (e.g. Website Contributor). Institutional Azure RBAC and newer ACR ABAC configurations may require different scoped roles. This identity does not need access to staff data or database passwords.

In GitHub **Actions**, choose **Deploy TeamUp to Azure App Service**, then **Run workflow**. The workflow validates the application, builds/pushes an immutable commit-tagged image, deploys it and checks `/health/ready`.

Runtime Entra/database secrets belong in App Service/Key Vault, not GitHub workflow YAML or the source repository. Pin action versions to reviewed commit SHAs for a hardened institutional production workflow; the supplied workflow uses maintained major-version tags for readability.
