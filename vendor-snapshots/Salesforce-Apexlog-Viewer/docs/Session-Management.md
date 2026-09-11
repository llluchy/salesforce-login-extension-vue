# Session 管理 — 完整知识手册

> 适用于 Chrome 扩展 / Manifest V3，从浏览器 Cookie 中提取 Salesforce Session，并管理多环境连接、会话续期与 API 调用。

---

## 一、核心概念

### 1.1 什么是 Salesforce Session

Salesforce 登录后，会在浏览器中种下名为 **`sid`**（Session ID）的安全 Cookie。格式为：

```
00D5g00000A1bCd!abcdefghijklmnopqrstuvwxyz
    └────┬─────┘   └─────────────┬─────────────┘
     Org ID（前 15 字符）       Session Token
```

- `sid` 的前半部分用 `!` 分隔的是 **Org ID**，用于标识组织
- Session 有有效期（默认 2 小时，受 org 配置影响）
- `sid` Cookie 绑定到特定域名（`.salesforce.com`、`.force.com` 等）

### 1.2 在 Chrome 扩展中读取 Session

Chrome 扩展声明 **`cookies`** 权限后，可通过 `chrome.cookies` API 读取指定域名的 Cookie。

```json
// manifest.json 必须声明
{
  "permissions": ["cookies", "tabs"],
  "host_permissions": [
    "https://*.salesforce.com/*",
    "https://*.force.com/*"
  ]
}
```

### 1.3 Session 的用途

所有 REST / Tooling / Chatter API 调用都通过 Bearer Token 方式使用：

```
GET https://na1.salesforce.com/services/data/v59.0/...
Authorization: Bearer <sessionId>
```

---

## 二、Session 提取流程

### 2.1 入口：`extractSessionFromTab(tabId)`

从一个浏览器标签页提取 Session，完整步骤：

1. 获取 Tab 的 URL，检查是否是 Salesforce 域
2. 调用 `getSfHost(url, cookieStoreId)` —— 找出真正持有 Session 的主机
3. 调用 `getSession(sfHost, cookieStoreId)` —— 从该主机读取 `sid`
4. 返回 `{ sessionId, instanceUrl, hostname }`

**代码参考**：

```javascript
async function extractSessionFromTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !isSalesforceUrl(tab.url)) return null;

  const sfHost = await getSfHost(tab.url, tab.cookieStoreId);
  if (!sfHost) return null;

  const session = await getSession(sfHost, tab.cookieStoreId);
  if (session) {
    return {
      sessionId: session.key,
      instanceUrl: `https://${session.hostname}`,
      hostname: session.hostname
    };
  }
  return null;
}
```

### 2.2 主机定位：`getSfHost(url, cookieStoreId)`

**问题**：用户可能访问 `lightning.force.com`（Lightning 首页），但 `sid` 实际种在 `na1.salesforce.com` 上。因此需要跨域名查找。

**算法**：

1. 先从当前 URL 尝试读取 `sid`
2. 如果拿到 `sid`，从中提取 **Org ID**（`!` 之前的部分）
3. 用 Org ID 在下列候选域名中查找匹配的 `sid`：

```
salesforce.com → cloudforce.com → salesforce.mil
→ cloudforce.mil → sfcrmproducts.cn → force.com
→ my.salesforce.com → lightning.force.com
```

4. 找到匹配项返回该域名；否则返回当前 URL 的 hostname

> **关键设计**：用 Org ID 做"指纹匹配"，确保拿到的是同一个 org 的 Session。

### 2.3 Session 读取：`getSession(sfHost, cookieStoreId)`

```javascript
const cookie = await chrome.cookies.get({
  name: "sid",
  storeId: cookieStoreId,
  url: "https://" + sfHost
});

if (cookie) {
  return { key: cookie.value, hostname: cookie.domain };
}
```

### 2.4 流程图示

```
用户在 Salesforce 页面登录
        ↓
