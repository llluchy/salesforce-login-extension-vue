# TOTP（基于时间的一次性密码）原理

## 一、什么是 TOTP

**TOTP** = **Time-based One-Time Password**，即"基于时间的一次性密码"。

它是 **MFA（多因素认证）** 中最常用的一种实现方式。当你在某个网站开启两步验证后，除了输入账号密码，还需要输入一个每 30 秒变化一次的 6 位数字，这个数字就是 TOTP Code。

常见的 TOTP 应用包括：
- Google Authenticator
- Microsoft Authenticator
- Salesforce Authenticator
- Authy

---

## 二、核心公式

TOTP 的标准是 **RFC 6238**，其核心公式非常简单：

```
TOTP = Truncate(HMAC-SHA1(Secret, TimeStep))
```

拆解来看：

| 组件 | 说明 |
|------|------|
| `Secret` | 一个只有你和服务器知道的密钥（base32 编码） |
| `TimeStep` | 当前时间除以 30 秒得到的步数 |
| `HMAC-SHA1` | 用 Secret 对 TimeStep 做哈希运算 |
| `Truncate` | 从哈希结果中截取出 6 位数字 |

---

## 三、分步详解

### 步骤 1：获取 Secret（密钥）

当你在某网站开启 MFA 时，网站会生成一个随机的密钥，通常以两种方式给你：

**方式 A：二维码**
```
二维码内容 = otpauth://totp/Example:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example
```

**方式 B：一串字符**
```
JBSWY3DPEHPK3PXP
```

这就是 **Secret**，用 **base32** 编码。你把它输入到 Authenticator App 里，App 以后就能生成 TOTP Code 了。

### 步骤 2：计算时间步长（TimeStep）

TOTP 以 **30 秒** 为一个周期。当前时间步长 = 从 1970-01-01 到现在的总秒数 ÷ 30。

```javascript
const timeStep = Math.floor(Date.now() / 1000 / 30);
// 例如：2026-07-08 12:00:00 → timeStep = 584xxx
```

同一个 30 秒内，timeStep 不变，生成的 Code 也不变。30 秒一过，timeStep + 1，Code 随之变化。

### 步骤 3：HMAC-SHA1 哈希

用 Secret 作为密钥，对 timeStep 进行 HMAC-SHA1 哈希运算：

```javascript
// 伪代码
const hash = HMAC_SHA1(key=Secret, message=timeStep);
```

得到一串 20 字节（160 位）的哈希值。

### 步骤 4：动态截断（Truncate）

从这 20 字节中取出 4 字节，转换成一个整数，然后取后 6 位：

```
1. 取哈希值的最后一个字节的低 4 位 → 得到偏移量 offset（0~15）
2. 从 offset 位置开始取 4 个字节 → 得到一个 32 位整数
3. 去掉最高位（防止负数）→ 得到一个正整数
4. 对 1000000 取模 → 得到一个 6 位数
5. 不足 6 位前面补 0 → 最终 TOTP Code
```

举个例子：
```
哈希值 = [0x1f, 0x86, 0x98, 0x69, 0x0e, 0x02, 0xca, ...]
最后一个字节低 4 位 = 0x0e → offset = 14
取 bytes[14~17] = [0x50, 0xef, 0x7f, 0x19]
转成整数 = 0x50ef7f19 = 1353770777
去掉最高位 = 1353770777 & 0x7fffffff = 1353770777
对 1000000 取模 = 377077
补零到 6 位 = 377077  →  这就是 TOTP Code！
```

---

## 四、为什么每 30 秒刷新一次？

30 秒是一个**权衡**：
- **太短**（如 5 秒）：用户来不及输入就过期，体验差
- **太长**（如 5 分钟）：安全风险增加，被截获后有更长时间可利用
- **30 秒**：行业公认平衡点，Google/Microsoft/Apple 都用这个值

---

## 五、二维码 URI 格式

当你扫描 MFA 二维码时，实际扫描的是这样一个 URI：

```
otpauth://totp/ACME:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=ACME&algorithm=SHA1&digits=6&period=30
```

解析：

| 参数 | 含义 |
|------|------|
| `otpauth://totp/` | 协议头，表示 TOTP |
| `ACME:alice@example.com` | 账号标识（issuer:账号名）|
| `secret=JBSWY3DPEHPK3PXP` | **密钥（最重要！）** |
| `issuer=ACME` | 服务提供商 |
| `algorithm=SHA1` | 哈希算法（默认 SHA1）|
| `digits=6` | Code 位数（默认 6 位）|
| `period=30` | 刷新周期（默认 30 秒）|

**插件只需要提取 `secret` 参数，就能生成和对方完全一致的 TOTP Code。**

---

## 六、安全性说明

### Secret 的重要性
- Secret 是 TOTP 的"根"，有了 Secret 就能生成任意时刻的 Code
- Secret 必须**保密**，泄露 = MFA 失效
- 一般网站会在你开启 MFA 时只显示一次二维码，之后不再暴露 Secret

### 为什么不直接传输 Code？
- 如果网络被监听，Code 被截获，攻击者就能登录
- 但 Code 只有 30 秒有效期，且用一次就失效
- 加上 HTTPS 加密传输，安全性足够

### 为什么需要时间同步？
- 服务器和 Authenticator 都独立计算 Code
- 如果两者时间差超过 30 秒，Code 就会不匹配
- 大多数系统允许 1~2 个周期的误差（即前后各 30 秒都接受）

---

## 七、插件如何使用 TOTP

### 绑定流程
1. 用户在 Salesforce 设置 MFA，页面上展示二维码
2. 插件点击"截屏扫描"或"上传图片"，提取二维码中的 `secret`
3. 将 `secret` 保存到该环境配置中

### 使用流程
1. 用户点击"登录"，插件打开 Salesforce 登录页
2. 插件用保存的 `secret` 实时计算当前 TOTP Code
3. 便签纸展开，显示 6 位 Code 和倒计时
4. 用户点击 Code 复制 → 粘贴到登录页 → 完成 MFA

### Code 验证
插件生成的 Code 和 Google Authenticator 生成的 Code 会**完全一致**，因为它们使用相同的 Secret 和相同的时间。
