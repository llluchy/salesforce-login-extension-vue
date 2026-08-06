# Salesforce Quick Login - Passkey 架构设计文档 v3

> 版本：v3
> 日期：2026-07-24

---

## 1. 设计原则

本次重构的核心原则：

1. **简化数据模型**：environments.passkeys 直接存完整凭证（含私钥），不做摘要/完整分离
2. **减少转发层数**：Content 直接发消息给 Side Panel，跳过 Background
3. **先登录再拦截**：用户未登录过时，不拦截任何 WebAuthn 请求，当做插件不存在
4. **不依赖 Side Panel 打开**：只要曾经登录过（userKey 已解锁过），就可以正常使用
5. **加密/解密放在 passkeyUI 中完成**：Side Panel 只在用户解锁时导出 userKey 原始材料到 session，passkeyUI 自己完成解密
6. **不考虑历史数据兼容**：只保证新数据格式

---

## 2. 整体架构（3 层）

```
┌─────────────────────────────────────────────────────────────┐
│               Salesforce 网页（主世界）                          │
│                                                             │
│  ┌───────────────────────────────────────────────────┐      │
│  │  page-world.js + passkey-ui.js                  │      │
│  │  • 拦截 navigator.credentials.create / get    │      │
│  │  • 调用 WebAuthnAuthenticator                   │      │
│  │  • PasskeyUI 浮层（环境选择 + 加解密            │      │
│  │  • 【新增：自己解密 environments 数据（从 session storage）│      │
│  └──────────────────────┬────────────────────────────┘      │
│                         │ window.postMessage()          │
├─────────────────────────┼────────────────────────────────┤
│  Content Script         │                                │
│  ┌──────────────────────┴────────────────────────────┐  │
│  │  content.js                                          │  │
│  │  • 注入 page-world.js 到页面                        │  │
│  │  • 转发 page-world ↔ Side Panel（不经过 Background）│  │
│  └──────────────────────┬────────────────────────────┘  │
│                         │ chrome.runtime.sendMessage()    │  │
├─────────────────────────┼────────────────────────────┤
│  Side Panel（Vue 应用）  │                            │
│  ┌──────────────────────┴────────────────────────┐  │
│  │  App.vue + useAuth.js + useStorage.js            │  │
│  │  • 用户登录解锁（输入主密码）                    │  │
│  │  • 【核心：解锁时导出 userKey 到 session storage │  │
│  │  • 管理 environments（增删改）                  │  │
│  │  • 不处理 Passkey 消息（不再转发 Passkey 消息）    │  │
│  └──────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────┘
```

**与旧架构（4 层的区别：删除了 Background 层的转发逻辑

- 旧：Page World → Content → **Background** → Side Panel
- 新：Page World → Content → Side Panel

---

## 3. 文件职责

| 文件 | 角色 | 运行环境 | 职责 |
|------|------|---------|------|
| [manifest.json](../public/manifest.json) | 扩展配置 | - | 声明 content_scripts / web_accessible_resources |
| [background.js](../public/background.js) | Service Worker | Service Worker | 只处理非 Passkey 的功能（登录、截图等），不参与 Passkey 流程 |
| [content.js](../public/content.js) | Content Script | 孤立世界 | 注入 page-world.js，转发消息（直接发给 Side Panel） |
| [page-world.js](../public/page-world.js) | Page World | 页面主世界 | 拦截 WebAuthn API，调用 passkeyUI |
| [passkey-ui.js](../public/lib/passkey-ui.js) | Passkey UI | 页面主世界 | **解密 environments、解密、显示环境选择、解密完成解密（自己完成解密逻辑** |
| [webauthn-authenticator.js](../public/lib/webauthn-authenticator.js) | 软件认证器 | 页面主世界 | makeCredential / getAssertion |
| [App.vue](../src/App.vue) | Side Panel | Side Panel | 用户解锁时导出 userKey 原始材料到 session storage |
| [useAuth.js](../src/composables/useAuth.js) | 认证模块 | Side Panel | 用户认证、userKey 派生与导出 |
| [useStorage.js](../src/composables/useStorage.js) | 存储模块 | Side Panel | environments 增删改 |

---

## 4. 登录态管理

### 4.1 登录态存储位置

```
chrome.storage.session 内存存储（浏览器关闭后自动清除

存储内容：

```javascript
{
  // 用户是否登录过（标记
  isLoggedIn: true
  
  // userKey 原始材料（JWK 格式，不是 CryptoKey 对象
  sf_userKeyJwk: {
    kty: "oct",
    k: "..."
    alg: "A256GCM",
    ext: true
  },
  
  // environments 数据（加密后的字符串（加密后的数据
  sf_environments: "encrypted..." 字符串",
  
  // 待登录环境（未加密，完整数据
  pendingLoginEnv: { ... }
}
```

### 4.2 登录流程（Side Panel 解锁后

用户在 Side Panel 输入主密码 → 派生出 userKey（CryptoKey 对象 → **导出为 JWK → 存入 session

```
1. 用户输入主密码
    │
    ▼
