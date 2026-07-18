# Salesforce Quick Login 扩展 — Passkey 集成设计书 V2

## 一、核心发现：Content Script 可以拦截 WebAuthn

经过对用户需求的重新分析和技术调研，发现**Content Script 运行在网页上下文中，可以完全覆盖 `navigator.credentials` 对象**。这意味着：

```javascript
// content.js 运行在 salesforce.com 域下
const originalGet = navigator.credentials.get.bind(navigator.credentials);

navigator.credentials.get = async function(options) {
  // 这里可以完全接管 Salesforce 的 Passkey 认证请求
  // origin 仍然是 https://salesforce.com，服务端验证无问题
};
```

这是实现用户需求的**关键技术基础**。

---

## 二、用户需求的精确映射

用户描述的理想流程：

```
登录页面 → 输入账号密码 → Salesforce 要求 Passkey 验证
    ↓
自动调起插件 Side Panel
    ↓
Side Panel 显示该环境已保存的 Passkey 列表
    ↓
用户点击 Passkey
    ↓
扩展完成验证 → 返回 assertion → Salesforce 验证通过
```

**每个 Passkey 绑定一个环境**，账号、密码、TOTP、Passkey 全部围绕各自的环境卡片管理。

---

## 三、最终方案：Content Script 拦截 + 扩展代理

### 3.1 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│  Salesforce 验证页面 (https://salesforce.com)                   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Content Script (注入到页面中)                            │   │
│  │                                                         │   │
│  │ ① 覆盖 navigator.credentials.get()                     │   │
│  │    检测到 Salesforce Passkey 请求 → 暂停执行             │   │
│  │    发送消息给 Background: "发现认证请求"                  │   │
│  │                                                         │   │
│  │ ④ 收到扩展回复的 credential ID                          │   │
│  │    调用原始 get() 并注入 allowCredentials               │   │
│  │    或直接用扩展私钥完成签名（取决于模式）                │   │
│  │                                                         │   │
│  │ ② 覆盖 navigator.credentials.create()                  │   │
│  │    检测到 Passkey 注册 → 通知扩展记录 credential ID     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                      │                                          │
│                      │ chrome.runtime.sendMessage               │
│                      ▼                                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Background (Service Worker)                              │   │
│  │ • 消息中转                                               │   │
│  │ • 读取/写入 chrome.storage（Passkey 数据）               │   │
│  │ • 通过 chrome.storage.onChanged 通知 Side Panel          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                      │                                          │
│                      ▼                                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Side Panel (Vue App)                                     │   │
│  │                                                          │   │
│  │ ③ 检测到认证通知                                         │   │
│  │    显示「验证助手」覆盖层                                 │   │
│  │    列出该环境绑定的所有 Passkey                           │   │
│  │    用户点击 Passkey → 通知 Background                     │   │
│  │                                                          │   │
│  │ ⑤ 在「我的 Passkey」页面                                 │   │
│  │    管理每个环境的 Passkey（注册/删除/查看）               │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 为什么这个方案可行

| 检查点 | 状态 | 说明 |
|--------|------|------|
| Content Script 能否覆盖 `navigator.credentials` | ✅ 可以 | Content Script 与页面同域，可以修改全局对象 |
| 拦截后的 origin 是否正确 | ✅ 正确 | `clientDataJSON.origin` 仍然是 `https://salesforce.com` |
| 能否暂停 WebAuthn 调用等待用户选择 | ✅ 可以 | 用 Promise 暂停，用户选择后 resolve |
| 扩展能否存储 credential ID | ✅ 可以 | `chrome.storage` 可以安全存储 |
| 私钥是否仍由系统管理 | ✅ 是 | 方案 A：私钥在系统安全区域；方案 B：扩展软件管理 |

---

## 四、双模式设计

### 模式 A：系统凭证代理（推荐首选）

**私钥存储位置**：系统安全区域（Windows Hello / Bitwarden / 安全密钥）
**扩展存储**：仅 credential ID + 元数据

