/**
 * 区域选择截图 content script
 * 在页面上覆盖半透明遮罩，用户拖拽选择矩形区域
 */

if (!window.__sfContentInjected) {
  window.__sfContentInjected = true;

  const _origLog = console.log.bind(console);
  console.log = function(...args) {
    _origLog(...args);
    try {
      chrome.runtime.sendMessage({
        action: 'contentLog',
        message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
      });
    } catch (e) {}
  };
}

let overlayDiv = null;
let selectionDiv = null;
let isSelecting = false;
let startX = 0;
let startY = 0;
let screenshotDataUrl = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startAreaSelect') {
    screenshotDataUrl = request.dataUrl;
    startSelection();
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'fillTotpCode') {
    fillTotpCode(request.totpCode);
    sendResponse({ success: true });
    return true;
  }
});

function fillTotpCode(totpCode) {
  console.log('[fillTotpCode] 尝试填入TOTP验证码');

  function tryFillTotp() {
    const totpField = document.querySelector('#totpCode') ||
      document.querySelector('input[name="totpCode"]') ||
      document.querySelector('#emc') ||
      document.querySelector('input[name="emc"]') ||
      document.querySelector('input[autocomplete="one-time-code"]');

    if (!totpField) {
      console.log('[fillTotpCode] 未找到TOTP输入框');
      return false;
    }

    console.log('[fillTotpCode] 找到TOTP输入框，填入验证码');
    const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeSet.call(totpField, totpCode);
    totpField.dispatchEvent(new Event('input', { bubbles: true }));
    totpField.dispatchEvent(new Event('change', { bubbles: true }));

    const verifyButton = document.querySelector('#save') ||
      document.querySelector('input[name="save"]') ||
      document.querySelector('button[name="save"]') ||
      document.querySelector('#verify');

    if (verifyButton) {
      console.log('[fillTotpCode] 找到验证按钮，点击提交');
      setTimeout(() => verifyButton.click(), 300);
    } else {
      console.log('[fillTotpCode] 未找到验证按钮');
    }

    return true;
  }

  if (!tryFillTotp()) {
    console.log('[fillTotpCode] 当前未找到TOTP框，启动DOM监听等待 (10秒)');
    const observer = new MutationObserver(() => {
      if (tryFillTotp()) {
        console.log('[fillTotpCode] DOM变化后找到TOTP框并填入');
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
      console.log('[fillTotpCode] TOTP监听超时结束');
      observer.disconnect();
    }, 10000);
  }
}

function startSelection() {
  if (overlayDiv) return;

  overlayDiv = document.createElement('div');
  overlayDiv.id = 'sf-ql-overlay';
  overlayDiv.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.4);
    z-index: 2147483646;
    cursor: crosshair;
  `;

  selectionDiv = document.createElement('div');
  selectionDiv.id = 'sf-ql-selection';
  selectionDiv.style.cssText = `
    position: fixed;
    border: 2px solid #00A1E0;
    background: rgba(0, 161, 224, 0.1);
    pointer-events: none;
    z-index: 2147483647;
    display: none;
    box-sizing: border-box;
  `;

  const tipDiv = document.createElement('div');
  tipDiv.id = 'sf-ql-tip';
  tipDiv.textContent = '拖拽选择二维码区域，按 ESC 取消';
  tipDiv.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.75);
    color: white;
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 14px;
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    pointer-events: none;
  `;

  overlayDiv.appendChild(selectionDiv);
  overlayDiv.appendChild(tipDiv);
  document.body.appendChild(overlayDiv);

  isSelecting = false;

  overlayDiv.addEventListener('mousedown', onMouseDown);
  overlayDiv.addEventListener('mousemove', onMouseMove);
  overlayDiv.addEventListener('mouseup', onMouseUp);
  document.addEventListener('keydown', onKeyDown);
}

function onMouseDown(e) {
  if (e.button !== 0) return;
  e.preventDefault();
  isSelecting = true;
  startX = e.clientX;
  startY = e.clientY;
  selectionDiv.style.display = 'block';
  selectionDiv.style.left = startX + 'px';
  selectionDiv.style.top = startY + 'px';
  selectionDiv.style.width = '0px';
  selectionDiv.style.height = '0px';
}

function onMouseMove(e) {
  if (!isSelecting) return;
  e.preventDefault();

  const currentX = Math.max(0, Math.min(window.innerWidth, e.clientX));
  const currentY = Math.max(0, Math.min(window.innerHeight, e.clientY));

  const left = Math.min(startX, currentX);
  const top = Math.min(startY, currentY);
  const width = Math.abs(currentX - startX);
  const height = Math.abs(currentY - startY);

  selectionDiv.style.left = left + 'px';
  selectionDiv.style.top = top + 'px';
  selectionDiv.style.width = width + 'px';
  selectionDiv.style.height = height + 'px';
}

