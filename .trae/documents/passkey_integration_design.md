# Salesforce Quick Login 扩展 — Passkey 集成设计书

## 一、项目概述

### 1.1 目标
为 Salesforce Quick Login Chrome 扩展增加 Passkey（通行密钥）支持能力，使扩展能够：
1. 在 Salesforce 登录触发 WebAuthn Passkey 验证时，提供辅助提示
2. 支持扩展内部管理 Passkey 凭据，实现一键自动认证
3. 与现有 TOTP 验证码功能并列，形成多验证方式支持体系

### 1.2 背景
- Salesforce 已强制要求特权用户使用抗钓鱼 MFA（2026年9月生产环境生效）
- Passkey（基于 WebAuthn/FIDO2）是合规的验证方式之一
- 用户当前已使用 Bitwarden 浏览器扩展完成 Passkey 验证
- 用户希望在自有扩展中也具备类似能力

---

## 二、当前系统架构分析

### 2.1 技术栈
| 层级 | 技术 |
|------|------|
| 前端框架 | Vue 3 + Composition API |
| 构建工具 | Vite + @crxjs/vite-plugin |
| 扩展架构 | Chrome Manifest V3 |
| 状态存储 | chrome.storage.sync / local |
| 拖拽排序 | Sortable.js |

### 2.2 核心文件结构
```
public/
  manifest.json          # 扩展配置
  background.js          # Service Worker，消息中心
  content.js             # 内容脚本，页面交互
  js/totp.js             # TOTP 算法库
  lib/jsqr.js            # 二维码解析库

src/
  App.vue                # 根组件，状态管理
  components/
    EnvCard.vue          # 环境卡片 + TOTP 便签
    GroupSection.vue     # 分组容器
    Toolbar.vue          # 工具栏
    EditModal.vue        # 环境编辑/添加
    GroupModal.vue       # 分组编辑
    DeleteModal.vue      # 删除确认
    Toast.vue            # 消息提示
  composables/
    useStorage.js        # 数据持久化
    useLogin.js          # 登录逻辑
    useTotp.js           # TOTP 生成
  utils/
    constants.js         # 常量定义
```

### 2.3 现有登录流程
```
用户点击登录按钮
    ↓
EnvCard.vue handleLogin()
    ↓
App.vue handleLogin(env)
    ↓
useLogin.js login(env)
    ↓
chrome.runtime.sendMessage({ action: 'login', env })
    ↓
background.js handleLoginAction()
    ↓
chrome.tabs.create({ url: loginUrl })
    ↓
等待页面加载 → 注入隐藏表单 → 提交账号密码
    ↓
Salesforce 触发 MFA/Passkey 验证（浏览器原生处理）
```

### 2.4 数据模型
```typescript
interface Environment {
  id: string
  alias: string
  username: string
  password: string
  type: 'production' | 'sandbox' | 'custom'
  customUrl?: string
  groupId: string
  totpSecret?: string          // Base32 编码的 TOTP 密钥
  // 新增字段 ↓
  passkeys?: PasskeyCredential[] // 关联的 Passkey 凭据列表
}

interface Group {
  id: string
  name: string
  collapsed: boolean
}
```

---

## 三、Passkey 技术原理

### 3.1 WebAuthn / FIDO2 核心概念

**Passkey** = 基于公钥密码学的无密码认证方式，包含：
- **私钥**：存储在设备安全区域（Secure Enclave / TPM），永不离开设备
- **公钥**：注册时发送给服务端（Salesforce）存储
- **Credential ID**：唯一标识符

**认证流程**：
```
Salesforce 服务端                  浏览器/设备
    │                                  │
    │  ① 生成随机 challenge           │
    │─────────────────────────────────▶│
    │                                  │
    │  ② 调用 navigator.credentials   │
    │     .get({ publicKey: {...} })  │
    │                                  │
    │                                  │  ③ 用户选择 Passkey Provider
    │                                  │     （系统弹出选择器）
    │                                  │
    │                                  │  ④ 私钥签名 challenge
    │                                  │
    │  ⑤ 返回 assertion（签名结果）   │
    │◀─────────────────────────────────│
    │                                  │
    │  ⑥ 用公钥验证签名 → 登录成功    │
```

### 3.2 Chrome 扩展与 WebAuthn 的关系

