# Chrome Web Store Listing Content

## Extension Name
Salesforce Quick Login

## Summary (132 chars max)
One-click login to Salesforce orgs with MFA/TOTP support, QR code scanning, and cross-device sync.

## Description

### English

Salesforce Quick Login is a powerful browser extension designed for Salesforce developers, administrators, and consultants who manage multiple Salesforce environments.

**Key Features:**

- **One-Click Login**: Instantly log in to any Salesforce org (Production, Sandbox, or Custom domain) without retyping credentials
- **MFA/TOTP Support**: Built-in TOTP code generator with QR code scanning — no separate authenticator app needed
- **Dual Login Methods**: Automatically tries SOAP API login first, then falls back to secure form submission — no Security Token required
- **Cross-Device Sync**: Your environments sync across all browsers logged into the same Google account
- **Environment Management**: Add, edit, clone, and delete up to 50 Salesforce environments with color-coded labels
- **Side Panel UI**: Clean, distraction-free interface accessible from Chrome's side panel
- **QR Code Scanner**: Scan Salesforce MFA QR codes directly from any web page using the built-in screenshot tool
- **TOTP Code Display**: View current TOTP codes on demand without triggering a login

**How It Works:**

1. Add your Salesforce environments (username, password, and optionally TOTP secret)
2. Click the login button — the extension handles the rest
3. For MFA-enabled orgs, TOTP codes are automatically generated and filled in

**Privacy First:**

- All credentials are stored locally in your browser using Chrome's encrypted storage
- No data is sent to any server other than Salesforce's official login endpoints
- No external servers, no tracking, no analytics

### 中文

Salesforce Quick Login 是一款专为 Salesforce 开发者、管理员和顾问设计的浏览器插件，用于管理多个 Salesforce 环境的一键登录。

**主要功能：**

- **一键登录**：无需重复输入凭证，即可登录任何 Salesforce 环境（生产环境、沙盒或自定义域名）
- **MFA/TOTP 支持**：内置 TOTP 验证码生成器，支持二维码扫描，无需单独的身份验证器应用
- **双登录模式**：自动先尝试 SOAP API 登录，失败后自动切换到安全表单提交——无需 Security Token
- **跨设备同步**：通过 Google 账号在所有浏览器间同步环境配置
- **环境管理**：增删改查、克隆最多 50 个 Salesforce 环境，支持颜色标记
- **侧边栏 UI**：简洁的侧边栏界面，不干扰浏览
- **二维码扫描**：通过内置截屏工具从任意网页扫描 Salesforce MFA 二维码
- **TOTP 验证码查看**：无需触发登录即可查看当前 TOTP 验证码

**工作原理：**

1. 添加 Salesforce 环境（用户名、密码，可选 TOTP 密钥）
2. 点击登录按钮，插件自动完成登录
3. 对于启用了 MFA 的环境，TOTP 验证码会自动生成并填入

**隐私优先：**

- 所有凭证均使用 Chrome 加密存储本地保存在浏览器中
- 不会向 Salesforce 官方登录端点以外的任何服务器发送数据
- 无外部服务器、无跟踪、无分析

## Category
Developer Tools

## Language
- English (United States)
- 中文 (简体)

## Single Purpose
Provide one-click login management for Salesforce environments with MFA/TOTP support.

## Permission Justification (for Web Store review)

| Permission | Justification |
|------------|---------------|
| `storage` | Required to store user's Salesforce environment configurations and credentials locally in the browser |
| `sidePanel` | Required to display the extension's user interface in Chrome's side panel |
| `tabs` | Required to open new tabs for Salesforce login and to query the active tab for screenshot capture |
| `activeTab` | Required to capture screenshots of the current tab for QR code scanning functionality |
| `clipboardWrite` | Required to copy TOTP codes to the clipboard for manual use |
| `scripting` | Required to inject login form submission scripts and TOTP code filling into Salesforce login pages |
| `host_permissions` (Salesforce domains) | Required to access Salesforce login pages and SOAP API endpoints for authentication |

## Screenshots Needed

Prepare 3-5 screenshots (1280x800 or 640x400):

1. Side Panel main view with environment list
2. Add/Edit environment modal
3. TOTP code display
4. QR code scanning in progress
5. Delete confirmation modal

## Privacy Policy URL
Upload `docs/privacy_policy.md` to GitHub Pages and use the URL:
`https://your-username.github.io/salesforce-login-extension/privacy_policy.html`