```
注册流程：
用户点击「注册 Passkey」→ 扩展打开 Salesforce Passkey 注册页
    ↓
Content Script 拦截 navigator.credentials.create()
    ↓
调用原始 create()，系统弹出注册流程（生物识别）
    ↓
注册成功 → 扩展记录 credentialId + rpId + userHandle
    ↓
将 Passkey 绑定到当前环境

认证流程：
Salesforce 调用 navigator.credentials.get()
    ↓
Content Script 拦截 → 通知扩展
    ↓
扩展弹出 Side Panel「验证助手」
    ↓
用户点击已保存的 Passkey
    ↓
扩展通过 content script 调用原始 get()，注入 allowCredentials
    ↓
浏览器找到系统凭证 → 弹出生物识别
    ↓
用户完成生物识别 → 返回 assertion
    ↓
Salesforce 验证通过
```

**优点**：
- 安全性最高，私钥永不离开系统安全区域
- 与现有 Passkey 生态完全兼容
- 不需要重新注册（如果已有 Passkey）

**缺点**：
- 最后一步仍需用户生物识别（但通常只需指纹/面容一触）
- 依赖系统 Passkey Provider（Windows Hello 等）

### 模式 B：软件凭证管理（完全自动化）

**私钥存储位置**：扩展内部，`chrome.storage` 中加密存储
**扩展存储**：完整密钥对（私钥加密 + 公钥）

```
注册流程：
用户点击「生成软件 Passkey」→ 扩展用 Web Crypto API 生成密钥对
    ↓
私钥加密存储在 chrome.storage
    ↓
公钥通过 content script 注册到 Salesforce
    ↓
将 Passkey 绑定到当前环境

认证流程：
Salesforce 调用 navigator.credentials.get()
    ↓
Content Script 拦截 → 通知扩展
    ↓
扩展弹出 Side Panel「验证助手」（或自动选择）
    ↓
扩展用存储的私钥完成签名
    ↓
构造 assertion 通过 content script 返回给 Salesforce
    ↓
Salesforce 验证通过
```

**优点**：
- 完全自动化，可实现"一键登录"
- 不依赖系统 Passkey Provider
- 跨设备可通过 chrome.storage.sync 同步

**缺点**：
- 私钥以软件形式存储，安全性低于硬件安全区域
- 需要在 Salesforce 重新注册（因为公钥是新生成的）
- 需要实现完整的 WebAuthn 客户端签名逻辑

---

## 五、推荐实现：先模式 A，后模式 B

### 第一阶段：模式 A（系统凭证代理）

理由：
1. 用户已经有 Passkey（Bitwarden / Windows Hello），无需重新注册
2. 实现简单，核心逻辑只需拦截 + 转发
3. 安全性无争议

### 第二阶段：模式 B（软件凭证）

作为可选功能，给希望完全自动化的用户。

---

## 六、数据模型

### 6.1 Environment 扩展

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
  passkeys: PasskeyCredential[]     // 新增：该环境绑定的 Passkey 列表
}

interface PasskeyCredential {
  id: string                        // 唯一标识（扩展生成）
  credentialId: string              // Base64URL 编码的 WebAuthn credential ID
  rpId: string                      // 如 "salesforce.com"
  userHandle: string                // Base64URL 编码的 userHandle
  type: 'system' | 'software'       // 凭证类型
  label: string                     // 显示名称，如 "Windows Hello - Work"
  createdAt: number                 // 创建时间戳
  // 模式 B 专属字段 ↓
  privateKey?: string               // 加密后的私钥（仅 software 模式）
  publicKey?: string                // 公钥（仅 software 模式）
}
```

### 6.2 新增存储常量

```javascript
// utils/constants.js
export const STORAGE_KEY_PASSKEYS = 'salesforce_passkeys'
```

---

## 七、核心代码设计

### 7.1 Content Script 重写（public/content.js）

```javascript
/**
 * Passkey 拦截模块
 * 覆盖 navigator.credentials，实现 WebAuthn 请求的拦截和代理
 */

