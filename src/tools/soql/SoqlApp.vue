<template>
  <div class="soql-app">
    <header class="soql-header">
      <h1>SOQL Creator</h1>
      <div class="soql-header-actions">
        <select
          v-model="selectedEnvId"
          class="env-select"
          :disabled="loadingEnvs || envs.length === 0"
          @change="onEnvChange"
        >
          <option disabled value="">
            {{ loadingEnvs ? '正在扫描已登录环境…' : (envs.length ? '选择已登录环境' : '无已登录环境') }}
          </option>
          <option v-for="env in envs" :key="env.id" :value="env.id">
            {{ env.label }} · {{ env.hostname }}
          </option>
        </select>
        <button type="button" class="btn btn-light" :disabled="loadingEnvs" @click="refreshEnvs">
          刷新环境
        </button>
      </div>
    </header>

    <div v-if="!selectedEnv" class="soql-empty">
      <div class="empty-card">
        <h2>请先选择已登录环境</h2>
        <p>
          本工具使用 Cookie 会话，不依赖扩展账户。请先在浏览器中打开并登录 Salesforce，
          然后点击「刷新环境」。
        </p>
        <button type="button" class="btn btn-primary" :disabled="loadingEnvs" @click="refreshEnvs">
          {{ loadingEnvs ? '扫描中…' : '刷新环境列表' }}
        </button>
        <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>
      </div>
    </div>

    <div v-else class="soql-body">
      <aside class="panel objects-panel">
        <div class="panel-head">
          <span>对象</span>
          <span class="count">{{ filteredObjects.length }}</span>
        </div>
        <input
          v-model.trim="objectSearch"
          class="search-input"
          type="search"
          placeholder="搜索对象标签 / API"
        />
        <div class="list-scroll">
          <div
            v-for="obj in filteredObjects"
            :key="obj.name"
            :class="['list-item', { active: currentObject?.name === obj.name }]"
            role="button"
            tabindex="0"
            @click="selectObject(obj)"
            @keydown.enter.prevent="selectObject(obj)"
          >
            <div class="item-top">
              <span class="item-label">{{ obj.label }}</span>
              <button
                type="button"
                class="obj-detail-btn"
                title="查看对象详情"
                @click.stop="openObjectDetail(obj)"
              >详</button>
            </div>
            <span class="item-api">{{ obj.name }}</span>
          </div>
          <p v-if="loadingObjects" class="list-hint">加载对象中…</p>
          <p v-else-if="filteredObjects.length === 0" class="list-hint">无匹配对象</p>
        </div>
      </aside>

      <section class="panel fields-panel">
        <div class="panel-head">
          <span>字段 {{ currentObject ? `· ${currentObject.label}` : '' }}</span>
          <span class="count">{{ selectedFieldNames.length }}/{{ filteredFields.length }}</span>
        </div>
        <div class="field-toolbar">
          <input
            v-model.trim="fieldSearch"
            class="search-input"
            type="search"
            placeholder="搜索字段"
            :disabled="!currentObject"
          />
          <div class="field-filter-chips">
            <button
              type="button"
              :class="['chip', { active: fieldKindFilter === 'all' }]"
              :disabled="!currentObject"
              @click="fieldKindFilter = 'all'"
            >全部</button>
            <button
              type="button"
              :class="['chip', { active: fieldKindFilter === 'standard' }]"
              :disabled="!currentObject"
              @click="fieldKindFilter = 'standard'"
            >标准</button>
            <button
              type="button"
              :class="['chip', { active: fieldKindFilter === 'custom' }]"
              :disabled="!currentObject"
              @click="fieldKindFilter = 'custom'"
            >自定义</button>
          </div>
          <div class="field-actions">
            <button type="button" class="btn btn-sm" :disabled="!currentObject" @click="selectAllFields">全选</button>
            <button type="button" class="btn btn-sm" :disabled="!currentObject" @click="clearFields">清空</button>
          </div>
        </div>
        <div class="list-scroll fields-list">
          <button
            v-for="field in filteredFields"
            :key="field.name"
            type="button"
            :class="['field-item', { selected: selectedFieldSet.has(field.name) }]"
            :title="fieldTooltip(field)"
            @click="toggleField(field.name)"
            @dblclick.stop="copyFieldText(field)"
          >
            <span
              class="field-line1 field-copyable"
              :title="field.label"
              @click.stop="onFieldTextClick(field.name, field.label)"
            >{{ field.label }}</span>
            <span class="field-line2">
              <span
                class="field-api field-copyable"
                :title="field.name"
                @click.stop="onFieldTextClick(field.name, field.name)"
              >{{ field.name }}</span>
              <span class="field-type">{{ field.type }}</span>
            </span>
          </button>
          <p v-if="loadingFields" class="list-hint">加载字段中…</p>
          <p v-else-if="!currentObject" class="list-hint">请先选择对象</p>
          <p v-else-if="filteredFields.length === 0" class="list-hint">无匹配字段</p>
        </div>
      </section>

      <section class="query-panel">
        <div class="panel-head">
          <span>SOQL</span>
          <div class="query-actions">
            <label class="limit-toggle">
              <input v-model="limitEnabled" type="checkbox" />
              <span>LIMIT</span>
            </label>
            <input
              v-model.number="queryLimit"
              type="number"
              min="1"
              max="2000"
              class="limit-input"
              :disabled="!limitEnabled"
            />
            <button type="button" class="btn btn-sm" :disabled="!canBuildQuery" @click="applyGeneratedQuery">生成</button>
            <button type="button" class="btn btn-sm" :disabled="!soqlText.trim()" @click="copySoql">复制</button>
            <button type="button" class="btn btn-primary btn-sm" :disabled="!canExecute || executing" @click="executeQuery">
              {{ executing ? '执行中…' : '执行' }}
            </button>
          </div>
        </div>
        <textarea
          v-model="soqlText"
          class="soql-editor"
          spellcheck="false"
          placeholder="SELECT Id, Name FROM Account"
        />
        <p v-if="errorMessage" class="error-text inline-error">{{ errorMessage }}</p>
        <p v-if="statusMessage" class="status-text">{{ statusMessage }}</p>

        <div class="results-head">
          <span>查询结果</span>
          <span class="count" v-if="resultRows.length">{{ resultRows.length }} 行{{ resultDone === false ? '（未完）' : '' }}</span>
        </div>
        <div class="results-wrap">
          <table v-if="resultColumns.length" class="results-table">
            <thead>
              <tr>
                <th class="col-detail">详</th>
                <th v-for="col in resultColumns" :key="col">{{ col }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, idx) in resultRows" :key="idx">
                <td class="col-detail">
                  <button
                    type="button"
                    class="obj-detail-btn"
                    title="查看该记录字段详情"
                    :disabled="!rowRecordId(row)"
                    @click="openRecordDetail(row)"
                  >详</button>
                </td>
                <td v-for="col in resultColumns" :key="col">{{ formatCell(row[col]) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="list-hint results-empty">执行查询后在此显示结果</p>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { SfRestClient, listSfEnvironments, fetchSfSession } from '../_shared/sfApi.js'
import { DEFAULT_STANDARD_WHITELIST, getObjectKind } from './soqlConstants.js'
import { openObjectDetailTab } from '../_shared/toolWindows.js'

const envs = ref([])
const selectedEnvId = ref('')
const loadingEnvs = ref(false)

const objects = ref([])
const objectSearch = ref('')
const currentObject = ref(null)
const loadingObjects = ref(false)

const fieldsMap = ref({})
const fieldSearch = ref('')
const fieldKindFilter = ref('all') // all | standard | custom
const selectedFieldSet = ref(new Set())
const selectedFieldNames = ref([])
const loadingFields = ref(false)

const soqlText = ref('')
const limitEnabled = ref(false)
const queryLimit = ref(10)
const executing = ref(false)
const resultColumns = ref([])
const resultRows = ref([])
const resultDone = ref(true)

const errorMessage = ref('')
const statusMessage = ref('')

let client = null

const selectedEnv = computed(() => envs.value.find((e) => e.id === selectedEnvId.value) || null)

const filteredObjects = computed(() => {
  const q = objectSearch.value.toLowerCase()
  let list = objects.value
  if (q) {
    list = list.filter(
      (o) => o.label.toLowerCase().includes(q) || o.name.toLowerCase().includes(q)
    )
  }
  return list
})

const filteredFields = computed(() => {
  let list = Object.values(fieldsMap.value)
  if (fieldKindFilter.value === 'standard') {
    list = list.filter((f) => !String(f.name).endsWith('__c'))
  } else if (fieldKindFilter.value === 'custom') {
    list = list.filter((f) => String(f.name).endsWith('__c'))
  }
  const q = fieldSearch.value.toLowerCase()
  if (q) {
    list = list.filter(
      (f) => f.label.toLowerCase().includes(q) || f.name.toLowerCase().includes(q)
    )
  }
  return list
})

const canBuildQuery = computed(
  () => !!currentObject.value && selectedFieldNames.value.length > 0
)
const canExecute = computed(() => !!selectedEnv.value && !!soqlText.value.trim())

function syncSelectedArray() {
  // 按字段列表（describe）顺序，而非点击顺序
  selectedFieldNames.value = Object.keys(fieldsMap.value).filter((name) =>
    selectedFieldSet.value.has(name)
  )
}

function fieldTooltip(field) {
  return `${field.label}\n${field.name} · ${field.type}`
}

async function copyText(text) {
  const value = String(text || '')
  if (!value) return
  try {
    await navigator.clipboard.writeText(value)
    statusMessage.value = `已复制：${value}`
  } catch {
    errorMessage.value = '复制失败'
  }
}

async function copyFieldText(field) {
  await copyText(`${field.label} (${field.name})`)
}

/** 点标签/API：确保选中并复制；已选中时不取消，避免复制时误取消 */
async function onFieldTextClick(name, text) {
  if (!selectedFieldSet.value.has(name)) {
    const next = new Set(selectedFieldSet.value)
    next.add(name)
    selectedFieldSet.value = next
    syncSelectedArray()
  }
  await copyText(text)
}

function formatCell(val) {
  if (val == null) return ''
  if (typeof val === 'object') {
    if (val.records) return `[${val.records.length} records]`
    return JSON.stringify(val)
  }
  return String(val)
}

async function refreshEnvs() {
  loadingEnvs.value = true
  errorMessage.value = ''
  try {
    const res = await listSfEnvironments()
    if (!res?.success) throw new Error(res?.error || '扫描环境失败')
    envs.value = res.environments || []
    if (!envs.value.find((e) => e.id === selectedEnvId.value)) {
      selectedEnvId.value = envs.value[0]?.id || ''
      if (selectedEnvId.value) await connectSelectedEnv()
      else {
        resetWorkspace()
      }
    }
    if (envs.value.length === 0) {
      statusMessage.value = '未发现已登录的 Salesforce 环境'
    } else {
      statusMessage.value = `发现 ${envs.value.length} 个已登录环境`
    }
  } catch (e) {
    errorMessage.value = e.message || String(e)
  } finally {
    loadingEnvs.value = false
  }
}

function resetWorkspace() {
  objects.value = []
  currentObject.value = null
  fieldsMap.value = {}
  selectedFieldSet.value = new Set()
  syncSelectedArray()
  soqlText.value = ''
  resultColumns.value = []
  resultRows.value = []
  client = null
}

async function connectSelectedEnv() {
  const env = selectedEnv.value
  if (!env) {
    resetWorkspace()
    return
  }
  errorMessage.value = ''
  statusMessage.value = '正在获取 Session…'
  try {
    const res = await fetchSfSession(env.hostname)
    if (!res?.success || !res.session?.sessionId) {
      throw new Error(res?.error || '无法获取 Session，请在浏览器中重新登录该 Org')
    }
    client = new SfRestClient({
      hostname: res.session.hostname || env.hostname,
      sessionId: res.session.sessionId
    })
    statusMessage.value = `已连接 ${client.hostname}`
    await loadObjects()
  } catch (e) {
    client = null
    objects.value = []
    errorMessage.value = e.message || String(e)
    statusMessage.value = ''
  }
}

async function onEnvChange() {
  resultColumns.value = []
  resultRows.value = []
  currentObject.value = null
  fieldsMap.value = {}
  selectedFieldSet.value = new Set()
  syncSelectedArray()
  soqlText.value = ''
  await connectSelectedEnv()
}

function filterApplicationObjects(sobjects) {
  const whitelist = new Set(DEFAULT_STANDARD_WHITELIST)
  return (sobjects || [])
    .filter((obj) => obj.queryable && obj.retrieveable)
    .filter((obj) => getObjectKind(obj.name) !== 'share')
    .filter((obj) => {
      const kind = getObjectKind(obj.name)
      if (kind === 'custom') return true
      if (kind === 'standard') return whitelist.has(obj.name)
      // metadata / system：默认隐藏，避免列表过长
      return false
    })
    .map((obj) => ({
      name: obj.name,
      label: obj.label || obj.name,
      custom: !!obj.custom
    }))
    .sort((a, b) => (a.label || a.name).localeCompare(b.label || b.name))
}

async function loadObjects() {
  if (!client) return
  loadingObjects.value = true
  errorMessage.value = ''
  try {
    const data = await client.getSObjects()
    objects.value = filterApplicationObjects(data?.sobjects)
    statusMessage.value = `已加载 ${objects.value.length} 个对象`
  } catch (e) {
    objects.value = []
    errorMessage.value = e.message || String(e)
  } finally {
    loadingObjects.value = false
  }
}

async function selectObject(obj) {
  if (!client || !obj) return
  currentObject.value = obj
  fieldSearch.value = ''
  fieldKindFilter.value = 'all'
  loadingFields.value = true
  errorMessage.value = ''
  try {
    const desc = await client.describeSObject(obj.name)
    const map = {}
    for (const field of desc.fields || []) {
      if (field.deprecatedAndHidden) continue
      // 不按 sortable 过滤：reference 等字段常为 sortable=false，但仍可出现在 SELECT 中
      map[field.name] = {
        name: field.name,
        label: field.label || field.name,
        type: field.type || 'string',
        custom: !!field.custom
      }
    }
    fieldsMap.value = map
    // 默认只选 Id、Name（存在才选）
    const defaults = ['Id', 'Name'].filter((n) => map[n])
    selectedFieldSet.value = new Set(defaults)
    syncSelectedArray()
    applyGeneratedQuery()
  } catch (e) {
    fieldsMap.value = {}
    selectedFieldSet.value = new Set()
    syncSelectedArray()
    errorMessage.value = e.message || String(e)
  } finally {
    loadingFields.value = false
  }
}

async function openObjectDetail(obj) {
  if (!obj?.name) return
  const hostname = selectedEnv.value?.hostname || client?.hostname
  if (!hostname) {
    errorMessage.value = '请先选择已登录环境'
    return
  }
  try {
    statusMessage.value = `正在打开「${obj.label || obj.name}」详情…`
    await openObjectDetailTab({ objectName: obj.name, hostname })
    statusMessage.value = `已在浏览器打开「${obj.label || obj.name}」详情`
  } catch (e) {
    errorMessage.value = e?.message || '无法打开对象详情页'
    statusMessage.value = ''
  }
}

function rowRecordId(row) {
  if (!row) return ''
  if (row.Id || row.id) return row.Id || row.id
  // REST 查询即使未 SELECT Id，也会在 attributes.url 中带上记录 Id
  // 形如 /services/data/v64.0/sobjects/Account/001xxxxxxxxxxxx
  const url = row.attributes?.url || ''
  const m = String(url).match(/\/sobjects\/[^/]+\/([a-zA-Z0-9]{15,18})(?:\/|$|\?)/)
  return m?.[1] || ''
}

function rowObjectType(row) {
  return row?.attributes?.type || currentObject.value?.name || ''
}

async function openRecordDetail(row) {
  const objectApi = rowObjectType(row)
  const id = rowRecordId(row)
  const hostname = selectedEnv.value?.hostname || client?.hostname
  if (!hostname) {
    errorMessage.value = '请先选择已登录环境'
    return
  }
  if (!objectApi || !id) {
    errorMessage.value = '无法打开详情：结果中缺少对象类型或记录 Id'
    return
  }
  try {
    statusMessage.value = `正在打开记录 ${id} 详情…`
    await openObjectDetailTab({ objectName: objectApi, hostname, recordId: id })
    statusMessage.value = `已在浏览器打开记录 ${id} 详情`
  } catch (e) {
    errorMessage.value = e?.message || '无法打开对象详情页'
    statusMessage.value = ''
  }
}

function toggleField(name) {
  const next = new Set(selectedFieldSet.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  selectedFieldSet.value = next
  syncSelectedArray()
}

function selectAllFields() {
  const next = new Set(selectedFieldSet.value)
  for (const f of filteredFields.value) next.add(f.name)
  selectedFieldSet.value = next
  syncSelectedArray()
}

function clearFields() {
  selectedFieldSet.value = new Set()
  syncSelectedArray()
}

function buildSoql() {
  if (!currentObject.value || selectedFieldNames.value.length === 0) return ''
  const fields = selectedFieldNames.value.join(', ')
  let soql = `SELECT ${fields} FROM ${currentObject.value.name}`
  if (limitEnabled.value) {
    const limit = Math.min(Math.max(Number(queryLimit.value) || 10, 1), 2000)
    soql += ` LIMIT ${limit}`
  }
  return soql
}

function applyGeneratedQuery() {
  const q = buildSoql()
  if (q) soqlText.value = q
}

async function copySoql() {
  try {
    await navigator.clipboard.writeText(soqlText.value)
    statusMessage.value = 'SOQL 已复制到剪贴板'
  } catch {
    errorMessage.value = '复制失败'
  }
}

async function executeQuery() {
  if (!client || !soqlText.value.trim()) return
  executing.value = true
  errorMessage.value = ''
  statusMessage.value = '执行中…'
  resultColumns.value = []
  resultRows.value = []
  try {
    // 若 Session 可能过期，执行前刷新一次
    const env = selectedEnv.value
    if (env) {
      const res = await fetchSfSession(env.hostname)
      if (res?.success && res.session?.sessionId) {
        client.sessionId = res.session.sessionId
        client.hostname = res.session.hostname || client.hostname
      }
    }
    const data = await client.query(soqlText.value.trim())
    const records = data?.records || []
    resultDone.value = data?.done !== false
    const cols = new Set()
    for (const rec of records) {
      Object.keys(rec).forEach((k) => {
        if (k !== 'attributes') cols.add(k)
      })
    }
    resultColumns.value = Array.from(cols)
    resultRows.value = records
    statusMessage.value = `返回 ${records.length} 行` + (resultDone.value ? '' : '（还有更多，可加 LIMIT / 分页）')
  } catch (e) {
    errorMessage.value = e.message || String(e)
    statusMessage.value = ''
  } finally {
    executing.value = false
  }
}

watch(selectedFieldNames, () => {
  // 字段变化时若编辑器仍是自动生成形态则同步；简单策略：有对象就刷新生成
  if (currentObject.value && selectedFieldNames.value.length) {
    // 不强制覆盖用户手改：仅当当前文本等于旧生成或为空时更新 —— 简化为总是可点「生成」
  }
})

onMounted(() => {
  refreshEnvs()
})
</script>

<style scoped>
/* Quick Login 蓝白 + 圆角分块布局 */
.soql-app {
  --accent: #1976d2;
  --accent-2: #1565c0;
  --accent-deep: #0d47a1;
  --page: #eef5fc;
  --card: #fff;
  --border: #bbdefb;
  --soft: #e3f2fd;
  --panel: #f5f9ff;
  --text: #333;
  --muted: #607d8b;
  --radius: 10px;
  --gap: 12px;
  --shadow: 0 2px 8px rgba(25, 118, 210, 0.08);

  height: 100%;
  max-height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: var(--gap);
  padding: var(--gap);
  box-sizing: border-box;
  color: var(--text);
  background: var(--page);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

.soql-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 16px;
  background: linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%);
  border-radius: var(--radius);
  box-shadow: 0 2px 8px rgba(25, 118, 210, 0.25);
  color: #fff;
}

.soql-header h1 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  /* 与 Apex Log 区分：琥珀金，贴合 Query/数据 */
  color: #ffe082;
  text-shadow: 0 1px 1px rgba(0, 40, 80, 0.25);
  line-height: 1.2;
}

.soql-header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
}

