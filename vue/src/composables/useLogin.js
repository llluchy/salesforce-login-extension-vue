import { TYPE_URLS } from '../utils/constants'

const isChromeExt = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage

function buildFrontdoorUrl(serverUrl, sessionId) {
  const domainMatch = serverUrl.match(/https:\/\/[^/]+/)
  if (!domainMatch) {
    throw new Error('无法解析服务器地址')
  }
  const domain = domainMatch[0]
  return `${domain}/secur/frontdoor.jsp?sid=${sessionId}&retURL=%2Fhome%2Fhome.jsp`
}

function parseSOAPResponse(xmlText) {
  try {
    const parser = new DOMParser()
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml')
    const sessionIdEl = xmlDoc.querySelector('sessionId')
    const serverUrlEl = xmlDoc.querySelector('serverUrl')
    if (sessionIdEl && serverUrlEl) {
      return {
        sessionId: sessionIdEl.textContent,
        serverUrl: serverUrlEl.textContent
      }
    }
    const faultstring = xmlDoc.querySelector('faultstring')
    if (faultstring) {
      const msg = faultstring.textContent
      if (msg.includes('MFA') || msg.includes('Multi-Factor') || msg.includes('multi-factor')) {
        throw new Error('账号启用了MFA，请使用手动登录')
      }
      if (msg.includes('Invalid username') || msg.includes('Invalid password')) {
        throw new Error('账号或密码错误')
      }
      throw new Error(msg)
    }
  } catch (e) {
    if (e instanceof Error) throw e
  }
  return null
}

export function useLogin() {
  const getLoginUrl = (env) => {
    if (env.type === 'custom') {
      return env.customUrl || TYPE_URLS.production
    }
    return TYPE_URLS[env.type] || TYPE_URLS.production
  }

  const getSoapUrl = (env) => {
    const loginUrl = getLoginUrl(env)
    const domainMatch = loginUrl.match(/https?:\/\/[^/]+/)
    if (!domainMatch) {
      throw new Error('环境地址格式不正确')
    }
    const domain = domainMatch[0]
    return `${domain}/services/Soap/c/64.0/`
  }

  const login = async (env) => {
    if (!env.username || !env.password) {
      throw new Error('缺少登录信息')
    }

    if (isChromeExt) {
      return new Promise((resolve, reject) => {
        const soapUrl = getSoapUrl(env)
        
        chrome.runtime.sendMessage({
          action: 'soapLogin',
          type: env.type,
          url: env.customUrl,
          username: env.username,
          password: env.password
        }, (response) => {
          if (!response || !response.success) {
            console.log('[useLogin] SOAP 登录失败，降级表单POST', response?.error)
            fallbackToFormPost(env, resolve, reject)
            return
          }

          try {
            const result = parseSOAPResponse(response.xmlText)
            if (result) {
              const frontdoorUrl = buildFrontdoorUrl(result.serverUrl, result.sessionId)
              console.log('[useLogin] SOAP 登录成功，使用 frontdoor', { frontdoorUrl })
              chrome.tabs.create({ url: frontdoorUrl })
              resolve({ success: true, method: 'soap' })
            } else {
              console.log('[useLogin] SOAP 返回无有效数据，降级表单POST')
              fallbackToFormPost(env, resolve, reject)
            }
          } catch (e) {
            console.log('[useLogin] SOAP XML 解析失败', e.message)
            fallbackToFormPost(env, resolve, reject)
          }
        })
      })
    } else {
      return new Promise((resolve) => {
        setTimeout(() => {
          console.log('[Mock] Login with:', env.username)
          resolve({ success: true, mock: true })
        }, 500)
      })
    }
  }

  const fallbackToFormPost = (env, resolve, reject) => {
    const loginUrl = getLoginUrl(env)
    
    chrome.runtime.sendMessage({
      action: 'formPostLogin',
      loginUrl,
      username: env.username,
      password: env.password,
      totpCode: env.totpCode || null
    }, (response) => {
      if (response && response.success) {
        resolve({ success: true, method: 'formPost' })
      } else {
        reject(response ? response.error : '表单登录失败')
      }
    })
  }

  const fillTotpCode = async (code) => {
    if (isChromeExt) {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          action: 'fillTotpCode',
          code: code
        }, (response) => {
          if (response && response.success) {
            resolve(response)
          } else {
            reject(response ? response.error : 'Failed to fill TOTP')
          }
        })
      })
    } else {
      return new Promise((resolve) => {
        setTimeout(() => {
          console.log('[Mock] Fill TOTP code:', code)
          resolve({ success: true, mock: true })
        }, 200)
      })
    }
  }

  return {
    getLoginUrl,
    login,
    fillTotpCode
  }
}
