// ============================================
// Page-World Passkey 拦截脚本
// 注入到页面主世界，使用软件认证器完成 Passkey 创建和验证
// 使用页面浮层 UI 替代 Side Panel 进行环境选择
// ============================================

(function() {
  'use strict';

  if (window.__sfPageWorldInjected) return;
  window.__sfPageWorldInjected = true;

  console.log('[SF Passkey] 插件加载成功');

  const _origOpen = XMLHttpRequest.prototype.open;
  const _origSend = XMLHttpRequest.prototype.send;
  const _origFetch = window.fetch;

  // 拦截 fetch（捕获 begin-ceremony 响应数据）
  window.fetch = async function(input, init) {
    const url = typeof input === 'string' ? input : (input?.url || '');
    const response = await _origFetch.apply(this, arguments);

    if (url && url.includes('webauthn/begin-ceremony')) {
      try {
        const cloned = response.clone();
        const respText = await cloned.text();
        try { JSON.parse(respText); } catch (e) {}
      } catch (e) {}
    }

    return response;
  };

  // XHR 拦截：修复 finish-ceremony 请求体格式
  XMLHttpRequest.prototype.open = function(method, url) {
    this._sfUrl = url;
    return _origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function(body) {
    if (this._sfUrl && this._sfUrl.includes('webauthn/finish-ceremony')
        && body && typeof body === 'string' && body.length > 0) {
      try {
        const parsed = JSON.parse(body);
        const isAssertion = this._sfUrl.includes('webauthn_operation=authentication');

        if (parsed.credential && parsed.credential.response) {
          const resp = parsed.credential.response;

          // 删除非标准字段
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

          // 确保 rawId 存在
          if (!parsed.credential.rawId && parsed.credential.id) {
            parsed.credential.rawId = parsed.credential.id;
          }

          // 确保 type 字段存在
          if (!parsed.credential.type) {
            parsed.credential.type = 'public-key';
          }

          // 确保 clientExtensionResults 存在
          if (!parsed.credential.clientExtensionResults) {
            parsed.credential.clientExtensionResults = {};
          }

          // 确保 authenticatorAttachment 存在
          if (!parsed.credential.authenticatorAttachment) {
            parsed.credential.authenticatorAttachment = 'platform';
          }

          arguments[0] = JSON.stringify(parsed);
        }
      } catch (e) {
        // 静默失败
      }
    }
    return _origSend.apply(this, arguments);
  };

  const originalGet = navigator.credentials.get.bind(navigator.credentials);
  const originalCreate = navigator.credentials.create.bind(navigator.credentials);

  window.__sfOriginalGet = originalGet;
  window.__sfOriginalCreate = originalCreate;

  // ========== 消息桥接（仅用于和 content.js 交换存储数据）==========

  let pendingGetCredentialsResolve = null;

  window.addEventListener('message', (event) => {
    if (!event.data || event.data.source !== 'sf-extension') return;

    if (event.data.action === 'storedCredentials') {
      if (pendingGetCredentialsResolve) {
        pendingGetCredentialsResolve(event.data.credentials || []);
        pendingGetCredentialsResolve = null;
      }
    }

    if (event.data.action === 'environmentsList') {
      if (window._pendingGetEnvsResolve) {
        window._pendingGetEnvsResolve(event.data.environments || []);
        window._pendingGetEnvsResolve = null;
      }
    }

    if (event.data.action === 'environmentSaved') {
      if (window._pendingSaveEnvResolve) {
        window._pendingSaveEnvResolve(event.data.success);
        window._pendingSaveEnvResolve = null;
      }
    }
  });

  // ========== 拦截认证请求（get）==========
  navigator.credentials.get = async function(options) {
    if (!options || !options.publicKey) {
      return originalGet(options);
    }

    const rpId = options.publicKey.rpId;

    if (!rpId || !isSalesforceDomain(rpId)) {
      return originalGet(options);
    }

    try {
      // 获取待登录环境（完整原始数据，不做任何解析）
      const pendingEnv = await requestPendingLoginEnv(rpId);
      console.log('[Page] ⑧ 最终使用处拿到 pendingEnv', {
        hasEnv: !!pendingEnv,
        envId: pendingEnv?.id,
        passkeysType: pendingEnv ? typeof pendingEnv.passkeys : 'N/A',
        passkeysIsArray: pendingEnv ? Array.isArray(pendingEnv.passkeys) : 'N/A',
        passkeysLength: pendingEnv && Array.isArray(pendingEnv.passkeys) ? pendingEnv.passkeys.length : 0
      });

      // ★ 最终使用处：第一次解析 passkeys（用于 storedCredentials）
      const storedCredentials = (pendingEnv && Array.isArray(pendingEnv.passkeys)) ? pendingEnv.passkeys : [];

      // 构造 displayEnvs（直接透传原始 passkeys，不做转换）
      const displayEnvs = pendingEnv
        ? [{
            id: pendingEnv.id || 'pending',
            alias: pendingEnv.alias,
            type: pendingEnv.type || 'production',
            username: pendingEnv.username,
            passkeys: pendingEnv.passkeys,
            _isPending: true
          }]
        : [];

      console.log('[Page] ⑨ 调用 PasskeyUI.showSelector', { displayEnvCount: displayEnvs.length });
      const selectedEnv = await PasskeyUI.showSelector('login', displayEnvs, rpId);
      console.log('[Page] ⑩ PasskeyUI.showSelector 返回', { hasSelected: !!selectedEnv });

      if (selectedEnv) {
        const origin = window.location.origin;
        // ★ 最终使用处：第二次解析 passkeys（确保 getAssertion 调用时用的是数组）
        const finalCredentials = Array.isArray(selectedEnv.passkeys) ? selectedEnv.passkeys : storedCredentials;
        console.log('[Page] ⑪ 调用 getAssertion', {
          rpId,
          storedCredentialCount: finalCredentials.length,
          storedCredentialIds: finalCredentials.map(c => c.credentialId),
          allowCredentials: (options.publicKey.allowCredentials || []).map(c => ({
            id: typeof c.id === 'string' ? c.id : arrayBufferToBase64(c.id),
            type: c.type
          }))
        });
        try {
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
            finalCredentials
          );

          console.log('[Page] ⑫ getAssertion 结果', { hasResult: !!result });
          if (result) {
            window.postMessage({
              source: 'sf-page-world',
              action: 'updateCredential',
              credential: result.updatedCredential
            }, '*');
            return result.credential;
          }
        } catch (e) {
          console.error('[Page] ⑫ getAssertion 异常', e);
        }
      }
    } catch (e) {
      console.error('[Page] navigator.credentials.get 异常', e);
    }

    return originalGet(options);
  };

  // 获取待登录环境（包含已解密的 passkeys 私钥）
  function requestPendingLoginEnv(rpId) {
    console.log('[Page] ⑥ 发起 getPendingLoginEnv 请求', { rpId });
    return new Promise((resolve) => {
      const handler = (event) => {
        if (!event.data || event.data.source !== 'sf-extension') return;
        if (event.data.action !== 'pendingLoginEnvLoaded') return;
        const env = event.data.loginEnv;
        console.log('[Page] ⑦ 收到 pendingLoginEnvLoaded', {
          hasEnv: !!env,
          envId: env?.id,
          passkeysType: env ? typeof env.passkeys : 'N/A',
          passkeysIsArray: env ? Array.isArray(env.passkeys) : 'N/A',
          passkeysLength: env && Array.isArray(env.passkeys) ? env.passkeys.length : 0,
          error: event.data.error
        });
        window.removeEventListener('message', handler);
        // 直接透传原始 env，不做任何解析，最终使用处再解析
        resolve(env || null);
      };
      window.addEventListener('message', handler);

      window.postMessage({
        source: 'sf-page-world',
        action: 'getPendingLoginEnv',
        rpId: rpId
      }, '*');

      // 超时保护
      setTimeout(() => {
        console.warn('[Page] ⑦ requestPendingLoginEnv 超时（3秒）');
        window.removeEventListener('message', handler);
        resolve(null);
      }, 3000);
    });
  }

  // ========== 拦截注册请求（create）==========
  navigator.credentials.create = async function(options) {
    if (!options || !options.publicKey) {
      return originalCreate(options);
    }

    const rpId = options.publicKey.rpId || options.publicKey.rp?.id;

    if (!rpId || !isSalesforceDomain(rpId)) {
      return originalCreate(options);
    }

    try {
      const environments = await getEnvironments();

      // 显示浮层 UI 让用户选择或创建环境
      const selectedEnv = await PasskeyUI.showSelector('create', environments, rpId);

      if (selectedEnv) {
        // 如果是新环境（还没有保存到 storage），先保存
        const isNewEnv = !environments.find(e => e.id === selectedEnv.id);
        if (isNewEnv) {
          await saveNewEnvironment(selectedEnv);
        }

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

        // 存储私钥
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
          envId: selectedEnv.envId || selectedEnv.id,
          signCount: 0,
          createdAt: Date.now()
        }, '*');

        // 同时更新环境的 passkeys 列表
        window.postMessage({
          source: 'sf-page-world',
          action: 'bindPasskeyToEnv',
          envId: selectedEnv.id,
          passkey: {
            id: 'pk_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            credentialId: result.credential.id,
            rpId: rpId,
            challenge: arrayBufferToBase64(options.publicKey.challenge),
            createdAt: Date.now()
          }
        }, '*');

        return result.credential;
      }
    } catch (e) {
      // 静默失败
    }

    return originalCreate(options);
  };

  // ========== 辅助函数 ==========

  function isSalesforceDomain(rpId) {
    return rpId.endsWith('.salesforce.com') ||
           rpId.endsWith('.force.com') ||
           rpId.endsWith('.my.salesforce.com') ||
           rpId.endsWith('.cloudforce.com') ||
           rpId === 'salesforce.com' ||
           rpId === 'force.com';
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
      pendingGetCredentialsResolve = resolve;
      window.postMessage({
        source: 'sf-page-world',
        action: 'getStoredCredentials',
        rpId: rpId
      }, '*');

      setTimeout(() => {
        if (pendingGetCredentialsResolve) {
          pendingGetCredentialsResolve([]);
          pendingGetCredentialsResolve = null;
        }
      }, 3000);
    });
  }

  // 获取环境列表（通过 content script 从 chrome.storage 读取）
  function getEnvironments() {
    return new Promise((resolve) => {
      window._pendingGetEnvsResolve = resolve;
      window.postMessage({
        source: 'sf-page-world',
        action: 'getEnvironments'
      }, '*');

      setTimeout(() => {
        if (window._pendingGetEnvsResolve) {
          window._pendingGetEnvsResolve([]);
          window._pendingGetEnvsResolve = null;
        }
      }, 3000);
    });
  }

  // 保存新环境（通过 content script 写入 chrome.storage）
  function saveNewEnvironment(env) {
    return new Promise((resolve) => {
      window._pendingSaveEnvResolve = resolve;
      window.postMessage({
        source: 'sf-page-world',
        action: 'saveNewEnvironment',
        environment: env
      }, '*');

      setTimeout(() => {
        if (window._pendingSaveEnvResolve) {
          window._pendingSaveEnvResolve(false);
          window._pendingSaveEnvResolve = null;
        }
      }, 3000);
    });
  }

  // 让 PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable 返回 true
  if (window.PublicKeyCredential) {
    PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = async function() {
      return true;
    };
  }
})();