| 能力 | 支持状态 | 说明 |
|------|----------|------|
| 扩展页面调用 WebAuthn API | ✅ Chrome 122+ | Side Panel / Popup / Options 中可直接调用 |
| 扩展指定任意 RP ID | ✅ Chrome 122+ | 只要在 host_permissions 中声明 |
| 扩展作为 Passkey Provider | ⚠️ 有限 | 需 Chrome flags + 特定条件，非公开标准 API |
| 拦截网页 WebAuthn 调用 | ❌ 不支持 | 安全模型不允许 |
| 导出/访问系统 Passkey 私钥 | ❌ 不支持 | 私钥不可导出 |

### 3.3 Bitwarden 扩展如何工作

Bitwarden 浏览器扩展的 Passkey 功能分三层：

1. **保存 Passkey**：在网页调用 `navigator.credentials.create()` 时，Bitwarden 拦截创建请求，将私钥存入自己的加密金库
2. **自动填充 Passkey**：当网页调用 `navigator.credentials.get()` 时，Chrome 弹出系统 Passkey 选择器，Bitwarden 作为可选 Provider 出现
3. **实际响应**：用户选择 Bitwarden 后，Bitwarden 用存储的私钥完成签名

**关键洞察**：Bitwarden 的 Passkey Provider 能力来自 **Chrome 内部集成**，不是公开扩展 API。Chrome 将 Bitwarden 识别为受信任的密码管理器，在 Passkey 选择器中优先展示。

---

## 四、可行方案对比

### 方案 A：扩展自管理 Passkey（软件实现）

**原理**：扩展内部用 JavaScript 生成密钥对，私钥加密存储在 `chrome.storage` 中。认证时，扩展在 Side Panel 中调用 WebAuthn API 的**软件模拟**版本完成签名。

**优点**：
- 完全自动化，用户一键完成认证
- 不依赖外部系统或第三方工具
- 可精确控制 Passkey 生命周期

**缺点**：
- 私钥以软件形式存储，安全性低于硬件安全区域
- 需要用户在 Salesforce 端**重新注册** Passkey（公钥要换）
- 无法实现跨设备同步
- 违反 Passkey "私钥不离开设备" 的设计原则

**技术可行性**：⭐⭐⭐ 中等

### 方案 B：辅助提示模式（推荐）

**原理**：扩展不管理私钥，只作为"智能助手"：
1. Content Script 监听 Salesforce 验证页面 URL
2. 检测到验证页面时，通过消息通知 Side Panel
3. Side Panel 自动切换到"验证助手"视图
4. 显示该环境可用的所有验证方式（Passkey、TOTP 等）
5. 用户点击后，扩展引导用户完成验证

**优点**：
- 安全，不触碰私钥
- 实现简单，不需要重新注册 Passkey
- 与现有 TOTP 功能无缝整合
- 兼容所有 Passkey Provider（Windows Hello、Bitwarden、YubiKey）

**缺点**：
- 无法完全自动化（最后一步仍需用户手动完成）
- 用户体验不如一键登录

**技术可行性**：⭐⭐⭐⭐⭐ 极高

### 方案 C：Hybrid 混合模式

**原理**：结合方案 A 和 B：
1. 扩展提供**软件 Passkey** 功能（方案 A）作为首选
2. 同时保留**辅助提示**（方案 B）作为备选
3. 用户在环境设置中选择优先验证方式

**优点**：
- 灵活性最高
- 软件 Passkey 可实现一键登录
- 硬件 Passkey 也能得到支持

**缺点**：
- 实现复杂度高
- 软件 Passkey 安全性存疑
- 用户需要理解两种模式的区别

**技术可行性**：⭐⭐⭐⭐ 较高

---

## 五、推荐方案：方案 B（辅助提示模式）+ 渐进增强

### 5.1 选择理由

1. **安全优先**：不存储私钥，符合 Salesforce 安全要求
2. **兼容现有**：用户已在用 Bitwarden/Windows Hello，无需改变习惯
3. **实现可控**：基于现有架构扩展，风险低
4. **未来可扩展**：如果 Chrome 开放更完善的 Passkey Provider API，可在此基础上升级

### 5.2 核心设计