(function() {
  'use strict';
  
  // 防止重复注入
  if (window.__sfPasskeyInjected) return;
  window.__sfPasskeyInjected = true;
  
  const originalGet = navigator.credentials.get.bind(navigator.credentials);
  const originalCreate = navigator.credentials.create.bind(navigator.credentials);
  
  // ========== 拦截认证请求 (get) ==========
  navigator.credentials.get = async function(options) {
    if (!options || !options.publicKey) {
      return originalGet(options);
    }
    
    const rpId = options.publicKey.rpId;
    if (!rpId || !isSalesforceDomain(rpId)) {
      return originalGet(options);
    }
    
    console.log('[SF Passkey] 拦截到认证请求', { rpId });
    
    // 通知扩展，询问是否要拦截
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'webauthnGetIntercepted',
        rpId: rpId,
        challenge: arrayBufferToBase64(options.publicKey.challenge),
        allowCredentials: (options.publicKey.allowCredentials || []).map(c => ({
          id: arrayBufferToBase64(c.id),
          type: c.type
        }))
      });
      
      if (response && response.intercept) {
        // 扩展要求拦截，等待用户选择 Passkey
        const selectedCredential = await waitForUserSelection(rpId);
        
        if (selectedCredential) {
          if (selectedCredential.type === 'software') {
            // 模式 B：扩展自己签名
            return createSoftwareAssertion(options.publicKey, selectedCredential);
          } else {
            // 模式 A：注入 credential ID，让系统完成
            const modifiedOptions = injectCredential(options, selectedCredential);
            return originalGet(modifiedOptions);
          }
        }
      }
    } catch (e) {
      console.log('[SF Passkey] 拦截失败，走原流程', e);
    }
    
    return originalGet(options);
  };
  
  // ========== 拦截注册请求 (create) ==========
  navigator.credentials.create = async function(options) {
    if (!options || !options.publicKey) {
      return originalCreate(options);
    }
    
    const rpId = options.publicKey.rpId;
    if (!rpId || !isSalesforceDomain(rpId)) {
      return originalCreate(options);
    }
    
    console.log('[SF Passkey] 拦截到注册请求', { rpId });
    
    // 先走原生注册流程
    const credential = await originalCreate(options);
    
    if (credential) {
      // 注册成功，通知扩展记录
      try {
        await chrome.runtime.sendMessage({
          action: 'passkeyRegistered',
          credentialId: arrayBufferToBase64(credential.rawId),
          rpId: rpId,
          userHandle: arrayBufferToBase64(credential.response.userHandle)
        });
      } catch (e) {
        console.log('[SF Passkey] 记录注册信息失败', e);
      }
    }
    
    return credential;
  };
  
  // ========== 辅助函数 ==========
  
  function isSalesforceDomain(rpId) {
    return rpId.includes('salesforce') || 
           rpId.includes('force.com') ||
           rpId.includes('cloudforce');
  }
  
  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }
  
  function base64ToArrayBuffer(base64) {
    const padding = '='.repeat((4 - base64.length % 4) % 4);
    const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64);
    const buffer = new ArrayBuffer(raw.length);
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < raw.length; i++) {
      bytes[i] = raw.charCodeAt(i);
    }
    return buffer;
  }
  
  // 等待用户在 Side Panel 中选择 Passkey
  function waitForUserSelection(rpId) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        chrome.runtime.onMessage.removeListener(listener);
        resolve(null);
      }, 60000); // 60秒超时
      
      function listener(request) {
        if (request.action === 'passkeySelected') {
          clearTimeout(timeout);
          chrome.runtime.onMessage.removeListener(listener);
          resolve(request.credential);
        }
        if (request.action === 'passkeySelectionCancelled') {
          clearTimeout(timeout);
          chrome.runtime.onMessage.removeListener(listener);
          resolve(null);
        }
      }
      
      chrome.runtime.onMessage.addListener(listener);
    });
  }
  
  // 注入 credential ID 到 allowCredentials
  function injectCredential(options, credential) {
    return {
      ...options,
      publicKey: {
        ...options.publicKey,
        allowCredentials: [
          ...(options.publicKey.allowCredentials || []),
          {
            id: base64ToArrayBuffer(credential.credentialId),
            type: 'public-key',
            transports: ['internal', 'hybrid']
          }
        ]
      }
    };
  }
  
  // 模式 B：用软件私钥创建 assertion（需要 @simplewebauthn/browser 或自定义实现）
  async function createSoftwareAssertion(publicKeyOptions, credential) {
    // TODO: 使用 Web Crypto API 完成签名
    // 1. 从 credential.privateKey 解密获取私钥
    // 2. 构造 clientDataJSON
    // 3. 签名 challenge + clientDataJSON hash
    // 4. 构造 AuthenticatorAssertionResponse
    // 5. 返回 PublicKeyCredential 对象
    throw new Error('软件凭证模式待实现');
  }
  
})();
```

### 7.2 Background 增强（public/background.js）

```javascript
// 新增消息处理

