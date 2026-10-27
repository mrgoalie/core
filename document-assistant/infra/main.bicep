// Fabbrini Law Group — Document Assistant: Azure infrastructure (resource-group scope).
//
// Creates a simple, managed architecture owned by the firm:
//   App Service (Linux container) · Azure Database for PostgreSQL Flexible Server · Storage (Blob)
//   Key Vault (secrets) · Container Registry · Log Analytics + Application Insights
// The web app uses a managed identity — no storage or registry keys are stored anywhere.
//
// STATUS: written for this project but NOT yet deployed or validated in Azure. Before the first
// deployment run `az deployment group what-if` (see docs/DEPLOYMENT-AZURE.md). Deploying incurs cost.

targetScope = 'resourceGroup'

@description('Short name used to build resource names (lowercase letters and numbers).')
@minLength(3)
@maxLength(16)
param appName string = 'flgdocassist'

@description('Azure region. Central US is closest to Chicago.')
param location string = 'centralus'

@description('Public address employees will use, e.g. https://ai.windycitylawfirm.com (set up the custom domain after DNS is verified).')
param appBaseUrl string

@description('Microsoft Entra ID tenant (directory) ID of the firm.')
param entraTenantId string

@description('Application (client) ID of the Document Assistant app registration.')
param entraClientId string

@description('Client secret of the app registration. Stored only in Key Vault.')
@secure()
param entraClientSecret string

@description('32-byte base64 key for application-level encryption (npm run generate-key). Stored only in Key Vault.')
@secure()
param storageEncryptionKey string

@description('Administrator password for PostgreSQL. Stored only in Key Vault.')
@secure()
param postgresAdminPassword string

@description('Optional Anthropic API key. Leave empty to start with the demonstration engine.')
@secure()
param anthropicApiKey string = ''

@description('Work email(s) of the first administrator(s), comma-separated.')
param bootstrapAdminEmails string

@description('Container image tag to run, e.g. document-assistant:1.0.0')
param imageTag string = 'document-assistant:latest'

@description('App Service plan size. P0v3 is a good starting point; B2 is cheaper for a pilot.')
param appServiceSku string = 'P0v3'

@description('Use the fictional demonstration matters until the Clio integration is verified.')
@allowed(['mock', 'clio'])
param caseManagement string = 'mock'

// App Service resolves these references at runtime using the web app's managed identity.
func kvRef(vaultName string, secretName string) string => '@Microsoft.KeyVault(VaultName=${vaultName};SecretName=${secretName})'

var suffix = uniqueString(resourceGroup().id)
var names = {
  logs: '${appName}-logs'
  insights: '${appName}-ai'
  vault: take('${appName}kv${suffix}', 24)
  storage: take('${appName}st${suffix}', 24)
  registry: take('${appName}acr${suffix}', 50)
  postgres: '${appName}-pg-${suffix}'
  plan: '${appName}-plan'
  site: '${appName}-${suffix}'
}
var postgresAdmin = 'flgadmin'
var databaseName = 'docassist'

// Built-in role definition IDs.
var roles = {
  keyVaultSecretsUser: '4633458b-17de-408a-b874-0445c86b69e6'
  storageBlobDataContributor: 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
  acrPull: '7f951dda-4ed3-4680-a7ca-43fe172d538d'
}

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: names.logs
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 90
  }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: names.insights
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logs.id
    DisableIpMasking: false
  }
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: names.vault
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
    publicNetworkAccess: 'Enabled'
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: names.storage
  location: location
  sku: { name: 'Standard_ZRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    encryption: {
      keySource: 'Microsoft.Storage'
      services: { blob: { enabled: true } }
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: { enabled: true, days: 14 }
    containerDeleteRetentionPolicy: { enabled: true, days: 14 }
    isVersioningEnabled: true
  }
}

resource documents 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'documents'
  properties: { publicAccess: 'None' }
}

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: names.registry
  location: location
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: names.postgres
  location: location
  sku: { name: 'Standard_B1ms', tier: 'Burstable' }
  properties: {
    version: '16'
    administratorLogin: postgresAdmin
    administratorLoginPassword: postgresAdminPassword
    storage: { storageSizeGB: 32, autoGrow: 'Enabled' }
    backup: { backupRetentionDays: 35, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    network: { publicNetworkAccess: 'Enabled' }
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: databaseName
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}

// Allows connections from Azure services (including this App Service). For a private network,
// see "Hardening" in docs/DEPLOYMENT-AZURE.md (VNet integration + private access).
resource allowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: postgres
  name: 'AllowAzureServices'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

resource requireTls 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: postgres
  name: 'require_secure_transport'
  properties: { value: 'on', source: 'user-override' }
}