async function onMouseUp(e) {
  if (!isSelecting) return;
  e.preventDefault();
  isSelecting = false;

  const rect = selectionDiv.getBoundingClientRect();
  const left = rect.left;
  const top = rect.top;
  const width = rect.width;
  const height = rect.height;

  cleanup();

  if (width < 10 || height < 10) {
    chrome.runtime.sendMessage({ action: 'areaCancelled', reason: 'too small' });
    return;
  }

  try {
    const croppedDataUrl = await cropImage(screenshotDataUrl, left, top, width, height);
    chrome.runtime.sendMessage({ action: 'areaSelected', dataUrl: croppedDataUrl });
  } catch (err) {
    chrome.runtime.sendMessage({ action: 'areaCancelled', reason: err.message });
  }
}

function onKeyDown(e) {
  if (e.key === 'Escape') {
    cleanup();
    chrome.runtime.sendMessage({ action: 'areaCancelled', reason: 'user cancelled' });
  }
}

function cleanup() {
  isSelecting = false;
  if (overlayDiv && overlayDiv.parentNode) {
    overlayDiv.parentNode.removeChild(overlayDiv);
  }
  overlayDiv = null;
  selectionDiv = null;
  document.removeEventListener('keydown', onKeyDown);
}

function cropImage(dataUrl, x, y, width, height) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scaleX = img.width / window.innerWidth;
      const scaleY = img.height / window.innerHeight;

      const canvas = document.createElement('canvas');
      canvas.width = width * scaleX;
      canvas.height = height * scaleY;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(
        img,
        x * scaleX, y * scaleY,
        width * scaleX, height * scaleY,
        0, 0,
        canvas.width, canvas.height
      );
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = dataUrl;
  });
}

// ============================================
// Passkey 桥接模块
// Content script 运行在孤立世界，无法直接拦截页面的 navigator.credentials
// 需要将 page-world.js 注入到页面主世界，并通过 window.postMessage 桥接消息
// ============================================

