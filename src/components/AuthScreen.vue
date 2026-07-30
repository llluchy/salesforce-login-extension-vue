<template>
  <div class="auth-container">
    <!-- 顶部品牌区 -->
    <div class="auth-header">
      <div class="auth-logo">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2"/>
          <path d="M7 11V7a5 5 0 0110 0v4"/>
        </svg>
      </div>
      <h1 class="auth-title">Salesforce Quick Login</h1>
      <p class="auth-subtitle">{{ subtitleText }}</p>
    </div>

    <!-- 已登录账户提示（仅在 session 存在但需解锁时显示） -->
    <div class="auth-user-info" v-if="hasSession">
      <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor"><path d="M10 2a4 4 0 100 8 4 4 0 000-8zM3 18a7 7 0 0114 0v-1a1 1 0 00-1-1H4a1 1 0 00-1 1v1z"/></svg>
      <span>{{ sessionEmail }}</span>
    </div>

    <!-- Tab 切换（仅在无 session 时显示） -->
    <div class="auth-tabs" v-if="!hasSession">
      <button
        :class="['auth-tab', { active: isLoginMode }]"
        @click="switchMode('login')">
        登录
      </button>
      <button
        :class="['auth-tab', { active: !isLoginMode }]"
        @click="switchMode('register')">
        注册
      </button>
    </div>

    <!-- 表单 -->
    <form class="auth-form" @submit.prevent="handleSubmit">
      <!-- 邮箱（仅在无 session 时显示） -->
      <div class="form-field" v-if="!hasSession">
        <label>邮箱</label>
        <input
          v-model.trim="email"
          type="email"
          autocomplete="email"
          placeholder="you@example.com"
          :disabled="isLoading"
          required />
      </div>

      <!-- 密码 -->
      <div class="form-field">
        <label>密码</label>
        <input
          v-model="password"
          type="password"
          :autocomplete="isLoginMode ? 'current-password' : 'new-password'"
          placeholder="至少 8 位"
          :disabled="isLoading"
          minlength="8"
          required />
      </div>

      <!-- 确认密码（仅注册） -->
      <div class="form-field" v-if="!isLoginMode && !hasSession">
        <label>确认密码</label>
        <input
          v-model="confirmPassword"
          type="password"
          autocomplete="new-password"
          placeholder="再次输入密码"
          :disabled="isLoading"
          minlength="8"
          required />
      </div>

      <!-- 错误提示 -->
      <div class="auth-error" v-if="errorMessage">
        <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor"><path d="M10 1a9 9 0 100 18 9 9 0 000-18zm-1 13a1 1 0 112 0 1 1 0 01-2 0zm1-3a1 1 0 01-1-1V7a1 1 0 112 0v3a1 1 0 01-1 1z"/></svg>
        <span>{{ errorMessage }}</span>
      </div>

      <!-- 成功提示（注册后等待邮件确认） -->
      <div class="auth-success" v-if="successMessage">
        <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor"><path d="M10 1a9 9 0 100 18 9 9 0 000-18zm-1 13l-4-4 1.5-1.5L9 11l4.5-4.5L15 8l-6 6z"/></svg>
        <span>{{ successMessage }}</span>
      </div>

      <!-- 提交按钮 -->
      <button type="submit" class="btn-submit" :disabled="isLoading">
        <span v-if="isLoading" class="spinner-mini"></span>
        <span>{{ submitButtonText }}</span>
      </button>

      <!-- 操作链接 -->
      <div class="auth-footer" v-if="hasSession">
        <a href="#" @click.prevent="handleSignOut">退出并切换账户</a>
      </div>
      <div class="auth-footer" v-else-if="isLoginMode">
        <a href="#" @click.prevent="showResetDialog = true">忘记密码？</a>
      </div>
    </form>

    <!-- 安全说明 -->
    <div class="auth-notice">
      <div class="notice-title">
        <svg viewBox="0 0 20 20" width="12" height="12" fill="currentColor"><path d="M10 1a9 9 0 100 18 9 9 0 000-18zm-1 13a1 1 0 112 0 1 1 0 01-2 0zm1-3a1 1 0 01-1-1V7a1 1 0 112 0v3a1 1 0 01-1 1z"/></svg>
        <span>端到端加密说明</span>
      </div>
      <ul>
        <li>数据使用 AES-256-GCM 加密后再上传</li>
        <li>加密密钥由您的登录密码派生，<strong>服务器无法解密</strong></li>
        <li><strong>忘记密码将导致已有数据无法恢复</strong></li>
        <li>同一账号同时只能在一台设备上登录</li>
      </ul>
    </div>

    <!-- 忘记密码弹窗 -->
    <Transition name="modal">
      <div class="reset-overlay" v-if="showResetDialog" @click.self="showResetDialog = false">
        <div class="reset-modal">
          <div class="reset-header">
            <h3>重置密码</h3>
            <button class="reset-close" @click="showResetDialog = false">×</button>
          </div>
          <div class="reset-body">
            <div class="reset-warn">
              ⚠️ 重置密码后，由于加密密钥派生自旧密码，<strong>您已有的所有数据将永久无法解密</strong>。
              建议您尽量回忆密码；如确实需要重置，请确认接受数据丢失。
            </div>
            <div class="form-field">
              <label>注册邮箱</label>
              <input v-model.trim="resetEmail" type="email" placeholder="you@example.com" />
            </div>
            <button class="btn-submit" @click="handleResetPassword" :disabled="isLoading">
              发送重置邮件
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useAuth } from '../composables/useAuth'