// ---- Secrets (Key Vault) ----------------------------------------------------------------------

resource secretDb 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'database-url'
  properties: {
    value: 'postgres://${postgresAdmin}:${uriComponent(postgresAdminPassword)}@${postgres.properties.fullyQualifiedDomainName}:5432/${databaseName}?sslmode=require'
  }
}

resource secretEntra 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'entra-client-secret'
  properties: { value: entraClientSecret }
}

resource secretKey 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'storage-encryption-key'
  properties: { value: storageEncryptionKey }
}

resource secretAnthropic 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(anthropicApiKey)) {
  parent: vault
  name: 'anthropic-api-key'
  properties: { value: anthropicApiKey }
}

// ---- App Service ----------------------------------------------------------------------------

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: names.plan
  location: location
  kind: 'linux'
  sku: { name: appServiceSku }
  properties: { reserved: true }
}


var baseSettings = [
  { name: 'APP_ENV', value: 'production' }
  { name: 'APP_BASE_URL', value: appBaseUrl }
  { name: 'AUTH_MODE', value: 'entra' }
  { name: 'ENTRA_TENANT_ID', value: entraTenantId }
  { name: 'ENTRA_CLIENT_ID', value: entraClientId }
  { name: 'ENTRA_CLIENT_SECRET', value: kvRef(names.vault, 'entra-client-secret') }
  { name: 'DATABASE_URL', value: kvRef(names.vault, 'database-url') }
  { name: 'STORAGE_DRIVER', value: 'azure-blob' }
  { name: 'AZURE_STORAGE_ACCOUNT_URL', value: storage.properties.primaryEndpoints.blob }
  { name: 'AZURE_STORAGE_CONTAINER', value: 'documents' }
  { name: 'STORAGE_ENCRYPTION_KEY', value: kvRef(names.vault, 'storage-encryption-key') }
  { name: 'CASE_MANAGEMENT', value: caseManagement }
  { name: 'BOOTSTRAP_ADMIN_EMAILS', value: bootstrapAdminEmails }
  { name: 'SEED_DEMO_DATA', value: 'false' }
  { name: 'TRUST_PROXY_HEADERS', value: 'true' }
  { name: 'WEBSITES_PORT', value: '8080' }
  { name: 'WEBSITES_ENABLE_APP_SERVICE_STORAGE', value: 'false' }
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: insights.properties.ConnectionString }
]
var aiSettings = empty(anthropicApiKey) ? [] : [{ name: 'ANTHROPIC_API_KEY', value: kvRef(names.vault, 'anthropic-api-key') }]

resource site 'Microsoft.Web/sites@2023-12-01' = {
  name: names.site
  location: location
  kind: 'app,linux,container'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    clientAffinityEnabled: false
    keyVaultReferenceIdentity: 'SystemAssigned'
    siteConfig: {
      linuxFxVersion: 'DOCKER|${registry.properties.loginServer}/${imageTag}'
      acrUseManagedIdentityCreds: true
      alwaysOn: true
      http20Enabled: true
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      healthCheckPath: '/api/health'
      appSettings: concat(baseSettings, aiSettings)
    }
  }
}

resource siteLogs 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'send-to-log-analytics'
  scope: site
  properties: {
    workspaceId: logs.id
    logs: [
      { category: 'AppServiceConsoleLogs', enabled: true }
      { category: 'AppServiceHTTPLogs', enabled: true }
      { category: 'AppServicePlatformLogs', enabled: true }
    ]
    metrics: [{ category: 'AllMetrics', enabled: true }]
  }
}

// ---- Managed-identity permissions (least privilege) ------------------------------------------

resource vaultAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, site.id, roles.keyVaultSecretsUser)
  scope: vault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.keyVaultSecretsUser)
    principalId: site.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource blobAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, site.id, roles.storageBlobDataContributor)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.storageBlobDataContributor)
    principalId: site.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource pullAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, site.id, roles.acrPull)
  scope: registry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.acrPull)
    principalId: site.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output webAppName string = site.name
output defaultHostName string = site.properties.defaultHostName
output registryName string = registry.name
output keyVaultName string = vault.name
output storageAccountName string = storage.name
output postgresServer string = postgres.properties.fullyQualifiedDomainName
