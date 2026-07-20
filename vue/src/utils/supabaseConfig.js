// ============================================
// Supabase 项目配置
// ============================================
// 使用说明：
// 1. 在 https://supabase.com 创建项目后，进入项目设置 → API
// 2. 复制 "Project URL" 填入 SUPABASE_URL
// 3. 复制 "anon public" key 填入 SUPABASE_ANON_KEY
// 4. anon key 可安全硬编码进扩展（受 RLS 保护）
// 5. service_role key 永远不要放进扩展代码
// ============================================

export const SUPABASE_URL = 'https://ulcqqmhykqxdpcoveidf.supabase.co'
export const SUPABASE_ANON_KEY = 'sb_publishable_b0Xs0scWJ24ZfSye2YV7JA_T-EPwjIF'

// 加密参数
export const PBKDF2_ITERATIONS = 100000
export const SALT_LENGTH = 32
export const IV_LENGTH = 12
export const AES_KEY_LENGTH = 256

// 标记配置是否已填写
export const isSupabaseConfigured = () => {
  return !SUPABASE_URL.includes('YOUR_PROJECT_REF') &&
         !SUPABASE_ANON_KEY.includes('YOUR_ANON_KEY') &&
         SUPABASE_URL.startsWith('https://') &&
         SUPABASE_ANON_KEY.length > 20
}
