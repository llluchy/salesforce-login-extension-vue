import { createApp } from 'vue'
import ToolWindowShell from './_shared/ToolWindowShell.vue'
import SoqlApp from './soql/SoqlApp.vue'
import ObjectDetailApp from './soql/ObjectDetailApp.vue'
import ApexLogApp from './apex-log/ApexLogApp.vue'
import { getToolWindowDef } from './_shared/toolWindows.js'
import '../assets/styles.css'

const params = new URLSearchParams(location.search)
const toolId = params.get('tool') || 'apex-log'
const def = getToolWindowDef(toolId)

if (toolId === 'soql') {
  document.title = 'SOQL Creator'
  createApp(SoqlApp).mount('#app')
} else if (toolId === 'object-detail') {
  document.title = '对象详情'
  createApp(ObjectDetailApp).mount('#app')
} else if (toolId === 'apex-log') {
  document.title = 'Apex Log Viewer'
  createApp(ApexLogApp).mount('#app')
} else {
  document.title = '未知工具'
  createApp(ToolWindowShell, {
    toolId,
    title: '未知工具',
    subtitle: toolId,
    statusText: '未识别的工具标识。'
  }).mount('#app')
}

console.info('[ToolWindow]', toolId, def?.page)