const emit = defineEmits(['authed'])

const { signIn, signUp, signOut, resetPassword, unlockWithPassword, isLoading, currentUser, authError } = useAuth()

// 监听 authError 变化（因为 getSession 是异步的，可能在组件挂载后才设置错误）
watch(authError, (newVal) => {
  if (newVal) {
    errorMessage.value = newVal
  }
}, { immediate: false })

// 模式：'login' | 'register'（有 session 时只解锁，不允许切换）
const mode = ref('login')
const isLoginMode = computed(() => mode.value === 'login')

// 是否有持久 session（用于切换为「解锁」模式）
const hasSession = computed(() => !!currentUser.value?.id)
const sessionEmail = computed(() => currentUser.value?.email || '')

const subtitleText = computed(() => {
  if (hasSession.value) return '请输入密码以解锁今日访问'
  return isLoginMode.value ? '登录账户以同步您的环境配置' : '创建账户开始使用云端同步'
})

const submitButtonText = computed(() => {
  if (isLoading.value) return '处理中...'
  if (hasSession.value) return '解锁'
  return isLoginMode.value ? '登录' : '注册'
})

// 表单字段
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const errorMessage = ref('')
const successMessage = ref('')

// 忘记密码
const showResetDialog = ref(false)
const resetEmail = ref('')

const switchMode = (m) => {
  mode.value = m
  errorMessage.value = ''
  successMessage.value = ''
  confirmPassword.value = ''
}

const validate = () => {
  if (!hasSession.value && !email.value) {
    errorMessage.value = '请输入邮箱'
    return false
  }
  if (!hasSession.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)) {
    errorMessage.value = '邮箱格式无效'
    return false
  }
  if (!password.value || password.value.length < 8) {
    errorMessage.value = '密码至少 8 位'
    return false
  }
  if (!isLoginMode.value && !hasSession.value && password.value !== confirmPassword.value) {
    errorMessage.value = '两次密码输入不一致'
    return false
  }
  return true
}

const handleSubmit = async () => {
  errorMessage.value = ''
  successMessage.value = ''
  if (!validate()) return

  try {
    if (hasSession.value) {
      // 已有 session，只需输入密码派生密钥
      await unlockWithPassword(password.value)
      password.value = ''
      emit('authed')
    } else if (isLoginMode.value) {
      await signIn({ email: email.value, password: password.value })
      emit('authed')
    } else {
      const result = await signUp({ email: email.value, password: password.value })
      if (result.needsEmailConfirm) {
        successMessage.value = `确认邮件已发送到 ${email.value}，请点击邮件中的链接完成验证后再登录`
      } else {
        emit('authed')
      }
    }
  } catch (e) {
    errorMessage.value = e.message || '操作失败'
  }
}

const handleSignOut = async () => {
  try {
    await signOut()
    password.value = ''
    errorMessage.value = ''
    successMessage.value = ''
  } catch (e) {
    errorMessage.value = e.message || '登出失败'
  }
}

const handleResetPassword = async () => {
  errorMessage.value = ''
  successMessage.value = ''
  if (!resetEmail.value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resetEmail.value)) {
    errorMessage.value = '请输入有效的邮箱'
    return
  }
  try {
    await resetPassword(resetEmail.value)
    successMessage.value = `重置邮件已发送到 ${resetEmail.value}，请查收邮件完成重置`
    showResetDialog.value = false
  } catch (e) {
    errorMessage.value = e.message || '发送失败'
  }
}

onMounted(() => {
  // 检查是否有设备不匹配等错误
  if (authError?.value) {
    errorMessage.value = authError.value
  }
})
</script>

<style scoped>
.auth-container {
  min-height: 100vh;
  background-color: #eef5fc;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 16px 24px;
  box-sizing: border-box;
}

.auth-header {
  text-align: center;
  margin-bottom: 20px;
}

.auth-logo {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
  color: white;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(25, 118, 210, 0.3);
  margin-bottom: 12px;
}

.auth-title {
  margin: 0 0 6px;
  font-size: 18px;
  font-weight: 600;
  color: #0d47a1;
  letter-spacing: 0.3px;
}

.auth-subtitle {
  margin: 0;
  font-size: 12px;
  color: #5c7a9b;
}

.auth-tabs {
  display: flex;
  background: #ffffff;
  border: 1px solid #bbdefb;
  border-radius: 8px;
  padding: 3px;
  width: 100%;
  max-width: 360px;
  margin-bottom: 16px;
  box-shadow: 0 1px 3px rgba(25, 118, 210, 0.08);
}