浏览器种下 sid Cookie（如 na1.salesforce.com）
        ↓
extractSessionFromTab(tabId)
        ↓
┌─ getSfHost(url, cookieStoreId) ─┐
│  1. 从当前 URL 拿 sid         │
│  2. 提取 orgId = sid.split('!')[0]
│  3. 按优先级遍历候选域名       │
│  4. 查找 startsWith(orgId + "!") 的 sid
│  5. 返回真正的 hostname        │
└────────────────────────────────┘
        ↓
getSession(sfHost, cookieStoreId) → { key, hostname }
        ↓
session = { sessionId, instanceUrl, hostname }
```

---

## 三、环境 (Environment) 管理

### 3.1 数据结构

```javascript
// background.js 全局变量
let environments = {
  [envId]: {
    id: envId,
    name: 'Production' | 'Sandbox' | 'Test',
    sessionId: '00D...',
    instanceUrl: 'https://na1.salesforce.com',
    hostname: 'na1.salesforce.com',
    connectedAt: 1718000000000,
    userName: 'John Doe',          // 可能为 undefined
    sessionExpired: false          // 可选：标记过期
  }
};
let activeEnvId = null;
```

### 3.2 生成 Env ID

**用 `hostname` 做 Base64 编码**，保证同一个 org 产生相同 ID：

```javascript
function generateEnvId(instanceUrl) {
  const hostname = new URL(instanceUrl).hostname;
  return btoa(hostname).replace(/[^a-zA-Z0-9]/g, '');
}
```

### 3.3 命名规则

根据 hostname 推测环境类型：

```javascript
function getEnvName(instanceUrl) {
  const hostname = new URL(instanceUrl).hostname;
  if (hostname.includes('sandbox') || hostname.includes('cs')) {
    return 'Sandbox';
  }
  if (hostname.includes('test')) {
    return 'Test';
  }
  return 'Production';
}
```

### 3.4 添加/更新环境

```javascript
async function addEnvironment(session) {
  const envId = generateEnvId(session.instanceUrl);

  if (environments[envId]) {
    // 更新已存在的 Session，清空 userName 以强制重新获取
    environments[envId] = {
      ...environments[envId],
      sessionId: session.sessionId,
      instanceUrl: session.instanceUrl,
      hostname: session.hostname,
      connectedAt: Date.now(),
      userName: undefined  // 关键：不缓存旧用户名
    };
  } else {
    environments[envId] = {
      id: envId,
      name: getEnvName(session.instanceUrl),
      sessionId: session.sessionId,
      instanceUrl: session.instanceUrl,
      hostname: session.hostname,
      connectedAt: Date.now()
    };
  }
  return envId;
}
```

> **设计要点**：重新发现同一环境时，清空 `userName`，避免显示旧用户信息。

### 3.5 状态持久化

用 `chrome.storage.local` 跨页面/重启保存：

```javascript
async function saveState() {
  await chrome.storage.local.set({
    'salesforce-environments': environments,
    'salesforce-active-env': activeEnvId
  });
}

async function loadState() {
  const result = await chrome.storage.local.get([
    'salesforce-environments',
    'salesforce-active-env'
  ]);
  environments = result['salesforce-environments'] || {};
  activeEnvId = result['salesforce-active-env'];
}