.env-select {
  min-width: 260px;
  max-width: 360px;
  padding: 7px 10px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  background: rgba(255, 255, 255, 0.95);
  color: var(--accent-deep);
  font-size: 12px;
  font-weight: 500;
}

.env-select:focus {
  outline: none;
  border-color: #fff;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.25);
}

.soql-empty {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 28px 32px;
  max-width: 440px;
  text-align: center;
  box-shadow: 0 8px 24px rgba(25, 118, 210, 0.1);
}

.empty-card h2 {
  margin: 0 0 10px;
  font-size: 16px;
  color: var(--accent-deep);
}

.empty-card p {
  margin: 0 0 16px;
  font-size: 13px;
  color: var(--muted);
  line-height: 1.5;
}

.soql-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: grid;
  grid-template-columns: 240px 280px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  gap: var(--gap);
}

.panel,
.query-panel {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  box-shadow: var(--shadow);
}

.panel-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  font-weight: 600;
  color: var(--accent-deep);
}

.count {
  font-size: 11px;
  font-weight: 600;
  color: var(--accent);
  background: var(--soft);
  padding: 2px 8px;
  border-radius: 999px;
}

.search-input {
  flex-shrink: 0;
  margin: 8px 10px 0;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 12px;
  background: #fff;
}

.search-input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.12);
}

