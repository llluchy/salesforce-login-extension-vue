/**
 * Cookie 会话路径：Service Worker 中发现 / 读取 Salesforce sid
 * 对齐 vendor Soql Creator（getSfHost / getSession / getMyDomain）
 * Apex Log / SOQL 共用，勿再维护第二套发现逻辑
 */

/** 与 Soql Creator background 一致：只扫这些父域 */
const ORDERED_DOMAINS = [
  'salesforce.com',
  'cloudforce.com',
  'salesforce.mil',
  'cloudforce.mil',
  'sfcrmproducts.cn',
  'force.com'
]

export function isSalesforceUrl(url) {
  if (!url || url.startsWith('chrome') || url.startsWith('about:')) return false
  try {
    const host = new URL(url).hostname
    return (
      host.endsWith('salesforce.com') ||
      host.endsWith('force.com') ||
      host.endsWith('cloudforce.com') ||
      host.endsWith('visualforce.com') ||
      host.endsWith('salesforce-setup.com') ||
      host.endsWith('sfcrmproducts.cn')
    )
  } catch {
    return false
  }
}

/** API 用主机名（与 Soql SalesforceConnection.getMyDomain 一致） */
export function normalizeSfHostname(host) {
  if (!host) return host
  return String(host)
    .replace(/^\./, '')
    .replace(/\.lightning\.force\./, '.my.salesforce.')
    .replace(/\.mcas\.ms$/, '')
}

export function guessEnvLabel(hostname) {
  const h = (hostname || '').toLowerCase()
  if (h.includes('sandbox') || h.includes('.cs') || h.includes('--')) return 'Sandbox'
  if (h.includes('test') || h.includes('scratch')) return 'Test'
  return 'Production'
}

function cookieOpts(extra = {}) {
  const opts = { ...extra }
  if (opts.storeId == null) delete opts.storeId
  return opts
}

function hostPreferenceScore(hostname) {
  const h = normalizeSfHostname(hostname)
  if (h.includes('.my.salesforce.')) return 100
  if (h.endsWith('salesforce.com') && !h.includes('help.')) return 80
  if (h.includes('cloudforce.com')) return 70
  if (h.includes('lightning.force')) return 40
  if (h.includes('visualforce.com')) return 10
  return 50
}

/**
 * 根据页面 URL 定位会话 Cookie 所在 domain
 * 返回值可能带前导点（与 Soql Creator 一致），供 getSession 原样使用
 */
export async function getSfHost(url, cookieStoreId) {
  try {
    const currentDomain = new URL(url).hostname
    const currentSid = await chrome.cookies.get(
      cookieOpts({ url, name: 'sid', storeId: cookieStoreId })
    )

    if (!currentSid?.value || currentDomain.endsWith('.mcas.ms')) {
      return currentDomain
    }

    const [orgId] = currentSid.value.split('!')
    for (const domain of ORDERED_DOMAINS) {
      try {
        const cookies = await chrome.cookies.getAll(
          cookieOpts({ name: 'sid', domain, secure: true, storeId: cookieStoreId })
        )
        const sessionCookie = cookies.find(
          (c) => c.value.startsWith(orgId + '!') && c.domain !== 'help.salesforce.com'
        )
        if (sessionCookie) return sessionCookie.domain
      } catch {
        // continue
      }
    }
    return currentDomain
  } catch (e) {
    console.error('[SfSession] getSfHost', e)
    try {
      return new URL(url).hostname
    } catch {
      return null
    }
  }
}

/**
 * 读取 sid。sfHost 可带前导点（Soql 原样拼接 https:// + sfHost）
 * 返回的 hostname 已 normalize，可直接作 API instance host
 */
export async function getSession(sfHost, cookieStoreId) {
  if (!sfHost) return null

  const candidates = [
    sfHost,
    String(sfHost).replace(/^\./, ''),
    normalizeSfHostname(sfHost),
    // 若传入已是 my.salesforce，也试 lightning（Cookie 可能只挂在 lightning）
    String(sfHost)
      .replace(/^\./, '')
      .replace(/\.my\.salesforce\./, '.lightning.force.')
  ]
  const unique = [...new Set(candidates.filter(Boolean))]

  for (const host of unique) {
    const urlHost = String(host).replace(/^\./, '')
    try {
      let cookie = await chrome.cookies.get(
        cookieOpts({
          name: 'sid',
          storeId: cookieStoreId,
          url: 'https://' + urlHost
        })
      )
      // Soql：允许 url 带前导点的 host 字符串
      if (!cookie && String(host).startsWith('.')) {
        cookie = await chrome.cookies.get(
          cookieOpts({
            name: 'sid',
            storeId: cookieStoreId,
            url: 'https://' + host
          })
        )
      }
      if (cookie?.value) {
        return {
          key: cookie.value,
          hostname: normalizeSfHostname(cookie.domain || urlHost)
        }
      }
    } catch (e) {
      // try next
    }
  }
  return null
}

