/**
 * TOTP (Time-based One-Time Password) 实现
 * 基于 RFC 6238 标准
 * 使用 Web Crypto API，无需外部依赖
 */

const TOTP = {
  /**
   * 生成当前 TOTP Code
   * @param {string} secret - base32 编码的密钥
   * @param {number} period - 时间周期（秒），默认 30
   * @param {number} digits - 输出位数，默认 6
   * @returns {string} TOTP Code
   */
  async generate(secret, period = 30, digits = 6) {
    const key = this.base32Decode(secret);
    const counter = Math.floor(Date.now() / 1000 / period);
    const counterBuffer = new ArrayBuffer(8);
    const counterView = new DataView(counterBuffer);
    counterView.setBigUint64(0, BigInt(counter), false);

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', cryptoKey, counterBuffer);
    const hash = new Uint8Array(signature);

    // 动态截断
    const offset = hash[hash.length - 1] & 0x0f;
    const binary =
      ((hash[offset] & 0x7f) << 24) |
      ((hash[offset + 1] & 0xff) << 16) |
      ((hash[offset + 2] & 0xff) << 8) |
      (hash[offset + 3] & 0xff);

    const otp = binary % Math.pow(10, digits);
    return otp.toString().padStart(digits, '0');
  },

  /**
   * 获取当前周期剩余秒数
   * @param {number} period - 时间周期（秒），默认 30
   * @returns {number} 剩余秒数
   */
  getRemainingSeconds(period = 30) {
    return period - (Math.floor(Date.now() / 1000) % period);
  },

  /**
   * base32 解码
   * @param {string} str - base32 编码字符串
   * @returns {Uint8Array} 解码后的字节数组
   */
  base32Decode(str) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const cleaned = str.toUpperCase().replace(/[^A-Z2-7]/g, '');
    const bits = [];

    for (const char of cleaned) {
      const val = alphabet.indexOf(char);
      for (let i = 4; i >= 0; i--) {
        bits.push((val >> i) & 1);
      }
    }

    const bytes = [];
    for (let i = 0; i < bits.length; i += 8) {
      if (i + 8 > bits.length) break;
      let byte = 0;
      for (let j = 0; j < 8; j++) {
        byte = (byte << 1) | bits[i + j];
      }
      bytes.push(byte);
    }

    return new Uint8Array(bytes);
  },

  /**
   * 从 otpauth URI 中提取 secret
   * @param {string} uri - otpauth://totp/... URI
   * @returns {string|null} secret 或 null
   */
  extractSecretFromURI(uri) {
    try {
      const url = new URL(uri);
      return url.searchParams.get('secret');
    } catch {
      return null;
    }
  }
};

// 兼容 CommonJS 和浏览器环境
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TOTP;
}
