// ============================================
// 云同步日志工具
// 统一前缀 [CloudSync]，便于在 DevTools 中筛选
// 控制开关：localStorage.syncDebug = '1' 可强制开启
// ============================================

const TAG = '[CloudSync]'
const ENABLED = true // 调试阶段默认开启

const isDebug = () => {
  if (!ENABLED) return false
  try {
    if (typeof localStorage !== 'undefined' && localStorage.syncDebug === '0') {
      return false
    }
  } catch (e) {
    // 某些上下文无 localStorage
  }
  return true
}

// 截断长字符串，避免日志爆炸
const truncate = (str, max = 200) => {
  if (!str) return str
  if (typeof str !== 'string') str = JSON.stringify(str)
  return str.length > max ? str.slice(0, max) + `...(${str.length}chars)` : str
}

// 计算对象 JSON 大小（字节）
const byteSize = (obj) => {
  try {
    return new Blob([JSON.stringify(obj)]).size
  } catch (e) {
    return -1
  }
}

export const syncLog = {
  // 普通信息
  info(action, detail) {
    if (!isDebug()) return
    if (detail !== undefined) {
      console.log(`${TAG} ${action}`, detail)
    } else {
      console.log(`${TAG} ${action}`)
    }
  },

  // 成功
  ok(action, detail) {
    if (!isDebug()) return
    console.log(`%c${TAG} ✓ ${action}`, 'color:#1976d2;font-weight:600', detail || '')
  },

  // 警告
  warn(action, detail) {
    if (!isDebug()) return
    console.warn(`${TAG} ⚠ ${action}`, detail || '')
  },

  // 错误
  error(action, err) {
    if (!isDebug()) return
    console.error(`${TAG} ✗ ${action}`, err || '')
  },

  // 分组
  group(title) {
    if (!isDebug()) return
    console.groupCollapsed(`%c${TAG} ${title}`, 'color:#0d47a1;font-weight:600')
  },

  groupEnd() {
    if (!isDebug()) return
    console.groupEnd()
  },

  // 工具方法
  truncate,
  byteSize,

  // 打印环境摘要（不包含密码/私钥）
  envSummary(env) {
    if (!env) return '(null)'
    return {
      id: env.id,
      alias: env.alias,
      username: env.username,
      type: env.type,
      groupId: env.groupId,
      hasTotp: !!env.totpSecret,
      passkeyCount: env.passkeys?.length || 0,
      createdAt: env.createdAt,
      updatedAt: env.updatedAt
    }
  },

  envsSummary(envs) {
    if (!Array.isArray(envs)) return '(not array)'
    return {
      count: envs.length,
      ids: envs.map(e => e.id),
      items: envs.map(e => this.envSummary(e))
    }
  },

  groupsSummary(groups) {
    if (!Array.isArray(groups)) return '(not array)'
    return {
      count: groups.length,
      items: groups.map(g => ({ id: g.id, name: g.name, updatedAt: g.updatedAt }))
    }
  }
}

export default syncLog