if (request.action === 'webauthnGetIntercepted') {
  // 转发给 Side Panel：通过 chrome.storage 触发
  chrome.storage.local.set({
    __sf_passkey_auth_request: {
      rpId: request.rpId,
      challenge: request.challenge,
      allowCredentials: request.allowCredentials,
      timestamp: Date.now()
    }
  });
  
  // 同时尝试通过 chrome.sidePanel 打开（如果未打开）
  chrome.windows.getAll({ populate: true }).then(windows => {
    const hasSidePanel = windows.some(w => 
      w.tabs?.some(t => t.url?.includes('sidepanel.html'))
    );
    if (!hasSidePanel) {
      // 设置 badge 提示用户
      chrome.action.setBadgeText({ text: '🔑' });
      chrome.action.setBadgeBackgroundColor({ color: '#FF5722' });
    }
  });
  
  sendResponse({ intercept: true });
  return true;
}

if (request.action === 'passkeyRegistered') {
  // 存储注册信息，等待 Side Panel 关联到环境
  chrome.storage.local.set({
    __sf_passkey_pending_registration: {
      credentialId: request.credentialId,
      rpId: request.rpId,
      userHandle: request.userHandle,
      timestamp: Date.now()
    }
  });
  sendResponse({ success: true });
  return true;
}

if (request.action === 'selectPasskeyForAuth') {
  // Side Panel 用户选择了 Passkey，通知 content script
  const { tabId, credential } = request;
  chrome.tabs.sendMessage(tabId, {
    action: 'passkeySelected',
    credential: credential
  });
  sendResponse({ success: true });
  return true;
}

