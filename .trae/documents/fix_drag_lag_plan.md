# 修复拖拽残影不跟手问题

## 问题概述

环境卡片拖拽时存在两个问题：
1. **跟手残影有延迟**：鼠标移动距离和残影跟踪之间存在速度差
2. **两个残影**：一个跟随鼠标，一个在目标位置提前出现

## 根因分析

### 根因1（主因）：CSS `transition: all` 导致跟手延迟

文件：`vue/src/components/EnvCard.vue` 第 63 行

```css
.env-card {
  transition: all 0.2s ease;  /* 问题根源 */
}
```

Sortable.js 使用 `forceFallback: true` 时，会克隆被拖拽元素并通过 `transform: translate3d(x, y, 0)` 更新位置。克隆体保留了 `.env-card` 类，`transition: all 0.2s ease` 会让每次 `transform` 变化都产生 200ms 的过渡动画，导致残影跟不上鼠标。

### 根因2：`transform: scale()` 与 Sortable 的 `translate3d()` 冲突

文件：`vue/src/components/EnvCard.vue` 第 178 行、`vue/src/components/GroupSection.vue` 第 181 行

```css
.env-drag {
  transform: scale(1.02);  /* 与 Sortable 的 translate3d 冲突 */
}
```

Sortable 通过 `transform: translate3d()` 定位克隆体，CSS 类中的 `transform: scale()` 会干扰定位。

### 根因3：冗余/未使用的样式类

- `GroupSection.vue` 第 168-182 行定义了 `.sortable-ghost`、`.sortable-chosen`、`.sortable-drag`，但 Sortable 配置实际使用的是自定义类名 `env-ghost`、`env-chosen`、`env-drag`，这些默认类名定义是冗余的
- `styles.css` 第 37-44 行的 `.dragging` 和 `.drop-target` 类未被任何代码引用

### 根因4：两层拖拽配置不一致

- `GroupSection.vue`（环境卡片拖拽）：`forceFallback: true` — 使用 JS 模拟拖拽
- `App.vue`（分组拖拽）：未设置 `forceFallback` — 使用原生 HTML5 拖拽

配置不一致导致两层拖拽行为表现不同。

## 修改方案

### 修改1：EnvCard.vue — 修复跟手延迟和 transform 冲突

**文件**：`vue/src/components/EnvCard.vue`

**修改 `.env-drag` 样式**（第 175-179 行）：
- 添加 `transition: none !important` — 覆盖 `.env-card` 的 `transition: all 0.2s ease`，消除跟手延迟
- 移除 `transform: scale(1.02)` — 避免与 Sortable 的 `translate3d()` 冲突
- 保留 `opacity` 和 `box-shadow` 维持视觉效果

```css
/* 修改前 */
:global(.env-drag) {
  opacity: 0.8;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  transform: scale(1.02);
}

/* 修改后 */
:global(.env-drag) {
  opacity: 0.85;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  transition: none !important;
}
```

### 修改2：GroupSection.vue — 删除冗余样式，优化 Sortable 配置

**文件**：`vue/src/components/GroupSection.vue`

**2a. 删除冗余的全局样式**（第 168-182 行）：
删除未被 Sortable 配置使用的 `.sortable-ghost`、`.sortable-chosen`、`.sortable-drag`，它们与 `env-*` 类重复且含 `transform: scale()` 冲突。

**2b. 优化 Sortable 配置**（第 75-111 行）：
- 添加 `fallbackOnBody: true` — 将克隆体附加到 `document.body`，脱离原容器的 CSS 继承链，进一步避免 `transition` 干扰
- 添加 `fallbackTolerance: 0` — 确保鼠标按下后立即开始拖拽，无延迟

```javascript
sortableInstance = new Sortable(contentRef.value, {
  group: {
    name: 'env-cards',
    pull: true,
    put: true
  },
  handle: '.env-drag-handle',
  animation: 150,
  ghostClass: 'env-ghost',
  chosenClass: 'env-chosen',
  dragClass: 'env-drag',
  forceFallback: true,
  fallbackClass: 'env-drag',
  fallbackOnBody: true,       // 新增：克隆体附加到 body
  fallbackTolerance: 0,      // 新增：立即响应拖拽
  onStart: () => { ... },
  onEnd: (evt) => { ... }
})
```

### 修改3：App.vue — 统一分组拖拽配置

**文件**：`vue/src/App.vue`

**3a. 为分组拖拽添加 `forceFallback` 配置**（第 330-353 行）：
添加 `forceFallback: true`、`fallbackClass: 'group-drag'`、`fallbackOnBody: true`、`fallbackTolerance: 0`，与环境卡片拖拽保持一致。

**3b. 修复 `.group-drag` 样式**（第 396-399 行）：
添加 `transition: none !important`，防止分组拖拽时出现同样的跟手延迟。

```css
/* 修改前 */
:global(.group-drag) {
  opacity: 0.8;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
}

/* 修改后 */
:global(.group-drag) {
  opacity: 0.85;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  transition: none !important;
}
```

### 修改4：styles.css — 清理未使用的遗留样式

**文件**：`vue/src/assets/styles.css`

删除第 37-44 行未被引用的 `.dragging` 和 `.drop-target` 类。

## 验证步骤

1. 执行 `cd vue && npm run build` 确认构建成功
2. 将 `vue/dist/` 加载到 Chrome 扩展中
3. 测试环境卡片拖拽：
   - 在同一分组内拖拽排序 — 残影应紧跟鼠标，无延迟
   - 跨分组拖拽 — 残影应紧跟鼠标
   - 确认目标位置占位符（蓝色虚线框）仍正常显示
4. 测试分组拖拽：
   - 拖拽分组排序 — 残影应紧跟鼠标，无延迟
   - 确认"未选择分组"不可拖拽
