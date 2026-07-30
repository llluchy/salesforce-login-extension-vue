<template>
  <div class="verify-helper-overlay" v-if="authRequest">
    <div class="verify-helper">
      <div class="verify-helper-header">
        <svg class="verify-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2"/>
          <circle cx="12" cy="7" r="4"/>
          <path d="M8 11V9a4 4 0 018 0v2"/>
        </svg>
        <span class="verify-title">{{ authRequest.type === 'create' ? '检测到创建身份验证请求' : '检测到身份验证请求' }}</span>
        <button class="verify-close" @click="handleDismiss" title="关闭">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M4 4l8 8M12 4l-8 8"/>
          </svg>
        </button>
      </div>

      <div class="verify-helper-body">
        <div v-if="authRequest.type === 'create'" class="verify-create-flow">
          <div class="verify-hint">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 8v4"/><path d="M12 16h.01"/></svg>
            <span>请选择环境绑定，之后需在系统中完成 Passkey 创建</span>
          </div>

          <div class="verify-env-list" v-if="availableEnvironments.length">
            <div
              v-for="env in availableEnvironments"
              :key="env.id"
              class="verify-env-item"
              @click="handleSelectEnvForCreate(env)"
            >
              <div class="env-item-header">
                <span class="env-item-alias">{{ env.alias }}</span>
                <span class="env-item-type" :class="`type-${env.type}`">
                  {{ getTypeLabel(env.type) }}
                </span>
              </div>
              <div class="env-item-detail">
                <span v-if="env.username">{{ env.username }}</span>
                <span v-else class="env-item-no-credential">未绑定账号密码</span>
              </div>
              <svg class="env-item-arrow" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M6 4l4 4-4 4"/>
              </svg>
            </div>
          </div>

          <div class="verify-no-environments" v-else>
            <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M16 11.37A4 4 0 1112.63 8 4 4 0 0116 11.37z"/><path d="M17 16h.01"/></svg>
            <p>暂未创建任何环境</p>
            <p class="hint-text">选择或创建环境后，仍需在系统中完成 Passkey 创建</p>
            <button class="create-env-btn" @click="handleCreateNewEnv">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 5v14M5 12h14"/></svg>
              创建环境并绑定
            </button>
          </div>
        </div>

        <div v-else class="verify-login-flow">
          <div class="verify-hint">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 8v4"/><path d="M12 16h.01"/></svg>
            <span>选择已绑定 Passkey 的环境完成登录验证</span>
          </div>

          <div class="verify-env-list" v-if="matchedEnvironments.length">
            <div
              v-for="env in matchedEnvironments"
              :key="env.id"
              class="verify-env-item"
              @click="handleSelectEnvForLogin(env)"
            >
              <div class="env-item-header">
                <span class="env-item-alias">{{ env.alias }}</span>
                <span class="env-item-type" :class="`type-${env.type}`">
                  {{ getTypeLabel(env.type) }}
                </span>
              </div>
              <div class="env-item-detail">
                <span>{{ env.username }}</span>
                <span class="env-item-passkey">已绑定 Passkey</span>
              </div>
              <svg class="env-item-arrow" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M6 4l4 4-4 4"/>
              </svg>
            </div>
          </div>

          <div class="verify-no-matched" v-else>
            <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><path d="M12 15v6M19 12l-7-7-7 7M12 3v6"/></svg>
            <p>未找到匹配的 Passkey 环境</p>
            <p class="hint-text">请先在 Salesforce 中为此环境创建 Passkey</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { TYPE_LABELS } from '../utils/constants'

const props = defineProps({
  environments: Array,
  authRequest: Object
})

const emit = defineEmits(['select-env', 'create-env', 'dismiss'])

const getTypeLabel = (type) => TYPE_LABELS[type] || type

const availableEnvironments = computed(() => {
  return props.environments || []
})

const matchedEnvironments = computed(() => {
  if (!props.authRequest) return []
  const rpId = props.authRequest.rpId
  return props.environments.filter(env =>
    env.passkeys?.some(pk => rpIdMatches(pk.rpId, rpId))
  )
})

function rpIdMatches(credRpId, requestRpId) {
  if (!credRpId || !requestRpId) return true
  if (credRpId === requestRpId) return true
  if (credRpId.endsWith('.' + requestRpId)) return true
  if (requestRpId.endsWith('.' + credRpId)) return true
  if (requestRpId === 'salesforce.com' && credRpId.endsWith('.salesforce.com')) return true
  if (credRpId === 'salesforce.com' && requestRpId.endsWith('.salesforce.com')) return true
  return false
}

const handleSelectEnvForCreate = (env) => {
  emit('select-env', { env, type: 'create', authRequest: props.authRequest })
}

const handleSelectEnvForLogin = (env) => {
  emit('select-env', { env, type: 'login', authRequest: props.authRequest })
}

const handleCreateNewEnv = () => {
  emit('create-env', { authRequest: props.authRequest })
}

const handleDismiss = () => {
  emit('dismiss')
}
</script>

<style scoped>
.verify-helper-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1000;
  padding: 10px;
}

.verify-helper {
  background: linear-gradient(135deg, #1a237e 0%, #283593 100%);
  border-radius: 10px;
  color: white;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  overflow: hidden;
}

.verify-helper-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.verify-icon {
  flex-shrink: 0;
}

.verify-title {
  font-weight: 600;
  font-size: 14px;
  flex: 1;
}

.verify-close {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.verify-close:hover {
  color: white;
  background: rgba(255, 255, 255, 0.1);
}

.verify-helper-body {
  padding: 12px 16px 16px;
}

.verify-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  opacity: 0.8;
  margin-bottom: 12px;
}

.verify-env-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.verify-env-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.verify-env-item:hover {
  background: rgba(255, 255, 255, 0.15);
}

.env-item-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.env-item-alias {
  font-weight: 500;
  font-size: 13px;
}

.env-item-type {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 3px;
  font-weight: 500;
}

.env-item-type.type-production {
  background: #4caf50;
}

.env-item-type.type-sandbox {
  background: #ff9800;
}

.env-item-type.type-custom {
  background: #2196f3;
}

.env-item-detail {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.env-item-detail span {
  font-size: 11px;
  opacity: 0.7;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.env-item-no-credential {
  color: #ffb74d;
}

.env-item-passkey {
  font-size: 10px;
  padding: 1px 5px;
  background: rgba(76, 175, 80, 0.3);
  border-radius: 3px;
  color: #81c784;
}

.env-item-arrow {
  flex-shrink: 0;
  opacity: 0.5;
}

.verify-no-environments,
.verify-no-matched {
  text-align: center;
  padding: 20px 16px;
}

.verify-no-environments svg,
.verify-no-matched svg {
  margin-bottom: 12px;
}

.verify-no-environments p,
.verify-no-matched p {
  margin: 0 0 6px 0;
  font-size: 13px;
}

.hint-text {
  font-size: 11px !important;
  opacity: 0.6 !important;
}

.create-env-btn {
  margin-top: 12px;
  padding: 8px 20px;
  background: rgba(76, 175, 80, 0.9);
  border: none;
  border-radius: 6px;
  color: white;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.2s;
}

.create-env-btn:hover {
  background: rgba(76, 175, 80, 1);
  transform: translateY(-1px);
}
</style>
