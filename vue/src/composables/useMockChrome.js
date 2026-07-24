// ============================================
// Mock Chrome API - 模拟浏览器插件 API
// 用于开发服务器中调试插件流程
// ============================================

const _sessionStorage = {}
const _localStorage = {}

export function useMockChrome() {
  const storage = {
    session: {
      get: async (keys) => {
        const result = {}
        const keyList = Array.isArray(keys) ? keys : [keys]
        for (const k of keyList) {
          if (k in _sessionStorage) {
            result[k] = _sessionStorage[k]
          }
        }
        console.log('[MockChrome] storage.session.get', keys, '→', result)
        return result
      },
      set: async (items) => {
        console.log('[MockChrome] storage.session.set', items)
        Object.assign(_sessionStorage, items)
      },
      remove: async (keys) => {
        const keyList = Array.isArray(keys) ? keys : [keys]
        for (const k of keyList) {
          delete _sessionStorage[k]
        }
      }
    },
    local: {
      get: async (keys) => {
        const result = {}
        const keyList = Array.isArray(keys) ? keys : [keys]
        for (const k of keyList) {
          if (k in _localStorage) {
            result[k] = _localStorage[k]
          }
        }
        return result
      },
      set: async (items) => {
        Object.assign(_localStorage, items)
      }
    }
  }

  // 模拟 runtime.sendMessage（直接调用内部 handler）
  let _messageHandler = null
  const runtime = {
    sendMessage: async (message) => {
      console.log('[MockChrome] runtime.sendMessage', message)
      if (!_messageHandler) {
        console.warn('[MockChrome] 没有注册消息处理器')
        return { success: false, error: 'no handler' }
      }
      return new Promise((resolve) => {
        const sendResponse = (resp) => resolve(resp)
        _messageHandler(message, null, sendResponse)
      })
    },
    _setHandler: (handler) => {
      _messageHandler = handler
    }
  }

  // 安装到全局（方便其他模块直接访问）
  if (typeof window !== 'undefined') {
    window.chrome = window.chrome || {}
    window.chrome.storage = storage
    window.chrome.runtime = window.chrome.runtime || {}
    window.chrome.runtime.sendMessage = runtime.sendMessage
  }

  return {
    storage,
    runtime,
    _reset: () => {
      for (const k of Object.keys(_sessionStorage)) delete _sessionStorage[k]
      for (const k of Object.keys(_localStorage)) delete _localStorage[k]
    }
  }
}
