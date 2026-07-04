@description('Environment name (dev, staging, prod)')
param environmentName string = 'dev'

@description('Azure region for all resources')
param location string = resourceGroup().location

var prefix = 'fullstack-${environmentName}'

resource appServicePlan 'Microsoft.Web/serverfarms@2023-01-01' = {
  name: '${prefix}-plan'
  location: location
  sku: {
    name: 'B2'
    tier: 'Basic'
  }
  properties: {
    reserved: false
  }
}

resource webApp 'Microsoft.Web/sites@2023-01-01' = {
  name: '${prefix}-api'
  location: location
  properties: {
    serverFarmId: appServicePlan.id
    siteConfig: {
      netFrameworkVersion: 'v8.0'
      alwaysOn: true
    }
  }
}

resource sqlServer 'Microsoft.Sql/servers@2023-05-01-preview' = {
  name: '${prefix}-sql'
  location: location
  properties: {
    administratorLogin: 'sqladmin'
    minimalTlsVersion: '1.2'
  }
}

resource sqlDatabase 'Microsoft.Sql/servers/databases@2023-05-01-preview' = {
  parent: sqlServer
  name: 'FullStackDb'
  location: location
  sku: {
    name: 'Basic'
    tier: 'Basic'
  }
}

resource staticWebApp 'Microsoft.Web/staticSites@2023-01-01' = {
  name: '${prefix}-portal'
  location: location
  sku: {
    name: 'Free'
    tier: 'Free'
  }
}

output webAppUrl string = 'https://${webApp.properties.defaultHostName}'
output staticSiteUrl string = 'https://${staticWebApp.properties.defaultHostname}'
