<template>
  <div v-if="visible" class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-container">
      <div class="modal-header">
        <h2>手动绑定 Passkey 凭证</h2>
        <button class="close-btn" @click="$emit('close')">×</button>
      </div>

      <div class="modal-body">
        <div v-if="mode === 'select'" class="mode-select">
          <p class="tip">选择绑定方式：</p>
          <div class="mode-buttons">
            <button class="mode-btn" @click="mode = 'list'">
              <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="10" cy="10" r="8"/><path d="M10 6v4l3 2"/></svg>
              <span>从已存储凭证选择</span>
              <small>（私钥还在 chrome.storage 中时可用）</small>
            </button>
            <button class="mode-btn" @click="mode = 'paste'">
              <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="10" height="16" rx="2"/><line x1="8" y1="6" x2="12" y2="6"/></svg>
              <span>粘贴凭证 JSON</span>
              <small>（从备份文件或控制台复制）</small>
            </button>
            <button class="mode-btn" @click="mode = 'credId'">
              <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 2L3 5v5c0 4 3 7 7 8 4-1 7-4 7-8V5l-7-3z"/></svg>
              <span>按 credentialId 导出</span>
              <small>（控制台用，把单条凭证导出为 JSON）</small>
            </button>
          </div>
        </div>

        <!-- 模式 1：从已存储凭证列表选择 -->
        <div v-else-if="mode === 'list'" class="mode-list">
          <div v-if="loading" class="loading">加载中...</div>
          <div v-else-if="credentialList.length === 0" class="empty">
            <p>没有已存储的凭证</p>
            <p class="sub-tip">私钥可能已随插件卸载丢失，请改用「粘贴凭证 JSON」</p>
          </div>
          <div v-else>
            <p class="tip">找到 {{ credentialList.length }} 个凭证，请选择要绑定到的环境：</p>
            <div v-if="!env" class="env-select-row">
              <select v-model="selectedEnvId" class="env-select">
                <option value="">-- 选择环境 --</option>
                <option v-for="e in environments" :key="e.id" :value="e.id">{{ e.alias }} ({{ e.username }})</option>
              </select>
            </div>
            <p v-else class="selected-env-info">目标环境：{{ env.alias }}（{{ env.username }}）</p>
            <p class="tip" style="margin-top:8px">选择要绑定的凭证：</p>
            <div class="cred-list">
              <div
                v-for="cred in credentialList"
                :key="cred.credentialId"
                class="cred-item"
                :class="{ selected: selectedCredId === cred.credentialId }"
                @click="selectedCredId = cred.credentialId"
              >
                <div class="cred-info">
                  <div class="cred-id">{{ cred.credentialId.substring(0, 40) }}...</div>
                  <div class="cred-meta">
                    <span>rpId: {{ cred.rpId }}</span>
                    <span v-if="cred.userName">用户: {{ cred.userName }}</span>
                    <span :class="cred.hasPrivateKey ? 'has-key' : 'no-key'">
                      {{ cred.hasPrivateKey ? '✓ 有私钥' : '✗ 无私钥' }}
                    </span>
                  </div>
                </div>
                <div v-if="cred.envId" class="cred-bound">已绑定: {{ cred.envId }}</div>
              </div>
            </div>
            <div class="actions">
              <button class="btn-secondary" @click="mode = 'select'">返回</button>
              <button class="btn-primary" :disabled="!canBindFromList" @click="bindFromList">绑定</button>
            </div>
          </div>
        </div>

        <!-- 模式 2：粘贴凭证 JSON -->
        <div v-else-if="mode === 'paste'" class="mode-paste">
          <p class="tip">粘贴完整的凭证 JSON（从备份文件复制单个 credential 对象，或从控制台复制）：</p>
          <p class="format-tip">必需字段：<code>credentialId</code>、<code>privateKeyJwk</code>（可选：<code>rpId</code>、<code>publicKeyJwk</code>、<code>userName</code>）</p>
          <div v-if="!env" class="env-select-row">
            <select v-model="selectedEnvIdForPaste" class="env-select">
              <option value="">-- 选择绑定环境（可选） --</option>
              <option v-for="e in environments" :key="e.id" :value="e.id">{{ e.alias }} ({{ e.username }})</option>
            </select>
          </div>
          <p v-else class="selected-env-info">目标环境：{{ env.alias }}（{{ env.username }}）</p>
          <textarea
            v-model="pasteText"
            class="json-textarea"
            placeholder='{
  "credentialId": "GH586D_DhhZqnE5...",
  "rpId": "salesforce.com",
  "privateKeyJwk": {
    "kty": "EC",
    "crv": "P-256",
    "x": "...",
    "y": "...",
    "d": "..."
  }
}'
          ></textarea>
          <div v-if="pasteError" class="error">{{ pasteError }}</div>
          <div class="actions">
            <button class="btn-secondary" @click="mode = 'select'">返回</button>
            <button class="btn-primary" :disabled="!pasteText.trim()" @click="bindFromPaste">绑定</button>
          </div>
        </div>

        <!-- 模式 3：按 credentialId 导出 -->
        <div v-else-if="mode === 'credId'" class="mode-credId">
          <p class="tip">输入 credentialId，导出该凭证的完整 JSON（包含私钥）：</p>
          <input
            v-model="credIdInput"
            class="credId-input"
            placeholder="GH586D_DhhZqnE5BhUqGJaB7t8sbz4Xh4UfrRN8DMpbTfF_TvrgG0UNKPULeH4sfvR6nQDoYWtzyq2LiT7LE6A"
          />
          <div v-if="exportedJson" class="export-result">
            <p class="success-tip">导出成功！请复制以下 JSON 保存到安全位置：</p>
            <textarea v-model="exportedJson" class="json-textarea" readonly></textarea>
            <button class="btn-primary" @click="copyExported">复制到剪贴板</button>
          </div>
          <div v-if="credIdError" class="error">{{ credIdError }}</div>
          <div class="actions">
            <button class="btn-secondary" @click="mode = 'select'">返回</button>
            <button class="btn-primary" :disabled="!credIdInput.trim()" @click="exportByCredId">导出</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, computed } from 'vue'
