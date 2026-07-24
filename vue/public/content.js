/**
 * 区域选择截图 content script
 * 在页面上覆盖半透明遮罩，用户拖拽选择矩形区域
 */

if (!window.__sfContentInjected) {
  window.__sfContentInjected = true;
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

});

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

  function injectPageWorldScript() {
    try {
      const cborScript = document.createElement('script');
      cborScript.src = chrome.runtime.getURL('lib/cbor.js');
      cborScript.onload = function() {
        this.remove();

        const authScript = document.createElement('script');
        authScript.src = chrome.runtime.getURL('lib/webauthn-authenticator.js');
        authScript.onload = function() {
          this.remove();

          const uiScript = document.createElement('script');
          uiScript.src = chrome.runtime.getURL('lib/passkey-ui.js');
          uiScript.onload = function() {
            this.remove();

            const mainScript = document.createElement('script');
            mainScript.src = chrome.runtime.getURL('page-world.js');
            mainScript.onload = function() {
              this.remove();
            };
            (document.head || document.documentElement).appendChild(mainScript);
          };
          (document.head || document.documentElement).appendChild(uiScript);
        };
        (document.head || document.documentElement).appendChild(authScript);
      };
      (document.head || document.documentElement).appendChild(cborScript);
    } catch (e) {
      // 静默失败
    }
  }

  // 立即注入
  injectPageWorldScript();

  // 监听来自 page-world 的消息（通过 window.postMessage），转发到 background
  window.addEventListener('message', async (event) => {
    if (!event.data || event.data.source !== 'sf-page-world') return;

    // 存储私钥
    if (event.data.action === 'storePrivateKey') {
      try {
        await chrome.runtime.sendMessage({
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
      } catch (e) {
        // 静默失败
      }
    }

    // 获取存储的凭证
    if (event.data.action === 'getStoredCredentials') {
      try {
        const response = await chrome.runtime.sendMessage({
          action: 'getStoredCredentials',
          rpId: event.data.rpId
        });
        window.postMessage({
          source: 'sf-extension',
          action: 'storedCredentials',
          credentials: response?.credentials || []
        }, '*');
      } catch (e) {
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
        // 静默失败
      }
    }

    // 获取环境列表（从 chrome.storage 读取，供浮层 UI 显示）
    if (event.data.action === 'getEnvironments') {
      try {
        const response = await chrome.runtime.sendMessage({
          action: 'getEnvironments'
        });
        window.postMessage({
          source: 'sf-extension',
          action: 'environmentsList',
          environments: response?.environments || []
        }, '*');
      } catch (e) {
        window.postMessage({
          source: 'sf-extension',
          action: 'environmentsList',
          environments: []
        }, '*');
      }
    }

    // 获取待登录环境（包含 passkeys 私钥），用于直接登录流程
    if (event.data.action === 'getPendingLoginEnv') {
      try {
        console.log('[Content] ④ 转发 getPendingLoginEnv 请求到 background', { rpId: event.data.rpId });
        const response = await chrome.runtime.sendMessage({
          action: 'getPendingLoginEnv',
          rpId: event.data.rpId
        });
        console.log('[Content] ⑤ 收到 background 响应', {
          success: response?.success,
          hasLoginEnv: !!response?.loginEnv,
          passkeysType: response?.loginEnv ? typeof response.loginEnv.passkeys : 'N/A',
          passkeysIsArray: response?.loginEnv ? Array.isArray(response.loginEnv.passkeys) : 'N/A',
          passkeysLength: response?.loginEnv && Array.isArray(response.loginEnv.passkeys) ? response.loginEnv.passkeys.length : 0
        });
        window.postMessage({
          source: 'sf-extension',
          action: 'pendingLoginEnvLoaded',
          loginEnv: response?.loginEnv || null,
          error: response?.error || null
        }, '*');
      } catch (e) {
        console.error('[Content] ⑤ getPendingLoginEnv 异常', e);
        window.postMessage({
          source: 'sf-extension',
          action: 'pendingLoginEnvLoaded',
          loginEnv: null,
          error: e.message
        }, '*');
      }
    }

    // 保存新环境（写入 chrome.storage）
    if (event.data.action === 'saveNewEnvironment') {
      try {
        const response = await chrome.runtime.sendMessage({
          action: 'saveNewEnvironment',
          environment: event.data.environment
        });
        window.postMessage({
          source: 'sf-extension',
          action: 'environmentSaved',
          success: response?.success || false
        }, '*');
      } catch (e) {
        window.postMessage({
          source: 'sf-extension',
          action: 'environmentSaved',
          success: false
        }, '*');
      }
    }

    // 绑定 Passkey 到环境（更新环境的 passkeys 列表）
    if (event.data.action === 'bindPasskeyToEnv') {
      try {
        await chrome.runtime.sendMessage({
          action: 'bindPasskeyToEnv',
          envId: event.data.envId,
          passkey: event.data.passkey
        });
      } catch (e) {
        // 静默失败
      }
    }
  });
})();