```
┌─────────────────────────────────────────────────────────────┐
│                     用户点击登录                              │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              打开 Salesforce 登录页 + 提交账号密码              │
│                    （现有流程，不变）                          │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              Salesforce 重定向到验证页面                       │
│              （URL 特征：/identity/verify 等）                │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Content Script 检测到验证页面                                │
│  → 发送消息给 Background：{ action: 'detectedVerifyPage' }   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Background 转发消息给 Side Panel                             │
│  → Side Panel 自动切换到「验证助手」视图                       │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Side Panel 显示：                                           │
│  ┌─────────────────────────────────────┐                   │
│  │  🔐 检测到身份验证页面               │                   │
│  │                                     │                   │
│  │  该环境支持的验证方式：              │                   │
│  │  ┌─────────────────────────────┐   │                   │
│  │  │ 1️⃣ 使用 Passkey 验证        │   │                   │
│  │  │    （Windows Hello/Bitwarden）│   │                   │
│  │  └─────────────────────────────┘   │                   │
│  │  ┌─────────────────────────────┐   │                   │
│  │  │ 2️⃣ TOTP 验证码：123456      │   │                   │
│  │  │    [点击复制]  剩余 15 秒    │   │                   │
│  │  └─────────────────────────────┘   │                   │
│  └─────────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  用户选择验证方式：                                           │
│  • 点击「使用 Passkey」→ 扩展聚焦到验证标签页，高亮提示       │
│  • 点击「复制 TOTP」→ 复制验证码，扩展聚焦到验证标签页       │
└─────────────────────────────────────────────────────────────┘
```

---

## 六、详细设计

### 6.1 新增数据字段

在 `Environment` 对象中增加 `verifyMethods` 字段：

```typescript
interface Environment {
  id: string
  alias: string
  username: string
  password: string
  type: 'production' | 'sandbox' | 'custom'
  customUrl?: string
  groupId: string
  totpSecret?: string
  verifyMethods: VerifyMethod[]  // 新增
}

interface VerifyMethod {
  type: 'totp' | 'passkey'
  label: string
  // TOTP 不需要额外配置
  // Passkey 不需要存储私钥，仅标记该环境支持 Passkey
}
```

### 6.2 Content Script 增强

在 `public/content.js` 中新增验证页面检测逻辑：

```javascript
// 检测 Salesforce 验证页面
function detectVerificationPage() {
  const url = window.location.href
  const isVerifyPage = 
    url.includes('/identity/verify') ||
    url.includes('/login/servlet/servlet.su') ||
    url.includes('/idp/endpoint/HttpRedirect') ||
    document.title.includes('Verify Your Identity') ||
    document.querySelector('[data-testid="verify-identity"]') ||
    document.querySelector('button:contains("Verify Your Identity")')
  
  if (isVerifyPage) {
    chrome.runtime.sendMessage({
      action: 'verificationPageDetected',
      url: url,
      title: document.title
    })
  }
}

// 页面加载完成后检测
detectVerificationPage()

// 监听 URL 变化（SPA 场景）
const urlObserver = new MutationObserver(() => {
  detectVerificationPage()
})
urlObserver.observe(document.body, { childList: true, subtree: true })
```

### 6.3 Background.js 增强

新增消息处理：

```javascript
if (request.action === 'verificationPageDetected') {
  // 找到当前 focused 的普通窗口中的 active tab
  chrome.windows.getAll({ populate: true, windowTypes: ['normal'] })
    .then(windows => {
      const targetWindow = windows.find(w => w.focused) || windows[0]
      const activeTab = targetWindow?.tabs?.find(t => t.active)
      if (activeTab) {
        // 向 Side Panel 发送消息（通过 chrome.storage 或特定机制）
        chrome.storage.local.set({
          __sf_verify_notification: {
            tabId: activeTab.id,
            url: request.url,
            timestamp: Date.now()
          }
        })
      }
    })
  sendResponse({ success: true })
  return true
}
```

### 6.4 Side Panel（Vue）增强

在 `App.vue` 中新增验证助手状态：

```vue
<template>
  <div class="app-container">
    <!-- 验证助手覆盖层 -->
    <VerificationHelper
      v-if="verifyNotification"
      :notification="verifyNotification"
      :environment="findEnvByUrl(verifyNotification.url)"
      @dismiss="dismissVerifyNotification"
      @focus-tab="focusVerifyTab"
    />
    
    <!-- 原有内容 -->
    <Toolbar ... />
    <div class="env-list" ...>...</div>
    ...
  </div>
</template>
```

新增 `VerificationHelper.vue` 组件：