.auth-tab {
  flex: 1;
  padding: 8px 0;
  border: none;
  background: transparent;
  color: #5c7a9b;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.15s;
}

.auth-tab.active {
  background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
  color: white;
  box-shadow: 0 2px 6px rgba(25, 118, 210, 0.3);
}

.auth-form {
  width: 100%;
  max-width: 360px;
  background: white;
  padding: 20px;
  border-radius: 8px;
  border: 1px solid #bbdefb;
  box-shadow: 0 2px 8px rgba(25, 118, 210, 0.1);
  box-sizing: border-box;
}

.form-field {
  margin-bottom: 14px;
}

.form-field label {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 500;
  color: #0d47a1;
}

.form-field input {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid #bbdefb;
  border-radius: 5px;
  font-size: 13px;
  background: #f5f9ff;
  color: #0d47a1;
  box-sizing: border-box;
  transition: all 0.15s;
}

.form-field input:focus {
  outline: none;
  border-color: #1976d2;
  background: white;
  box-shadow: 0 0 0 3px rgba(25, 118, 210, 0.12);
}

.form-field input:disabled {
  background: #eef5fc;
  cursor: not-allowed;
}

.auth-error {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px 14px;
  background: linear-gradient(135deg, #ffebee 0%, #ffcdd2 100%);
  border: 2px solid #ef5350;
  color: #c62828;
  border-radius: 8px;
  font-size: 12px;
  margin-bottom: 14px;
  line-height: 1.6;
  animation: shake 0.4s ease-in-out;
  box-shadow: 0 2px 8px rgba(229, 57, 53, 0.2);
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-4px); }
  75% { transform: translateX(4px); }
}

.auth-error svg {
  flex-shrink: 0;
  margin-top: 1px;
}

.auth-success {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 8px 10px;
  background: #e8f5e9;
  border: 1px solid #81c784;
  color: #2e7d32;
  border-radius: 5px;
  font-size: 12px;
  margin-bottom: 12px;
  line-height: 1.5;
}

.auth-success svg {
  flex-shrink: 0;
  margin-top: 1px;
}

.btn-submit {
  width: 100%;
  padding: 10px;
  border: none;
  border-radius: 5px;
  background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
  color: white;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: all 0.15s;
  box-shadow: 0 2px 6px rgba(25, 118, 210, 0.25);
}

.btn-submit:hover:not(:disabled) {
  background: linear-gradient(135deg, #1565c0 0%, #0d47a1 100%);
  box-shadow: 0 4px 10px rgba(25, 118, 210, 0.35);
}

.btn-submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.spinner-mini {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.auth-footer {
  text-align: center;
  margin-top: 12px;
}

.auth-footer a {
  font-size: 12px;
  color: #1976d2;
  text-decoration: none;
}

.auth-footer a:hover {
  text-decoration: underline;
}

.auth-notice {
  width: 100%;
  max-width: 360px;
  margin-top: 16px;
  padding: 12px 14px;
  background: #e3f2fd;
  border: 1px solid #90caf9;
  border-radius: 6px;
  box-sizing: border-box;
}

.notice-title {
  display: flex;
  align-items: center;
  gap: 5px;
  color: #0d47a1;
  font-size: 11px;
  font-weight: 600;
  margin-bottom: 8px;
}

.auth-notice ul {
  margin: 0;
  padding-left: 16px;
  color: #5c7a9b;
  font-size: 11px;
  line-height: 1.7;
}

.auth-notice li strong {
  color: #0d47a1;
}

.auth-user-info {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: #e3f2fd;
  border: 1px solid #90caf9;
  border-radius: 18px;
  color: #0d47a1;
  font-size: 12px;
  font-weight: 500;
  margin-bottom: 14px;
  max-width: 360px;
  width: 100%;
  box-sizing: border-box;
  justify-content: center;
}

.auth-user-info svg {
  flex-shrink: 0;
}

.auth-user-info span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 忘记密码弹窗 */
.reset-overlay {
  position: fixed;
  inset: 0;
  background: rgba(13, 71, 161, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 16px;
  box-sizing: border-box;
}

.reset-modal {
  background: white;
  border-radius: 8px;
  width: 100%;
  max-width: 360px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
}

.reset-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
  color: white;
  border-radius: 8px 8px 0 0;
}

.reset-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.reset-close {
  background: none;
  border: none;
  color: white;
  font-size: 22px;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.reset-body {
  padding: 16px;
}

.reset-warn {
  padding: 10px 12px;
  background: #fff3e0;
  border: 1px solid #ffb74d;
  color: #e65100;
  border-radius: 5px;
  font-size: 11px;
  line-height: 1.6;
  margin-bottom: 12px;
}

.reset-warn strong {
  color: #bf360c;
}

/* Transition */
.modal-enter-active, .modal-leave-active {
  transition: opacity 0.2s;
}
.modal-enter-from, .modal-leave-to {
  opacity: 0;
}
</style>
