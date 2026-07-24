// ============================================
// Mock Passkey Flow - 完整复现浏览器插件 Passkey 登录流程
// 所有数据解析逻辑与插件完全一致，用于在开发服务器中 debug
// ============================================

import { useStorage } from './useStorage'
import { useAuth } from './useAuth'
import { useMockChrome } from './useMockChrome'

export function useMockPasskeyFlow() {
  const mockChrome = useMockChrome()
  const { loadEnvironments, saveEnvironments } = useStorage()
  const { isAuthed, getCryptoKeyRaw } = useAuth()

  const logs = []
  const addLog = (step, detail) => {
    const entry = {
      time: new Date().toLocaleTimeString(),
      step,
      detail: JSON.parse(JSON.stringify(detail, (k, v) => {
        if (typeof v === 'bigint') return v.toString()
        if (v instanceof ArrayBuffer) return '[ArrayBuffer]'
        return v
      }))
    }
    logs.unshift(entry)
    console.log(`[MockFlow] ${step}`, detail)
  }

  // ============================================
  // Step 1: 模拟 handleLogin - 存储 pendingLoginEnv
  // 对应 App.vue handleLogin
  // ============================================
  const step1_handleLogin = async (env) => {
    addLog('① handleLogin 开始', { envId: env?.id, alias: env?.alias })

    // 规范化 passkeys（与 App.vue 完全一致）
    let passkeysToStore = []
    if (Array.isArray(env.passkeys)) {
      passkeysToStore = env.passkeys
    } else if (env.passkeys && typeof env.passkeys === 'object') {
      passkeysToStore = Object.values(env.passkeys)
    }

    const hasPrivateKey = passkeysToStore.length > 0 && passkeysToStore.some(pk => !!pk.privateKeyJwk)
    addLog('① handleLogin - passkeys 规范化结果', {
      count: passkeysToStore.length,
      hasPrivateKey,
      firstPkFields: passkeysToStore.length > 0 ? Object.keys(passkeysToStore[0]) : [],
      firstPk: passkeysToStore.length > 0 ? passkeysToStore[0] : null
    })

    const pendingLoginEnv = {
      id: env.id,
      alias: env.alias,
      username: env.username,
      password: env.password,
      type: env.type,
      customUrl: env.customUrl || '',
      totpSecret: env.totpSecret || '',
      passkeys: passkeysToStore,
      createdAt: Date.now()
    }

    await mockChrome.storage.session.set({ pendingLoginEnv })
    addLog('① handleLogin - 已写入 session storage', { pendingLoginEnv })

    return pendingLoginEnv
  }

  // ============================================
  // Step 2: 模拟 bg:getPendingLoginEnv - usePasskeyBridge.js
  // ============================================
  const step2_getPendingLoginEnv = async (rpId) => {
    addLog('② bg:getPendingLoginEnv 开始', { rpId })

    if (!isAuthed.value || !getCryptoKeyRaw()) {
      addLog('② bg:getPendingLoginEnv - 鉴权失败', {})
      return { success: false, error: '请先在扩展面板登录并解锁' }
    }

    try {
      const result = await mockChrome.storage.session.get(['pendingLoginEnv'])
      const env = result.pendingLoginEnv
      addLog('② bg:getPendingLoginEnv - 从 session storage 读取', {
        hasEnv: !!env,
        envId: env?.id,
        passkeysType: env ? typeof env.passkeys : 'N/A',
        passkeysIsArray: env ? Array.isArray(env.passkeys) : 'N/A',
        passkeysLength: env && Array.isArray(env.passkeys) ? env.passkeys.length : 0,
        rawPasskeys: env?.passkeys
      })

      if (!env) {
        addLog('② bg:getPendingLoginEnv - 无待登录数据', {})
        return { success: false, error: '无待登录数据' }
      }

      // 关键修复：规范化 passkeys（与 usePasskeyBridge.js 完全一致）
      const passkeysArr = Array.isArray(env.passkeys)
        ? env.passkeys
        : (env.passkeys && typeof env.passkeys === 'object')
          ? Object.values(env.passkeys)
          : []

      addLog('② bg:getPendingLoginEnv - passkeys 规范化后', {
        count: passkeysArr.length,
        firstPk: passkeysArr.length > 0 ? passkeysArr[0] : null,
        hasPrivateKey: passkeysArr.length > 0 ? !!passkeysArr[0].privateKeyJwk : false
      })

      let fullPasskeys = []
      if (passkeysArr.length > 0) {
        if (passkeysArr[0].privateKeyJwk) {
          fullPasskeys = passkeysArr
          addLog('② bg:getPendingLoginEnv - 使用现有完整凭证', { count: fullPasskeys.length })
        } else {
          // 从 Supabase 拉取完整环境数据
          addLog('② bg:getPendingLoginEnv - 只有摘要，从 Supabase 拉取完整数据')
          const allEnvs = await loadEnvironments()
          const fullEnv = allEnvs.find(e => e.id === env.id)
          addLog('② bg:getPendingLoginEnv - Supabase 中查到的环境', {
            found: !!fullEnv,
            envId: fullEnv?.id,
            passkeysCount: fullEnv?.passkeys?.length,
            passkeys: fullEnv?.passkeys
          })
          if (fullEnv && Array.isArray(fullEnv.passkeys)) {
            fullPasskeys = fullEnv.passkeys
          }
        }
      }

      addLog('② bg:getPendingLoginEnv - 最终补全的 passkeys', {
        count: fullPasskeys.length,
        hasPrivateKey: fullPasskeys.length > 0 ? !!fullPasskeys[0].privateKeyJwk : false,
        passkeys: fullPasskeys
      })

      const fullEnv = { ...env, passkeys: fullPasskeys }
      addLog('② bg:getPendingLoginEnv - 完成，返回 env', { fullEnv })
      return { success: true, loginEnv: fullEnv }
    } catch (e) {
      addLog('② bg:getPendingLoginEnv - 异常', { error: e.message })
      return { success: false, error: e.message }
    }
  }

  // ============================================
  // Step 3: 模拟 page-world.js requestPendingLoginEnv
  // ============================================
  const step3_requestPendingLoginEnv = async (rpId) => {
    addLog('③ requestPendingLoginEnv 开始', { rpId })
    const response = await step2_getPendingLoginEnv(rpId)
    const env = response.loginEnv
    addLog('③ requestPendingLoginEnv - 收到响应', {
      hasEnv: !!env,
      passkeysType: env ? typeof env.passkeys : 'N/A',
      passkeysIsArray: env ? Array.isArray(env.passkeys) : 'N/A',
      passkeysLength: env && Array.isArray(env.passkeys) ? env.passkeys.length : 0,
      error: response.error
    })
    return env || null
  }

  // ============================================
  // Step 4: 模拟 page-world.js navigator.credentials.get 中的解析
  // ============================================
  const step4_parseForGetAssertion = (pendingEnv) => {
    addLog('④ navigator.credentials.get 中解析 passkeys', { pendingEnv })

    const storedCredentials = (pendingEnv && Array.isArray(pendingEnv.passkeys)) ? pendingEnv.passkeys : []
    addLog('④ storedCredentials（用于 getAssertion）', {
      count: storedCredentials.length,
      credentials: storedCredentials,
      firstHasPrivateKey: storedCredentials.length > 0 ? !!storedCredentials[0].privateKeyJwk : false
    })

    const displayEnvs = pendingEnv
      ? [{
          id: pendingEnv.id || 'pending',
          alias: pendingEnv.alias,
          type: pendingEnv.type || 'production',
          username: pendingEnv.username,
          passkeys: pendingEnv.passkeys,
          _isPending: true
        }]
      : []

    addLog('④ displayEnvs（传给 UI 选择器）', { displayEnvs })

    return { storedCredentials, displayEnvs }
  }

  // ============================================
  // 一键运行完整流程
  // ============================================
  const runFullFlow = async (env, rpId) => {
    logs.length = 0
    addLog('========== 完整流程开始 ==========', { envId: env?.id, rpId })

    await step1_handleLogin(env)
    const pendingEnv = await step3_requestPendingLoginEnv(rpId)
    if (!pendingEnv) {
      addLog('========== 流程结束：无待登录环境 ==========', {})
      return { success: false, error: '无待登录环境' }
    }

    const { storedCredentials, displayEnvs } = step4_parseForGetAssertion(pendingEnv)
    addLog('========== 流程结束 ==========', {
      passkeyCount: storedCredentials.length,
      hasPrivateKey: storedCredentials.length > 0 ? !!storedCredentials[0].privateKeyJwk : false
    })
    return { success: true, pendingEnv, storedCredentials, displayEnvs }
  }

  return {
    logs,
    step1_handleLogin,
    step2_getPendingLoginEnv,
    step3_requestPendingLoginEnv,
    step4_parseForGetAssertion,
    runFullFlow,
    clearLogs: () => { logs.length = 0 }
  }
}
