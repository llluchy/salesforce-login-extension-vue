<template>
  <Transition name="toast">
    <div class="toast-container" v-if="visible">
      <div class="toast" :class="`toast-${type}`">
        <span class="toast-icon">{{ getIcon(type) }}</span>
        <span class="toast-message">{{ message }}</span>
        <button class="toast-close" @click="$emit('close')">×</button>
      </div>
    </div>
  </Transition>
</template>

<script setup>
defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  message: {
    type: String,
    default: ''
  },
  type: {
    type: String,
    default: 'success',
    validator: (value) => ['success', 'error', 'info'].includes(value)
  }
})

defineEmits(['close'])

const getIcon = (type) => {
  const icons = {
    success: '✓',
    error: '✗',
    info: 'ℹ'
  }
  return icons[type] || ''
}
</script>

<style scoped>
.toast-container {
  position: fixed;
  top: 80px;
  right: 16px;
  z-index: 1000;
}

.toast {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-radius: 8px;
  min-width: 200px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.toast-success {
  background-color: #d4edda;
  color: #155724;
}

.toast-error {
  background-color: #f8d7da;
  color: #721c24;
}

.toast-info {
  background-color: #d1ecf1;
  color: #0c5460;
}

.toast-icon {
  font-weight: bold;
  font-size: 14px;
}

.toast-message {
  flex: 1;
  font-size: 13px;
}

.toast-close {
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: inherit;
  padding: 0;
  line-height: 1;
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(100%);
}
</style>