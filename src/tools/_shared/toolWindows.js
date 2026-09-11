/** 工具独立窗口路径与尺寸（Side Panel / Service Worker 共用） */
export const TOOL_WINDOW_DEFS = {
  'apex-log': {
    page: 'tool-window.html',
    query: 'tool=apex-log',
    width: 1180,
    height: 800,
    type: 'popup'
  },
  soql: {
    page: 'tool-window.html',
    query: 'tool=soql',
    width: 1180,
    height: 800,
    type: 'popup'
  },
  'object-detail': {
    page: 'tool-window.html',
    query: 'tool=object-detail',
    width: 1180,
    height: 800,
    type: 'popup'
  }
}

export function getToolWindowDef(toolId) {
  return TOOL_WINDOW_DEFS[toolId] || null
}

/** 在扩展环境中拼出可打开的完整 URL */
export function buildToolWindowUrl(toolId, extraParams = {}) {
  const def = getToolWindowDef(toolId)
  if (!def || typeof chrome === 'undefined' || !chrome.runtime?.getURL) return null
  const params = new URLSearchParams(def.query || '')
  for (const [k, v] of Object.entries(extraParams)) {
    if (v != null && v !== '') params.set(k, String(v))
  }
  const qs = params.toString()
  return chrome.runtime.getURL(def.page) + (qs ? `?${qs}` : '')
}

/** 打开对象详情（Chrome 新标签页，并前置所在浏览器窗口） */
export async function openObjectDetailTab({ objectName, hostname, recordId } = {}) {
  const extra = {
    object: objectName,
    hostname
  }
  if (recordId) extra.id = recordId

  const url = buildToolWindowUrl('object-detail', extra)
  if (!url) throw new Error('无法构建详情页 URL')

  const tab = await chrome.tabs.create({ url, active: true })
  // 扩展 popup/独立窗口置顶时，仅 active tab 不会前置浏览器；需显式 focus 窗口
  if (tab?.windowId != null) {
    try {
      await chrome.windows.update(tab.windowId, { focused: true })
    } catch {
      // 忽略前置失败，标签仍已创建
    }
  }
  return tab
}

