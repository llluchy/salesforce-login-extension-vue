import { ref, onMounted, onUnmounted } from 'vue'
import { STORAGE_KEY_PASSKEY_REQ } from '../utils/constants'

const isChromeExt = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local

export function usePasskey() {
  const authRequest = ref(null)
  let storageListener = null

  // 监听 chrome.storage 中的 Passkey 认证请求
  const startListening = () => {
    if (!isChromeExt) return

    storageListener = (changes, areaName) => {
      if (areaName === 'local' && changes[STORAGE_KEY_PASSKEY_REQ]) {
        const newValue = changes[STORAGE_KEY_PASSKEY_REQ].newValue
        if (newValue) {
          authRequest.value = newValue
        }
      }
    }

    chrome.storage.onChanged.addListener(storageListener)

    // 初始检查
    chrome.storage.local.get(STORAGE_KEY_PASSKEY_REQ).then(result => {
      if (result[STORAGE_KEY_PASSKEY_REQ]) {
        const req = result[STORAGE_KEY_PASSKEY_REQ]
        if (Date.now() - req.timestamp < 300000) {
          authRequest.value = req
        } else {
          chrome.storage.local.remove(STORAGE_KEY_PASSKEY_REQ)
        }
      }
    })
  }

  // 开发环境模拟：直接触发认证请求
  const triggerMockAuthRequest = (rpId = 'salesforce.com') => {
    authRequest.value = {
      rpId: rpId,
      challenge: 'test-challenge-data',
      allowCredentials: [],
      timestamp: Date.now()
    }
  }

  const stopListening = () => {
    if (storageListener && isChromeExt) {
      chrome.storage.onChanged.removeListener(storageListener)
      storageListener = null
    }
  }

  // 清除认证请求通知
  const dismissAuthRequest = async () => {
    authRequest.value = null
    if (isChromeExt) {
      await chrome.storage.local.remove(STORAGE_KEY_PASSKEY_REQ)
      // 清除 badge
      try {
        await chrome.action.setBadgeText({ text: '' })
      } catch (e) {}
    }
  }

  // 通知 content script 用户选择了 Passkey
  const notifyPasskeySelected = async (tabId, credential, requestId) => {
    if (!isChromeExt) return
    await chrome.runtime.sendMessage({
      action: 'selectPasskeyForAuth',
      tabId,
      requestId,
      credential
    })
  }

  // 通知 content script 用户取消选择
  const notifyPasskeyCancelled = async (tabId, requestId) => {
    if (!isChromeExt) return
    await chrome.runtime.sendMessage({
      action: 'cancelPasskeySelection',
      tabId,
      requestId
    })
  }

  // 为环境添加 Passkey
  const addPasskeyToEnv = (env, passkey) => {
    if (!env.passkeys) {
      env.passkeys = []
    }
    env.passkeys.push(passkey)
  }

  // 从环境移除 Passkey
  const removePasskeyFromEnv = (env, passkeyId) => {
    if (!env.passkeys) return
    env.passkeys = env.passkeys.filter(pk => pk.id !== passkeyId)
  }

  // 生成唯一 ID
  const generatePasskeyId = () => {
    return 'pk_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
  }

  // 创建 Passkey 对象
  const createPasskey = (rpId, challenge) => {
    return {
      id: generatePasskeyId(),
      rpId: rpId,
      challenge: challenge,
      createdAt: Date.now(),
      type: 'system'
    }
  }

  // 绑定 Passkey 到环境
  const bindPasskey = (env, rpId, challenge) => {
    if (!env.passkeys) {
      env.passkeys = []
    }
    
    const existing = env.passkeys.find(pk => pk.rpId === rpId)
    if (!existing) {
      env.passkeys.push(createPasskey(rpId, challenge))
    }
    
    return env.passkeys.find(pk => pk.rpId === rpId)
  }

  // 获取环境中匹配的 Passkey
  const getMatchedPasskey = (env, rpId) => {
    return env.passkeys?.find(pk => pk.rpId === rpId)
  }

  // 检查环境是否有匹配的 Passkey
  const hasMatchedPasskey = (env, rpId) => {
    return env.passkeys?.some(pk => pk.rpId === rpId)
  }

  onMounted(() => {
    startListening()
  })

  onUnmounted(() => {
    stopListening()
  })

  return {
    authRequest,
    startListening,
    stopListening,
    dismissAuthRequest,
    notifyPasskeySelected,
    notifyPasskeyCancelled,
    addPasskeyToEnv,
    removePasskeyFromEnv,
    generatePasskeyId,
    triggerMockAuthRequest,
    createPasskey,
    bindPasskey,
    getMatchedPasskey,
    hasMatchedPasskey
  }
}
