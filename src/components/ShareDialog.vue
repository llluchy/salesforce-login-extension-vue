<template>
  <Transition name="modal">
    <div class="modal-overlay" v-if="visible" @click.self="handleClose">
      <div class="modal-content share-modal">
        <div class="modal-header">
          <h2>环境分享</h2>
          <button class="modal-close" @click="handleClose" :disabled="loading">×</button>
        </div>

        <div class="modal-body">
          <!-- Tab 切换 -->
          <div class="mode-tabs">
            <button :class="['mode-tab', { active: mode === 'share' }]" @click="mode = 'share'">分享出去</button>
            <button :class="['mode-tab', { active: mode === 'accept' }]" @click="mode = 'accept'">接受分享</button>
          </div>

          <!-- 分享出去 -->
          <div class="share-section" v-if="mode === 'share'">
            <div class="form-hint">
              勾选要分享的环境（可多选），生成分享码和验证码。被分享者输入两码后一次性接收所有环境。
              <br>分享码 24 小时有效，接受后立即失效。
            </div>

            <div class="env-list" v-if="environments.length > 0">
              <label
                v-for="env in environments"
                :key="env.id"
                :class="['env-item', { selected: selectedEnvs.includes(env.id) }]"
              >
                <input
                  type="checkbox"
                  :value="env.id"
                  v-model="selectedEnvs"
                  :disabled="loading"
                />
                <div class="env-info">
                  <div class="env-alias">{{ env.alias }}</div>
                  <div class="env-meta">
                    <span class="env-type">{{ env.type }}</span>
                  </div>
                </div>
              </label>
            </div>
            <div v-else class="empty-tip">暂无可分享的环境</div>

            <button
              class="btn-primary"
              @click="handleCreateShare"
              :disabled="loading || selectedEnvs.length === 0"
            >
              {{ loading ? '生成中...' : '生成分享码' }}
            </button>

            <!-- 分享码展示 -->
            <div class="codes-display" v-if="generatedCodes">
              <div class="code-block">
                <div class="code-label">分享码（发给对方）</div>
                <div class="code-value">{{ generatedCodes.shareCode }}</div>
              </div>
              <div class="code-block">
                <div class="code-label">验证码（另外发送给对方）</div>
                <div class="code-value">{{ generatedCodes.verifyCode }}</div>
              </div>
              <div class="code-warn">
                ⚠️ 请通过安全渠道发送，建议两码分别发送（如短信+微信）。
                <br>对方接受后此分享码立即失效。
              </div>
            </div>

            <div class="error-message" v-if="errorMessage">{{ errorMessage }}</div>
          </div>

          <!-- 接受分享 -->
          <div class="accept-section" v-if="mode === 'accept'">
            <div class="form-hint">
              输入分享码和验证码，接受后将创建独立的环境副本，与原环境互不影响，可独立管理。
            </div>

            <div class="form-field">
              <label>分享码</label>
              <input
                v-model="inputShareCode"
                type="text"
                maxlength="6"
                placeholder="6 位数字"
                :disabled="loading"
                @input="inputShareCode = inputShareCode.replace(/\D/g, '')"
              />
            </div>

            <div class="form-field">
              <label>验证码</label>
              <input
                v-model="inputVerifyCode"
                type="text"
                maxlength="6"
                placeholder="6 位数字"
                :disabled="loading"
                @input="inputVerifyCode = inputVerifyCode.replace(/\D/g, '')"
              />
            </div>

            <button
              class="btn-primary"
              @click="handleAcceptShare"
              :disabled="loading || !inputShareCode || !inputVerifyCode"
            >
              {{ loading ? '接受中...' : '接受分享' }}
            </button>

            <div class="error-message" v-if="errorMessage">{{ errorMessage }}</div>
            <div class="success-message" v-if="successMessage">{{ successMessage }}</div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useShare } from '../composables/useShare'

const props = defineProps({
  visible: { type: Boolean, default: false },
  environments: { type: Array, default: () => [] }
})

const emit = defineEmits(['close', 'accepted'])

const { createShare, acceptShare } = useShare()

const mode = ref('share')
const loading = ref(false)
const errorMessage = ref('')
const successMessage = ref('')

// 分享相关
const selectedEnvs = ref([])
const generatedCodes = ref(null)

// 接受相关
const inputShareCode = ref('')
const inputVerifyCode = ref('')

// 切换 Tab 时重置
watch(mode, () => {
  errorMessage.value = ''
  successMessage.value = ''
  generatedCodes.value = null
})

// 关闭时重置
watch(() => props.visible, (v) => {
  if (v) {
    selectedEnvs.value = []
    generatedCodes.value = null
    inputShareCode.value = ''
    inputVerifyCode.value = ''
    errorMessage.value = ''
    successMessage.value = ''
    mode.value = 'share'
  }
})

const handleClose = () => {
  if (loading.value) return
  emit('close')
}

