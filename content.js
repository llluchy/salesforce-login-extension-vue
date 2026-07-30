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
// Passkey 桥接模块（v4 架构）
// - page-world.js 拦截 WebAuthn API → 转发到 Side Panel 集中处理
// - session storage 读写接口（通过 Background 中转）
// - Side Panel 负责所有 Passkey UI 和数据处理
// ============================================

(function() {
  'use strict';

  if (window.__sfPasskeyBridgeInjected) return;
  window.__sfPasskeyBridgeInjected = true;

  const CT = '[CT]';
  console.log(`${CT} ========== Passkey 桥接模块注入 (v4) ==========`);
  console.log(`${CT} location:`, window.location.href);

  /**
   * 注入 page-world.js 到页面主世界
   * v4 架构不再需要 cbor.js / webauthn-authenticator.js / passkey-ui.js
   */
  function injectPageWorldScript() {
    console.log(`${CT} 开始注入 page-world.js...`);
    try {
      const mainScript = document.createElement('script');
      mainScript.src = chrome.runtime.getURL('page-world.js');
      mainScript.onload = function() {
        console.log(`${CT} page-world.js 加载完成 ✅`);
        this.remove();
      };
      mainScript.onerror = function(e) {
        console.error(`${CT} page-world.js 加载失败!`, e);
      };
      (document.head || document.documentElement).appendChild(mainScript);
    } catch (e) {
      console.error(`${CT} injectPageWorldScript 异常:`, e.message);
    }
  }

  /**
   * 向 page-world.js 回传响应
   */
  function respondToPageWorld(requestId, data) {
    window.postMessage({
      source: 'sf-extension',
      requestId: requestId,
      data: data
    }, '*');
  }

  // ============================================
  // postMessage 监听（接收 page-world.js 的请求）
  // ============================================
  window.addEventListener('message', async (event) => {
    if (!event.data || event.data.source !== 'sf-page-world') return;

    const action = event.data.action;
    const requestId = event.data.requestId;
    console.log(`${CT} [message] 收到 page-world 消息: ${action}`, { requestId });

    // ====== sessionGet：通过 Background 读取 session storage ======
    if (action === 'sessionGet') {
      console.log(`${CT} [sessionGet] 转发到 Background, keys:`, event.data.data?.keys);
      try {
        const result = await chrome.runtime.sendMessage({
          action: '__sf_sessionGet',
          keys: event.data.data.keys || event.data.keys
        });
        respondToPageWorld(requestId, result || {});
      } catch (e) {
        console.error(`${CT} [sessionGet] 失败:`, e.message);
        respondToPageWorld(requestId, {});
      }
      return;
    }

    // ====== sf:passkeyGet / sf:passkeyCreate：fire-and-forget 发给 Side Panel ======
    // 响应由 sf:passkeyResult listener 接收后回传给 page-world
    if (action === 'sf:passkeyGet' || action === 'sf:passkeyCreate') {
      console.log(`${CT} [${action}] 转发到 Side Panel (fire-and-forget)...`);
      try {
        chrome.runtime.sendMessage({
          action: action,
          requestId: requestId,
          data: event.data.data
        }).catch(e => {
          console.error(`${CT} [${action}] sendMessage 失败:`, e.message);
          respondToPageWorld(requestId, { success: false, error: e.message });
        });
      } catch (e) {
        console.error(`${CT} [${action}] 失败:`, e.message, e.stack);
        respondToPageWorld(requestId, { success: false, error: e.message });
      }
      return;
    }

    console.warn(`${CT} [message] 未处理的消息: ${action}`);
  });

  // ====== 接收 Side Panel 的直接响应（sf:passkeyResult） ======
  chrome.runtime.onMessage.addListener((request, sender) => {
    if (request.action !== 'sf:passkeyResult') return;
    console.log(`${CT} [passkeyResult] 收到 Side Panel 响应`, {
      requestId: request.requestId,
      success: request.data?.success,
      hasCredential: !!request.data?.credential
    });
    respondToPageWorld(request.requestId, request.data);
  });

  console.log(`${CT} 开始注入脚本...`);
  injectPageWorldScript();
  console.log(`${CT} ========== 桥接模块初始化完成 (v4) ==========`);
})();
