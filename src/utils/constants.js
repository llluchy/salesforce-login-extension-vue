// 环境列表的本地缓存 key（仅用于离线只读缓存）
export const STORAGE_KEY = 'salesforce_environments'
// 分组列表的本地缓存 key
export const STORAGE_KEY_GROUPS = 'salesforce_groups'

// Passkey 临时通信 key（content script ↔ side panel，与 Supabase 无关）
export const STORAGE_KEY_PASSKEY_REQ = '__sf_passkey_auth_request'
export const STORAGE_KEY_PASSKEY_REG = '__sf_passkey_pending_registration'

// Supabase session 在 chrome.storage.local 中的同步 key（供 background.js 使用）
export const STORAGE_KEY_SESSION = '__sf_supabase_session'

export const MAX_ENVIRONMENTS = 50

export const TYPE_URLS = {
  production: 'https://login.salesforce.com',
  sandbox: 'https://test.salesforce.com',
  custom: ''
}

export const TYPE_LABELS = {
  production: 'Production',
  sandbox: 'SandBox',
  custom: '自定义'
}
