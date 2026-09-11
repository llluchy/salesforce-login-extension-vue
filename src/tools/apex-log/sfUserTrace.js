/**
 * Apex Log · User 检索与 TraceFlag（窗口内走 SfRestClient，对齐新 SOQL Creator）
 */

import { SfRestClient, fetchSfSession } from '../_shared/sfApi.js'

const TOOLING_API = '59.0'
const STORAGE_KEY_TRACKED = 'sfql_apex_tracked_users'
const DEBUG_LEVEL_NAME = 'SFQL_ApexLog'

function escapeSoql(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

export function buildUserSearchSoql(filters = {}, limit = 40) {
  const clauses = []
  const addLike = (field, value) => {
    const v = String(value || '').trim()
    if (!v) return
    clauses.push(`${field} LIKE '%${escapeSoql(v)}%'`)
  }
  addLike('Name', filters.name)
  addLike('Email', filters.email)
  addLike('Username', filters.username)
  addLike('Alias', filters.alias)
  addLike('FirstName', filters.firstName)
  addLike('LastName', filters.lastName)

  if (filters.isActive === true || filters.isActive === 'true') {
    clauses.push('IsActive = true')
  } else if (filters.isActive === false || filters.isActive === 'false') {
    clauses.push('IsActive = false')
  }

  if (!clauses.length) {
    throw new Error('请至少填写一个检索条件')
  }

  const lim = Math.min(Math.max(Number(limit) || 40, 1), 100)
  return `
    SELECT Id, Name, Username, Email, Alias, FirstName, LastName,
           IsActive, UserType, Profile.Name
    FROM User
    WHERE ${clauses.join(' AND ')}
    ORDER BY Name
    LIMIT ${lim}
  `.replace(/\s+/g, ' ').trim()
}

function mapUserRecord(r) {
  return {
    id: r.Id,
    name: r.Name,
    username: r.Username,
    email: r.Email,
    alias: r.Alias,
    firstName: r.FirstName,
    lastName: r.LastName,
    isActive: r.IsActive,
    userType: r.UserType,
    profileName: r.Profile?.Name || ''
  }
}

/** 按当前环境 hostname 建立与 SOQL 相同的 REST 客户端 */
export async function createEnvRestClient(hostname) {
  const res = await fetchSfSession(hostname)
  if (!res?.success || !res.session?.sessionId) {
    throw new Error(res?.error || '无法获取 Session，请刷新环境')
  }
  return new SfRestClient({
    hostname: res.session.hostname || hostname,
    sessionId: res.session.sessionId
  })
}

export async function searchUsersClient(hostname, filters, limit = 40) {
  const client = await createEnvRestClient(hostname)
  const soql = buildUserSearchSoql(filters, limit)
  const data = await client.query(soql)
  return (data?.records || []).map(mapUserRecord)
}

async function toolingQuery(client, soql) {
  return client.rest(
    `/services/data/v${TOOLING_API}/tooling/query/?q=${encodeURIComponent(soql)}`
  )
}

async function getOrCreateDebugLevel(client) {
  const soql = `SELECT Id, DeveloperName FROM DebugLevel WHERE DeveloperName = '${DEBUG_LEVEL_NAME}' LIMIT 1`
  const found = await toolingQuery(client, soql)
  if (found?.records?.length) return found.records[0].Id

  const created = await client.rest(`/services/data/v${TOOLING_API}/tooling/sobjects/DebugLevel`, {
    method: 'POST',
    body: {
      DeveloperName: DEBUG_LEVEL_NAME,
      MasterLabel: 'SFQL Apex Log',
      ApexCode: 'FINEST',
      ApexProfiling: 'FINEST',
      Callout: 'FINEST',
      Database: 'FINEST',
      System: 'DEBUG',
      Validation: 'INFO',
      Visualforce: 'INFO',
      Workflow: 'INFO'
    }
  })
  return created?.id || null
}

export async function createOrRenewUserTraceFlag(hostname, userId, durationMinutes = 60) {
  if (!userId) throw new Error('缺少用户 Id')
  const client = await createEnvRestClient(hostname)
  const debugLevelId = await getOrCreateDebugLevel(client)
  if (!debugLevelId) throw new Error('无法创建 DebugLevel')

  const expiration = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString()
  const start = new Date().toISOString()
  const soql = `SELECT Id FROM TraceFlag WHERE TracedEntityId = '${escapeSoql(userId)}' LIMIT 1`
  const existing = await toolingQuery(client, soql)

  if (existing?.records?.length) {
    const id = existing.records[0].Id
    await client.rest(`/services/data/v${TOOLING_API}/tooling/sobjects/TraceFlag/${id}`, {
      method: 'PATCH',
      body: {
        DebugLevelId: debugLevelId,
        ExpirationDate: expiration,
        StartDate: start
      }
    })
    return { success: true, renewed: true, userId, traceFlagId: id }
  }

  const created = await client.rest(`/services/data/v${TOOLING_API}/tooling/sobjects/TraceFlag`, {
    method: 'POST',
    body: {
      TracedEntityId: userId,
      DebugLevelId: debugLevelId,
      LogType: 'USER_DEBUG',
      StartDate: start,
      ExpirationDate: expiration
    }
  })
  if (!created?.id) throw new Error('无法创建 TraceFlag')
  return { success: true, created: true, userId, traceFlagId: created.id }
}

async function readTrackedMap() {
  try {
    let data = await chrome.storage.session.get(STORAGE_KEY_TRACKED)
    if (!data?.[STORAGE_KEY_TRACKED]) {
      data = await chrome.storage.local.get(STORAGE_KEY_TRACKED)
    }
    return data?.[STORAGE_KEY_TRACKED] || {}
  } catch {
    return {}
  }
}

async function writeTrackedMap(map) {
  const payload = { [STORAGE_KEY_TRACKED]: map }
  try {
    await chrome.storage.session.set(payload)
  } catch {
    await chrome.storage.local.set(payload)
  }
}

/** 追加追踪用户并写回 storage（供 SW 续期读取） */
export async function persistTrackedUser(envId, user) {
  if (!envId || !user?.id) return []
  const map = await readTrackedMap()
  const list = [...(map[envId] || [])]
  const next = {
    id: user.id,
    name: user.name || user.Name || user.id,
    username: user.username || user.Username || '',
    email: user.email || user.Email || ''
  }
  const idx = list.findIndex((u) => u.id === next.id)
  if (idx >= 0) list[idx] = { ...list[idx], ...next }
  else list.push(next)
  map[envId] = list
  await writeTrackedMap(map)
  return list
}
