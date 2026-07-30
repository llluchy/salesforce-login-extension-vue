// ============================================
// Page-World Passkey 拦截脚本（v4.1 架构）
// 注入到页面主世界，仅做拦截 + 转发，不参与任何业务判断
// 登录状态 / 环境匹配 / PasskeyUI 全部由 Side Panel 负责
// ============================================

(function() {
  'use strict';

  if (window.__sfPageWorldInjected) return;
  window.__sfPageWorldInjected = true;

  const LOG = '[PW]';

  // ============================================
  // 基础辅助函数
  // ============================================

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  function base64ToArrayBuffer(b64) {
    const padding = '='.repeat((4 - b64.length % 4) % 4);
    const raw = atob((b64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes.buffer;
  }

  function isSalesforceDomain(rpId) {
    const result = rpId.endsWith('.salesforce.com') ||
           rpId.endsWith('.force.com') ||
           rpId.endsWith('.my.salesforce.com') ||
           rpId.endsWith('.cloudforce.com') ||
           rpId === 'salesforce.com' ||
           rpId === 'force.com';
    return result;
  }

  // ============================================
  // 与 content.js 通信
  // 唯一通信模式：发送一个请求 → 等待一个响应
  // 不做任何带外回执（不查登录状态、不查环境数据）
  // ============================================

  function forwardToSidePanel(action, data, timeoutMs) {
    const requestId = Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    return new Promise((resolve) => {
      const handler = (event) => {
        if (!event.data || event.data.source !== 'sf-extension') return;
        if (event.data.requestId !== requestId) return;
        window.removeEventListener('message', handler);
        resolve(event.data.data || {});
      };
      window.addEventListener('message', handler);
      window.postMessage({
        source: 'sf-page-world',
        action: action,
        requestId: requestId,
        data: data
      }, '*');
      setTimeout(() => {
        window.removeEventListener('message', handler);
        resolve({ fallback: true, error: 'Side Panel 未响应' });
      }, timeoutMs);
    });
  }

  // ============================================
  // XHR 拦截（修复 finish-ceremony 请求体格式）
  // ============================================
  const _origOpen = XMLHttpRequest.prototype.open;
  const _origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url) {
    this._sfUrl = url;
    return _origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function(body) {
    if (this._sfUrl && this._sfUrl.includes('webauthn/finish-ceremony')
        && body && typeof body === 'string' && body.length > 0) {
      try {
        const parsed = JSON.parse(body);
        if (parsed.credential && parsed.credential.response) {
          const resp = parsed.credential.response;
          delete resp.challenge;
          delete resp.origin;
          delete resp.getPublicKeyAlgorithm;
          delete resp.getTransports;
          delete resp.getAuthenticatorData;
          delete resp.getPublicKey;
          if (!parsed.credential.rawId && parsed.credential.id) parsed.credential.rawId = parsed.credential.id;
          if (!parsed.credential.type) parsed.credential.type = 'public-key';
          if (!parsed.credential.clientExtensionResults) parsed.credential.clientExtensionResults = {};
          if (!parsed.credential.authenticatorAttachment) parsed.credential.authenticatorAttachment = 'platform';
          arguments[0] = JSON.stringify(parsed);
        }
      } catch (e) { /* 静默 */ }
    }
    return _origSend.apply(this, arguments);
  };

  // ============================================
  // fetch 拦截（finish-ceremony — 监控 + 确保格式正确）
  // ============================================
  const _origFetch = window.fetch;
  window.fetch = async function(input, init) {
    const url = typeof input === 'string' ? input : (input?.url || '');

    // 拦截 finish-ceremony：清理非标准字段（兼容系统 Passkey 的 toJSON）
    if (url.includes('webauthn/finish-ceremony') && init && init.body && typeof init.body === 'string') {
      try {
        const parsed = JSON.parse(init.body);
        if (parsed.credential && parsed.credential.response) {
          const resp = parsed.credential.response;
          delete resp.challenge;
          delete resp.origin;
          delete resp.getPublicKeyAlgorithm;
          delete resp.getTransports;
          delete resp.getAuthenticatorData;
          delete resp.getPublicKey;
          if (!parsed.credential.rawId && parsed.credential.id) parsed.credential.rawId = parsed.credential.id;
          if (!parsed.credential.type) parsed.credential.type = 'public-key';
          if (!parsed.credential.clientExtensionResults) parsed.credential.clientExtensionResults = {};
          if (!parsed.credential.authenticatorAttachment) parsed.credential.authenticatorAttachment = 'platform';
          init = { ...init, body: JSON.stringify(parsed) };
        }
      } catch (e) { /* 静默 */ }
    }

    return _origFetch.call(this, input, init);
  };

  // ============================================
  // WebAuthn API 拦截
  // ============================================

  const originalGet = navigator.credentials.get.bind(navigator.credentials);
  const originalCreate = navigator.credentials.create.bind(navigator.credentials);
  window.__sfOriginalGet = originalGet;
  window.__sfOriginalCreate = originalCreate;

  /**
   * credentials.get — 只做两件事：1) 识别域名  2) 转发给 Side Panel
   * 不做登录检查、不做环境获取、不做凭证匹配
   */
  navigator.credentials.get = async function(options) {
    if (!options || !options.publicKey) {
      return originalGet(options);
    }

    const rpId = options.publicKey.rpId;
    // 仅本地判断域名，不做任何异步回执
    if (!rpId || !isSalesforceDomain(rpId)) {
      return originalGet(options);
    }

    // 转发全部参数给 Side Panel
    const response = await forwardToSidePanel('sf:passkeyGet', {
      rpId: rpId,
      challenge: arrayBufferToBase64(options.publicKey.challenge),
      allowCredentials: (options.publicKey.allowCredentials || []).map(c => ({
        id: typeof c.id === 'string' ? c.id : arrayBufferToBase64(c.id),
        type: c.type
      })),
      origin: window.location.origin,
      userVerification: options.publicKey.userVerification || 'preferred',
      timeout: options.publicKey.timeout || 60000
    }, 120000);

    // Side Panel 决定不处理（未登录 / 无环境 / 用户取消等）→ 回退
    if (response.fallback) {
      return originalGet(options);
    }

    // Side Panel 处理成功 → 重建 PublicKeyCredential
    if (response.success && response.credential) {
      return rebuildPublicKeyCredential(response.credential);
    }

    // Side Panel 返回错误 → 抛出给 Salesforce 页面
    throw new DOMException(response.error || 'Passkey 验证取消', 'AbortError');
  };

  /**
   * credentials.create — 只做两件事：1) 识别域名  2) 转发给 Side Panel
   */
  navigator.credentials.create = async function(options) {
    if (!options || !options.publicKey) return originalCreate(options);

    const rpId = options.publicKey.rpId || options.publicKey.rp?.id;
    if (!rpId || !isSalesforceDomain(rpId)) return originalCreate(options);

    const response = await forwardToSidePanel('sf:passkeyCreate', {
      rpId: rpId,
      rp: options.publicKey.rp,
      user: options.publicKey.user ? {
        id: options.publicKey.user.id ? arrayBufferToBase64(options.publicKey.user.id) : '',
        name: options.publicKey.user.name || '',
        displayName: options.publicKey.user.displayName || ''
      } : null,
      challenge: arrayBufferToBase64(options.publicKey.challenge),
      pubKeyCredParams: options.publicKey.pubKeyCredParams,
      excludeCredentials: (options.publicKey.excludeCredentials || []).map(c => ({
        id: typeof c.id === 'string' ? c.id : arrayBufferToBase64(c.id),
        type: c.type
      })),
      authenticatorSelection: options.publicKey.authenticatorSelection ? {
        authenticatorAttachment: options.publicKey.authenticatorSelection.authenticatorAttachment,
        requireResidentKey: options.publicKey.authenticatorSelection.requireResidentKey,
        residentKey: options.publicKey.authenticatorSelection.residentKey,
        userVerification: options.publicKey.authenticatorSelection.userVerification
      } : null,
      origin: window.location.origin
    }, 120000);

    if (response.fallback) {
      return originalCreate(options);
    }

    if (response.success && response.credential) {
      try {
        const cred = rebuildPublicKeyCredential(response.credential);
        return cred;
      } catch (e) {
        throw e;
      }
    }

    throw new DOMException(response.error || 'Passkey 注册取消', 'AbortError');
  };

  /**
   * 将 Side Panel 返回的序列化 credential 重建为 PublicKeyCredential
   * 包含正确的 toJSON() 方法，使 JSON.stringify 产出符合 WebAuthn 规范的格式
   */
  function rebuildPublicKeyCredential(data) {
    const r = data.response || {};

    // 判断是 create(attestation) 还是 get(assertion)
    const isAttestation = !!r.attestationObject;

    const credential = {
      id: data.id,
      rawId: base64ToArrayBuffer(data.id),
      type: data.type || 'public-key',
      authenticatorAttachment: data.authenticatorAttachment || 'platform',
      response: {}
    };

    if (isAttestation) {
      // ====== create / attestation ======
      credential.response.clientDataJSON = base64ToArrayBuffer(r.clientDataJSON);
      credential.response.attestationObject = base64ToArrayBuffer(r.attestationObject);

      Object.defineProperty(credential.response, 'getTransports', {
        value: () => r.transports || ['internal'], enumerable: false
      });
      Object.defineProperty(credential.response, 'getAuthenticatorData', {
        value: () => base64ToArrayBuffer(r.authenticatorData), enumerable: false
      });
      Object.defineProperty(credential.response, 'getPublicKey', {
        value: () => r.getPublicKey ? base64ToArrayBuffer(r.getPublicKey) : new ArrayBuffer(0),
        enumerable: false
      });
      Object.defineProperty(credential.response, 'getPublicKeyAlgorithm', {
        value: () => r.getPublicKeyAlgorithm !== undefined ? r.getPublicKeyAlgorithm : -7,
        enumerable: false
      });

      // toJSON: 仅输出 WebAuthn 标准字段
      credential.response.toJSON = function() {
        return {
          clientDataJSON: r.clientDataJSON,
          attestationObject: r.attestationObject,
          transports: r.transports || ['internal']
        };
      };
    } else {
      // ====== get / assertion ======
      credential.response.clientDataJSON = base64ToArrayBuffer(r.clientDataJSON);
      credential.response.authenticatorData = base64ToArrayBuffer(r.authenticatorData);
      credential.response.signature = base64ToArrayBuffer(r.signature);
      if (r.userHandle) credential.response.userHandle = base64ToArrayBuffer(r.userHandle);

      // toJSON: 仅输出 WebAuthn 标准字段
      credential.response.toJSON = function() {
        const obj = {
          clientDataJSON: r.clientDataJSON,
          authenticatorData: r.authenticatorData,
          signature: r.signature
        };
        if (r.userHandle) obj.userHandle = r.userHandle;
        return obj;
      };
    }

    // PublicKeyCredential.toJSON()
    credential.toJSON = function() {
      return {
        id: credential.id,
        rawId: credential.id,
        type: credential.type,
        authenticatorAttachment: credential.authenticatorAttachment,
        response: credential.response.toJSON(),
        clientExtensionResults: credential.getClientExtensionResults()
      };
    };

    Object.defineProperty(credential, 'getClientExtensionResults', {
      value: () => (data.clientExtensionResults || {}), enumerable: false
    });

    return credential;
  }

  // ============================================
  // 覆盖 isUserVerifyingPlatformAuthenticatorAvailable
  // ============================================
  if (window.PublicKeyCredential) {
    PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = async function() {
      return true;
    };
  }

})();
