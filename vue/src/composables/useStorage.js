// ============================================
// 数据存储层（Supabase + 本地缓存）
// ============================================
// 设计要点：
// 1. Supabase 是唯一真相源（single source of truth）
// 2. chrome.storage.local 仅作离线只读缓存（断网时仍可显示）
// 3. 敏感字段在客户端加密后写入 Supabase（密钥来自 useAuth.cryptoKey）
// 4. EditModal / EnvCard 不感知加密，加解密在 saveEnvironments/loadEnvironments 内部完成
// 5. saveEnvironments(envs) 保留数组接口，内部做 diff：upsert 新增/修改 + delete 删除
// ============================================

import { STORAGE_KEY, STORAGE_KEY_GROUPS } from '../utils/constants'
import { getSupabase } from './useSupabase'
import { useAuth } from './useAuth'
import {
  encryptEnv, decryptEnv,
  encryptGroup, decryptGroup
} from '../utils/crypto'

const isChromeExt = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local

const TAG = '[Supabase/Storage]'
const log = (action, detail) => {
  if (detail !== undefined) console.log(`${TAG} ${action}`, detail)
  else console.log(`${TAG} ${action}`)
}
const logError = (action, err) => console.error(`${TAG} ✗ ${action}`, err)
const logWarn = (action, detail) => console.warn(`${TAG} ⚠ ${action}`, detail)

// ============================================
// 本地缓存辅助（chrome.storage.local）
// ============================================
async function cacheSet(key, value) {
  if (!isChromeExt) {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch (e) {}
    return
  }
  try {
    await chrome.storage.local.set({ [key]: value })
  } catch (e) {
    logWarn('cacheSet 失败', { key, error: e.message })
  }
}

async function cacheGet(key) {
  if (!isChromeExt) {
    try {
      const v = localStorage.getItem(key)
      return v ? JSON.parse(v) : null
    } catch (e) { return null }
  }
  try {
    const result = await chrome.storage.local.get(key)
    return result[key]
  } catch (e) {
    logWarn('cacheGet 失败', { key, error: e.message })
    return null
  }
}

async function cacheRemove(key) {
  if (!isChromeExt) {
    try { localStorage.removeItem(key) } catch (e) {}
    return
  }
  try {
    await chrome.storage.local.remove(key)
  } catch (e) {
    logWarn('cacheRemove 失败', { key, error: e.message })
  }
}

// ============================================
// 当前 cryptoKey 获取（来自 useAuth）
// 使用 getCryptoKeyRaw() 避免 readonly Proxy 导致 Web Crypto API 拒绝
// ============================================
function getCryptoKey() {
  const { getCryptoKeyRaw } = useAuth()
  return getCryptoKeyRaw ? getCryptoKeyRaw() : null
}

// ============================================
// 当前 userId 获取（来自 useAuth）
// 用于 RLS 策略 auth.uid() = user_id
// ============================================
function getUserId() {
  const { currentUser } = useAuth()
  return currentUser.value?.id || null
}

