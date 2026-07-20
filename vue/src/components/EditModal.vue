<template>
  <Transition name="modal">
    <div class="modal-overlay" v-if="visible">
      <div class="modal-content">
        <div class="modal-header">
          <h2>{{ env ? '编辑环境' : '添加环境' }}</h2>
          <button class="modal-close" @click="$emit('close')">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3l10 10M13 3L3 13"/></svg>
          </button>
        </div>
        
        <div class="modal-body">
          <div class="form-group">
            <label>别名 *</label>
            <input type="text" v-model="form.alias" placeholder="输入环境别名" required />
          </div>
          
          <div class="form-group">
            <label>账号 *</label>
            <input type="text" v-model="form.username" placeholder="输入 Salesforce 账号" required />
          </div>
          
          <div class="form-group">
            <label>密码 *</label>
            <input type="password" v-model="form.password" placeholder="输入密码" required />
          </div>
          
          <div class="form-group">
            <label>环境类型 *</label>
            <select v-model="form.type" @change="handleTypeChange">
              <option value="production">Production</option>
              <option value="sandbox">SandBox</option>
              <option value="custom">自定义</option>
            </select>
          </div>
          
          <div class="form-group" v-if="form.type === 'custom'">
            <label>自定义地址</label>
            <input type="text" v-model="form.customUrl" placeholder="https://xxx.salesforce.com" />
          </div>
          
          <div class="form-group">
            <label>分组</label>
            <div class="group-select-wrapper">
              <select v-model="form.groupId">
                <option value="ungrouped">未选择分组</option>
                <option v-for="group in groups" :key="group.id" :value="group.id">
                  {{ group.name }}
                </option>
              </select>
              <button class="btn btn-sm btn-outline" @click="openQuickAddGroup">+ 分组</button>
            </div>
          </div>
          
          <div class="form-divider"><span>MFA 绑定</span></div>

          <div class="form-group">
            <label>TOTP Secret</label>
            <input type="text" v-model="form.totpSecret" placeholder="输入或从二维码获取" />
          </div>

          <div class="form-group" v-if="firstPasskey">
            <label>已绑定 Passkey</label>
            <div class="passkey-tag">
              <svg v-if="firstPasskey.type === 'system'" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M8 1a3 3 0 00-3 3v3H4a2 2 0 00-2 2v4a2 2 0 002 2h8a2 2 0 002-2v-4a2 2 0 00-2-2h-1V4a3 3 0 00-3-3z"/>
              </svg>
              <svg v-else viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="1" y="2" width="14" height="10" rx="1.5"/><path d="M5 14h6M8 12v2"/>
              </svg>
              <span class="passkey-tag-label">{{ firstPasskey.label || firstPasskey.rpId }}</span>
              <button class="passkey-tag-remove" @click="removePasskey(firstPasskey.id)" title="删除">
                <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M4 4l8 8M12 4l-8 8"/>
                </svg>
              </button>
            </div>
          </div>
          
          <div class="form-group qr-actions">
            <button class="btn btn-sm btn-outline" @click="$emit('scan-qr')" title="截图识别二维码">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="5" height="5" rx="1"/><rect x="10" y="1" width="5" height="5" rx="1"/><rect x="1" y="10" width="5" height="5" rx="1"/><rect x="10" y="10" width="3" height="3" rx="0.5"/><rect x="14" y="10" width="1" height="1"/><rect x="10" y="14" width="1" height="1"/><rect x="14" y="14" width="1" height="1"/></svg>
              截图扫码
            </button>
            <button class="btn btn-sm btn-outline" @click="triggerFileInput" title="从图片文件识别二维码">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="3" width="14" height="10" rx="2"/><circle cx="5" cy="7" r="1.5"/><path d="M15 11l-3-3-4 4-2-2-5 5"/></svg>
              图片识别
            </button>
            <input ref="fileInputRef" type="file" accept="image/*" style="display:none" @change="handleFileSelect" />
          </div>
        </div>
        
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="$emit('close')">取消</button>
          <button class="btn btn-primary" @click="handleSave">保存</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { ref, watch, computed } from 'vue'
import { useTotp } from '../composables/useTotp'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  env: {
    type: Object,
    default: null
  },
  groups: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['close', 'save', 'add-group', 'scan-qr'])

const { parseQRCode } = useTotp()

const fileInputRef = ref(null)

const form = ref({
  alias: '',
  username: '',
  password: '',
  type: 'production',
  customUrl: '',
  groupId: 'ungrouped',
  totpSecret: '',
  passkeys: []
})

const validPasskeys = computed(() => {
  if (!Array.isArray(form.value.passkeys)) return []
  return form.value.passkeys.filter(pk => {
    return pk && typeof pk === 'object' && pk.id && pk.rpId && typeof pk.type === 'string'
  })
})

const firstPasskey = computed(() => {
  return validPasskeys.value[0] || null
})

const handleTypeChange = () => {
  if (form.value.type !== 'custom') {
    form.value.customUrl = ''
  }
}

const removePasskey = (passkeyId) => {
  if (form.value.passkeys) {
    form.value.passkeys = form.value.passkeys.filter(pk => pk.id !== passkeyId)
  }
}

const openQuickAddGroup = async () => {
  const groupName = prompt('请输入新分组名称:')
  if (groupName && groupName.trim()) {
    const newGroup = await emit('add-group', groupName.trim())
    if (newGroup) {
      form.value.groupId = newGroup.id
    }
  }
}

