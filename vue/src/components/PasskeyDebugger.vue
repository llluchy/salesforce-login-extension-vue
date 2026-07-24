<template>
  <div class="passkey-debugger">
    <div class="debugger-header">
      <h2>🔧 Passkey 流程调试器</h2>
      <div class="header-actions">
        <button class="btn btn-secondary" @click="clearLogs">清空日志</button>
        <button class="btn btn-close" @click="$emit('close')">×</button>
      </div>
    </div>

    <div class="debugger-body">
      <!-- 左侧：控制面板 -->
      <div class="debugger-panel">
        <h3>选择环境</h3>
        <div class="env-selector">
          <label v-for="env in environments" :key="env.id" class="env-option">
            <input type="radio" :value="env.id" v-model="selectedEnvId">
            <div class="env-info">
              <div class="env-alias">{{ env.alias || '(未命名)' }}</div>
              <div class="env-meta">
                <span class="tag">{{ env.type }}</span>
                <span class="passkey-count">
                  Passkey: {{ (env.passkeys || []).length }}
                </span>
              </div>
            </div>
          </label>
        </div>

        <h3 style="margin-top: 20px;">rpId</h3>
        <input v-model="rpId" class="input" placeholder="例如: xxx.sandbox.my.salesforce.com">

        <div class="action-buttons">
          <button class="btn btn-primary" @click="runFlow" :disabled="!selectedEnv">
            ▶ 运行完整流程
          </button>
          <button class="btn btn-secondary" @click="showEnvDetails = !showEnvDetails">
            {{ showEnvDetails ? '隐藏' : '查看' }}选中环境详情
          </button>
        </div>

        <div v-if="showEnvDetails && selectedEnv" class="env-details">
          <h4>环境详情（原始数据）</h4>
          <pre>{{ JSON.stringify(selectedEnv, null, 2) }}</pre>
        </div>

        <div v-if="flowResult" class="flow-result" :class="flowResult.success ? 'success' : 'error'">
          <h4>流程结果</h4>
          <div class="result-item">
            <span>成功:</span>
            <span>{{ flowResult.success }}</span>
          </div>
          <div v-if="flowResult.error" class="result-item">
            <span>错误:</span>
            <span class="error-text">{{ flowResult.error }}</span>
          </div>
          <div v-if="flowResult.storedCredentials" class="result-item">
            <span>Passkey 数:</span>
            <span>{{ flowResult.storedCredentials.length }}</span>
          </div>
          <div v-if="flowResult.storedCredentials && flowResult.storedCredentials.length > 0" class="result-item">
            <span>含私钥:</span>
            <span :class="flowResult.storedCredentials[0].privateKeyJwk ? 'success-text' : 'error-text'">
              {{ !!flowResult.storedCredentials[0].privateKeyJwk }}
            </span>
          </div>
        </div>
      </div>

      <!-- 右侧：日志 -->
      <div class="debugger-logs">
        <h3>执行日志（按步骤）</h3>
        <div class="logs-container">
          <div v-if="logs.length === 0" class="empty-logs">
            点击「运行完整流程」开始调试
          </div>
          <div v-for="(log, idx) in logs" :key="idx" class="log-entry">
            <div class="log-time">{{ log.time }}</div>
            <div class="log-step">{{ log.step }}</div>
            <details class="log-detail">
              <summary>查看详情</summary>
              <pre>{{ JSON.stringify(log.detail, null, 2) }}</pre>
            </details>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>import { ref, computed } from 'vue';
import { useStorage } from '../composables/useStorage';
import { useMockPasskeyFlow } from '../composables/useMockPasskeyFlow';
const emit = defineEmits(['close']);
const { loadEnvironments } = useStorage();
const { logs, runFullFlow, clearLogs: clearFlowLogs } = useMockPasskeyFlow();
const environments = ref([]);
const selectedEnvId = ref(null);
const rpId = ref('');
const showEnvDetails = ref(false);
const flowResult = ref(null);
const selectedEnv = computed(() => {
 return environments.value.find(e => e.id === selectedEnvId.value);
});
const init = async () => {
 environments.value = await loadEnvironments();
 // 默认选中第一个有 passkey 的环境
 const envWithPk = environments.value.find(e => (e.passkeys || []).length > 0);
 if (envWithPk) {
 selectedEnvId.value = envWithPk.id;
 // 自动填充 rpId
 if (envWithPk.passkeys && envWithPk.passkeys.length > 0 && envWithPk.passkeys[0].rpId) {
 rpId.value = envWithPk.passkeys[0].rpId;
 }
 }
};
const runFlow = async () => {
 flowResult.value = null;
 if (!selectedEnv.value)
 return;
 const result = await runFullFlow(selectedEnv.value, rpId.value);
 flowResult.value = result;
};
const clearLogs = () => {
 clearFlowLogs();
 flowResult.value = null;
};
init();
</script>