// ============================================
// 主 API
// ============================================
export function useStorage() {
  // ----------------------------------------
  // 环境列表
  // ----------------------------------------

  /**
   * 加载所有环境（解密后）
   * 流程：
   * 1. 从 Supabase 拉取
   * 2. 用 cryptoKey 解密
   * 3. 写入 chrome.storage.local 缓存
   * 4. 返回明文 env 数组
   * 失败时 fallback 到 local 缓存（离线场景）
   */
  const loadEnvironments = async () => {
    log('loadEnvironments')
    const supabase = getSupabase()
    const key = getCryptoKey()

    console.log('[Storage] loadEnvironments 检查', { hasSupabase: !!supabase, hasKey: !!key })

    if (!supabase) {
      logWarn('Supabase 未初始化，使用本地缓存')
      const cached = await cacheGet(STORAGE_KEY)
      return Array.isArray(cached) ? cached : []
    }
    if (!key) {
      logWarn('cryptoKey 未派生（未解锁），使用本地缓存')
      const cached = await cacheGet(STORAGE_KEY)
      return Array.isArray(cached) ? cached : []
    }

    try {
      console.log('[Storage] loadEnvironments 开始查询 Supabase')
      const { data, error } = await supabase
        .from('environments')
        .select('*')
        .eq('is_deleted', false)
        .order('sort_order', { ascending: true })

      console.log('[Storage] loadEnvironments 查询结果', { dataLength: data?.length, error: error?.message })

      if (error) throw new Error('Supabase 查询失败：' + error.message)

      const envs = await Promise.all((data || []).map(row => decryptEnv(row, key)))
      log('读取成功', { count: envs.length, ids: envs.map(e => e.id) })

      // 写入本地缓存
      await cacheSet(STORAGE_KEY, envs)
      return envs
    } catch (e) {
      logError('从 Supabase 读取失败，fallback 到本地缓存', e)
      console.error('[Storage] loadEnvironments 异常', e)
      const cached = await cacheGet(STORAGE_KEY)
      return Array.isArray(cached) ? cached : []
    }
  }

  /**
   * 保存环境列表（upsert 增量更新）
   * 流程：
   * 1. 对传入的 envs 数组逐个加密并 upsert
   * 2. 更新本地缓存
   * 删除操作通过 deleteEnvironment() 单独触发，避免本地数据不同步时误删
   */
  const saveEnvironments = async (envs) => {
    log('saveEnvironments', { count: envs?.length || 0 })
    const supabase = getSupabase()
    const key = getCryptoKey()

    if (!supabase) return { success: false, error: 'Supabase 未初始化' }
    if (!key) return { success: false, error: '加密密钥未派生（未解锁）' }

    const envList = Array.isArray(envs) ? envs : []

    // 1. 加密 + upsert
    const rowsToUpsert = []
    for (let i = 0; i < envList.length; i++) {
      const env = envList[i]
      env.sortOrder = i
      env.updatedAt = Date.now()
      if (!env.createdAt) env.createdAt = Date.now()

      const encrypted = await encryptEnv(env, key, getUserId())
      rowsToUpsert.push(encrypted)
    }

    // 2. 批量 upsert
    if (rowsToUpsert.length > 0) {
      const { data: upserted, error: upsertErr } = await supabase
        .from('environments')
        .upsert(rowsToUpsert, { onConflict: 'id' })
        .select('id, created_at, updated_at')
      if (upsertErr) {
        logError('upsert 失败', upsertErr)
        return { success: false, error: '写入失败：' + upsertErr.message }
      }

      if (upserted && upserted.length === envList.length) {
        for (let i = 0; i < envList.length; i++) {
          if (upserted[i].created_at) envList[i].createdAt = new Date(upserted[i].created_at).getTime()
          if (upserted[i].updated_at) envList[i].updatedAt = new Date(upserted[i].updated_at).getTime()
        }
      }
    }

    // 3. 更新本地缓存
    await cacheSet(STORAGE_KEY, envList)
    log('保存成功', { count: envList.length })
    return { success: true }
  }

  /**
   * 删除单个环境（伪删除：仅标记 is_deleted=true 和 deleted_at=now()）
   */
  const deleteEnvironment = async (id) => {
    log('deleteEnvironment (soft)', { id })
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'Supabase 未初始化' }

    const { error } = await supabase
      .from('environments')
      .update({ is_deleted: true, deleted_at: new Date().toISOString() })
      .eq('id', id)
    if (error) {
      logError('伪删除失败', error)
      return { success: false, error: error.message }
    }
    // 更新本地缓存
    const cached = await cacheGet(STORAGE_KEY)
    if (Array.isArray(cached)) {
      await cacheSet(STORAGE_KEY, cached.filter(e => e.id !== id))
    }
    return { success: true }
  }

  // ----------------------------------------
  // 分组列表
  // ----------------------------------------

  const loadGroups = async () => {
    log('loadGroups')
    const supabase = getSupabase()
    const key = getCryptoKey()

    if (!supabase) {
      logWarn('Supabase 未初始化，使用本地缓存')
      const cached = await cacheGet(STORAGE_KEY_GROUPS)
      return Array.isArray(cached) ? cached : []
    }
    if (!key) {
      logWarn('cryptoKey 未派生（未解锁），使用本地缓存')
      const cached = await cacheGet(STORAGE_KEY_GROUPS)
      return Array.isArray(cached) ? cached : []
    }

    try {
      const { data, error } = await supabase
        .from('groups')
        .select('*')
        .order('sort_order', { ascending: true })
      if (error) throw new Error('Supabase 查询失败：' + error.message)

      console.log('[Storage] loadGroups 从 Supabase 获取到', (data || []).length, '条原始数据')
      console.log('[Storage] loadGroups 原始数据:', JSON.stringify(data || [], null, 2))

      const groups = (data || []).map(decryptGroup)
      log('读取成功', { count: groups.length, ids: groups.map(g => g.id) })
      await cacheSet(STORAGE_KEY_GROUPS, groups)
      return groups
    } catch (e) {
      logError('从 Supabase 读取分组失败，fallback 到本地缓存', e)
      console.error('[Storage] loadGroups 失败详情:', e)
      const cached = await cacheGet(STORAGE_KEY_GROUPS)
      console.log('[Storage] loadGroups fallback 到缓存，缓存数据:', cached ? cached.length : 0, '条')
      return Array.isArray(cached) ? cached : []
    }
  }

  const saveGroups = async (groups) => {
    log('saveGroups', { count: groups?.length || 0 })
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'Supabase 未初始化' }

    const groupList = Array.isArray(groups) ? groups : []

    // 1. 加密（分组无敏感字段，仅格式转换）+ upsert
    const rowsToUpsert = []
    for (let i = 0; i < groupList.length; i++) {
      const g = groupList[i]
      g.sortOrder = i
      g.updatedAt = Date.now()
      if (!g.createdAt) g.createdAt = Date.now()
      const encrypted = encryptGroup(g, getUserId())
      rowsToUpsert.push(encrypted)
    }

    if (rowsToUpsert.length > 0) {
      const { data: upserted, error: upsertErr } = await supabase
        .from('groups')
        .upsert(rowsToUpsert, { onConflict: 'id' })
        .select('id, created_at, updated_at')
      if (upsertErr) {
        logError('upsert 分组失败', upsertErr)
        return { success: false, error: upsertErr.message }
      }
      if (upserted && upserted.length === groupList.length) {
        for (let i = 0; i < groupList.length; i++) {
          if (upserted[i].created_at) groupList[i].createdAt = new Date(upserted[i].created_at).getTime()
          if (upserted[i].updated_at) groupList[i].updatedAt = new Date(upserted[i].updated_at).getTime()
        }
      }
    }

    // 2. 更新本地缓存
    await cacheSet(STORAGE_KEY_GROUPS, groupList)
    log('保存分组成功', { count: groupList.length })
    return { success: true }
  }

  const deleteGroup = async (id) => {
    log('deleteGroup', { id })
    const supabase = getSupabase()
    if (!supabase) return { success: false, error: 'Supabase 未初始化' }

    const { error } = await supabase
      .from('groups')
      .delete()
      .eq('id', id)
    if (error) return { success: false, error: error.message }
    const cached = await cacheGet(STORAGE_KEY_GROUPS)
    if (Array.isArray(cached)) {
      await cacheSet(STORAGE_KEY_GROUPS, cached.filter(g => g.id !== id))
    }
    return { success: true }
  }

  // ----------------------------------------
  // Passkey 凭证（独立表，供 background.js 通过消息请求）
  // ----------------------------------------

  /**
   * 加载所有 Passkey 凭证（解密后）
   */
  const loadPasskeyCredentials = async () => {
    log('loadPasskeyCredentials')
    const supabase = getSupabase()
    const key = getCryptoKey()
    if (!supabase || !key) return []

    try {
      const { data, error } = await supabase
        .from('passkey_credentials')
        .select('*')
      if (error) throw new Error(error.message)

      const { decryptPasskeyCredential } = await import('../utils/crypto')
      const creds = await Promise.all((data || []).map(r => decryptPasskeyCredential(r, key)))
      log('读取 Passkey 凭证成功', { count: creds.length })
      return creds
    } catch (e) {
      logError('读取 Passkey 凭证失败', e)
      return []
    }
  }

  /**
   * 保存单个 Passkey 凭证（加密后 upsert）
   */
  const savePasskeyCredential = async (cred) => {
    log('savePasskeyCredential', { credentialId: cred?.credentialId })
    const supabase = getSupabase()
    const key = getCryptoKey()
    if (!supabase) return { success: false, error: 'Supabase 未初始化' }
    if (!key) return { success: false, error: '加密密钥未派生' }

    try {
      const { encryptPasskeyCredential } = await import('../utils/crypto')
      const encrypted = await encryptPasskeyCredential(cred, key, getUserId())
      const { error } = await supabase
        .from('passkey_credentials')
        .upsert(encrypted, { onConflict: 'credential_id' })
      if (error) throw new Error(error.message)
      log('保存 Passkey 凭证成功')
      return { success: true }
    } catch (e) {
      logError('保存 Passkey 凭证失败', e)
      return { success: false, error: e.message }
    }
  }

  /**
   * 按 credentialId 查询单个 Passkey 凭证（解密后）
   * 供 background.js 通过消息中转调用
   */
  const getPasskeyCredentialById = async (credentialId) => {
    log('getPasskeyCredentialById', { credentialId })
    const supabase = getSupabase()
    const key = getCryptoKey()
    if (!supabase || !key) return null

    try {
      const { data, error } = await supabase
        .from('passkey_credentials')
        .select('*')
        .eq('credential_id', credentialId)
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!data) return null

      const { decryptPasskeyCredential } = await import('../utils/crypto')
      return await decryptPasskeyCredential(data, key)
    } catch (e) {
      logError('查询 Passkey 凭证失败', e)
      return null
    }
  }

  /**
   * 按 rpId 过滤 Passkey 凭证（解密后）
   * 供 background.js 在 WebAuthn get 流程中使用
   */
  const getPasskeyCredentialsByRpId = async (rpId) => {
    log('getPasskeyCredentialsByRpId', { rpId })
    const supabase = getSupabase()
    const key = getCryptoKey()
    if (!supabase || !key) return []

    try {
      const { data, error } = await supabase
        .from('passkey_credentials')
        .select('*')
        .eq('rp_id', rpId)
      if (error) throw new Error(error.message)

      const { decryptPasskeyCredential } = await import('../utils/crypto')
      return await Promise.all((data || []).map(r => decryptPasskeyCredential(r, key)))
    } catch (e) {
      logError('按 rpId 查询 Passkey 凭证失败', e)
      return []
    }
  }

  /**
   * 更新 Passkey 凭证的 signCount（防重放）
   */
  const updatePasskeySignCount = async (credentialId, newSignCount) => {
    const supabase = getSupabase()
    if (!supabase) return { success: false }
    const { error } = await supabase
      .from('passkey_credentials')
      .update({ sign_count: newSignCount })
      .eq('credential_id', credentialId)
    if (error) {
      logWarn('更新 signCount 失败', error.message)
      return { success: false, error: error.message }
    }
    return { success: true }
  }

  /**
   * 清空本地缓存（登出时调用）
   */
  const clearCache = async () => {
    await cacheRemove(STORAGE_KEY)
    await cacheRemove(STORAGE_KEY_GROUPS)
    log('本地缓存已清空')
  }

  return {
    // 环境
    loadEnvironments,
    saveEnvironments,
    deleteEnvironment,
    // 分组
    loadGroups,
    saveGroups,
    deleteGroup,
    // Passkey 凭证
    loadPasskeyCredentials,
    savePasskeyCredential,
    getPasskeyCredentialById,
    getPasskeyCredentialsByRpId,
    updatePasskeySignCount,
    // 缓存
    clearCache
  }
}