const triggerFileInput = () => {
  fileInputRef.value?.click()
}

const handleFileSelect = async (e) => {
  const file = e.target.files?.[0]
  if (!file) return

  try {
    const dataUrl = await readFileAsDataUrl(file)
    const result = await parseQRCode(dataUrl)
    if (result) {
      const secret = extractSecretFromOtpUri(result)
      form.value.totpSecret = secret || result
    } else {
      alert('未能识别二维码，请确认图片中包含有效的 TOTP 二维码')
    }
  } catch (err) {
    console.error('QR parse error:', err)
    alert('二维码识别失败: ' + err.message)
  }

  // 清空 file input 以便重复选择同一文件
  if (fileInputRef.value) {
    fileInputRef.value.value = ''
  }
}

const readFileAsDataUrl = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

const extractSecretFromOtpUri = (uri) => {
  try {
    if (uri.startsWith('otpauth://')) {
      const url = new URL(uri)
      return url.searchParams.get('secret') || ''
    }
  } catch (e) {
    // 不是 URI 格式，直接返回原始值
  }
  return ''
}

const handleSave = () => {
  if (!form.value.alias || !form.value.username || !form.value.password) {
    alert('请填写必填字段')
    return
  }

  const now = Date.now()
  const envData = {
    id: props.env ? props.env.id : null,
    alias: form.value.alias,
    username: form.value.username,
    password: form.value.password,
    type: form.value.type,
    customUrl: form.value.customUrl,
    groupId: form.value.groupId,
    totpSecret: form.value.totpSecret,
    passkeys: form.value.passkeys || [],
    createdAt: props.env?.createdAt || now,
    updatedAt: now
  }

  emit('save', envData)
}

watch(() => props.visible, (val) => {
  if (val) {
    if (props.env) {
      form.value = {
        alias: props.env.alias || '',
        username: props.env.username || '',
        password: props.env.password || '',
        type: props.env.type || 'production',
        customUrl: props.env.customUrl || '',
        groupId: props.env.groupId || 'ungrouped',
        totpSecret: props.env.totpSecret || '',
        passkeys: props.env.passkeys || []
      }
    } else {
      form.value = {
        alias: '',
        username: '',
        password: '',
        type: 'production',
        customUrl: '',
        groupId: 'ungrouped',
        totpSecret: '',
        passkeys: []
      }
    }
  }
})
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background-color: white;
  border-radius: 8px;
  width: 90%;
  max-width: 380px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 4px 20px rgba(25, 118, 210, 0.2);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 14px;
  border-bottom: 1px solid #bbdefb;
  background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
  color: #ffffff;
}

.modal-header h2 {
  margin: 0;
  font-size: 14px;
  color: #ffffff;
}

.modal-close {
  background: none;
  border: none;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.85);
  padding: 2px;
  display: flex;
  border-radius: 3px;
}

.modal-close:hover {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.15);
}

.modal-body {
  padding: 12px 14px;
}

.form-group {
  margin-bottom: 10px;
}

.form-group label {
  display: block;
  margin-bottom: 4px;
  font-size: 12px;
  font-weight: 500;
  color: #555;
}

.form-group input,
.form-group select {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid #bbdefb;
  border-radius: 4px;
  font-size: 13px;
  box-sizing: border-box;
  background: #ffffff;
}

.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: #1976d2;
  box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.1);
}

.group-select-wrapper {
  display: flex;
  gap: 6px;
}

.group-select-wrapper select {
  flex: 1;
}

.form-divider {
  text-align: center;
  margin: 14px 0;
  position: relative;
}

.form-divider span {
  background-color: #ffffff;
  padding: 0 8px;
  font-size: 11px;
  color: #1976d2;
  font-weight: 500;
}

.form-divider::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 1px;
  background-color: #bbdefb;
  z-index: -1;
}

.qr-actions {
  display: flex;
  gap: 8px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 14px;
  border-top: 1px solid #bbdefb;
  background: #f5f9ff;
}

.btn {
  padding: 6px 14px;
  border: none;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-sm {
  padding: 4px 10px;
  font-size: 12px;
}

.btn-primary {
  background-color: #1976d2;
  color: white;
}

.btn-primary:hover {
  background-color: #0d47a1;
}

.btn-secondary {
  background-color: #e3f2fd;
  color: #0d47a1;
  border: 1px solid #bbdefb;
}

.btn-secondary:hover {
  background-color: #bbdefb;
}

.btn-outline {
  background: white;
  color: #1976d2;
  border: 1px solid #bbdefb;
  display: flex;
  align-items: center;
  gap: 4px;
}

.btn-outline:hover {
  background: #e3f2fd;
  border-color: #64b5f6;
}

.modal-enter-active,
.modal-leave-active {
  transition: all 0.3s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.passkey-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.passkey-tag {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: #e3f2fd;
  border: 1px solid #bbdefb;
  border-radius: 6px;
  font-size: 12px;
  color: #0d47a1;
}

.passkey-tag-label {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.passkey-tag-remove {
  background: none;
  border: none;
  cursor: pointer;
  color: #999;
  padding: 2px;
  display: flex;
  border-radius: 3px;
}

.passkey-tag-remove:hover {
  color: #e74c3c;
  background: rgba(231, 76, 60, 0.1);
}

.modal-enter-from .modal-content,
.modal-leave-to .modal-content {
  transform: scale(0.9);
}
</style>
