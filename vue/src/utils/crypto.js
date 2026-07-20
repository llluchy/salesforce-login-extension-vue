// ============================================
// 客户端加密模块（AES-256-GCM + PBKDF2）
// ============================================
// 设计原则：
// 1. 密钥永不离开内存（CryptoKey, extractable=false）
// 2. 每条密文使用独立随机 IV（12 字节）
// 3. AES-GCM 自带完整性校验
// 4. 密文格式统一为 JSON: {"iv": "<base64>", "ct": "<base64>"}
// ============================================

import { PBKDF2_ITERATIONS, SALT_LENGTH, IV_LENGTH } from './supabaseConfig'

const subtle = (() => {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    return crypto.subtle
  }
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    return window.crypto.subtle
  }
  throw new Error('Web Crypto API 不可用')
})()

// ============================================
// 编码辅助
// ============================================
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function generateUuid() {
  return crypto.randomUUID()
}

export function bytesToBase64(bytes) {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64ToBytes(b64) {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

// ============================================
// 随机盐生成
// ============================================
export function generateSalt() {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
}

// ============================================
// 设备码生成与简易转换
// 目的：不是加密，而是简单的不可读
// ============================================

/**
 * 收集设备稳定属性，生成设备指纹
 */
function collectDeviceFingerprint() {
  const parts = []
  
  if (typeof navigator !== 'undefined') {
    parts.push(navigator.userAgent || '')
    parts.push(navigator.platform || '')
    parts.push(navigator.language || '')
    parts.push(String(navigator.hardwareConcurrency || 0))
  }
  
  if (typeof screen !== 'undefined') {
    parts.push(String(screen.width || 0))
    parts.push(String(screen.height || 0))
    parts.push(String(screen.colorDepth || 0))
    parts.push(String(screen.pixelDepth || 0))
  }
  
  return parts.join('|')
}

/**
 * 简易哈希转换（FNV-1a 32位变体）
 * 目的：不是加密，只是把可读字符串变成不可读的乱码
 */
function simpleHash(str) {
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = (hash * 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * 简易混淆：多轮哈希 + 拼接
 * 目的：让设备码看起来更乱，不直接是指纹
 */
function obfuscate(fingerprint) {
  const h1 = simpleHash(fingerprint)
  const h2 = simpleHash(fingerprint + '_salt_v2')
  const h3 = simpleHash(h1 + h2 + fingerprint.length)
  return `${h1}${h2}${h3}`
}

/**
 * 生成设备码
 * 第一次生成后会缓存到内存中
 */
let _cachedDeviceCode = null

export function getDeviceCode() {
  if (_cachedDeviceCode) return _cachedDeviceCode
  
  try {
    const fingerprint = collectDeviceFingerprint()
    _cachedDeviceCode = obfuscate(fingerprint)
  } catch (e) {
    // 降级：生成随机码
    _cachedDeviceCode = 'dev_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
  }
  
  return _cachedDeviceCode
}

// ============================================
// 密钥派生：PBKDF2-SHA256 → AES-256-GCM
// ============================================
export async function deriveKey(password, saltBytes, extractable = false) {
  if (!password) throw new Error('密码不能为空')
  if (!saltBytes || saltBytes.length < 16) throw new Error('salt 至少 16 字节')

  const baseKey = await subtle.importKey(
    'raw',
    textEncoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  )

  const derivedKey = await subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    extractable,
    ['encrypt', 'decrypt']
  )

  return derivedKey
}

export async function exportKeyToJwk(key) {
  return subtle.exportKey('jwk', key)
}

export async function importKeyFromJwk(jwk) {
  return subtle.importKey(
    'jwk',
    jwk,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

// ============================================
// 加密单个字符串字段
// 返回 JSON 字符串：{"iv": "<base64>", "ct": "<base64>"}
// ============================================
export async function encryptField(plaintext, key) {
  if (plaintext === null || plaintext === undefined) return null
  if (plaintext === '') return ''
  if (!key) throw new Error('加密密钥未初始化')

  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const encoded = textEncoder.encode(String(plaintext))

  const ciphertext = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  )

  return JSON.stringify({
    iv: bytesToBase64(iv),
    ct: bytesToBase64(new Uint8Array(ciphertext))
  })
}

// ============================================
// 解密单个字段
// ============================================
export async function decryptField(ciphertext, key) {
  if (ciphertext === null || ciphertext === undefined) return null
  if (ciphertext === '') return ''
  if (!key) throw new Error('解密密钥未初始化')

  let parsed
  try {
    parsed = typeof ciphertext === 'string' ? JSON.parse(ciphertext) : ciphertext
  } catch (e) {
    throw new Error('密文格式无效（非 JSON）')
  }

  if (!parsed.iv || !parsed.ct) {
    throw new Error('密文格式无效（缺 iv/ct）')
  }

  const iv = base64ToBytes(parsed.iv)
  const ct = base64ToBytes(parsed.ct)

  const decrypted = await subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ct
  )

  return textDecoder.decode(decrypted)
}

// ============================================
// 加密整个对象（序列化为 JSON 后加密）
// ============================================
export async function encryptJson(obj, key) {
  if (obj === null || obj === undefined) return null
  if (!key) throw new Error('加密密钥未初始化')
  return encryptField(JSON.stringify(obj), key)
}

// ============================================
// 解密为对象
// ============================================
export async function decryptJson(ciphertext, key) {
  if (ciphertext === null || ciphertext === undefined) return null
  if (ciphertext === '' || ciphertext === '[]') return []
  const plaintext = await decryptField(ciphertext, key)
  if (!plaintext) return null
  return JSON.parse(plaintext)
}

// ============================================
// 加密整个 Environment 对象
// 仅加密敏感字段，非敏感字段保留明文
// ============================================
export async function encryptEnv(env, key, userId) {
  if (!env) return null
  const encrypted = {
    alias: env.alias || '',
    type: env.type || 'production',
    group_id: env.group_id || env.groupId || 'ungrouped',
    sort_order: env.sort_order || env.sortOrder || 0
  }

  // 必须显式写入 user_id（RLS 策略 auth.uid() = user_id 要求）
  if (userId) encrypted.user_id = userId

  // 敏感字段加密
  encrypted.username = await encryptField(env.username || '', key)
  encrypted.password = await encryptField(env.password || '', key)
  encrypted.custom_url = env.custom_url ? await encryptField(env.custom_url, key) : (env.customUrl ? await encryptField(env.customUrl, key) : null)
  encrypted.totp_secret = env.totp_secret ? await encryptField(env.totp_secret, key) : (env.totpSecret ? await encryptField(env.totpSecret, key) : null)
  encrypted.passkeys = (env.passkeys && env.passkeys.length > 0)
    ? await encryptJson(env.passkeys, key)
    : '[]'

  // ID（前端已生成 UUID，直接保留；编辑时保留原 ID）
  if (env.id) {
    encrypted.id = env.id
  }

  // 时间戳（保留原值，用于编辑场景）
  if (env.created_at) encrypted.created_at = env.created_at
  else if (env.createdAt) encrypted.created_at = new Date(env.createdAt).toISOString()
  if (env.updated_at) encrypted.updated_at = env.updated_at
  else if (env.updatedAt) encrypted.updated_at = new Date(env.updatedAt).toISOString()

  return encrypted
}

// ============================================
// 解密 Environment 行（数据库行 → 前端对象）
// ============================================
export async function decryptEnv(row, key) {
  if (!row) return null
  return {
    id: row.id,
    alias: row.alias || '',
    username: await decryptField(row.username, key),
    password: await decryptField(row.password, key),
    type: row.type || 'production',
    customUrl: row.custom_url ? await decryptField(row.custom_url, key) : '',
    groupId: row.group_id || 'ungrouped',
    totpSecret: row.totp_secret ? await decryptField(row.totp_secret, key) : '',
    passkeys: (row.passkeys && row.passkeys !== '[]')
      ? await decryptJson(row.passkeys, key)
      : [],
    sortOrder: row.sort_order || 0,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now()
  }
}

// ============================================
// 加密 Group 对象（无敏感字段，仅做格式转换）
// ============================================
export function encryptGroup(group, userId) {
  if (!group) return null
  const encrypted = {
    name: group.name || '',
    sort_order: group.sortOrder || 0,
    collapsed: !!group.collapsed
  }
  // 必须显式写入 user_id（RLS 策略 auth.uid() = user_id 要求）
  if (userId) encrypted.user_id = userId
  // ID（前端已生成 UUID，直接保留；编辑时保留原 ID）
  if (group.id) {
    encrypted.id = group.id
  }
  if (group.createdAt) encrypted.created_at = new Date(group.createdAt).toISOString()
  if (group.updatedAt) encrypted.updated_at = new Date(group.updatedAt).toISOString()
  return encrypted
}

// ============================================
// 解密 Group 行
// ============================================
export function decryptGroup(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name || '',
    isVirtual: false,
    collapsed: !!row.collapsed,
    sortOrder: row.sort_order || 0,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now()
  }
}

// ============================================
// 加密 Passkey Credential 对象
// 仅 privateKeyJwk / publicKeyJwk 加密，其余明文
// ============================================
export async function encryptPasskeyCredential(cred, key, userId) {
  if (!cred) return null
  const encrypted = {
    credential_id: cred.credentialId || cred.credential_id,
    rp_id: cred.rpId || cred.rp_id || 'salesforce.com',
    user_handle: cred.userId || cred.user_handle || '',
    user_name: cred.userName || cred.user_name || '',
    user_display_name: cred.userDisplayName || cred.user_display_name || '',
    sign_count: cred.signCount || cred.sign_count || 0
  }
  // 必须显式写入 user_id（RLS 策略 auth.uid() = user_id 要求）
  if (userId) encrypted.user_id = userId
  encrypted.private_key_jwk = await encryptJson(cred.privateKeyJwk || cred.private_key_jwk, key)
  encrypted.public_key_jwk = cred.publicKeyJwk || cred.public_key_jwk
    ? await encryptJson(cred.publicKeyJwk || cred.public_key_jwk, key)
    : null

  if (cred.id) {
    encrypted.id = cred.id
  }

  return encrypted
}

// ============================================
// 解密 Passkey Credential 行
// ============================================
export async function decryptPasskeyCredential(row, key) {
  if (!row) return null
  return {
    id: row.id,
    credentialId: row.credential_id,
    rpId: row.rp_id,
    privateKeyJwk: row.private_key_jwk ? await decryptJson(row.private_key_jwk, key) : null,
    publicKeyJwk: row.public_key_jwk ? await decryptJson(row.public_key_jwk, key) : null,
    userId: row.user_handle || '',
    userName: row.user_name || '',
    userDisplayName: row.user_display_name || '',
    envId: null, // 引用关系存在 environments.passkeys 中
    signCount: row.sign_count || 0,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now()
  }
}

// ============================================
// 修改密码时的批量重加密工具
// 输入密文行数组 + 旧密钥 + 新密钥，返回新密文行数组
// ============================================
export async function reencryptEnvs(envRows, oldKey, newKey) {
  // 1. 用旧密钥解密
  const plaintextEnvs = await Promise.all(envRows.map(r => decryptEnv(r, oldKey)))
  // 2. 用新密钥重新加密（保留原 user_id，RLS 需要）
  const newRows = await Promise.all(plaintextEnvs.map((e, i) => encryptEnv(e, newKey, envRows[i].user_id)))
  // 3. 保留原 id
  return newRows.map((row, i) => ({ ...row, id: envRows[i].id }))
}

export async function reencryptPasskeys(pkRows, oldKey, newKey) {
  const plaintext = await Promise.all(pkRows.map(r => decryptPasskeyCredential(r, oldKey)))
  // 保留原 user_id，RLS 需要
  const newRows = await Promise.all(plaintext.map((c, i) => encryptPasskeyCredential(c, newKey, pkRows[i].user_id)))
  return newRows.map((row, i) => ({ ...row, id: pkRows[i].id }))
}