function buildEnv(sessionId, hostname, extras = {}) {
  const host = normalizeSfHostname(hostname)
  if (!sessionId || !host || !sessionId.includes('!')) return null
  const orgId = sessionId.split('!')[0]
  return {
    id: orgId,
    orgId,
    name: guessEnvLabel(host),
    label: guessEnvLabel(host),
    sessionId,
    hostname: host,
    instanceUrl: `https://${host}`,
    connectedAt: Date.now(),
    hasSession: true,
    ...extras
  }
}

/**
 * 直接枚举 sid Cookie（主路径，不依赖是否打开 SF 页）
 */
export async function discoverFromCookies(cookieStoreId) {
  /** @type {Map<string, { env: any, score: number }>} */
  const byOrg = new Map()

  for (const domain of ORDERED_DOMAINS) {
    try {
      const cookies = await chrome.cookies.getAll(
        cookieOpts({ name: 'sid', domain, secure: true, storeId: cookieStoreId })
      )
      for (const c of cookies) {
        if (!c?.value?.includes('!')) continue
        if ((c.domain || '').includes('help.salesforce.com')) continue
        const score = hostPreferenceScore(c.domain)
        const env = buildEnv(c.value, c.domain)
        if (!env) continue
        const prev = byOrg.get(env.orgId)
        if (!prev || score > prev.score) {
          byOrg.set(env.orgId, { env, score })
        }
      }
    } catch {
      // continue
    }
  }

  return [...byOrg.values()].map((x) => x.env)
}

export async function extractSessionFromTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId)
    if (!tab?.url || !isSalesforceUrl(tab.url)) return null
    const sfHost = await getSfHost(tab.url, tab.cookieStoreId)
    if (!sfHost) return null
    const session = await getSession(sfHost, tab.cookieStoreId)
    if (!session) return null
    return buildEnv(session.key, session.hostname, {
      tabId: tab.id,
      tabTitle: tab.title || session.hostname
    })
  } catch (e) {
    console.error('[SfSession] extractSessionFromTab', e)
    return null
  }
}

export async function discoverFromTabs() {
  const tabs = await chrome.tabs.query({})
  const envs = []
  for (const tab of tabs) {
    if (!tab?.url || !isSalesforceUrl(tab.url)) continue
    const env = await extractSessionFromTab(tab.id)
    if (env) envs.push(env)
  }
  return envs
}

/**
 * 完整会话发现（含 sessionId），供 Apex Log / 内部使用
 */
export async function discoverSfSessions() {
  /** @type {Map<string, { env: any, score: number }>} */
  const byOrg = new Map()

  const upsert = (env, scoreBoost = 0) => {
    if (!env?.orgId || !env.sessionId) return
    const score = hostPreferenceScore(env.hostname) + scoreBoost
    const prev = byOrg.get(env.orgId)
    if (!prev || score >= prev.score) {
      byOrg.set(env.orgId, {
        env: prev ? { ...prev.env, ...env, sessionId: env.sessionId } : env,
        score
      })
    }
  }

  for (const env of await discoverFromCookies()) upsert(env, 10)
  for (const env of await discoverFromTabs()) upsert(env, 20)

  try {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (active?.url && isSalesforceUrl(active.url)) {
      const env = await extractSessionFromTab(active.id)
      if (env) upsert(env, 40)
    }
  } catch {
    // ignore
  }

  return [...byOrg.values()]
    .map((x) => x.env)
    .sort((a, b) => a.hostname.localeCompare(b.hostname))
}

/**
 * 列出已登录 Org（不把 sessionId 暴露给 UI；SOQL 再调 getSfSession）
 */
export async function listLoggedInSfEnvironments() {
  const sessions = await discoverSfSessions()
  return sessions.map(({ sessionId, ...rest }) => ({
    ...rest,
    hasSession: true
  }))
}