<style scoped>
.passkey-debugger {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.85);
  z-index: 99999;
  display: flex;
  flex-direction: column;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #333;
}

.debugger-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
  color: white;
}

.debugger-header h2 {
  margin: 0;
  font-size: 18px;
}

.header-actions {
  display: flex;
  gap: 10px;
}

.debugger-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.debugger-panel {
  width: 420px;
  background: #f5f9ff;
  padding: 20px;
  overflow-y: auto;
  border-right: 1px solid #bbdefb;
}

.debugger-panel h3 {
  margin: 0 0 12px 0;
  font-size: 14px;
  color: #0d47a1;
  border-bottom: 2px solid #bbdefb;
  padding-bottom: 6px;
}

.debugger-panel h4 {
  margin: 0 0 10px 0;
  font-size: 13px;
  color: #1976d2;
}

.env-selector {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.env-option {
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  background: white;
  border: 1px solid #bbdefb;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
}

.env-option:hover {
  background: #e3f2fd;
  border-color: #1976d2;
}

.env-option input[type="radio"] {
  margin-top: 4px;
}

.env-alias {
  font-weight: 600;
  color: #0d47a1;
  font-size: 14px;
}

.env-meta {
  display: flex;
  gap: 8px;
  margin-top: 4px;
  font-size: 11px;
}

.tag {
  padding: 2px 8px;
  background: #e3f2fd;
  color: #1976d2;
  border-radius: 10px;
}

.passkey-count {
  padding: 2px 8px;
  background: #fff8e1;
  color: #f57c00;
  border-radius: 10px;
}

.input {
  width: 100%;
  padding: 9px 11px;
  border: 1px solid #bbdefb;
  border-radius: 4px;
  font-size: 13px;
  box-sizing: border-box;
  outline: none;
}

.input:focus {
  border-color: #1976d2;
}

.action-buttons {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.15s;
}

.btn-primary {
  background: #1976d2;
  color: white;
}

.btn-primary:hover {
  background: #0d47a1;
}

.btn-primary:disabled {
  background: #90caf9;
  cursor: not-allowed;
}

.btn-secondary {
  background: #e3f2fd;
  color: #1976d2;
}

.btn-secondary:hover {
  background: #bbdefb;
}

.btn-close {
  background: rgba(255, 255, 255, 0.2);
  color: white;
  font-size: 20px;
  padding: 4px 12px;
}

.btn-close:hover {
  background: rgba(255, 255, 255, 0.3);
}

.env-details {
  margin-top: 16px;
  padding: 12px;
  background: white;
  border: 1px solid #bbdefb;
  border-radius: 6px;
}

.env-details pre {
  max-height: 300px;
  overflow: auto;
  font-size: 11px;
  background: #f5f5f5;
  padding: 10px;
  border-radius: 4px;
}

.flow-result {
  margin-top: 16px;
  padding: 12px;
  border-radius: 6px;
  border: 2px solid;
}

.flow-result.success {
  background: #e8f5e9;
  border-color: #4caf50;
}

.flow-result.error {
  background: #ffebee;
  border-color: #f44336;
}

.result-item {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  padding: 4px 0;
}

.success-text {
  color: #2e7d32;
  font-weight: 600;
}

.error-text {
  color: #c62828;
  font-weight: 600;
}

.debugger-logs {
  flex: 1;
  padding: 20px;
  background: #1a1a2e;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.debugger-logs h3 {
  margin: 0 0 12px 0;
  font-size: 14px;
  color: #bbdefb;
  border-bottom: 1px solid #1976d2;
  padding-bottom: 6px;
}

.logs-container {
  flex: 1;
  overflow-y: auto;
}

.empty-logs {
  color: #666;
  text-align: center;
  padding: 40px;
  font-size: 13px;
}

.log-entry {
  background: #16213e;
  border: 1px solid #1976d2;
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 10px;
}

.log-time {
  font-size: 11px;
  color: #90caf9;
  margin-bottom: 4px;
}

.log-step {
  font-size: 13px;
  color: #e3f2fd;
  font-weight: 600;
  margin-bottom: 6px;
}

.log-detail summary {
  cursor: pointer;
  color: #64b5f6;
  font-size: 12px;
}

.log-detail pre {
  margin-top: 8px;
  background: #0a0a1a;
  color: #a5d6a7;
  padding: 10px;
  border-radius: 4px;
  font-size: 11px;
  max-height: 400px;
  overflow: auto;
}
</style>
