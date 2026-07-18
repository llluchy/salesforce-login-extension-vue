import { STORAGE_KEY, STORAGE_KEY_GROUPS } from '../utils/constants'

const isChromeExt = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync

// 检测是否为旧的测试数据
const isTestEnvironment = (env) => {
  const testAliases = ['生产环境 - 主账号', '测试沙箱 - 开发', '测试沙箱 - QA', '自定义环境']
  return testAliases.includes(env.alias) || ['1', '2', '3', '4'].includes(env.id)
}

const isTestGroup = (group) => {
  const testGroupNames = ['沙箱环境', '特殊环境']
  return testGroupNames.includes(group.name) || ['g1', 'g2'].includes(group.id)
}

export function useStorage() {
  const loadEnvironments = async () => {
    if (isChromeExt) {
      try {
        const result = await chrome.storage.sync.get(STORAGE_KEY)
        const envs = result[STORAGE_KEY] || []
        // 过滤掉测试数据
        return envs.filter(env => !isTestEnvironment(env))
      } catch (e) {
        console.error('Failed to load environments from sync:', e)
        try {
          const localResult = await chrome.storage.local.get(STORAGE_KEY)
          const envs = localResult[STORAGE_KEY] || []
          return envs.filter(env => !isTestEnvironment(env))
        } catch (localErr) {
          return []
        }
      }
    } else {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const envs = JSON.parse(stored)
        // 过滤掉测试数据
        const filtered = envs.filter(env => !isTestEnvironment(env))
        // 如果有变化，保存回存储
        if (filtered.length !== envs.length) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered))
        }
        return filtered
      }
      return []
    }
  }

  const saveEnvironments = async (envs) => {
    if (isChromeExt) {
      try {
        await chrome.storage.sync.set({ [STORAGE_KEY]: envs })
        await chrome.storage.local.set({ [STORAGE_KEY]: envs })
      } catch (e) {
        console.error('Failed to save environments:', e)
        try {
          await chrome.storage.local.set({ [STORAGE_KEY]: envs })
        } catch (localErr) {
          console.error('Failed to save to local:', localErr)
        }
      }
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(envs))
    }
  }

  const loadGroups = async () => {
    if (isChromeExt) {
      try {
        const result = await chrome.storage.sync.get(STORAGE_KEY_GROUPS)
        const groups = result[STORAGE_KEY_GROUPS] || []
        // 过滤掉测试分组
        return groups.filter(group => !isTestGroup(group))
      } catch (e) {
        console.error('Failed to load groups from sync:', e)
        try {
          const localResult = await chrome.storage.local.get(STORAGE_KEY_GROUPS)
          const groups = localResult[STORAGE_KEY_GROUPS] || []
          return groups.filter(group => !isTestGroup(group))
        } catch (localErr) {
          return []
        }
      }
    } else {
      const stored = localStorage.getItem(STORAGE_KEY_GROUPS)
      if (stored) {
        const groups = JSON.parse(stored)
        // 过滤掉测试分组
        const filtered = groups.filter(group => !isTestGroup(group))
        // 如果有变化，保存回存储
        if (filtered.length !== groups.length) {
          localStorage.setItem(STORAGE_KEY_GROUPS, JSON.stringify(filtered))
        }
        return filtered
      }
      return []
    }
  }

  const saveGroups = async (groups) => {
    if (isChromeExt) {
      try {
        await chrome.storage.sync.set({ [STORAGE_KEY_GROUPS]: groups })
        await chrome.storage.local.set({ [STORAGE_KEY_GROUPS]: groups })
      } catch (e) {
        console.error('Failed to save groups:', e)
        try {
          await chrome.storage.local.set({ [STORAGE_KEY_GROUPS]: groups })
        } catch (localErr) {
          console.error('Failed to save groups to local:', localErr)
        }
      }
    } else {
      localStorage.setItem(STORAGE_KEY_GROUPS, JSON.stringify(groups))
    }
  }

  return {
    loadEnvironments,
    saveEnvironments,
    loadGroups,
    saveGroups
  }
}