```vue
<template>
  <div class="verify-helper">
    <div class="verify-helper-header">
      <span class="verify-icon">🔐</span>
      <span>检测到身份验证</span>
      <button class="verify-dismiss" @click="$emit('dismiss')">✕</button>
    </div>
    
    <div class="verify-helper-body">
      <div class="verify-env-info" v-if="environment">
        <span class="verify-env-alias">{{ environment.alias }}</span>
        <span class="verify-env-type">{{ getTypeLabel(environment.type) }}</span>
      </div>
      
      <div class="verify-methods">
        <!-- Passkey 选项 -->
        <div class="verify-method-item" @click="handlePasskey">
          <div class="verify-method-icon">🔑</div>
          <div class="verify-method-content">
            <div class="verify-method-title">使用 Passkey 验证</div>
            <div class="verify-method-desc">Windows Hello / Bitwarden / 安全密钥</div>
          </div>
          <div class="verify-method-arrow">›</div>
        </div>
        
        <!-- TOTP 选项（如果环境有 totpSecret） -->
        <div class="verify-method-item" v-if="environment?.totpSecret" @click="handleTotp">
          <div class="verify-method-icon">🔢</div>
          <div class="verify-method-content">
            <div class="verify-method-title">TOTP 验证码</div>
            <div class="verify-method-code">{{ currentTotpCode }}</div>
          </div>
          <div class="verify-method-action">{{ copyStatus || '点击复制' }}</div>
        </div>
      </div>
      
      <button class="verify-focus-btn" @click="$emit('focus-tab')">
        聚焦到验证页面
      </button>
    </div>
  </div>
</template>
```

### 6.5 环境编辑界面增强

在 `EditModal.vue` 中新增验证方式配置：

```vue
<div class="form-group">
  <label>验证方式</label>
  <div class="verify-methods-config">
    <label class="verify-method-checkbox">
      <input type="checkbox" v-model="form.hasTotp" />
      <span>TOTP 验证码</span>
      <span class="verify-method-hint">（需要绑定二维码密钥）</span>
    </label>
    <label class="verify-method-checkbox">
      <input type="checkbox" v-model="form.hasPasskey" />
      <span>Passkey 验证</span>
      <span class="verify-method-hint">（已注册 Passkey 到该账户）</span>
    </label>
  </div>
</div>
```

### 6.6 环境卡片增强

在 `EnvCard.vue` 中，登录按钮的行为：

```javascript
const handleLogin = async () => {
  emit('login')
  
  // 如果绑定了 TOTP，自动展开并复制
  if (props.env.totpSecret) {
    if (!showTotpCard.value) {
      showTotpCard.value = true
      await refreshTotpCode()
      startTimer()
    }
    if (currentTotpCode.value && currentTotpCode.value !== '---') {
      await copyToClipboard(currentTotpCode.value)
      emit('copy-success', currentTotpCode.value)
    }
  }
  
  // 如果标记了 Passkey，提示用户使用 Passkey
  if (props.env.hasPasskey) {
    emit('passkey-hint', props.env)
  }
}
```

---

## 七、交互流程详细设计

### 7.1 登录 + Passkey 验证完整流程

```
[用户] → 点击「登录」按钮
  │
  ▼
[EnvCard] → handleLogin()
  │   • 触发 login 事件
  │   • 如果 hasPasskey → emit('passkey-hint')
  │   • 如果 hasTotp → 展开便签 + 复制验证码
  │
  ▼
[App] → handleLogin(env)
  │   • 调用 useLogin.login(env)
  │   • 打开 Salesforce 登录页
  │   • 提交账号密码
  │
  ▼
[Salesforce] → 账号密码验证通过
  │   • 重定向到身份验证页面
  │
  ▼
[Content Script] → 检测到验证页面
  │   • URL 匹配 /identity/verify
  │   • 发送 verificationPageDetected 消息
  │
  ▼
[Background] → 转发通知
  │   • 写入 chrome.storage.local.__sf_verify_notification
  │
  ▼
[Side Panel] → 检测到存储变化
  │   • 读取通知数据
  │   • 匹配对应的环境
  │   • 显示 VerificationHelper 组件
  │
  ▼
[用户] → 在 Side Panel 中选择验证方式
  │
  ├──→ 点击「使用 Passkey」
  │      • Side Panel 调用 chrome.tabs.update(tabId, { active: true })
  │      • 用户看到验证页面，点击「Verify Your Identity」
  │      • 系统弹出 Passkey 选择器（Windows Hello / Bitwarden）
  │      • 用户完成生物识别
  │      • Salesforce 验证通过 → 登录成功
  │
  └──→ 点击「复制 TOTP」
         • 复制验证码到剪贴板
         • 聚焦到验证标签页
         • 用户手动粘贴验证码
         • Salesforce 验证通过 → 登录成功
```

