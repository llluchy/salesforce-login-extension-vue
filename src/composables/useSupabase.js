// ============================================
// Supabase Client 单例
// ============================================
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON_KEY, isSupabaseConfigured } from '../utils/supabaseConfig'

let _client = null
let _initError = null

/**
 * 获取 Supabase Client 单例
 * 在 Chrome 扩展 Side Panel 中使用 localStorage 持久化 session
 * 在 background.js 中通过 chrome.storage.local 手动同步 session
 */
export function getSupabase() {
  if (_client) return _client

  if (!isSupabaseConfigured()) {
    _initError = 'Supabase 未配置：请在 src/utils/supabaseConfig.js 填入项目 URL 和 anon key'
    console.error('[Supabase]', _initError)
    return null
  }

  try {
    _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        // Side Panel 中 localStorage 可用；Supabase SDK 自动持久化 session
        persistSession: true,
        autoRefreshToken: true,
        // 扩展内不通过 URL 检测 OAuth 回调
        detectSessionInUrl: false,
        // session 持久化用的 storage key 前缀
        storageKey: '__sf_supabase_auth'
      }
    })
    return _client
  } catch (e) {
    _initError = e.message
    console.error('[Supabase] Client 初始化失败', e)
    return null
  }
}
