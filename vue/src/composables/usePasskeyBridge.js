import { useStorage } from './useStorage'
import { useAuth } from './useAuth'

let _listener = null

export function initPasskeyBridge() {
  if (_listener) return

  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) {
    console.warn('[PasskeyBridge] 非扩展环境，跳过消息桥注册')
    return
  }

  const {
    loadEnvironments, saveEnvironments,
    loadPasskeyCredentials, savePasskeyCredential,
    getPasskeyCredentialById, getPasskeyCredentialsByRpId,
    updatePasskeySignCount
  } = useStorage()
  const { isAuthed, getCryptoKeyRaw } = useAuth()

  const requireAuth = () => {
    if (!isAuthed.value || !getCryptoKeyRaw()) {
      return { success: false, error: '请先在扩展面板登录并解锁' }
    }
    return null
  }

  const handlers = {
    'bg:storePasskey': async (msg) => {
      const authErr = requireAuth()
      if (authErr) return authErr
      const c = msg.credential || {}
      return await savePasskeyCredential({
        credentialId: c.credentialId,
        rpId: c.rpId,
        privateKeyJwk: c.privateKeyJwk,
        publicKeyJwk: c.publicKeyJwk,
        userId: c.userId || '',
        userName: c.userName,
        userDisplayName: c.userDisplayName,
        envId: c.envId,
        signCount: c.signCount || 0,
        createdAt: c.createdAt || Date.now()
      })
    },

    'bg:getPasskeys': async (msg) => {
      const authErr = requireAuth()
      if (authErr) return authErr
      const creds = msg.rpId
        ? await getPasskeyCredentialsByRpId(msg.rpId)
        : await loadPasskeyCredentials()
      return { credentials: creds }
    },

    'bg:updatePasskey': async (msg) => {
      const authErr = requireAuth()
      if (authErr) return authErr
      return await savePasskeyCredential(msg.credential)
    },

    'bg:updatePasskeySignCount': async (msg) => {
      const authErr = requireAuth()
      if (authErr) return authErr
      return await updatePasskeySignCount(msg.credentialId, msg.signCount)
    },

    'bg:exportPasskeyBackup': async () => {
      const authErr = requireAuth()
      if (authErr) return authErr
      const [creds, envs] = await Promise.all([
        loadPasskeyCredentials(),
        loadEnvironments()
      ])
      return {
        success: true,
        backup: {
          version: 2,
          exportedAt: new Date().toISOString(),
          credentials: creds,
          environments: envs
        }
      }
    },

    'bg:importPasskeyBackup': async (msg) => {
      const authErr = requireAuth()
      if (authErr) return authErr
      const backup = msg.backup
      if (!backup || !Array.isArray(backup.credentials)) {
        return { success: false, error: '备份文件格式无效' }
      }

      let credCount = 0
      for (const cred of backup.credentials) {
        const r = await savePasskeyCredential(cred)
        if (r?.success) credCount++
      }

      let envCount = 0
      if (Array.isArray(backup.environments) && backup.environments.length > 0) {
        const existing = await loadEnvironments()
        const merged = [...existing]
        for (const env of backup.environments) {
          if (!merged.find(e => e.id === env.id)) {
            merged.push(env)
            envCount++
          }
        }
        await saveEnvironments(merged)
      }

      return {
        success: true,
        imported: {
          credentials: credCount,
          environments: envCount
        }
      }
    },

    'bg:manualBindPasskey': async (msg) => {
      const authErr = requireAuth()
      if (authErr) return authErr
      const cred = msg.credential
      if (!cred || !cred.credentialId) {
        return { success: false, error: '凭证数据不完整：需要 credentialId' }
      }
      return await savePasskeyCredential(cred)
    },

    'bg:getPasskeyById': async (msg) => {
      const authErr = requireAuth()
      if (authErr) return authErr
      const cred = await getPasskeyCredentialById(msg.credentialId)
      return cred
        ? { success: true, credential: cred }
        : { success: false, error: '未找到该 credentialId 对应的凭证' }
    },

    'bg:listPasskeys': async () => {
      const authErr = requireAuth()
      if (authErr) return authErr
      const creds = await loadPasskeyCredentials()
      return {
        success: true,
        credentials: creds.map(c => ({
          credentialId: c.credentialId,
          rpId: c.rpId,
          userId: c.userId,
          userName: c.userName,
          envId: c.envId,
          createdAt: c.createdAt,
          hasPrivateKey: !!c.privateKeyJwk
        }))
      }
    },

    'bg:getEnvironments': async () => {
      const authErr = requireAuth()
      if (authErr) return authErr
      return { environments: await loadEnvironments() }
    },

    'bg:saveNewEnvironment': async (msg) => {
      const authErr = requireAuth()
      if (authErr) return authErr
      const newEnv = msg.environment
      if (!newEnv) return { success: false, error: '环境数据为空' }
      const envs = await loadEnvironments()
      if (!envs.find(e => e.id === newEnv.id)) {
        envs.push(newEnv)
      }
      return await saveEnvironments(envs)
    },

    'bg:bindPasskeyToEnv': async (msg) => {
      const authErr = requireAuth()
      if (authErr) return authErr
      const { envId, passkey } = msg
      if (!envId || !passkey) return { success: false, error: '参数不完整' }
      const envs = await loadEnvironments()
      const idx = envs.findIndex(e => e.id === envId)
      if (idx === -1) return { success: false, error: '未找到环境' }
      if (!envs[idx].passkeys) envs[idx].passkeys = []
      if (!envs[idx].passkeys.find(pk => pk.rpId === passkey.rpId)) {
        envs[idx].passkeys.push(passkey)
      }
      return await saveEnvironments(envs)
    }
  }

  _listener = (msg, sender, sendResponse) => {
    if (!msg || typeof msg.action !== 'string' || !msg.action.startsWith('bg:')) return
    const handler = handlers[msg.action]
    if (!handler) {
      sendResponse({ success: false, error: '未知 Passkey bridge action: ' + msg.action })
      return
    }
    Promise.resolve(handler(msg))
      .then(result => sendResponse(result))
      .catch(err => {
        console.error('[PasskeyBridge] 处理失败', msg.action, err)
        sendResponse({ success: false, error: err.message || String(err) })
      })
    return true
  }

  chrome.runtime.onMessage.addListener(_listener)
  console.log('[PasskeyBridge] 消息监听已注册')
}

export function destroyPasskeyBridge() {
  if (_listener) {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.removeListener(_listener)
    }
    _listener = null
    console.log('[PasskeyBridge] 消息监听已注销')
  }
}