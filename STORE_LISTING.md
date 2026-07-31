# Salesforce Quick Login

---

## English

**One-click Salesforce login with Passkey authentication, TOTP 2FA, encrypted cloud sync and environment sharing.**

---

### Features

- **One-Click Login** — Instantly log into any Salesforce org (Production, Sandbox, or custom domain) with a single click. Supports both SOAP login and form-based login fallback.

- **Passkey / WebAuthn Support** — Automatically intercepts Salesforce WebAuthn prompts and completes passkey authentication using your locally stored credentials. No more reaching for your phone or security key.

- **Built-in TOTP 2FA** — Scan a QR code or manually enter a secret to generate time-based one-time passwords directly inside the extension. No third-party authenticator app required.

- **End-to-End Encrypted Cloud Sync** — All credentials are encrypted with AES-256-GCM before leaving your device. Your password-derived encryption key never touches our servers. Sync your environments securely across devices via Supabase.

- **Environment Management** — Organize your Salesforce orgs with custom aliases, grouping, and drag-and-drop sorting. Easily switch between dozens of orgs.

- **Environment Sharing** — Share environment credentials securely with teammates. All data remains end-to-end encrypted; only the intended recipient can decrypt it.

---

### How It Works

1. **Set up your vault** — Create an account and set up your master password. Your encryption key is derived locally and never sent to any server.

2. **Add environments** — Add your Salesforce orgs with username, password, and security token. Credentials are encrypted before storage.

3. **Login** — Click the login button next to any environment to instantly open a new tab authenticated to that org.

4. **Passkey** — When Salesforce prompts for passkey verification, the extension handles it automatically. Just select the matching environment from the popup.

---

### Permissions Explained

- **storage** — Store encrypted credentials and extension settings locally.
- **sidePanel** — Provide the main extension interface in Chrome's side panel.
- **tabs / activeTab** — Open Salesforce login pages in new tabs.
- **scripting** — Capture area screenshots for QR code scanning and TOTP setup.
- **host_permissions (<all_urls>)** — Required to scan TOTP QR codes on any page and support custom Salesforce domain login.

---

### Support

For issues, feature requests, or questions, please visit our GitHub repository or contact support.

---

## 中文

**一键登录 Salesforce，支持 Passkey 验证、TOTP 两步验证、加密云同步与环境分享。**

---

### 功能亮点

- **一键登录** — 点击即可登录任意 Salesforce 环境（生产、沙箱或自定义域名）。支持 SOAP 登录和表单登录两种方式。

- **Passkey / WebAuthn 验证** — 自动拦截 Salesforce 的 WebAuthn 验证请求，使用本地存储的凭证完成 Passkey 认证。无需再拿出手机或插入安全密钥。

- **内置 TOTP 两步验证** — 扫描二维码或手动输入密钥，在插件内直接生成动态验证码。无需安装第三方验证器应用。

- **端到端加密云同步** — 所有凭证在离开设备前均使用 AES-256-GCM 加密。密码派生的加密密钥永不触及服务器。通过 Supabase 在不同设备间安全同步环境数据。

- **环境管理** — 使用自定义别名、分组和拖拽排序来管理 Salesforce 环境。轻松在数十个环境之间切换。

- **环境分享** — 安全地与团队成员分享环境凭证。所有数据保持端到端加密，只有指定的接收者才能解密。

---

### 使用流程

1. **初始化保险库** — 注册账号并设置主密码。加密密钥在本地派生，永不发送至任何服务器。

2. **添加环境** — 添加 Salesforce 环境，填入用户名、密码和安全令牌。凭证在存储前即被加密。

3. **一键登录** — 点击任意环境旁的登录按钮，即可在新标签页中打开已认证的 Salesforce 页面。

4. **Passkey 验证** — 当 Salesforce 要求 Passkey 验证时，插件自动处理。只需在弹出的环境列表中选择匹配的环境即可。

---

### 权限说明

- **storage** — 本地存储加密凭证和扩展设置。
- **sidePanel** — 在 Chrome 侧边栏中提供扩展主界面。
- **tabs / activeTab** — 在新标签页中打开 Salesforce 登录页面。
- **scripting** — 捕获区域截图，用于扫描 TOTP 二维码。
- **host_permissions (<all_urls>)** — 支持在任意页面扫描 TOTP 二维码，以及自定义 Salesforce 域名的登录。

---

### 支持

如有问题、功能建议或疑问，请访问 GitHub 仓库或联系支持。
