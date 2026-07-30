<template>
  <Transition name="modal">
    <div class="modal-overlay" v-if="visible">
      <div class="modal-content">
        <div class="modal-header">
          <h2>{{ group ? '编辑分组' : '创建分组' }}</h2>
          <button class="modal-close" @click="$emit('close')">×</button>
        </div>
        
        <div class="modal-body">
          <div class="form-group">
            <label>分组名称 *</label>
            <input 
              type="text" 
              v-model="groupName" 
              placeholder="输入分组名称" 
              required
            />
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
import { ref, watch } from 'vue'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  group: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['close', 'save'])

const groupName = ref('')

const handleSave = () => {
  if (!groupName.value.trim()) {
    alert('请输入分组名称')
    return
  }
  
  const groupData = {
    id: props.group ? props.group.id : null,
    name: groupName.value.trim(),
    isVirtual: false,
    collapsed: props.group ? props.group.collapsed : false
  }
  
  emit('save', groupData)
}

watch(() => props.visible, (val) => {
  if (val) {
    groupName.value = props.group ? props.group.name : ''
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
  max-width: 360px;
  box-shadow: 0 4px 20px rgba(25, 118, 210, 0.2);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid #bbdefb;
  background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
  color: #ffffff;
}

.modal-header h2 {
  margin: 0;
  font-size: 16px;
  color: #ffffff;
}

.modal-close {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.85);
}

.modal-close:hover {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 3px;
}

.modal-body {
  padding: 16px;
}

.form-group {
  margin-bottom: 14px;
}

.form-group label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 500;
  color: #333;
}

.form-group input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #bbdefb;
  border-radius: 4px;
  font-size: 13px;
  box-sizing: border-box;
  background: #ffffff;
}

.form-group input:focus {
  outline: none;
  border-color: #1976d2;
  box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.1);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px;
  border-top: 1px solid #bbdefb;
  background: #f5f9ff;
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
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

.modal-enter-active,
.modal-leave-active {
  transition: all 0.3s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal-content,
.modal-leave-to .modal-content {
  transform: scale(0.9);
}
</style>