.list-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 6px;
  background: var(--panel);
}

.list-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 6px;
  width: 100%;
  text-align: left;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  margin-bottom: 4px;
  transition: background 0.12s ease, border-color 0.12s ease;
  box-sizing: border-box;
}

.list-item:hover {
  border-color: #90caf9;
  background: #fafcff;
}

.list-item.active {
  background: var(--soft);
  border-color: #90caf9;
}

.item-top {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  width: 100%;
  min-width: 0;
}

.item-label {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.obj-detail-btn {
  flex-shrink: 0;
  margin: 0;
  padding: 0 5px;
  height: 18px;
  line-height: 16px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: #fff;
  color: var(--accent);
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
}

.obj-detail-btn:hover {
  background: var(--soft);
  border-color: var(--accent);
}

.obj-detail-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.item-api {
  font-size: 11px;
  color: #78909c;
  font-family: Consolas, 'Courier New', monospace;
}

.field-toolbar {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-toolbar .search-input {
  margin-bottom: 0;
}

.field-filter-chips {
  display: flex;
  gap: 4px;
  padding: 0 10px;
}

.chip {
  flex: 1;
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: #fff;
  color: #5c7a9b;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}

.chip:hover:not(:disabled) {
  border-color: #90caf9;
  background: #f5f9ff;
  color: var(--accent);
}

.chip.active {
  background: var(--soft);
  border-color: var(--accent);
  color: var(--accent-deep);
}

.chip:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.field-actions {
  display: flex;
  gap: 4px;
  padding: 0 10px 2px;
}

.fields-list {
  padding: 4px 6px 6px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.field-item {
  display: flex;
  flex-direction: column;
  gap: 1px;
  width: 100%;
  margin: 0;
  padding: 4px 7px;
  text-align: left;
  border: 1px solid #e3f2fd;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
  box-sizing: border-box;
  transition: background 0.12s ease, border-color 0.12s ease;
}

.field-item:hover {
  border-color: #90caf9;
  background: #f5f9ff;
}

.field-item.selected {
  background: var(--soft);
  border-color: var(--accent);
  box-shadow: inset 0 0 0 1px rgba(25, 118, 210, 0.08);
}

.field-item.selected:hover {
  background: #d6eafb;
  border-color: var(--accent-2);
}

.field-line1,
.field-api,
.field-type {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.field-line1 {
  display: inline-block;
  vertical-align: top;
  max-width: 100%;
  width: fit-content;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.25;
  color: var(--accent-2);
}

.field-copyable {
  cursor: copy;
}

.field-copyable:hover {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.field-line2 {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  line-height: 1.2;
}

.field-api {
  flex: 0 1 auto;
  max-width: calc(100% - 52px);
  font-size: 11px;
  color: #78909c;
  font-family: Consolas, 'Courier New', monospace;
}

.field-type {
  flex-shrink: 0;
  margin-left: auto;
  max-width: 42%;
  font-size: 10px;
  color: #90a4ae;
  text-align: right;
  pointer-events: none;
  user-select: none;
}

.query-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  justify-content: flex-end;
}

.limit-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 500;
  color: #5c7a9b;
  cursor: pointer;
  user-select: none;
}

.limit-toggle input {
  margin: 0;
  accent-color: var(--accent);
}

.limit-input {
  width: 56px;
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 12px;
}

.limit-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: #f5f7fa;
}

.soql-editor {
  flex-shrink: 0;
  height: 96px;
  max-height: 96px;
  margin: 8px 10px 0;
  resize: none;
  overflow: auto;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-family: Consolas, 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.45;
  color: #263238;
  background: #fafcff;
  box-sizing: border-box;
}

.soql-editor:focus {
  outline: none;
  border-color: var(--accent);
  background: #fff;
  box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.12);
}

.results-head {
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent-deep);
}

.results-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  margin: 0 10px 10px;
  border: 1px solid #e3f2fd;
  border-radius: 6px;
  background: #fafcff;
}