2. useAuth.js → 派生出 CryptoKey userKey（内存对象）
    │
    ▼
3. crypto.subtle.exportKey("jwk", userKey)
    │ 得到原始密钥材料
    │
    ▼
4. chrome.storage.session.set({ sf_userKeyJwk: jwk })
    │
    ▼
5. chrome.storage.session.set({ sf_environments: 加密后的 environments 字符串
    │
    ▼
6. chrome.storage.session.set({ isLoggedIn: true })
```

**注意**：session 存储是内存中，userKey 存在 chrome.storage.session，浏览器关闭后自动清除

---

## 5. Passkey 注册流程（navigator.credentials.create）

```
用户在 Salesforce 页面点击「注册 Passkey」
         │
         ▼
① page-world.js 拦截前检查
   检查 chrome.storage.session.isLoggedIn
   └─ 如果未登录 → 直接调用 originalCreate()，当做插件不存在
   [page-world.js#L257-L266](../public/page-world.js#L257-L266)
         │
         ▼
② 从 chrome.storage.session 读取加密的 environments
   passkeyUI 自己解密（用 sf_userKeyJwk 导入为 CryptoKey
   [passkey-ui.js 新增解密模块
         │
         ▼
③ PasskeyUI.showSelector('create', environments, rpId)
   显示浮层让用户选择环境
         │
         ▼
④ WebAuthnAuthenticator.makeCredential()
   生成公私钥对
         │
         ▼
⑤ 【只发一次 postMessage('bindPasskeyToEnv')
   直接传完整凭证（含 privateKeyJwk
   （不再发 storePrivateKey
   消息
   [page-world.js#L292-L320](../public/page-world.js#L292-L320)
         │
         ▼
⑥ content.js 转发 → Side Panel bg:bindPasskeyToEnv
   更新 environments 表的 passkeys 数组（完整凭证
         │
         ▼
⑦ 返回凭证给 Salesforce 页面
```

### 5.1 完整凭证结构（直接存入 environments.passkeys

```javascript
{
  id: "pk_xxx",
  credentialId: "...",
  rpId: "xxx.salesforce.com",
  challenge: "...",
  privateKeyJwk: { kty: "EC", crv: "P-256", x: "...", y: "...", d: "..." },
  publicKeyJwk:  { kty: "EC", crv: "P-256", x: "...", y: "..." },
  userId: "...",
  userName: "xxx@example.com",
  userDisplayName: "User Name",
  envId: "env-uuid",
  signCount: 0,
  createdAt: 1234567890
}
```

---

## 6. Passkey 验证流程（navigator.credentials.get）

```
用户在扩展面板点击「登录」
         │
         ▼
① Side Panel App.vue handleLogin(env)
   存储完整环境数据（未加密，存到 chrome.storage.session.pendingLoginEnv
   （因为是完整数据，passkeys 含私钥
         │
         ▼
② 打开 Salesforce 登录页，页面触发 navigator.credentials.get()
         │
         ▼
③ page-world.js 拦截前检查
   检查 chrome.storage.session.isLoggedIn
   └─ 未登录 → 直接调用 originalGet()
         │
         ▼
④ requestPendingLoginEnv(rpId)
   直接从 chrome.storage.session.pendingLoginEnv 读取
   （不需要经过 Side Panel，因为存在 session 里
   [page-world.js#L220-L254](../public/page-world.js#L220-L254)
         │
         ▼
⑤ PasskeyUI.showSelector('login', displayEnvs, rpId)
   显示浮层让用户确认
         │
         ▼
⑥ WebAuthnAuthenticator.getAssertion()
   使用 privateKeyJwk 签名
         │
         ▼
⑦ 返回签名结果给 Salesforce
```

### 6.1 关键变化

- **删除「补全逻辑不再需要**：pendingLoginEnv 直接是完整数据
- **不再经过 Side Panel：直接从 session storage 直接读，不用 Bridge 层的补全
- **不需要 Background 转发删除了

---

## 7. 数据存储位置总结

### 7.1 chrome.storage.session（内存存储

| Key | 内容 | 加密状态 |
|-----|------|---------|
| `isLoggedIn` | `true/false` | 明文 |
| `sf_userKeyJwk` | userKey 的 JWK 格式（不是 CryptoKey | 明文（session 是隔离的） |
| `sf_environments` | 加密后的 environments 字符串（用 userKey 加密） | 加密 |
| `pendingLoginEnv` | 待登录环境（完整数据，含私钥） | 明文（只在内存 session 中，自动清除） |

### 7.2 Supabase 数据库

| 表 | 内容 | 加密状态 |
|----|------|---------|
| `environments` | 环境列表，passkeys 存完整凭证（含私钥） | 用 userKey 加密后存储 |
| （删除）`passkey_credentials` | （不再需要 | - |

---

## 8. 消息动作（简化后的动作表

### 8.1 只保留 Content → Side Panel 的（直接发给（不再经过 Background

| Page World 动作 | Content 转发 | Side Panel 处理器 |
|----------------|------------|-------------------|
| `bindPasskeyToEnv` | → `bindPasskeyToEnv` → `bg:bindPasskeyToEnv` |
| `getEnvironments` | → `getEnvironments` → `bg:getEnvironments`（Side Panel 返回加密后的 |
| `saveNewEnvironment` | → `saveNewEnvironment` → `bg:saveNewEnvironment` |
| `updateCredential` | → `updateCredential` → `bg:updatePasskey` |

### 8.2 page-world.js 直接读 session storage（不需要转发

- `requestPendingLoginEnv()` → 直接从 `chrome.storage.session.pendingLoginEnv` 读取
- `isLoggedIn` → 直接从 `chrome.storage.session.isLoggedIn` 读取
- `sf_userKeyJwk` → 直接从 `chrome.storage.session.sf_userKeyJwk` 读取
- `sf_environments` → 直接从 `chrome.storage.session.sf_environments` 读取（passkeyUI 自己解密）

---

## 9. 触发拦截条件

### 9.1 页面必须满足

1. **Salesforce 域名匹配（manifest.json 配置的域名
2. **用户登录过：`chrome.storage.session.isLoggedIn === true`

如果不满足 → 当做插件不存在，调用原始的 `navigator.credentials.create/get`

### 9.2 不再需要

- ~~Side Panel 必须打开~~ → 只要登录过（session 中有 userKeyJwk 就行

---

## 10. 安全考虑

### 10.1 userKey 暴露风险

- userKey 的 JWK 存在 `chrome.storage.session` 中：
  - session 是扩展隔离的，页面脚本不能直接访问
  - 但 passkeyUI 运行在页面主世界，需要通过 content.js 转发才能访问 session storage
  - 所以 content.js 需要提供访问接口让 page-world.js 读 session 需要通过 content.js 转发
  - 所以需要提供一个读取 session 接口

### 10.2 session storage 的内容

- 浏览器关闭后自动清除，重启浏览器后需要重新登录解锁
- 比 localStorage 安全（持久化

---

## 11. content.js 需要新增功能

为了让 page-world.js 能访问 chrome.storage.session，content.js 需要新增：

```javascript
// page-world.js → content.js 读 session storage
window.addEventListener('message', (event) => {
  if (event.data.source !== 'sf-page-world') return
  
  // 读 session storage
  if (event.data.action === 'sessionGet') {
    chrome.storage.session.get(event.data.keys).then(result => {
      window.postMessage({
        source: 'sf-extension',
        action: 'sessionGetResult',
        data: result
      }, '*')
    })
  }
  
  // 写 session storage
  if (event.data.action === 'sessionSet') {
    chrome.storage.session.set(event.data.data).then(() => {
      window.postMessage({
        source: 'sf-extension',
        action: 'sessionSetResult'
      }, '*')
    })
  }
})
```

---

## 12. 需要修改的文件清单

| 文件 | 修改内容 |
|------|---------|
| [page-world.js](../public/page-world.js) | 1. 拦截前检查 isLoggedIn<br>2. 合并 storePrivateKey + bindPasskeyToEnv → 只发 bindPasskeyToEnv（完整凭证）<br>3. requestPendingLoginEnv 直接读 session storage<br>4. 删除经过 Background 转发动作 |
| [content.js](../public/content.js) | 1. 删除 Background 转发删除<br>2. 消息直接发给 Side Panel<br>3. 新增 session storage 读写接口 |
| [background.js](../public/background.js) | 删除 Passkey 相关的转发逻辑（PASSKEY_FORWARD_ACTIONS |
| [passkey-ui.js](../public/lib/passkey-ui.js) | 1. 新增解密模块（导入 userKeyJwk → 解密 environments |
| [usePasskeyBridge.js](../src/composables/usePasskeyBridge.js) | 1. 删除 storePasskey / getPasskeys 等独立表操作<br>2. bg:getPendingLoginEnv 删除（改为直接读 session<br>3. bg:bindPasskeyToEnv 保留但简化（只更新 environments |
| [useAuth.js](../src/composables/useAuth.js) | 新增 exportUserKeyJwk() 方法（导出 userKey 为 JWK 并存入 session |
| [App.vue](../src/App.vue) | 用户解锁后调用 exportUserKeyJwk() |
| [useStorage.js](../src/composables/useStorage.js) | 删除 passkey_credentials 相关函数 |

---

## 13. 后续优化目标

### 13.1 将 content.js 迁移到 src 目录（使用 Vite 多入口构建）

**当前问题**：`public/content.js 不经过 Vite 处理，不能用 import/export，代码无法模块化。

**迁移方案**：

```
① 创建 src/entries/content.js（从 public/content.js 复制）
② 修改 vite.config.js，添加多入口配置：
   input: {
     sidepanel: resolve(__dirname, 'index.html'),
     content:   resolve(__dirname, 'src/entries/content.js')
   },
   output: {
     entryFileNames: '[name].js'   // 输出固定文件名
   }
③ 修改 package.json build 脚本，避免 public 下的旧 content.js 覆盖构建产物
④ 删除 public/content.js
```

**迁移后好处**：
- content.js 可以 import 其他模块（如加密工具）
- 代码可以拆分
- Vite 自动压缩
