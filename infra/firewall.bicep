targetScope = 'resourceGroup'
param postgresServerName string
@description('Explicit App Service outbound IPv4 addresses. No wildcard or AllowAllAzure rule is created.')
param allowedIps array

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' existing = {
  name: postgresServerName
}
resource rules 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = [for (ip, index) in allowedIps: {
  parent: postgres
  name: 'teamup-outbound-${index}'
  properties: { startIpAddress: ip, endIpAddress: ip }
}]
