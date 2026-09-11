# 工具聚合平台 · 第一版壳层

> 术语见 [`terminology.md`](./terminology.md)。

分支：`feature/tool-platform-shell`  
状态：Side Panel 工具导航 + 独立窗口占位（窗口内业务逻辑后续接入）

---

## 已实现

1. **Side Panel 顶部工具导航**
   - 标签「登录」（默认）：原 Quick Login（扩展账户鉴权仅锁此标签）
   - 标签「工具」：宫格入口，**不要求登录扩展**

2. **独立窗口启动**
   - Apex Log Viewer → `apex-log.html`
   - SOQL Creator → `soql.html`
   - 由 Service Worker `openToolWindow` 创建；再次点击会聚焦已有窗口
   - **关闭 Side Panel 不会关闭独立窗口**

3. **窗口内**
   - 仅占位壳（`ToolWindowShell`），风格与宿主一致
   - 环境选择器 / Cookie 会话 / 具体业务 → 后续版本

---

## 关键文件

| 路径 | 作用 |
|------|------|
| `src/components/SideNavTabs.vue` | 顶部标签 |
| `src/components/ToolHub.vue` | 工具宫格 |
| `src/tools/_shared/ToolWindowShell.vue` | 独立窗口占位 UI |
| `src/tools/apex-log/`、`src/tools/soql/` | 工具入口 |
| `tool-window.html` | 独立窗口统一入口（`?tool=apex-log|soql`） |
| `background.js` → `openToolWindow` | 开窗 / 聚焦 |
| `vite.config.js` | 多页 rollup input（sidepanel + tool-window） |

---

## 鉴权边界

| 区域 | 是否需要扩展账户 |
|------|------------------|
| 标签「登录」 | 是（认证屏 / 主界面） |
| 标签「工具」 | 否 |
| Apex / SOQL 独立窗口 | 否（后续走 Cookie 会话路径） |

---

## 下一步（部分已完成）

- [x] SOQL 独立窗口：环境选择器 + 对象/字段 + 生成/执行（Cookie 会话）
- [ ] Apex Log 能力完善与风格统一验收
- [ ] 共享 `SfSession` 进一步收敛 Apex / SOQL 重复发现逻辑
- [ ] 白名单设置页（当前 SOQL 使用内置默认标准对象白名单）