import { useStorage } from '../composables/useStorage'

const { loadPasskeyCredentials, savePasskeyCredential, getPasskeyCredentialById, loadEnvironments, saveEnvironments } = useStorage()

const props = defineProps({
  visible: Boolean,
  env: Object,
  environments: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['close', 'bound'])

const mode = ref('select')
const loading = ref(false)
const credentialList = ref([])
const selectedCredId = ref('')
const selectedEnvId = ref('')
const selectedEnvIdForPaste = ref('')
const pasteText = ref('')
const pasteError = ref('')
const credIdInput = ref('')
const exportedJson = ref('')
const credIdError = ref('')

const canBindFromList = computed(() => {
  if (!selectedCredId.value) return false
  const targetEnvId = props.env?.id || selectedEnvId.value
  return !!targetEnvId
})

const activeEnvId = computed(() => props.env?.id || selectedEnvId.value)

watch(() => props.visible, (v) => {
  if (v) {
    mode.value = 'select'
    selectedCredId.value = ''
    selectedEnvId.value = ''
    selectedEnvIdForPaste.value = ''
    pasteText.value = ''
    pasteError.value = ''
    credIdInput.value = ''
    exportedJson.value = ''
    credIdError.value = ''
  }
})

const loadCredentialList = async () => {
  loading.value = true
  try {
    const creds = await loadPasskeyCredentials()
    credentialList.value = creds.map(c => ({
      credentialId: c.credentialId,
      rpId: c.rpId,
      userId: c.userId,
      userName: c.userName,
      envId: c.envId,
      createdAt: c.createdAt,
      hasPrivateKey: !!c.privateKeyJwk
    }))
  } catch (e) {
    console.error('Load credentials error:', e)
  } finally {
    loading.value = false
  }
}

watch(mode, (m) => {
  if (m === 'list') {
    loadCredentialList()
  }
})

const bindFromList = async () => {
  if (!selectedCredId.value) return
  const targetEnvId = props.env?.id || selectedEnvId.value
  if (!targetEnvId) return
  try {
    const selectedCred = credentialList.value.find(c => c.credentialId === selectedCredId.value)
    const credRpId = selectedCred?.rpId || 'salesforce.com'
    const fullCred = await getPasskeyCredentialById(selectedCredId.value)
    if (!fullCred) {
      alert('未找到该凭证')
      return
    }
    const updatedCred = { ...fullCred, envId: targetEnvId }
    const res = await savePasskeyCredential(updatedCred)
    if (res?.success) {
      emit('bound', { envId: targetEnvId, credentialId: selectedCredId.value, rpId: credRpId })
      emit('close')
    } else {
      alert(res?.error || '绑定失败')
    }
  } catch (e) {
    alert(e.message || '绑定失败')
  }
}

const bindFromPaste = async () => {
  pasteError.value = ''
  try {
    const cred = JSON.parse(pasteText.value)
    if (!cred.credentialId) {
      pasteError.value = 'JSON 缺少 credentialId 字段'
      return
    }
    if (!cred.privateKeyJwk) {
      pasteError.value = 'JSON 缺少 privateKeyJwk 字段（无私钥无法用于登录）'
      return
    }
    const targetEnvId = props.env?.id || selectedEnvIdForPaste.value
    if (targetEnvId) {
      cred.envId = targetEnvId
    }
    if (!cred.rpId) {
      cred.rpId = 'salesforce.com'
    }
    const res = await savePasskeyCredential(cred)
    if (res?.success) {
      emit('bound', { envId: targetEnvId, credentialId: cred.credentialId, rpId: cred.rpId })
      emit('close')
    } else {
      pasteError.value = res?.error || '绑定失败'
    }
  } catch (e) {
    pasteError.value = 'JSON 格式错误: ' + e.message
  }
}

const exportByCredId = async () => {
  credIdError.value = ''
  exportedJson.value = ''
  try {
    const cred = await getPasskeyCredentialById(credIdInput.value.trim())
    if (cred) {
      exportedJson.value = JSON.stringify(cred, null, 2)
    } else {
      credIdError.value = '未找到该凭证'
    }
  } catch (e) {
    credIdError.value = e.message || '导出失败'
  }
}

const copyExported = async () => {
  try {
    await navigator.clipboard.writeText(exportedJson.value)
    alert('已复制到剪贴板')
  } catch (e) {
    alert('复制失败：' + e.message)
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 10px;
}

.modal-container {
  background: white;
  border-radius: 8px;
  width: 100%;
  max-width: 600px;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 20px rgba(25, 118, 210, 0.25);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 16px;
  border-bottom: 1px solid #bbdefb;
  background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
  color: white;
}

.modal-header h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #ffffff;
}

.close-btn {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.85);
  font-size: 22px;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  border-radius: 3px;
}

