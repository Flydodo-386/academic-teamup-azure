targetScope = 'resourceGroup'

@description('Lowercase project prefix; Azure resource names must be globally unique where required.')
@minLength(3)
@maxLength(12)
param projectPrefix string = 'teamup'
param location string = resourceGroup().location

@secure()
@description('PostgreSQL bootstrap administrator password. Use a dedicated app database role for runtime access.')
@minLength(16)
param postgresAdministratorPassword string

param postgresAdministratorLogin string = 'teamupbootstrap'
param appServiceSku string = 'B1'
param postgresSku string = 'Standard_B1ms'

var suffix = uniqueString(resourceGroup().id)
var registryName = '${projectPrefix}${suffix}'
var webAppName = '${projectPrefix}-${suffix}'
var postgresName = '${projectPrefix}-pg-${suffix}'

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: registryName
  location: location
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${projectPrefix}-plan-${suffix}'
  location: location
  kind: 'linux'
  sku: { name: appServiceSku }
  properties: { reserved: true }
}

resource webApp 'Microsoft.Web/sites@2023-12-01' = {
  name: webAppName
  location: location
  kind: 'app,linux,container'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'DOCKER|${registry.properties.loginServer}/teamup:bootstrap'
      acrUseManagedIdentityCreds: true
      alwaysOn: true
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      healthCheckPath: '/health/ready'
    }
  }
}

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, webApp.id, 'AcrPull')
  scope: registry
  properties: {
    principalId: webApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
  }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: postgresName
  location: location
  sku: { name: postgresSku, tier: 'Burstable' }
  properties: {
    version: '16'
    administratorLogin: postgresAdministratorLogin
    administratorLoginPassword: postgresAdministratorPassword
    storage: { storageSizeGB: 32 }
    backup: { backupRetentionDays: 14, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    network: { publicNetworkAccess: 'Enabled' }
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: 'teamup'
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}

// No open firewall rule and no secrets in outputs. Add only explicit application
// outbound addresses with infra/firewall.bicep after inspecting the created app.
output webAppName string = webApp.name
output appOrigin string = 'https://${webApp.properties.defaultHostName}'
output callbackUrl string = 'https://${webApp.properties.defaultHostName}/auth/microsoft/callback'
output acrName string = registry.name
output acrLoginServer string = registry.properties.loginServer
output postgresServerName string = postgres.name
output postgresHostname string = postgres.properties.fullyQualifiedDomainName
output appPossibleOutboundIps string = webApp.properties.possibleOutboundIpAddresses