.results-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}

.results-table .col-detail {
  width: 36px;
  text-align: center;
  position: sticky;
  left: 0;
  z-index: 2;
  background: var(--soft);
  max-width: 40px;
}

.results-table tbody td.col-detail {
  background: #fafcff;
  z-index: 1;
}

.results-table th,
.results-table td {
  border-bottom: 1px solid #e3f2fd;
  padding: 6px 8px;
  text-align: left;
  white-space: nowrap;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.results-table th {
  position: sticky;
  top: 0;
  background: var(--soft);
  color: var(--accent-deep);
  font-weight: 600;
  z-index: 1;
}

.results-table th.col-detail {
  z-index: 3;
}

.results-empty {
  padding: 20px !important;
}

.list-hint {
  margin: 12px 8px;
  font-size: 12px;
  color: #90a4ae;
  text-align: center;
}

.error-text {
  color: #c62828;
  font-size: 12px;
  margin: 8px 0 0;
}

.inline-error {
  flex-shrink: 0;
  margin: 4px 12px 0;
  max-height: 40px;
  overflow: auto;
}

.status-text {
  flex-shrink: 0;
  margin: 2px 12px 0;
  font-size: 12px;
  color: #2e7d32;
  max-height: 36px;
  overflow: auto;
}

.btn {
  border: 1px solid var(--border);
  background: #fff;
  color: var(--accent-deep);
  border-radius: 6px;
  padding: 7px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn:hover:not(:disabled) {
  background: var(--soft);
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.btn-sm {
  padding: 4px 8px;
  font-size: 11px;
}

.btn-primary {
  background: var(--accent);
  border-color: var(--accent-2);
  color: #fff;
}

.btn-primary:hover:not(:disabled) {
  background: var(--accent-deep);
  color: #fff;
}

.btn-light {
  background: rgba(255, 255, 255, 0.2);
  border-color: rgba(255, 255, 255, 0.35);
  color: #fff;
}

.btn-light:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.3);
  color: #fff;
}

@media (max-width: 960px) {
  .soql-body {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) minmax(0, 1.2fr);
  }
  .query-panel {
    grid-column: 1 / -1;
  }
}
</style>