.close-btn:hover {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.15);
}

.modal-body {
  padding: 16px;
  overflow-y: auto;
  flex: 1;
}

.tip {
  margin: 0 0 12px;
  font-size: 13px;
  color: #333;
}

.format-tip {
  margin: 0 0 8px;
  font-size: 11px;
  color: #666;
}

.format-tip code {
  background: #e3f2fd;
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 11px;
  color: #0d47a1;
}

.env-select-row {
  margin-bottom: 10px;
}

.env-select {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid #bbdefb;
  border-radius: 4px;
  font-size: 12px;
  background: white;
}

.env-select:focus {
  outline: none;
  border-color: #1976d2;
  box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.1);
}

.selected-env-info {
  font-size: 12px;
  color: #0d47a1;
  padding: 6px 8px;
  background: #e3f2fd;
  border: 1px solid #bbdefb;
  border-radius: 4px;
  margin: 0 0 8px;
}

.mode-buttons {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mode-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border: 1px solid #bbdefb;
  border-radius: 6px;
  background: #f5f9ff;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s;
  color: #0d47a1;
}

.mode-btn:hover {
  background: #e3f2fd;
  border-color: #1976d2;
}

.mode-btn span {
  font-size: 13px;
  font-weight: 500;
}

.mode-btn small {
  font-size: 11px;
  color: #1976d2;
  margin-left: auto;
  opacity: 0.7;
}

.cred-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 300px;
  overflow-y: auto;
  margin-bottom: 12px;
}

.cred-item {
  padding: 10px;
  border: 1px solid #bbdefb;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
  background: #ffffff;
}

.cred-item:hover {
  border-color: #1976d2;
  background: #f5f9ff;
}

.cred-item.selected {
  border-color: #1976d2;
  background: #e3f2fd;
  box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.1);
}

.cred-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cred-id {
  font-family: monospace;
  font-size: 11px;
  color: #333;
  word-break: break-all;
}

.cred-meta {
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: #666;
}

.has-key {
  color: #4caf50;
  font-weight: 500;
}

.no-key {
  color: #f44336;
  font-weight: 500;
}

.cred-bound {
  font-size: 11px;
  color: #ff9800;
  margin-top: 4px;
}

.json-textarea {
  width: 100%;
  min-height: 180px;
  padding: 8px;
  border: 1px solid #bbdefb;
  border-radius: 4px;
  font-family: monospace;
  font-size: 11px;
  resize: vertical;
  box-sizing: border-box;
  background: #f5f9ff;
}

.json-textarea:focus {
  outline: none;
  border-color: #1976d2;
  box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.1);
}

.credId-input {
  width: 100%;
  padding: 8px;
  border: 1px solid #bbdefb;
  border-radius: 4px;
  font-family: monospace;
  font-size: 11px;
  box-sizing: border-box;
  margin-bottom: 12px;
  background: #f5f9ff;
}

.credId-input:focus {
  outline: none;
  border-color: #1976d2;
  box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.1);
}

.export-result {
  margin-top: 12px;
}

.success-tip {
  font-size: 12px;
  color: #4caf50;
  margin: 0 0 6px;
}

.error {
  color: #f44336;
  font-size: 12px;
  margin-top: 6px;
}

.loading, .empty {
  text-align: center;
  padding: 24px;
  color: #666;
  font-size: 13px;
}

.sub-tip {
  font-size: 11px;
  color: #999;
  margin-top: 4px;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.btn-primary, .btn-secondary {
  padding: 6px 14px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.15s;
}

.btn-primary {
  background: #1976d2;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #0d47a1;
}

.btn-primary:disabled {
  background: #90caf9;
  cursor: not-allowed;
}

.btn-secondary {
  background: #e3f2fd;
  color: #0d47a1;
  border: 1px solid #bbdefb;
}

.btn-secondary:hover {
  background: #bbdefb;
}
</style>