(function() {
  'use strict';

  if (window.__sfPasskeyBridgeInjected) return;
  window.__sfPasskeyBridgeInjected = true;

  console.log('%c[SF Passkey] Content Script 桥接已注入', 'color: #7b1fa2; font-weight: bold;');

  // 注入 page-world 脚本到页面主世界（按顺序加载依赖）
  function injectPageWorldScript() {
    try {
      // 先加载 CBOR 编码器
      const cborScript = document.createElement('script');
      cborScript.src = chrome.runtime.getURL('lib/cbor.js');
      cborScript.onload = function() {
        console.log('[SF Passkey] CBOR 脚本加载完成');
        this.remove();

        // 再加载 WebAuthn 认证器
        const authScript = document.createElement('script');
        authScript.src = chrome.runtime.getURL('lib/webauthn-authenticator.js');
        authScript.onload = function() {
          console.log('[SF Passkey] WebAuthn 认证器脚本加载完成');
          this.remove();

          // 最后加载 page-world 主脚本
          const mainScript = document.createElement('script');
          mainScript.src = chrome.runtime.getURL('page-world.js');
          mainScript.onload = function() {
            console.log('[SF Passkey] Page-World 脚本加载完成');
            this.remove();
          };
          mainScript.onerror = function() {
            console.error('[SF Passkey] Page-World 脚本加载失败');
          };
          (document.head || document.documentElement).appendChild(mainScript);
        };
        authScript.onerror = function() {
          console.error('[SF Passkey] WebAuthn 认证器脚本加载失败');
        };
        (document.head || document.documentElement).appendChild(authScript);
      };
      cborScript.onerror = function() {
        console.error('[SF Passkey] CBOR 脚本加载失败');
      };
      (document.head || document.documentElement).appendChild(cborScript);
      console.log('[SF Passkey] 已开始注入依赖脚本');
    } catch (e) {
      console.error('[SF Passkey] 注入脚本失败:', e);
    }
  }

  // 立即注入
  injectPageWorldScript();

  // 监听来自 page-world 的消息（通过 window.postMessage）
  window.addEventListener('message', async (event) => {
    if (!event.data || event.data.source !== 'sf-page-world') return;

    console.log('%c[SF Passkey] Content Script 收到 Page-World 消息:', 'color: #7b1fa2;', event.data.action);

    if (event.data.action === 'webauthnGetIntercepted') {
      try {
        const response = await chrome.runtime.sendMessage({
          action: 'webauthnGetIntercepted',
          requestId: event.data.requestId,
          rpId: event.data.rpId,
          challenge: event.data.challenge,
          allowCredentials: event.data.allowCredentials
        });

        console.log('%c[SF Passkey] Background 回复:', 'color: #7b1fa2;', response);

        if (response && response.intercept) {
          window.postMessage({
            source: 'sf-extension',
            action: 'interceptConfirmed',
            requestId: event.data.requestId
          }, '*');
        }
      } catch (e) {
        console.error('%c[SF Passkey] 转发给 Background 失败:', 'color: #d32f2f;', e);
      }
    }

    if (event.data.action === 'webauthnCreateIntercepted') {
      try {
        console.log('[SF Passkey] Content Script 转发 webauthnCreateIntercepted，requestId:', event.data.requestId);
        const response = await chrome.runtime.sendMessage({
          action: 'webauthnCreateIntercepted',
          requestId: event.data.requestId,
          rpId: event.data.rpId,
          challenge: event.data.challenge,
          user: event.data.user
        });

        console.log('[SF Passkey] Background 回复:', response);

        if (response && response.intercept) {
          console.log('[SF Passkey] Content Script 发送 interceptConfirmed，requestId:', event.data.requestId);
          window.postMessage({
            source: 'sf-extension',
            action: 'interceptConfirmed',
            requestId: event.data.requestId
          }, '*');
        } else {
          console.log('[SF Passkey] Background 回复未确认拦截，不发送 interceptConfirmed');
        }
      } catch (e) {
        console.error('[SF Passkey] 转发注册请求给 Background 失败:', e);
      }
    }

    if (event.data.action === 'passkeyRegistered') {
      try {
        await chrome.runtime.sendMessage({
          action: 'passkeyRegistered',
          credentialId: event.data.credentialId,
          rpId: event.data.rpId,
          userHandle: event.data.userHandle
        });
      } catch (e) {
        console.error('[SF Passkey] 转发注册消息失败:', e);
      }
    }

    // 存储私钥
    if (event.data.action === 'storePrivateKey') {
      try {
        const response = await chrome.runtime.sendMessage({
          action: 'storePrivateKey',
          credentialId: event.data.credentialId,
          rpId: event.data.rpId,
          privateKeyJwk: event.data.privateKeyJwk,
          publicKeyJwk: event.data.publicKeyJwk,
          userId: event.data.userId,
          userName: event.data.userName,
          userDisplayName: event.data.userDisplayName,
          envId: event.data.envId,
          signCount: event.data.signCount,
          createdAt: event.data.createdAt
        });
        console.log('[SF Passkey] 私钥存储结果:', response);
        if (response?.success) {
          window.postMessage({
            source: 'sf-extension',
            action: 'privateKeyStored',
            credentialId: event.data.credentialId
          }, '*');
        }
      } catch (e) {
        console.error('[SF Passkey] 存储私钥失败:', e);
      }
    }

    // 获取存储的凭证
    if (event.data.action === 'getStoredCredentials') {
      try {
        const response = await chrome.runtime.sendMessage({
          action: 'getStoredCredentials',
          rpId: event.data.rpId
        });
        console.log('[SF Passkey] 获取存储凭证结果:', response);
        window.postMessage({
          source: 'sf-extension',
          action: 'storedCredentials',
          credentials: response?.credentials || []
        }, '*');
      } catch (e) {
        console.error('[SF Passkey] 获取存储凭证失败:', e);
        window.postMessage({
          source: 'sf-extension',
          action: 'storedCredentials',
          credentials: []
        }, '*');
      }
    }

    // 更新凭证
    if (event.data.action === 'updateCredential') {
      try {
        await chrome.runtime.sendMessage({
          action: 'updateCredential',
          credential: event.data.credential
        });
      } catch (e) {
        console.error('[SF Passkey] 更新凭证失败:', e);
      }
    }
  });

  // 监听来自 background 的消息，转发给 page-world
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[SF Passkey] Content Script 收到 Background 消息:', request.action, 'requestId:', request.requestId, 'tabId:', request.tabId);

    if (request.action === 'passkeySelected') {
      console.log('[SF Passkey] Content Script 转发 passkeySelected 到 page-world，credential:', request.credential);
      window.postMessage({
        source: 'sf-extension',
        action: 'passkeySelected',
        requestId: request.requestId,
        credential: request.credential
      }, '*');
      sendResponse({ success: true });
      return true;
    }

    if (request.action === 'passkeySelectionCancelled') {
      console.log('[SF Passkey] Content Script 转发 passkeySelectionCancelled 到 page-world');
      window.postMessage({
        source: 'sf-extension',
        action: 'passkeySelectionCancelled',
        requestId: request.requestId
      }, '*');
      sendResponse({ success: true });
      return true;
    }

    return false;
  });
})();
