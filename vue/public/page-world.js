// ============================================
// Page-World Passkey 拦截脚本
// 注入到页面主世界，使用软件认证器完成 Passkey 创建和验证
// 参考 Bitwarden 实现，不依赖系统 Passkey
// ============================================

(function() {
  'use strict';

  if (window.__sfPageWorldInjected) return;
  window.__sfPageWorldInjected = true;

  console.log('[SF Passkey] Page-World 脚本 V8 已注入');

  const _origOpen = XMLHttpRequest.prototype.open;
  const _origSend = XMLHttpRequest.prototype.send;
  const _origFetch = window.fetch;

  // 拦截 fetch
  window.fetch = async function(input, init) {
    const url = typeof input === 'string' ? input : (input?.url || '');

    if (url && url.includes('webauthn/begin-ceremony')) {
      console.log('[SF Passkey] 拦截到 fetch begin-ceremony 请求:', url.substring(0, 100));
    }

    const response = await _origFetch.apply(this, arguments);

    if (url && url.includes('webauthn/begin-ceremony')) {
      try {
        const cloned = response.clone();
        const respText = await cloned.text();
        let respJson;
        try {
          respJson = JSON.parse(respText);
        } catch (e) {
          respJson = null;
        }
        console.log('[SF Passkey] begin-ceremony fetch 响应:', JSON.stringify(respJson).substring(0, 1000));
      } catch (e) {
        console.error('[SF Passkey] 读取 begin-ceremony fetch 响应失败:', e);
      }
    }

    return response;
  };

  XMLHttpRequest.prototype.open = function(method, url) {
    this._sfUrl = url;
    if (url && url.includes('webauthn/begin-ceremony')) {
      const self = this;
      this.addEventListener('load', function() {
        try {
          const resp = JSON.parse(self.responseText);
          console.log('[SF Passkey] begin-ceremony 响应:', JSON.stringify(resp).substring(0, 800));
        } catch (e) {}
      });
    }
    return _origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function(body) {
    if (this._sfUrl && this._sfUrl.includes('webauthn/finish-ceremony')
        && body && typeof body === 'string' && body.length > 0) {
      try {
        const parsed = JSON.parse(body);
        const isAssertion = this._sfUrl.includes('webauthn_operation=authentication');

        console.log('[SF Passkey] XHR 请求体顶级字段:', Object.keys(parsed));
        console.log('[SF Passkey] XHR 完整 body (前500):', body.substring(0, 500));

        if (parsed.credential && parsed.credential.response) {
          const resp = parsed.credential.response;

          console.log('[SF Passkey] XHR 修复前:', isAssertion ? 'assertion' : 'attestation');
          console.log('[SF Passkey]  credential keys:', Object.keys(parsed.credential));
          console.log('[SF Passkey]  credential.id:', parsed.credential.id);
          console.log('[SF Passkey]  credential.rawId:', parsed.credential.rawId ? (parsed.credential.rawId.substring?.(0, 40) + '...') : parsed.credential.rawId);
          console.log('[SF Passkey]  response keys:', Object.keys(resp));

          // 删除所有 yubico 不识别的字段
          delete resp.challenge;
          delete resp.origin;
          delete resp.getPublicKeyAlgorithm;
          delete resp.getTransports;
          delete resp.getAuthenticatorData;
          delete resp.getPublicKey;

          if (isAssertion) {
            delete resp.transports;
          } else {
            if (!resp.transports) {
              resp.transports = ['internal'];
            }
          }

          // 确保 rawId 存在（和 id 相同的 base64url 字符串）
          if (!parsed.credential.rawId && parsed.credential.id) {
            parsed.credential.rawId = parsed.credential.id;
          }

          // 确保 type 字段存在
          if (!parsed.credential.type) {
            parsed.credential.type = 'public-key';
          }

          // 确保 clientExtensionResults 存在（yubico 可能需要）
          if (!parsed.credential.clientExtensionResults) {
            parsed.credential.clientExtensionResults = {};
          }

          // 确保 authenticatorAttachment 存在
          if (!parsed.credential.authenticatorAttachment) {
            parsed.credential.authenticatorAttachment = 'platform';
          }

          arguments[0] = JSON.stringify(parsed);
          console.log('[SF Passkey] XHR 修复后:');
          console.log('[SF Passkey]  credential.rawId:', parsed.credential.rawId?.substring?.(0, 40) + '...');
          console.log('[SF Passkey]  credential.type:', parsed.credential.type);
          console.log('[SF Passkey]  credential.clientExtensionResults:', parsed.credential.clientExtensionResults);
          console.log('[SF Passkey]  response keys:', Object.keys(resp));
          if (isAssertion) {
            console.log('[SF Passkey]  response.userHandle:', resp.userHandle ? resp.userHandle.substring(0, 30) + '...' : resp.userHandle);
            console.log('[SF Passkey]  response.signature 长度:', resp.signature?.length);
            console.log('[SF Passkey]  response.authenticatorData 长度:', resp.authenticatorData?.length);
          }
          console.log('[SF Passkey] XHR 发送完成');
        }
      } catch (e) {
        console.error('[SF Passkey] XHR 修复失败:', e);
      }
    }
    return _origSend.apply(this, arguments);
  };

  const originalGet = navigator.credentials.get.bind(navigator.credentials);
  const originalCreate = navigator.credentials.create.bind(navigator.credentials);

  window.__sfOriginalGet = originalGet;
  window.__sfOriginalCreate = originalCreate;

  let pendingAuthRequestId = null;
  let pendingAuthResolve = null;

  // 调试指示器
  const debugDiv = document.createElement('div');
  debugDiv.id = 'sf-passkey-debug';
  debugDiv.style.cssText = `
    position: fixed;
    bottom: 10px;
    right: 10px;
    background: rgba(25, 118, 210, 0.95);
    color: white;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 11px;
    font-family: monospace;
    z-index: 99999;
    pointer-events: auto;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  `;
  debugDiv.innerHTML = '<strong>SF Passkey</strong><br>软件认证器已就绪';
  debugDiv.addEventListener('click', () => {
    alert('SF Passkey 软件认证器状态:\n\n' +
      '注入状态: ' + window.__sfPageWorldInjected + '\n' +
      'CBOR: ' + (typeof CBOR !== 'undefined' ? '已加载' : '未加载') + '\n' +
      'WebAuthnAuthenticator: ' + (typeof WebAuthnAuthenticator !== 'undefined' ? '已加载' : '未加载') + '\n' +
      '点击浏览器控制台查看详细日志');
  });
  document.body.appendChild(debugDiv);

  // 调试工具
  window._sfDebug = {
    testGet: function() {
      console.log('[SF Passkey] 手动测试 navigator.credentials.get');
      navigator.credentials.get({ publicKey: { rpId: 'test.salesforce.com', challenge: new Uint8Array([1,2,3]) } }).catch(e => console.log('test error:', e));
    },
    testCreate: function() {
      console.log('[SF Passkey] 手动测试 navigator.credentials.create');
      navigator.credentials.create({ publicKey: { rpId: 'test.salesforce.com', challenge: new Uint8Array([1,2,3]), user: { id: new Uint8Array([1]), name: 'test', displayName: 'Test' }, pubKeyCredParams: [] } }).catch(e => console.log('test error:', e));
    },
    status: function() {
      console.log('[SF Passkey] 调试状态:', {
        injected: window.__sfPageWorldInjected,
        CBOR: typeof CBOR !== 'undefined',
        WebAuthnAuthenticator: typeof WebAuthnAuthenticator !== 'undefined',
        originalGet: window.__sfOriginalGet,
        originalCreate: window.__sfOriginalCreate
      });
    }
  };

  // 监听来自 content script 的消息
  window.addEventListener('message', (event) => {
    if (!event.data || event.data.source !== 'sf-extension') return;

    if (event.data.action === 'passkeySelected') {
      console.log('[SF Passkey] 收到 passkeySelected，event.requestId:', event.data.requestId, 'pendingAuthRequestId:', pendingAuthRequestId);
      const requestIdMatch = !event.data.requestId || event.data.requestId === pendingAuthRequestId;
      if (pendingAuthResolve && requestIdMatch) {
        console.log('[SF Passkey] 用户选择了环境，开始处理');
        pendingAuthResolve(event.data.credential || event.data);
        pendingAuthResolve = null;
        pendingAuthRequestId = null;
      }
    }

    if (event.data.action === 'passkeySelectionCancelled') {
      const requestIdMatch = !event.data.requestId || event.data.requestId === pendingAuthRequestId;
      if (pendingAuthResolve && requestIdMatch) {
        console.log('[SF Passkey] 用户取消了选择');
        pendingAuthResolve(null);
        pendingAuthResolve = null;
        pendingAuthRequestId = null;
      }
    }

    // 存储私钥确认
    if (event.data.action === 'privateKeyStored') {
      console.log('[SF Passkey] 私钥存储确认:', event.data.credentialId);
    }

    // 返回存储的凭证
    if (event.data.action === 'storedCredentials') {
      console.log('[SF Passkey] 收到存储的凭证:', event.data.credentials?.length);
      if (window._pendingGetCredentialsResolve) {
        window._pendingGetCredentialsResolve(event.data.credentials || []);
        window._pendingGetCredentialsResolve = null;
      }
    }
  });

  // ========== 拦截认证请求（get）==========
  navigator.credentials.get = async function(options) {
    console.log('[SF Passkey] navigator.credentials.get 被调用');

    if (!options || !options.publicKey) {
      return originalGet(options);
    }

    const rpId = options.publicKey.rpId;
    console.log('[SF Passkey] rpId:', rpId);

    if (!rpId || !isSalesforceDomain(rpId)) {
      console.log('[SF Passkey] 不是 Salesforce 域名，走原流程');
      return originalGet(options);
    }

    const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    console.log('[SF Passkey] 拦截到 Salesforce 认证请求，requestId:', requestId);

    try {
      // 获取存储的凭证
      const storedCredentials = await getStoredCredentials(rpId);
      console.log('[SF Passkey] 存储的凭证数量:', storedCredentials.length);

      // 通知扩展
      window.postMessage({
        source: 'sf-page-world',
        action: 'webauthnGetIntercepted',
        requestId: requestId,
        rpId: rpId,
        challenge: arrayBufferToBase64(options.publicKey.challenge),
        allowCredentials: (options.publicKey.allowCredentials || []).map(c => ({
          id: typeof c.id === 'string' ? c.id : arrayBufferToBase64(c.id),
          type: c.type
        }))
      }, '*');

      const interceptConfirmed = await waitForInterceptConfirm(requestId, 5000);

      if (interceptConfirmed) {
        console.log('[SF Passkey] 扩展已确认拦截，等待用户选择...');
        pendingAuthRequestId = requestId;

        const selectedEnv = await new Promise((resolve) => {
          pendingAuthResolve = resolve;
          setTimeout(() => {
            if (pendingAuthResolve && pendingAuthRequestId === requestId) {
              console.log('[SF Passkey] 等待用户选择超时（120s），回退到原流程');
              pendingAuthResolve(null);
              pendingAuthResolve = null;
              pendingAuthRequestId = null;
            }
          }, 120000);
        });

        if (selectedEnv) {
          console.log('[SF Passkey] 用户选择了环境:', selectedEnv.envId);

          // 使用软件认证器生成断言
          const origin = window.location.origin;
          const result = await WebAuthnAuthenticator.getAssertion(
            {
              rpId: rpId,
              challenge: arrayBufferToBase64(options.publicKey.challenge),
              allowCredentials: (options.publicKey.allowCredentials || []).map(c => ({
                id: typeof c.id === 'string' ? c.id : arrayBufferToBase64(c.id),
                type: c.type
              }))
            },
            origin,
            storedCredentials
          );

          if (result) {
            console.log('[SF Passkey] 软件认证器生成断言成功');
            // 通知扩展更新签名计数
            window.postMessage({
              source: 'sf-page-world',
              action: 'updateCredential',
              credential: result.updatedCredential
            }, '*');
            return result.credential;
          } else {
            console.log('[SF Passkey] 软件认证器未找到匹配凭证，回退到原流程');
          }
        } else {
          console.log('[SF Passkey] 用户未选择或取消');
        }
      } else {
        console.log('[SF Passkey] 扩展未确认拦截，回退到原流程');
      }
    } catch (e) {
      console.error('[SF Passkey] 拦截出错，走原流程:', e);
    }

    return originalGet(options);
  };

  // ========== 拦截注册请求（create）==========
  navigator.credentials.create = async function(options) {
    console.log('[SF Passkey] navigator.credentials.create 被调用');
    console.log('[SF Passkey] options:', options);

    if (!options || !options.publicKey) {
      return originalCreate(options);
    }

    // create 使用 rp.id，get 使用 rpId
    const rpId = options.publicKey.rpId || options.publicKey.rp?.id;
    console.log('[SF Passkey] rpId:', rpId);

    if (!rpId || !isSalesforceDomain(rpId)) {
      console.log('[SF Passkey] 不是 Salesforce 域名，走原流程');
      return originalCreate(options);
    }

    const requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    console.log('[SF Passkey] 拦截到 Salesforce 注册请求，requestId:', requestId);

    try {
      window.postMessage({
        source: 'sf-page-world',
        action: 'webauthnCreateIntercepted',
        requestId: requestId,
        rpId: rpId,
        challenge: arrayBufferToBase64(options.publicKey.challenge),
        user: {
          id: options.publicKey.user?.id ? arrayBufferToBase64(options.publicKey.user.id) : null,
          name: options.publicKey.user?.name || null,
          displayName: options.publicKey.user?.displayName || null
        }
      }, '*');

      const interceptConfirmed = await waitForInterceptConfirm(requestId, 5000);

      if (interceptConfirmed) {
        console.log('[SF Passkey] 扩展已确认拦截，等待用户选择...');
        pendingAuthRequestId = requestId;

        const selectedEnv = await new Promise((resolve) => {
          pendingAuthResolve = resolve;
          setTimeout(() => {
            if (pendingAuthResolve && pendingAuthRequestId === requestId) {
              console.log('[SF Passkey] 等待用户选择超时（120s），回退到原流程');
              pendingAuthResolve(null);
              pendingAuthResolve = null;
              pendingAuthRequestId = null;
            }
          }, 120000);
        });

        if (selectedEnv) {
          console.log('[SF Passkey] 用户选择了环境:', selectedEnv.envId);

          // 使用软件认证器生成凭证
          const origin = window.location.origin;
          
          const result = await WebAuthnAuthenticator.makeCredential({
            rpId: rpId,
            rp: options.publicKey.rp,
            user: options.publicKey.user,
            challenge: options.publicKey.challenge,
            pubKeyCredParams: options.publicKey.pubKeyCredParams,
            excludeCredentials: options.publicKey.excludeCredentials,
            authenticatorSelection: options.publicKey.authenticatorSelection
          }, origin);

          console.log('[SF Passkey] 软件认证器生成凭证成功，credentialId:', result.credential.id);
          console.log('[SF Passkey] credential 对象完整结构:', JSON.stringify({
            id: result.credential.id,
            type: result.credential.type,
            rawId: result.credential.rawId instanceof ArrayBuffer ? 'ArrayBuffer(' + result.credential.rawId.byteLength + ')' : typeof result.credential.rawId,
            authenticatorAttachment: result.credential.authenticatorAttachment,
            response: {
              clientDataJSON: result.credential.response.clientDataJSON instanceof ArrayBuffer ? 'ArrayBuffer(' + result.credential.response.clientDataJSON.byteLength + ')' : typeof result.credential.response.clientDataJSON,
              attestationObject: result.credential.response.attestationObject instanceof ArrayBuffer ? 'ArrayBuffer(' + result.credential.response.attestationObject.byteLength + ')' : typeof result.credential.response.attestationObject
            },
            isPublicKeyCredential: result.credential instanceof PublicKeyCredential
          }, null, 2));
          console.log('[SF Passkey] 即将返回 credential 给页面');

          // 存储私钥到扩展 storage
          window.postMessage({
            source: 'sf-page-world',
            action: 'storePrivateKey',
            credentialId: result.credential.id,
            rpId: rpId,
            privateKeyJwk: result.privateKeyData.privateKeyJwk,
            publicKeyJwk: result.privateKeyData.publicKeyJwk,
            userId: result.privateKeyData.userId,
            userName: result.privateKeyData.userName,
            userDisplayName: result.privateKeyData.userDisplayName,
            envId: selectedEnv.envId,
            signCount: 0,
            createdAt: Date.now()
          }, '*');

          try {
            const finalCredential = result.credential;
            console.log('[SF Passkey] credential instanceof PublicKeyCredential:', finalCredential instanceof PublicKeyCredential);
            console.log('[SF Passkey] credential.response instanceof AuthenticatorAttestationResponse:', finalCredential.response instanceof AuthenticatorAttestationResponse);
            
            console.log('[SF Passkey] ====== 开始逐个属性测试 JSON.stringify ======');
            
            console.log('[SF Passkey] Object.keys(credential):', Object.keys(finalCredential));
            console.log('[SF Passkey] Object.getOwnPropertyNames(credential):', Object.getOwnPropertyNames(finalCredential));
            console.log('[SF Passkey] Object.keys(credential.response):', Object.keys(finalCredential.response));
            console.log('[SF Passkey] Object.getOwnPropertyNames(credential.response):', Object.getOwnPropertyNames(finalCredential.response));
            
            const testSingle = (val, path) => {
              try {
                const type = typeof val;
                if (type === 'function') {
                  console.log(`[SF Passkey] ${path} 是函数`);
                }
                const str = JSON.stringify(val);
                console.log(`[SF Passkey] ${path} (${type}) 序列化成功: ${str?.substring(0, 60)}`);
              } catch (e) {
                console.error(`[SF Passkey] ❌ ${path} 序列化失败:`, e.message);
              }
            };
            
            console.log('[SF Passkey] --- 测试顶层属性 ---');
            testSingle(finalCredential.id, 'credential.id');
            testSingle(finalCredential.rawId, 'credential.rawId');
            testSingle(finalCredential.type, 'credential.type');
            testSingle(finalCredential.authenticatorAttachment, 'credential.authenticatorAttachment');
            testSingle(finalCredential.response, 'credential.response');
            testSingle(finalCredential.getClientExtensionResults, 'credential.getClientExtensionResults');
            
            console.log('[SF Passkey] --- 测试 response 属性 ---');
            testSingle(finalCredential.response.clientDataJSON, 'response.clientDataJSON');
            testSingle(finalCredential.response.attestationObject, 'response.attestationObject');
            testSingle(finalCredential.response.getAuthenticatorData, 'response.getAuthenticatorData');
            testSingle(finalCredential.response.getPublicKey, 'response.getPublicKey');
            testSingle(finalCredential.response.getPublicKeyAlgorithm, 'response.getPublicKeyAlgorithm');
            testSingle(finalCredential.response.getTransports, 'response.getTransports');
            
            console.log('[SF Passkey] --- 测试原型链 ---');
            console.log('[SF Passkey] credential.__proto__ === PublicKeyCredential.prototype:', finalCredential.__proto__ === PublicKeyCredential.prototype);
            console.log('[SF Passkey] response.__proto__ === AuthenticatorAttestationResponse.prototype:', finalCredential.response.__proto__ === AuthenticatorAttestationResponse.prototype);
            
            const protoKeys = Object.keys(Object.getPrototypeOf(finalCredential));
            console.log('[SF Passkey] PublicKeyCredential.prototype 可枚举属性:', protoKeys);
            const protoNames = Object.getOwnPropertyNames(Object.getPrototypeOf(finalCredential));
            console.log('[SF Passkey] PublicKeyCredential.prototype 所有属性:', protoNames);
            
            const respProtoKeys = Object.keys(Object.getPrototypeOf(finalCredential.response));
            console.log('[SF Passkey] AuthenticatorAttestationResponse.prototype 可枚举属性:', respProtoKeys);
            const respProtoNames = Object.getOwnPropertyNames(Object.getPrototypeOf(finalCredential.response));
            console.log('[SF Passkey] AuthenticatorAttestationResponse.prototype 所有属性:', respProtoNames);
            
            console.log('[SF Passkey] ====== 测试完整对象 JSON.stringify ======');
            try {
              const fullStr = JSON.stringify(finalCredential);
              console.log('[SF Passkey] 完整序列化成功，长度:', fullStr.length);
              console.log('[SF Passkey] 前300字符:', fullStr.substring(0, 300));
            } catch (e) {
              console.error('[SF Passkey] ❌ 完整序列化失败:', e);
              console.error('[SF Passkey] 错误堆栈:', e.stack);
            }
            
            console.log('[SF Passkey] 实际返回值类型:', typeof finalCredential);
            console.log('[SF Passkey] 返回值 id:', finalCredential?.id);
            
            return finalCredential;
          } catch (e) {
            console.error('[SF Passkey] 返回 credential 时出错:', e);
            throw e;
          }

        } else {
          console.log('[SF Passkey] 用户未选择或取消');
        }
      } else {
        console.log('[SF Passkey] 扩展未确认拦截，回退到原流程');
      }
    } catch (e) {
      console.error('[SF Passkey] 拦截注册请求出错，走原流程:', e);
    }

    return originalCreate(options);
  };

  // ========== 辅助函数 ==========

  function isSalesforceDomain(rpId) {
    const result = rpId.endsWith('.salesforce.com') ||
           rpId.endsWith('.force.com') ||
           rpId.endsWith('.my.salesforce.com') ||
           rpId.endsWith('.cloudforce.com') ||
           rpId === 'salesforce.com' ||
           rpId === 'force.com';
    return result;
  }

  function waitForInterceptConfirm(requestId, timeout) {
    console.log('[SF Passkey] 开始等待 interceptConfirmed，requestId:', requestId);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        console.log('[SF Passkey] 等待 interceptConfirmed 超时');
        window.removeEventListener('message', listener);
        resolve(false);
      }, timeout);

      function listener(event) {
        if (event.data && event.data.source === 'sf-extension' &&
            event.data.action === 'interceptConfirmed' &&
            event.data.requestId === requestId) {
          clearTimeout(timer);
          window.removeEventListener('message', listener);
          resolve(true);
        }
      }

      window.addEventListener('message', listener);
    });
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  // 获取存储的凭证（通过 content script 从 chrome.storage 读取）
  function getStoredCredentials(rpId) {
    return new Promise((resolve) => {
      window._pendingGetCredentialsResolve = resolve;
      window.postMessage({
        source: 'sf-page-world',
        action: 'getStoredCredentials',
        rpId: rpId
      }, '*');

      setTimeout(() => {
        if (window._pendingGetCredentialsResolve) {
          window._pendingGetCredentialsResolve([]);
          window._pendingGetCredentialsResolve = null;
        }
      }, 3000);
    });
  }

  // 让 PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable 返回 true
  // 这样网站认为存在平台认证器，会尝试使用 Passkey
  if (window.PublicKeyCredential) {
    const originalIsUserVerifying = PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable;
    PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = async function() {
      console.log('[SF Passkey] isUserVerifyingPlatformAuthenticatorAvailable → true');
      return true;
    };
  }
})();
