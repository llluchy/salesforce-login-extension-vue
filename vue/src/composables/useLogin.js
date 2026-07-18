import { TYPE_URLS } from '../utils/constants'

const isChromeExt = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage

export function useLogin() {
  const getLoginUrl = (env) => {
    if (env.type === 'custom') {
      return env.customUrl || TYPE_URLS.production
    }
    return TYPE_URLS[env.type] || TYPE_URLS.production
  }

  const login = async (env) => {
    if (isChromeExt) {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          action: 'login',
          env: env
        }, (response) => {
          if (response && response.success) {
            resolve(response)
          } else {
            reject(response ? response.error : 'Login failed')
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