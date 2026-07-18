<template>
  <div class="toolbar">
    <div class="toolbar-title-row">
      <h1 class="toolbar-title">Salesforce Quick Login</h1>
      <span class="toolbar-count">{{ envCount }}/{{ maxEnvironments }}</span>
    </div>
  </div>
  <div class="toolbar-actions">
    <button class="btn-action" @click="$emit('add-env')">
      <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="16" height="16" rx="3"/><line x1="10" y1="7" x2="10" y2="13"/><line x1="7" y1="10" x2="13" y2="10"/></svg>
      <span>添加环境</span>
    </button>
    <button class="btn-action" @click="$emit('add-group')">
      <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 6h16v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/><path d="M6 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/><line x1="10" y1="9" x2="10" y2="14"/><line x1="7.5" y1="11.5" x2="12.5" y2="11.5"/></svg>
      <span>创建分组</span>
    </button>
    <button class="btn-action btn-test" @click="$emit('test-passkey')">
      <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="14" height="7" rx="2"/><circle cx="10" cy="7" r="4"/><path d="M6 11V9a4 4 0 018 0v2"/></svg>
      <span>测试 Passkey</span>
    </button>
    <button class="btn-action btn-backup" @click="$emit('export-backup')" title="导出 Passkey 凭证备份">
      <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 3v10"/><path d="M6 9l4 4 4-4"/><path d="M3 15v2a1 1 0 001 1h12a1 1 0 001-1v-2"/></svg>
      <span>导出备份</span>
    </button>
    <button class="btn-action btn-backup" @click="$emit('import-backup')" title="从备份文件恢复 Passkey 凭证">
      <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13V3"/><path d="M6 7l4-4 4 4"/><path d="M3 15v2a1 1 0 001 1h12a1 1 0 001-1v-2"/></svg>
      <span>导入备份</span>
    </button>
    <button class="btn-action btn-manual" @click="$emit('manual-bind')" title="手动绑定 Passkey 凭证（粘贴 JSON 或按 credentialId 导出）">
      <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 2v6M10 12v6M2 10h6M12 10h6"/></svg>
      <span>手动绑定</span>
    </button>
    <input ref="fileInputRef" type="file" accept=".json" style="display:none" @change="$emit('import-file', $event)" />
  </div>
</template>

<script setup>
import { ref } from 'vue'
defineProps({
  envCount: {
    type: Number,
    default: 0
  },
  maxEnvironments: {
    type: Number,
    default: 50
  }
})

defineEmits(['add-env', 'add-group', 'test-passkey', 'export-backup', 'import-backup', 'import-file', 'manual-bind'])

const fileInputRef = ref(null)
defineExpose({ fileInputRef })
</script>

<style scoped>
.toolbar {
  background: #2c2c2c;
  color: white;
  padding: 6px 12px;
}

.toolbar-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.toolbar-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.3;
}

.toolbar-count {
  font-size: 11px;
  opacity: 0.6;
}

.toolbar-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 6px 12px;
  background: #3a3a3a;
  border-bottom: 1px solid #2c2c2c;
}

.btn-action {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px 10px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.08);
  color: white;
  cursor: pointer;
  transition: all 0.15s;
  gap: 5px;
  font-size: 12px;
}

.btn-action:hover {
  background: rgba(255, 255, 255, 0.18);
  border-color: rgba(255, 255, 255, 0.4);
}

.btn-test {
  border-color: rgba(76, 175, 80, 0.4);
  color: #81c784;
}

.btn-test:hover {
  background: rgba(76, 175, 80, 0.15);
  border-color: rgba(76, 175, 80, 0.6);
}

.btn-backup {
  border-color: rgba(255, 152, 0, 0.4);
  color: #ffb74d;
}

.btn-backup:hover {
  background: rgba(255, 152, 0, 0.15);
  border-color: rgba(255, 152, 0, 0.6);
}

.btn-manual {
  border-color: rgba(156, 39, 176, 0.4);
  color: #ce93d8;
}

.btn-manual:hover {
  background: rgba(156, 39, 176, 0.15);
  border-color: rgba(156, 39, 176, 0.6);
}
</style>
