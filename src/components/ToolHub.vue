<template>
  <div class="tool-hub">
    <div class="tool-hub-header">
      <h2>工具入口</h2>
      <p>点击图标将在独立窗口中打开对应工具。无需登录扩展账户。</p>
    </div>

    <div class="tool-grid">
      <button type="button" class="tool-tile" @click="$emit('open-tool', 'apex-log')">
        <div class="tool-tile-icon icon-apex">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8">
            <rect x="4" y="5" width="16" height="14" rx="2"/>
            <path d="M7 9h10M7 12h8M7 15h6"/>
          </svg>
        </div>
        <div class="tool-tile-name">Apex Log Viewer</div>
        <div class="tool-tile-desc">实时查看 Apex Debug Log</div>
      </button>

      <button type="button" class="tool-tile" @click="$emit('open-tool', 'soql')">
        <div class="tool-tile-icon icon-soql">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8">
            <ellipse cx="12" cy="7" rx="7" ry="3"/>
            <path d="M5 7v8c0 1.7 3.1 3 7 3s7-1.3 7-3V7"/>
            <path d="M5 11c0 1.7 3.1 3 7 3s7-1.3 7-3"/>
          </svg>
        </div>
        <div class="tool-tile-name">SOQL Creator</div>
        <div class="tool-tile-desc">生成并执行 SOQL 查询</div>
      </button>
    </div>
  </div>
</template>

<script setup>
defineEmits(['open-tool'])
</script>

<style scoped>
.tool-hub {
  min-height: calc(100vh - 42px);
  background: #eef5fc;
  padding: 16px 14px 20px;
  box-sizing: border-box;
}

.tool-hub-header h2 {
  margin: 0 0 6px;
  font-size: 15px;
  color: #0d47a1;
}

.tool-hub-header p {
  margin: 0 0 16px;
  font-size: 12px;
  color: #607d8b;
  line-height: 1.5;
}

.tool-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.tool-tile {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  gap: 8px;
  padding: 14px 12px;
  border: 1px solid #bbdefb;
  border-radius: 10px;
  background: #fff;
  cursor: pointer;
  transition: all 0.15s;
  box-shadow: 0 2px 8px rgba(25, 118, 210, 0.06);
}

.tool-tile:hover {
  border-color: #64b5f6;
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(25, 118, 210, 0.12);
}

.tool-tile:active {
  transform: translateY(0);
}

.tool-tile-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-apex {
  background: #e3f2fd;
  color: #1565c0;
}

.icon-soql {
  background: #e8f5e9;
  color: #2e7d32;
}

.tool-tile-name {
  font-size: 13px;
  font-weight: 600;
  color: #0d47a1;
  line-height: 1.3;
}

.tool-tile-desc {
  font-size: 11px;
  color: #78909c;
  line-height: 1.4;
}
</style>