if (request.action === 'cancelPasskeySelection') {
  const { tabId } = request;
  chrome.tabs.sendMessage(tabId, {
    action: 'passkeySelectionCancelled'
  });
  sendResponse({ success: true });
  return true;
}
```

### 7.3 Side Panel — 验证助手组件（新增 src/components/VerificationHelper.vue）

```vue
<template>
  <div class="verify-helper-overlay" v-if="authRequest">
    <div class="verify-helper">
      <div class="verify-header">
        <span class="verify-icon">🔐</span>
        <span class="verify-title">身份验证</span>
        <button class="verify-close" @click="dismiss">✕</button>
      </div>
      
      <div class="verify-env" v-if="matchedEnv">
        <span class="verify-env-name">{{ matchedEnv.alias }}</span>
        <span class="verify-env-type">{{ getTypeLabel(matchedEnv.type) }}</span>
      </div>
      
      <div class="verify-passkey-list" v-if="availablePasskeys.length">
        <div 
          v-for="pk in availablePasskeys" 
          :key="pk.id"
          class="verify-passkey-item"
          @click="selectPasskey(pk)"
        >
          <span class="passkey-icon">{{ pk.type === 'system' ? '🔑' : '💻' }}</span>
          <div class="passkey-info">
            <div class="passkey-label">{{ pk.label }}</div>
            <div class="passkey-type">{{ pk.type === 'system' ? '系统凭证' : '软件凭证' }}</div>
          </div>
          <span class="passkey-arrow">›</span>
        </div>
      </div>
      
      <div class="verify-no-passkey" v-else>
        <p>该环境未绑定 Passkey</p>
        <button class="verify-register-btn" @click="goToRegister">
          注册 Passkey
        </button>
      </div>
      
      <div class="verify-totp-section" v-if="matchedEnv?.totpSecret">
        <div class="verify-divider">或</div>
        <div class="verify-totp" @click="copyTotp">
          <span class="totp-code">{{ totpCode }}</span>
          <span class="totp-action">{{ copyStatus || '点击复制验证码' }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';

const props = defineProps({
  environments: Array,
  authRequest: Object  // { rpId, challenge, timestamp }
});

const emit = defineEmits(['select-passkey', 'dismiss', 'focus-tab']);

const copyStatus = ref('');
const totpCode = ref('');

const matchedEnv = computed(() => {
  if (!props.authRequest) return null;
  // 根据 rpId 或当前活跃环境匹配
  return props.environments.find(env => 
    env.passkeys?.some(pk => pk.rpId === props.authRequest.rpId)
  ) || props.environments[0];
});

const availablePasskeys = computed(() => {
  return matchedEnv.value?.passkeys || [];
});

function selectPasskey(passkey) {
  emit('select-passkey', passkey);
}

function dismiss() {
  emit('dismiss');
}

function copyTotp() {
  // 复制 TOTP 并聚焦标签页
}

function goToRegister() {
  // 跳转到 Passkey 注册界面
}
</script>
```

### 7.4 Side Panel — Passkey 管理页面（新增视图）

在 App.vue 中新增「我的 Passkey」入口，展示所有环境绑定的 Passkey：

```
┌─────────────────────────────────────┐
│  Salesforce Quick Login      [≡]   │
├─────────────────────────────────────┤
│                                     │
│  📁 环境列表（现有）                 │
│                                     │
│  🔑 我的 Passkey（新增）            │
│  ┌─────────────────────────────┐   │
│  │ 生产环境 - 主账号            │   │
│  │   🔑 Windows Hello           │   │
│  │   💻 Software Key (自动)     │   │
│  └─────────────────────────────┘   │
│  ┌─────────────────────────────┐   │
│  │ 测试沙箱 - QA                │   │
│  │   🔑 Bitwarden               │   │
│  └─────────────────────────────┘   │
│                                     │
└─────────────────────────────────────┘
```

---

## 八、实施计划

### Phase 1：Content Script 拦截框架（2 天）
1. 重写 `public/content.js`，添加 Passkey 拦截模块
2. 实现 `navigator.credentials.get()` 和 `create()` 的覆盖
3. 实现消息通信机制（Content Script ↔ Background ↔ Side Panel）
4. 测试拦截是否正常工作

### Phase 2：数据层（1 天）
1. 扩展 `Environment` 模型，添加 `passkeys` 字段
2. 新增 `usePasskey.js` composable，管理 Passkey CRUD
3. 更新 `useStorage.js`，支持 Passkey 数据持久化

### Phase 3：验证助手 UI（2 天）
1. 创建 `VerificationHelper.vue` 组件
2. 在 `App.vue` 中集成验证助手状态（监听 `chrome.storage` 变化）
3. 设计验证助手样式（渐变背景、卡片式选项）
4. 实现 TOTP 与 Passkey 的并列展示

### Phase 4：Passkey 管理界面（2 天）
1. 在 Side Panel 中新增「我的 Passkey」视图
2. 实现 Passkey 注册引导流程
3. 实现 Passkey 删除、重命名功能
4. 在 `EditModal.vue` 中集成 Passkey 配置

### Phase 5：流程整合与测试（2 天）
1. 整合登录 → 拦截 → 验证助手 → 完成的完整流程
2. 处理边界情况（超时、取消、多标签页）
3. 构建与测试

---

## 九、关键风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Salesforce 检测 `navigator.credentials` 被覆盖 | 安全策略拒绝 | 使用更隐蔽的代理方式（Proxy 对象或原型链修改） |
| Content Script 与页面其他脚本冲突 | 功能异常 | 使用 IIFE 隔离，添加前缀命名空间 |
| 用户选择 Passkey 后系统无响应 | 认证卡死 | 设置 30 秒超时，自动 fallback 到原流程 |
| 多标签页同时触发验证 | 通知混乱 | 记录 tabId，只响应当前活跃标签页 |
| Passkey 注册后 Salesforce 不承认 | 注册失败 | 确保完整传递 attestation 数据 |

---

## 十、与原设计书的关键差异

| 维度 | V1 设计书 | V2 设计书 |
|------|-----------|-----------|
| 核心机制 | 仅检测验证页面 URL，被动提示 | Content Script **主动拦截** `navigator.credentials` |
| 自动化程度 | 需用户手动点击系统 Passkey 按钮 | 扩展可直接注入 credential ID 或自己签名 |
| Passkey 管理 | 仅布尔标记 | 完整 CRUD，支持系统凭证 + 软件凭证双模式 |
| 用户体验 | 辅助提示 | 扩展作为 Passkey 管理器，一站式完成 |
| 技术可行性 | 高（简单） | 中高（需要精确的 WebAuthn 协议实现） |

---

*设计书版本: 2.0*
*日期: 2026-07-15*
*关键变更: 基于 Content Script 可覆盖 navigator.credentials 的核心发现，重构为拦截代理方案*
