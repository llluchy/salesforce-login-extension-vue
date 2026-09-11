/**
 * 窗口内 Salesforce REST 客户端（Cookie 会话路径）
 * session 由 Service Worker 提供，此处只负责 Bearer 调用
 */

export const SF_API_VERSION = '64.0'
const CLIENT_ID = 'Salesforce Quick Login SOQL'

export function normalizeSfHostname(host) {
  if (!host) return host
  return String(host)
    .replace(/^\./, '')
    .replace(/\.lightning\.force\./, '.my.salesforce.')
    .replace(/\.mcas\.ms$/, '')
}

export class SfRestClient {
  constructor({ hostname, sessionId, apiVersion = SF_API_VERSION } = {}) {
    this.hostname = normalizeSfHostname(hostname)
    this.sessionId = sessionId
    this.apiVersion = apiVersion
  }

  get baseUrl() {
    return `https://${this.hostname}`
  }

  async rest(path, { method = 'GET', body, headers = {} } = {}) {
    if (!this.hostname) throw new Error('未设置 Salesforce 主机')
    if (!this.sessionId) throw new Error('无有效 Session，请重新选择已登录环境')

    const url = path.startsWith('http')
      ? path
      : new URL(path, this.baseUrl).toString()

    const init = {
      method,
      headers: {
        Accept: 'application/json; charset=UTF-8',
        Authorization: `Bearer ${this.sessionId}`,
        'Sforce-Call-Options': `client=${CLIENT_ID}`,
        ...headers
      }
    }
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json; charset=UTF-8'
      init.body = typeof body === 'string' ? body : JSON.stringify(body)
    }

    let res
    try {
      res = await fetch(url, init)
    } catch (e) {
      const err = new Error('网络错误，离线或超时')
      err.name = 'SalesforceRestError'
      throw err
    }

    const text = await res.text()
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = text
    }

    if (res.status >= 200 && res.status < 300) return data

    if (res.status === 401) {
      const err = new Error(
        Array.isArray(data) && data[0]?.message ? data[0].message : 'Session 已过期，请重新登录该 Org'
      )
      err.name = 'Unauthorized'
      throw err
    }

    let message = `HTTP ${res.status}`
    if (Array.isArray(data)) {
      message = data
        .map((d) => `${d.errorCode || ''}: ${d.message || ''}`.trim())
        .join('\n')
    } else if (data?.message) {
      message = data.message
    }
    const err = new Error(message)
    err.name = 'SalesforceRestError'
    err.detail = data
    throw err
  }

  getSObjects() {
    return this.rest(`/services/data/v${this.apiVersion}/sobjects/`)
  }

  describeSObject(name) {
    return this.rest(`/services/data/v${this.apiVersion}/sobjects/${encodeURIComponent(name)}/describe/`)
  }

  query(soql) {
    return this.rest(
      `/services/data/v${this.apiVersion}/query/?q=${encodeURIComponent(soql)}`
    )
  }
}

/** 通过 background 列出已登录环境 */
export function listSfEnvironments() {
  return chrome.runtime.sendMessage({ action: 'listSfEnvironments' })
}

/** 通过 background 按 hostname 取最新 sid */
export function fetchSfSession(hostname) {
  return chrome.runtime.sendMessage({ action: 'getSfSession', hostname })
}
