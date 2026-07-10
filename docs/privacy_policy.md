# Privacy Policy for Salesforce Quick Login

**Last updated: July 10, 2026**

## Overview

Salesforce Quick Login ("the extension") is a browser extension that allows users to store and manage their Salesforce login credentials for one-click login to Salesforce orgs. This privacy policy explains how the extension handles user data.

## Data Collection

**The extension does NOT collect, transmit, or share any personal data with the extension developer or any third-party servers.**

All data entered by the user (Salesforce usernames, passwords, security tokens, TOTP secrets, and environment configurations) is stored **locally** in the browser using `chrome.storage.sync` and `chrome.storage.local` APIs.

## Data Storage

- **chrome.storage.sync**: Data is synchronized through the user's own Google account via Chrome's built-in sync feature. The extension developer has no access to this data.
- **chrome.storage.local**: A local backup copy is stored in the browser's local storage.
- **No external servers**: The extension does not connect to any external servers, databases, or APIs operated by the developer. All operations happen entirely within the user's browser.

## Data Usage

The stored credentials are used solely for:

1. **Auto-login**: Automatically filling in Salesforce login forms when the user initiates a login
2. **MFA/TOTP**: Generating time-based one-time passwords for Salesforce MFA authentication
3. **Session management**: Opening Salesforce orgs via frontdoor.jsp with the stored session ID

## Data Security

- Credentials are stored in Chrome's encrypted storage
- The extension does not transmit credentials to any server other than Salesforce's own login endpoints
- SOAP API login requests are sent directly to Salesforce servers (login.salesforce.com, test.salesforce.com, or custom Salesforce domains)
- Form submission login sends credentials directly to Salesforce's login endpoints

## Permissions Explanation

| Permission | Purpose |
|------------|---------|
| `storage` | Store environment configurations and credentials |
| `sidePanel` | Display the extension UI in Chrome's side panel |
| `tabs` | Open new tabs for Salesforce login |
| `activeTab` | Capture screenshots for QR code scanning |
| `clipboardWrite` | Copy TOTP codes to clipboard |
| `scripting` | Inject login forms and TOTP codes into Salesforce pages |
| `host_permissions` (Salesforce domains) | Access Salesforce login pages and APIs |

## Third-Party Services

The extension interacts only with Salesforce's official login endpoints. No other third-party services are used.

## Data Deletion

Users can delete all stored data at any time by:

1. Removing individual environments through the extension UI
2. Uninstalling the extension (this removes all stored data)
3. Clearing browser data in Chrome settings

## User Consent

By installing and using this extension, the user consents to the storage of their Salesforce credentials in Chrome's local and sync storage as described above.

## Changes to This Policy

Any changes to this privacy policy will be updated in this document and reflected in future extension updates.

## Contact

For privacy concerns or questions, please open an issue on the extension's GitHub repository.

---

# 隐私政策（中文）

**最后更新：2026年7月10日**

## 概述

Salesforce Quick Login（"本插件"）是一个浏览器插件，允许用户存储和管理 Salesforce 登录凭证，实现一键登录 Salesforce 环境。本隐私政策说明插件如何处理用户数据。

## 数据收集

**本插件不会向插件开发者或任何第三方服务器收集、传输或共享任何个人数据。**

用户输入的所有数据（Salesforce 用户名、密码、安全令牌、TOTP 密钥和环境配置）均使用 `chrome.storage.sync` 和 `chrome.storage.local` API **本地**存储在浏览器中。

## 数据存储

- **chrome.storage.sync**：数据通过用户自己的 Google 账号同步，使用 Chrome 内置的同步功能。插件开发者无法访问此数据。
- **chrome.storage.local**：在浏览器本地存储中保留备份副本。
- **无外部服务器**：插件不连接任何由开发者运营的外部服务器、数据库或 API。所有操作完全在用户浏览器内完成。

## 数据用途

存储的凭证仅用于：

1. **自动登录**：用户发起登录时自动填写 Salesforce 登录表单
2. **MFA/TOTP**：为 Salesforce MFA 认证生成基于时间的一次性密码
3. **会话管理**：使用存储的会话 ID 通过 frontdoor.jsp 打开 Salesforce 环境

## 数据安全

- 凭证存储在 Chrome 的加密存储中
- 插件不会将凭证传输到 Salesforce 自有登录端点以外的任何服务器
- SOAP API 登录请求直接发送到 Salesforce 服务器（login.salesforce.com、test.salesforce.com 或自定义 Salesforce 域名）
- 表单提交登录将凭证直接发送到 Salesforce 的登录端点

## 权限说明

| 权限 | 用途 |
|------|------|
| `storage` | 存储环境配置和凭证 |
| `sidePanel` | 在 Chrome 侧边栏中显示插件界面 |
| `tabs` | 打开新标签页进行 Salesforce 登录 |
| `activeTab` | 截取屏幕截图用于二维码扫描 |
| `clipboardWrite` | 复制 TOTP 验证码到剪贴板 |
| `scripting` | 向 Salesforce 页面注入登录表单和 TOTP 验证码 |
| `host_permissions`（Salesforce 域名）| 访问 Salesforce 登录页面和 API |

## 第三方服务

本插件仅与 Salesforce 官方登录端点交互。不使用任何其他第三方服务。

## 数据删除

用户可以随时通过以下方式删除所有存储的数据：

1. 通过插件界面删除单个环境
2. 卸载插件（将删除所有存储的数据）
3. 在 Chrome 设置中清除浏览器数据

## 用户同意

安装和使用本插件即表示用户同意上述将 Salesforce 凭证存储在 Chrome 本地和同步存储中的方式。

## 政策变更

本隐私政策的任何变更将在本文档中更新，并在未来的插件更新中体现。

## 联系方式

如有隐私问题或疑问，请在插件的 GitHub 仓库中提交 issue。