const handleCreateShare = async () => {
  if (loading.value) return
  if (selectedEnvs.value.length === 0) {
    errorMessage.value = '请至少选择一个环境'
    return
  }

  loading.value = true
  errorMessage.value = ''
  generatedCodes.value = null

  try {
    const result = await createShare(selectedEnvs.value)
    generatedCodes.value = result
  } catch (e) {
    errorMessage.value = e.message || '生成分享码失败'
  } finally {
    loading.value = false
  }
}

const handleAcceptShare = async () => {
  if (loading.value) return
  if (!inputShareCode.value || inputShareCode.value.length !== 6) {
    errorMessage.value = '分享码必须为 6 位数字'
    return
  }
  if (!inputVerifyCode.value || inputVerifyCode.value.length !== 6) {
    errorMessage.value = '验证码必须为 6 位数字'
    return
  }
  if (inputShareCode.value === inputVerifyCode.value) {
    errorMessage.value = '分享码和验证码不能相同'
    return
  }

  loading.value = true
  errorMessage.value = ''
  successMessage.value = ''

  try {
    const result = await acceptShare(inputShareCode.value, inputVerifyCode.value)
    successMessage.value = `接受成功，已添加 ${result.envIds.length} 个环境`

    // 清空输入
    inputShareCode.value = ''
    inputVerifyCode.value = ''

    // 通知父组件刷新
    emit('accepted')

    // 3 秒后关闭
    setTimeout(() => {
      handleClose()
    }, 2000)
  } catch (e) {
    errorMessage.value = e.message || '接受分享失败'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: #fff;
  border-radius: 12px;
  width: 420px;
  max-width: 92vw;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #e5e7eb;
}

.modal-header h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
}

.modal-close {
  border: none;
  background: none;
  font-size: 22px;
  color: #6b7280;
  cursor: pointer;
  padding: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-close:hover {
  color: #1f2937;
}

.modal-close:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.modal-body {
  padding: 16px 20px;
  overflow-y: auto;
  flex: 1;
}

.mode-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
  background: #f3f4f6;
  border-radius: 8px;
  padding: 4px;
}

.mode-tab {
  flex: 1;
  padding: 8px 12px;
  border: none;
  background: none;
  border-radius: 6px;
  font-size: 13px;
  color: #6b7280;
  cursor: pointer;
  transition: all 0.2s;
}

.mode-tab.active {
  background: #fff;
  color: #1f2937;
  font-weight: 500;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.form-hint {
  font-size: 12px;
  color: #6b7280;
  line-height: 1.5;
  margin-bottom: 12px;
  padding: 8px 10px;
  background: #f9fafb;
  border-radius: 6px;
}

.env-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
  max-height: 240px;
  overflow-y: auto;
}

.env-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
}

.env-item:hover {
  border-color: #3b82f6;
  background: #f0f7ff;
}

.env-item.selected {
  border-color: #3b82f6;
  background: #eff6ff;
}

.env-item input[type="checkbox"] {
  cursor: pointer;
}

.env-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.env-alias {
  font-size: 13px;
  font-weight: 500;
  color: #1f2937;
}

.env-meta {
  display: flex;
  gap: 6px;
  align-items: center;
}

.env-type {
  font-size: 11px;
  color: #6b7280;
  padding: 1px 6px;
  background: #f3f4f6;
  border-radius: 4px;
}

.empty-tip {
  text-align: center;
  color: #9ca3af;
  font-size: 13px;
  padding: 24px 0;
}

.btn-primary {
  width: 100%;
  padding: 10px;
  background: #3b82f6;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-primary:hover:not(:disabled) {
  background: #2563eb;
}

.btn-primary:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}

.codes-display {
  margin-top: 16px;
  padding: 12px;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-radius: 8px;
}

.code-block {
  margin-bottom: 10px;
}

.code-label {
  font-size: 12px;
  color: #4b5563;
  margin-bottom: 4px;
}

.code-value {
  font-size: 20px;
  font-weight: 700;
  color: #059669;
  letter-spacing: 4px;
  font-family: 'Courier New', monospace;
}

.code-warn {
  font-size: 11px;
  color: #92400e;
  background: #fef3c7;
  padding: 6px 8px;
  border-radius: 4px;
  margin-top: 8px;
  line-height: 1.5;
}

.form-field {
  margin-bottom: 12px;
}

.form-field label {
  display: block;
  font-size: 13px;
  color: #374151;
  margin-bottom: 4px;
}

.form-field input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  box-sizing: border-box;
}

.form-field input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.alias-tip {
  font-size: 11px;
  color: #6b7280;
  margin-top: 4px;
}

.error-message {
  color: #dc2626;
  font-size: 13px;
  margin-top: 10px;
  padding: 8px 10px;
  background: #fef2f2;
  border-radius: 6px;
}

.success-message {
  color: #059669;
  font-size: 13px;
  margin-top: 10px;
  padding: 8px 10px;
  background: #f0fdf4;
  border-radius: 6px;
}

.modal-enter-active, .modal-leave-active {
  transition: opacity 0.2s;
}

.modal-enter-from, .modal-leave-to {
  opacity: 0;
}
</style>