// Service Worker 启动时加载
loadState();
```

---

## 四、多环境发现：`discoverAllSalesforceTabs()`

### 4.1 场景

用户在多个标签页登录了不同 Salesforce org（生产 + 沙箱）。扩展需要一次性发现所有环境。

### 4.2 实现

```javascript
async function discoverAllSalesforceTabs() {
  const tabs = await chrome.tabs.query({});  // 查所有标签

  // 先筛选 Salesforce 域
  const sfTabs = tabs.filter(tab =>
    tab.url && !tab.url.startsWith('chrome-extension://') &&
    (tab.url.includes('salesforce.com') || tab.url.includes('force.com'))
  );

  // 并行处理所有标签，加快速度
  await Promise.all(sfTabs.map(async (tab) => {
    const session = await extractSessionFromTab(tab.id);
    if (session) {
      await addEnvironment(session);  // 自动去重
    }
  }));

  await saveState();
}
```

### 4.3 性能优化

- **串行 → 并行**：用 `Promise.all` 处理所有标签
- **延时获取用户名**：发现阶段只拿 Session，用户名在窗口 UI 中懒加载
- **先打开窗口，后台加载数据**：用户点击扩展图标时，立即创建窗口；环境发现在后台执行，完成后通过消息通知前端

---

## 五、API 调用封装

### 5.1 `makeApiRequest(endpoint, options)`

统一请求方法，自动处理：

1. 检查 active 环境
2. 注入 `Authorization: Bearer <sessionId>`
3. 处理 401 Session 过期 → 自动尝试刷新
4. 解析返回（JSON / 204 No Content）

```javascript
async function makeApiRequest(endpoint, options = {}) {
  const env = environments[activeEnvId];
  if (!env) throw new Error('No active environment');

  const response = await fetch(env.instanceUrl + endpoint, {
    ...options,
    headers: {
      'Authorization': `Bearer ${env.sessionId}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  if (response.status === 401) {
    // 标记过期，尝试刷新
    environments[activeEnvId].sessionExpired = true;
    await saveState();
    if (await tryRefreshSession(activeEnvId)) {
      return await makeApiRequest(endpoint, options);  // 自动重试
    }
    throw new Error('Session expired');
  }

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  return response.status === 204 ? null : await response.json();
}
```

### 5.2 指定环境的请求：`makeApiRequestForEnv(envId, ...)`

与上面完全相同，但用指定环境而不是 `activeEnvId`。用于初始化阶段还没选 active 环境时。

### 5.3 常见端点

| 功能 | 端点 |
|------|------|
| 查询 ApexLog | `GET /services/data/v59.0/query/?q=SELECT+Id+FROM+ApexLog` |
| 获取日志内容 | `GET /services/data/v59.0/sobjects/ApexLog/{id}/Body` |
| 获取当前用户 | `GET /services/data/v59.0/chatter/users/me` |
| Tooling API | `GET/POST /services/data/v59.0/tooling/...` |
| 连接测试 | `GET /services/data/v59.0/limits` |

---

## 六、Session 自动刷新

### 6.1 为什么需要刷新

- Session 过期会返回 `401 Unauthorized`
- 用户可能已经在浏览器中重新登录了 Salesforce，产生了新的 `sid`
- 扩展需要能够从最新的标签页中重新提取 Session

### 6.2 `tryRefreshSession(envId)` 实现

```javascript
async function tryRefreshSession(envId) {
  const env = environments[envId];
  if (!env) return false;

  const tabs = await chrome.tabs.query({});

  for (const tab of tabs) {
    if (tab.url && isSalesforceUrl(tab.url)) {
      const session = await extractSessionFromTab(tab.id);
      if (session) {
        const newEnvId = generateEnvId(session.instanceUrl);
        if (newEnvId === envId) {  // 同一环境
          environments[envId] = {
            ...environments[envId],
            sessionId: session.sessionId,
            sessionExpired: false,
            connectedAt: Date.now()
          };
          await saveState();
          return true;  // 刷新成功
        }
      }
    }
  }
  return false;  // 没找到可刷新的标签页
}
```

### 6.3 在请求中触发自动刷新

参见第五节 `makeApiRequest` 的 401 处理逻辑。关键要点：

1. 401 时先 `throw Error('Session expired')` 之前调用刷新
2. 刷新成功后 **递归调用自身** 重试同一请求（透明重试）
3. 前端收到 `'Session expired'` 错误时停止轮询并提示用户

---

## 七、消息通信协议（Background ↔ UI）

### 7.1 通信方式

UI 页面（`window/index.html`）通过 `chrome.runtime.sendMessage({action, ...})` 向 Background 发送请求。Background 通过 `chrome.runtime.onMessage.addListener` 监听。

### 7.2 完整动作列表

| action | 参数 | 返回 | 用途 |
|--------|------|------|------|
| `connect-to-tab` | `tabId` | `{success, envId, environments, userName}` | 从指定标签页提取 Session 并连接 |
| `refresh-session` | `tabId` | 同上 | 刷新指定标签页的 Session |
| `disconnect` | `envId` | `{success, environments}` | 断开指定环境 |
| `refresh-environments` | — | `{success, environments, activeEnvId}` | 扫描所有标签页发现环境 |
| `switch-environment` | `envId` | `{success, environments, userName}` | 切换活跃环境 |
| `get-state` | — | `{success, environments, activeEnvId, currentUserName}` | 获取当前状态 |
| `fetch-logs` | `limit` | `{success, data}` | 查询 Apex 日志 |
| `fetch-log-body` | `logId` | `{success, data}` | 获取单条日志内容 |
| `start-polling` | `interval` | `{success}` | 启动日志轮询 |
| `stop-polling` | — | `{success}` | 停止日志轮询 |
| `renew-traceflag` | — | `{success}` | 续期 TraceFlag |

### 7.3 UI 端的消息监听

```javascript
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 轮询数据推送
  if (message.action === 'polling-update') {
    if (message.error?.includes('Session expired')) {
      stopPolling();
      showSessionExpired();
    } else {
      updateLogs(message.data);
    }
  }
  // 后台发现环境完成后推送
  else if (message.action === 'environments-updated') {
    environments = message.environments;
    updateEnvSelector();
    // ... 如果还没有 active 环境，自动选第一个
  }
});
```

### 7.4 UI 端的请求封装

```javascript
function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(response);
      }
    });
  });
}
```

---

## 八、启动与连接流程

### 8.1 Service Worker 启动

```
扩展安装/唤醒
    ↓
loadState() → 从 storage 恢复 environments 和 activeEnvId
    ↓
等待 action click / message 事件
```

### 8.2 用户点击扩展图标

```
chrome.action.onClicked
    ↓
检查是否已存在窗口 → 存在则聚焦（focused: true）
    ↓
不存在则 chrome.windows.create({ url: 'window/index.html', ... })
    ↓
discoverAllSalesforceTabs() 在后台执行（不阻塞 UI 渲染）
    ↓
完成后通过 chrome.tabs.sendMessage 通知窗口 {environments-updated}
```

> **优化点**：先打开窗口，让用户立即看到 UI，然后在后台扫描环境。

### 8.3 窗口页面启动

```
DOMContentLoaded
    ↓
loadTheme() → initElements() → setupEventListeners() → initSearchUI()
    ↓
loadState()
    ├─ sendMessage({action: 'get-state'})
    ├─ 如果有 environments → 渲染下拉框 → 选第一个
    └─ 如果有 activeEnvId → fetchLogs() + startPolling()
```

### 8.4 环境切换

```
用户选择不同环境
    ↓
handleEnvChange()
    ├─ sendMessage({action: 'switch-environment', envId})
    ├─ Background: testConnection(envId)
    │   └─ 调用 /services/data/v59.0/limits 检查 Session 是否有效
    │       └─ 401 则标记为过期并从 environments 中移除
    ├─ 如果用户名尚未获取 → fetchCurrentUserName(envId)
    └─ 切换成功后，UI 端清空旧日志，重新 fetchLogs + startPolling
```

---

## 九、连接测试：`testConnection(envId)`

```javascript
async function testConnection(envId) {
  const env = environments[envId];
  if (!env) return { success: false, error: 'Environment not found' };

  try {
    const response = await fetch(
      `${env.instanceUrl}/services/data/v59.0/limits`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${env.sessionId}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.ok) {
      return { success: true };
    } else if (response.status === 401) {
      delete environments[envId];  // Session 确实过期了，删除
      await saveState();
      return { success: false, error: 'Session expired' };
    } else {
      return { success: false, error: 'Connection failed' };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}
```

> **为何选 `/limits`**：这是一个轻量端点，返回 org 容量信息，不依赖任何对象权限。

---

## 十、用户名获取：`fetchCurrentUserName(envId)`

### 10.1 方法

通过 **Chatter API** `/services/data/v59.0/chatter/users/me` 获取当前用户信息。

> **为什么不用 REST API**：REST 的 `limits` 等端点不带用户信息；`/services/data/v59.0/sobjects/User/me` 在某些 org 配置下不可用。Chatter API 最稳定。

### 10.2 实现

```javascript
async function fetchCurrentUserName(envId) {
  const endpoint = `/services/data/v59.0/chatter/users/me`;
  const result = await makeApiRequestForEnv(envId, endpoint);
  return result?.name || null;
}
```

### 10.3 返回示例

```json
{
  "id": "0055g00000ABCdE",
  "name": "John Doe",
  "email": "john.doe@example.com",
  "smallPhotoUrl": "...",
  "...": "..."
}
```

---

## 十一、权限 & Manifest 配置

### 11.1 最小权限集合

```json
{
  "manifest_version": 3,
  "permissions": [
    "storage",     // 保存 environments
    "cookies",     // 读取 sid Cookie
    "tabs",        // 查询/访问标签页 URL 和 tabId
    "activeTab"    // 当前标签页信息
  ],
  "host_permissions": [
    "https://*.salesforce.com/*",
    "https://*.force.com/*",
    "https://*.cloudforce.com/*",
    "https://*.visualforce.com/*",
    "https://*.lightning.force.com/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_title": "Salesforce Log Viewer"
  }
}
```

### 11.2 权限说明

| 权限 | 用途 |
|------|------|
| `storage` | 用 `chrome.storage.local` 保存环境状态 |
| `cookies` | 调用 `chrome.cookies.get` / `.getAll` 读取 `sid` |
| `tabs` | 调用 `chrome.tabs.query({})` 扫描所有标签页 |
| `activeTab` | 获取当前激活标签的 URL 和 tabId |

### 11.3 Host Permissions

`host_permissions` 决定了 `chrome.cookies` 能读取哪些域名的 Cookie，以及 `fetch()` 能访问哪些域名。必须覆盖 Salesforce 所有可能的登录域名。

---

## 十二、调试 & 常见问题

### 12.1 提取不到 Session

- **检查 Manifest**：`cookies` 权限和 `host_permissions` 是否包含目标域名
- **检查 Cookie 状态**：Chrome DevTools → Application → Cookies → `sid` 是否存在、是否 Secure、是否 `HttpOnly`（HttpOnly 不影响 Chrome Cookies API 读取）
- **检查多域名**：用户可能在 `lightning.force.com` 登录，但 `sid` 在 `na1.salesforce.com` 上

### 12.2 Session 过期

表现：所有 API 返回 401。处理流程：

```
401 响应
    ↓
标记 sessionExpired = true
    ↓
tryRefreshSession(envId) → 扫描所有 Salesforce 标签页
    ↓
找到新 sid → 更新 environments → 自动重试请求
没找到 → 抛 'Session expired' → UI 停止轮询并提示
```

### 12.3 Service Worker 休眠

MV3 的 Service Worker 在空闲时会被浏览器终止，导致 `pollingInterval` 等定时器失效。

**解决**：
- 轮询在 UI 页面（`window.js`）中通过 `sendMessage` 请求，不由 Background 维护。Background 只提供 API 代理层
- Background 通过 `chrome.runtime.onMessage` 每次被唤醒时都 `loadState()`

### 12.4 多 Cookie Store（多 Profile）

Chrome 每个 Profile 有独立的 Cookie Store。`tab.cookieStoreId` 区分不同 Profile：

```javascript
const cookie = await chrome.cookies.get({
  name: "sid",
  storeId: tab.cookieStoreId,  // 使用标签页所属的 Store
  url: "https://" + sfHost
});
```

### 12.5 调试命令

```javascript
// 在 Service Worker Console 中执行
chrome.storage.local.get(console.log)        // 查看存储
chrome.cookies.getAll({name: 'sid'}, console.log)  // 查看所有 sid
chrome.tabs.query({}, console.log)            // 查看所有标签页
```

---

## 十三、可复用代码片段（模板）

**以下代码可以直接复制到任何需要 Session 管理的 Chrome 扩展中使用。**

### 13.1 Session 提取模块（复制即用）

```javascript
const SALESFORCE_DOMAIN_PATTERNS = [
  'salesforce.com', 'force.com', 'cloudforce.com', 'visualforce.com'
];

const SID_CANDIDATE_DOMAINS = [
  'salesforce.com', 'cloudforce.com', 'salesforce.mil',
  'cloudforce.mil', 'sfcrmproducts.cn', 'force.com',
  'my.salesforce.com', 'lightning.force.com'
];

function isSalesforceUrl(url) {
  return SALESFORCE_DOMAIN_PATTERNS.some(d => url.includes(d))
      && !url.startsWith('chrome-extension://');
}

async function extractSessionFromTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab?.url || !isSalesforceUrl(tab.url)) return null;

  const sfHost = await getSfHost(tab.url, tab.cookieStoreId);
  if (!sfHost) return null;

  const session = await getSession(sfHost, tab.cookieStoreId);
  if (!session) return null;

  return {
    sessionId: session.key,
    instanceUrl: `https://${session.hostname}`,
    hostname: session.hostname
  };
}

async function getSfHost(url, cookieStoreId) {
  // 1. 先从当前 URL 试
  const currentSid = await chrome.cookies.get({
    url, name: 'sid', storeId: cookieStoreId
  });

  if (!currentSid) {
    return new URL(url).hostname;
  }

  // 2. 用 Org ID 指纹在候选域名中查找
  const orgId = currentSid.value.split('!')[0];
  for (const domain of SID_CANDIDATE_DOMAINS) {
    const cookies = await chrome.cookies.getAll({
      name: 'sid', domain, secure: true, storeId: cookieStoreId
    });
    const match = cookies.find(c =>
      c.value.startsWith(orgId + '!') &&
      c.domain !== 'help.salesforce.com'
    );
    if (match) return match.domain;
  }

  return new URL(url).hostname;
}

async function getSession(sfHost, cookieStoreId) {
  const cookie = await chrome.cookies.get({
    name: 'sid', storeId: cookieStoreId, url: 'https://' + sfHost
  });
  return cookie ? { key: cookie.value, hostname: cookie.domain } : null;
}
```

### 13.2 环境管理模块

```javascript
let environments = {};
let activeEnvId = null;

function generateEnvId(instanceUrl) {
  const hostname = new URL(instanceUrl).hostname;
  return btoa(hostname).replace(/[^a-zA-Z0-9]/g, '');
}

function getEnvName(instanceUrl) {
  const h = new URL(instanceUrl).hostname;
  if (h.includes('sandbox') || h.includes('cs')) return 'Sandbox';
  if (h.includes('test')) return 'Test';
  return 'Production';
}

async function addEnvironment(session) {
  const envId = generateEnvId(session.instanceUrl);
  if (environments[envId]) {
    environments[envId] = {
      ...environments[envId],
      sessionId: session.sessionId,
      instanceUrl: session.instanceUrl,
      hostname: session.hostname,
      connectedAt: Date.now(),
      userName: undefined
    };
  } else {
    environments[envId] = {
      id: envId,
      name: getEnvName(session.instanceUrl),
      sessionId: session.sessionId,
      instanceUrl: session.instanceUrl,
      hostname: session.hostname,
      connectedAt: Date.now()
    };
  }
  return envId;
}

async function saveState() {
  await chrome.storage.local.set({
    'salesforce-environments': environments,
    'salesforce-active-env': activeEnvId
  });
}

async function loadState() {
  const result = await chrome.storage.local.get([
    'salesforce-environments', 'salesforce-active-env'
  ]);
  environments = result['salesforce-environments'] || {};
  activeEnvId = result['salesforce-active-env'];
}
```

### 13.3 API 请求模块

```javascript
const API_VERSION = 'v59.0';

async function apiRequest(endpoint, options = {}) {
  const env = environments[activeEnvId];
  if (!env) throw new Error('No active environment');

  const response = await fetch(env.instanceUrl + endpoint, {
    ...options,
    headers: {
      'Authorization': `Bearer ${env.sessionId}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  if (response.status === 401) {
    if (environments[activeEnvId]) {
      environments[activeEnvId].sessionExpired = true;
      await saveState();
    }
    const refreshed = await tryRefreshSession(activeEnvId);
    if (refreshed) return apiRequest(endpoint, options);
    throw new Error('Session expired');
  }

  if (!response.ok) {
    throw new Error(`API ${response.status}: ${await response.text()}`);
  }
  return response.status === 204 ? null : await response.json();
}

async function tryRefreshSession(envId) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.url && isSalesforceUrl(tab.url)) {
      const session = await extractSessionFromTab(tab.id);
      if (session) {
        const newEnvId = generateEnvId(session.instanceUrl);
        if (newEnvId === envId) {
          environments[envId] = {
            ...environments[envId],
            sessionId: session.sessionId,
            sessionExpired: false,
            connectedAt: Date.now()
          };
          await saveState();
          return true;
        }
      }
    }
  }
  return false;
}
```

### 13.4 消息处理器（Background 端）

```javascript
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.action) {
        case 'get-state':
          sendResponse({
            success: true,
            environments: Object.values(environments),
            activeEnvId,
            currentUserName: activeEnvId
              ? environments[activeEnvId]?.userName : null
          });
          break;
        // ... 其他 action
        default:
          sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (error) {
      console.error('Message handler error:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();
  return true;  // 关键：标记异步响应
});
```

> **注意**：`return true` 告诉 Chrome 这是异步响应，不能省略。

### 13.5 UI 端请求封装

```javascript
function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else if (response?.success) {
        resolve(response);
      } else {
        reject(new Error(response?.error || 'Request failed'));
      }
    });
  });
}

// 用法
async function loadState() {
  const response = await sendMessage({ action: 'get-state' });
  environments = response.environments;
  activeEnvId = response.activeEnvId;
  // ... 渲染 UI
}
```

---

## 十四、设计要点总结

| 要点 | 说明 |
|------|------|
| **Org ID 指纹** | 用 `sid` 的前半部分做跨域名匹配 |
| **域名优先级列表** | 按实际情况排列，从上往下找 |
| **先开窗口后扫环境** | 让用户立即看到 UI，降低感知延迟 |
| **并行处理标签页** | `Promise.all` 代替串行循环 |
| **不缓存用户名** | Session 更新时清空 `userName` 强制重取 |
| **401 自动重试** | 先 `tryRefreshSession`，再递归重试请求 |
| **`return true`** | `onMessage` 处理器必须返回 true 以支持异步响应 |
| **`chrome.runtime.sendMessage` 封装 Promise** | 把回调 API 转成 async/await |
| **`chrome.storage.local` 持久化** | Service Worker 重启后能恢复状态 |

---

*以上内容基于 Salesforce Apex Log Viewer 项目的实际实现整理。可作为 Chrome 扩展的 Session 管理模板复用。*