### 7.2 自动检测 vs 手动触发

| 场景 | 行为 |
|------|------|
| 自动检测（Content Script） | 用户正常登录流程中，扩展自动检测到验证页面并弹出提示 |
| 手动触发（Side Panel 按钮） | 用户在 Side Panel 中点击环境的「验证」按钮，主动获取验证码或 Passkey 提示 |

---

## 八、UI 设计

### 8.1 VerificationHelper 组件样式

```css
.verify-helper {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  background: linear-gradient(135deg, #1a237e 0%, #283593 100%);
  color: white;
  padding: 12px 16px;
  z-index: 100;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
}

.verify-helper-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
}

.verify-helper-body {
  margin-top: 10px;
}

.verify-method-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: rgba(255,255,255,0.1);
  border-radius: 8px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: background 0.2s;
}

.verify-method-item:hover {
  background: rgba(255,255,255,0.2);
}

.verify-method-icon {
  font-size: 20px;
}

.verify-method-title {
  font-weight: 500;
  font-size: 13px;
}

.verify-method-desc {
  font-size: 11px;
  opacity: 0.8;
}

.verify-focus-btn {
  width: 100%;
  padding: 8px;
  background: rgba(255,255,255,0.15);
  border: 1px solid rgba(255,255,255,0.3);
  border-radius: 6px;
  color: white;
  font-size: 12px;
  cursor: pointer;
  margin-top: 8px;
}
```

### 8.2 环境卡片新增 Passkey 标识

在环境卡片右上角或操作按钮区域增加 Passkey 状态标识：

```
[🔑]  表示该环境已配置 Passkey
[🔢]  表示该环境已配置 TOTP
[🔑🔢] 表示同时支持两种验证方式
```

---

## 九、安全考虑

### 9.1 不存储私钥
本方案明确不存储 Passkey 私钥，所有私钥操作交由系统原生处理（Windows Hello、Bitwarden、硬件密钥）。

### 9.2 隐私保护
- Content Script 仅检测 Salesforce 域名下的页面
- 验证页面检测不发送任何用户数据到外部
- 所有通信在扩展内部完成

### 9.3 数据存储
- `hasPasskey` 标记仅是一个布尔值，不包含任何密钥信息
- 不增加额外的敏感数据存储

---

## 十、实施计划

### Phase 1：基础检测（1-2 天）
1. 增强 Content Script 检测 Salesforce 验证页面
2. 新增 Background → Side Panel 通知机制
3. 新增 `chrome.storage` 监听逻辑

### Phase 2：UI 组件（2-3 天）
1. 创建 `VerificationHelper.vue` 组件
2. 在 `App.vue` 中集成验证助手状态
3. 设计并应用验证助手样式

### Phase 3：数据层（1 天）
1. 在 `Environment` 模型中新增 `verifyMethods` 字段
2. 更新 `EditModal.vue` 支持验证方式配置
3. 更新 `EnvCard.vue` 显示验证方式标识

### Phase 4：流程整合（1-2 天）
1. 整合登录流程与验证助手
2. TOTP 自动复制 + Passkey 提示联动
3. 测试完整登录 → 验证流程

### Phase 5：优化（1 天）
1. 动画与过渡效果
2. 边界情况处理（多标签页、超时等）
3. 构建与验证

---

## 十一、风险与限制

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Salesforce 验证页面 URL/结构变化 | 检测失效 | 使用多种检测策略（URL + DOM + 标题），定期更新 |
| Chrome 安全策略收紧 | Content Script 能力受限 | 保持最小权限原则，关注 Chrome 更新公告 |
| 用户同时打开多个验证页面 | 通知冲突 | 通知队列机制，显示最新的验证请求 |
| Side Panel 未打开 | 通知无法显示 | 通过 chrome.action.setBadge 提示，点击打开 Side Panel |

---

## 十二、未来扩展方向

1. **软件 Passkey（方案 A）**：如果 Chrome 开放更完善的扩展 Passkey Provider API，可在现有架构上增加软件密钥管理
2. **自动填充 TOTP 到验证页面**：扩展检测到 TOTP 输入框后自动填入（类似当前 content.js 的 fillTotpCode）
3. **验证历史记录**：记录每次验证的时间、方式，方便审计
4. **企业级功能**：支持组织策略强制验证方式

---

*设计书版本: 1.0*
*日期: 2026-07-15*
