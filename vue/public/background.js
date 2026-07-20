// ============================================
// 云同步诊断日志（开发版扩展 chrome.storage.sync 行为受限制）
// 在 Service Worker 控制台查看（chrome://extensions → 检查视图 service worker）
// ============================================
const _BG_TAG = '[CloudSync/BG]'
const _bgLog = (action, detail) => {
  if (detail !== undefined) {
    console.log(`${_BG_TAG} ${action}`, detail)
  } else {
    console.log(`${_BG_TAG} ${action}`)
  }
}
const _bgWarn = (action, detail) => console.warn(`${_BG_TAG} ⚠ ${action}`, detail || '')
const _bgErr = (action, err) => console.error(`${_BG_TAG} ✗ ${action}`, err || '')

// Service Worker 启动时输出环境信息
_bgLog('Service Worker 启动', (() => {
  try {
    const manifest = chrome.runtime.getManifest()
    const info = {
      extensionId: chrome.runtime.id,
      name: manifest.name,
      version: manifest.version,
      manifestVersion: manifest.manifest_version,
      // update_url 仅 Web Store 安装的扩展才有；开发版/未打包没有
      hasUpdateUrl: 'update_url' in manifest,
      installType: '(unknown)'
    }
    info.isFromWebStore = info.hasUpdateUrl
    info.isDev = !info.hasUpdateUrl

    // chrome.management.getSelf 可获取 installType
    // 但需要 management 权限，因此包在 try/catch 里
    if (chrome.management && chrome.management.getSelf) {
      chrome.management.getSelf().then(selfInfo => {
        _bgLog('installType', { installType: selfInfo.installType })
        if (selfInfo.installType === 'development') {
          _bgWarn('当前为开发版扩展 (development)', {
            note: 'chrome.storage.sync 在开发版扩展中行为受限',
            impact: '可能无法真正同步到 Google 账户云端，仅表现为本地持久存储',
            advice: '数据可能在卸载扩展时丢失，需要从 Chrome Web Store 安装才能使用真正的云同步'
          })
        }
      }).catch(e => _bgWarn('getSelf 失败', e.message))
    }
    return info
  } catch (e) {
    return { error: e.message }
  }
})())

// 监听 storage.onChanged 事件，输出 storage 变化日志
chrome.storage.onChanged.addListener((changes, areaName) => {
  const interestingKeys = ['salesforce_environments', 'salesforce_groups']
  const relevant = Object.keys(changes).filter(k => interestingKeys.includes(k))
  if (relevant.length === 0) return

  for (const key of relevant) {
    const change = changes[key]
    _bgLog(`storage.onChanged (${areaName})`, {
      key,
      oldValueCount: Array.isArray(change.oldValue) ? change.oldValue.length : (change.oldValue ? 'object' : '(empty)'),
      newValueCount: Array.isArray(change.newValue) ? change.newValue.length : (change.newValue ? 'object' : '(empty)'),
      newValueIds: Array.isArray(change.newValue) ? change.newValue.map(e => e.id) : null
    })
  }
})

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (error) {
    // 静默失败
  }
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});

let pendingQRCallback = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'captureVisibleTab') {
    chrome.tabs.captureVisibleTab({ format: 'png' })
      .then((dataUrl) => sendResponse({ success: true, dataUrl }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'startAreaQR') {
    handleStartAreaQR(sendResponse);
    return true;
  }

  if (request.action === 'areaSelected') {
    if (pendingQRCallback) {
      pendingQRCallback({ success: true, dataUrl: request.dataUrl });
      pendingQRCallback = null;
    }
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'areaCancelled') {
    if (pendingQRCallback) {
      pendingQRCallback({ success: false, error: request.reason || 'cancelled' });
      pendingQRCallback = null;
    }
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'login') {
    handleLoginAction(request, sendResponse);
    return true;
  }

  if (request.action === 'soapLogin') {
    handleSoapLogin(request, sendResponse);
    return true;
  }

  if (request.action === 'formPostLogin') {
    handleFormPostLogin(request, sendResponse);
    return true;
  }

  if (request.action === 'fillTotpCode') {
    handleFillTotpCode(request, sendResponse);
    return true;
  }

  // ========== Passkey 凭证与环境管理（转发给 Side Panel） ==========
  // background.js（Service Worker）无法持有 CryptoKey，所有加解密在 Side Panel 完成。
  // 若 Side Panel 未打开或未登录，返回明确错误提示。

  const PASSKEY_FORWARD_ACTIONS = {
    'storePrivateKey':       'bg:storePasskey',
    'getStoredCredentials':  'bg:getPasskeys',
    'updateCredential':      'bg:updatePasskey',
    'exportPasskeyBackup':   'bg:exportPasskeyBackup',
    'importPasskeyBackup':   'bg:importPasskeyBackup',
    'manualBindCredential':  'bg:manualBindPasskey',
    'exportCredentialById':  'bg:getPasskeyById',
    'listAllCredentials':    'bg:listPasskeys',
    'getEnvironments':       'bg:getEnvironments',
    'saveNewEnvironment':    'bg:saveNewEnvironment',
    'bindPasskeyToEnv':      'bg:bindPasskeyToEnv'
  }

  const targetAction = PASSKEY_FORWARD_ACTIONS[request.action]
  if (targetAction) {
    forwardPasskeyToSidePanel(request, targetAction, sendResponse)
    return true
  }
})

// ============================================
// 转发 Passkey/环境请求到 Side Panel
// Side Panel 持有 cryptoKey 和 Supabase client，负责加解密与云端读写
// ============================================
async function forwardPasskeyToSidePanel(request, targetAction, sendResponse) {
  const forwardMsg = { ...request, action: targetAction }

  // storePrivateKey 是扁平结构，包装成 credential 对象以匹配 Side Panel 接口
  if (request.action === 'storePrivateKey') {
    forwardMsg.credential = {
      credentialId: request.credentialId,
      rpId: request.rpId,
      privateKeyJwk: request.privateKeyJwk,
      publicKeyJwk: request.publicKeyJwk,
      userId: request.userId || '',
      userName: request.userName,
      userDisplayName: request.userDisplayName,
      envId: request.envId,
      signCount: request.signCount || 0,
      createdAt: request.createdAt || Date.now()
    }
  }

  _bgLog('转发 Passkey 请求', { from: request.action, to: targetAction })

  try {
    const response = await chrome.runtime.sendMessage(forwardMsg)
    if (response === undefined) {
      sendResponse({ success: false, error: '扩展面板未打开，请先点击扩展图标打开面板并登录' })
    } else {
      sendResponse(response)
    }
  } catch (err) {
    _bgErr('转发 Passkey 请求失败 ' + request.action, err)
    sendResponse({
      success: false,
      error: '扩展面板未打开或未登录，请先点击扩展图标打开面板并登录后再使用 Passkey 功能'
    })
  }
}

async function handleStartAreaQR(sendResponse) {
  try {
    // 遍历所有普通浏览器窗口的所有标签，找到第一个 active 标签
    const windows = await chrome.windows.getAll({
      populate: true,
      windowTypes: ['normal']
    });
    
    let tab = null;
    let targetWindow = null;
    for (const win of windows) {
      if (win.tabs) {
        const activeTab = win.tabs.find(t => t.active);
        if (activeTab) {
          tab = activeTab;
          targetWindow = win;
          break;
        }
      }
    }
    
    if (!tab || !tab.id) {
      sendResponse({ success: false, error: '未找到活动标签页' });
      return;
    }

    const url = tab.url || '';
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('edge://') || url === '') {
      sendResponse({ success: false, error: '当前页面不支持截屏操作' });
      return;
    }

    const dataUrl = await chrome.tabs.captureVisibleTab(targetWindow.id, { format: 'png' });

    try {
      await chrome.tabs.sendMessage(tab.id, {
        action: 'startAreaSelect',
        dataUrl: dataUrl
      });
    } catch (sendError) {
      if (sendError.message && sendError.message.includes('Receiving end does not exist')) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });
        await chrome.tabs.sendMessage(tab.id, {
          action: 'startAreaSelect',
          dataUrl: dataUrl
        });
      } else {
        throw sendError;
      }
    }

    pendingQRCallback = sendResponse;
  } catch (error) {
    let errorMsg = error.message;
    if (errorMsg.includes('activeTab') || errorMsg.includes('Cannot access') || errorMsg.includes('Receiving end does not exist')) {
      errorMsg = '当前页面不支持截屏操作';
    }
    sendResponse({ success: false, error: errorMsg });
  }
}

async function handleLoginAction(request, sendResponse) {
  try {
    const { env } = request;
    if (!env || !env.username || !env.password) {
      sendResponse({ success: false, error: '缺少登录信息' });
      return;
    }

    let loginUrl;
    if (env.type === 'custom') {
      loginUrl = env.customUrl || 'https://login.salesforce.com';
    } else if (env.type === 'sandbox') {
      loginUrl = 'https://test.salesforce.com';
    } else {
      loginUrl = 'https://login.salesforce.com';
    }

    const tab = await chrome.tabs.create({ url: loginUrl });
    const tabId = tab.id;

    await waitForTabLoaded(tabId);

    await chrome.scripting.executeScript({
      target: { tabId },
      func: submitHiddenForm,
      args: [loginUrl, env.username, env.password]
    });

    sendResponse({ success: true });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleSoapLogin(request, sendResponse) {
  try {
    const { type, username, password, url } = request;

    let soapUrl;
    if (type === 'production') {
      soapUrl = 'https://login.salesforce.com/services/Soap/c/64.0/';
    } else if (type === 'sandbox') {
      soapUrl = 'https://test.salesforce.com/services/Soap/c/64.0/';
    } else if (type === 'custom' && url) {
      const domainMatch = url.match(/https?:\/\/[^/]+/);
      if (!domainMatch) {
        sendResponse({ success: false, error: '自定义环境地址格式不正确' });
        return;
      }
      const domain = domainMatch[0];
      soapUrl = `${domain}/services/Soap/c/64.0/`;
    } else {
      sendResponse({ success: false, error: '不支持的环境类型' });
      return;
    }

    const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<env:Envelope xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:env="http://schemas.xmlsoap.org/soap/envelope/">
    <env:Body>
        <n1:login xmlns:n1="urn:enterprise.soap.sforce.com">
            <n1:username>${username}</n1:username>
            <n1:_password>${password}</n1:_password>
        </n1:login>
    </env:Body>
</env:Envelope>`;

    const response = await fetch(soapUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'SOAPAction': 'login'
      },
      body: soapBody
    });

    const xmlText = await response.text();

    sendResponse({
      success: true,
      ok: response.ok,
      xmlText: xmlText
    });

  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleFormPostLogin(request, sendResponse) {
  try {
    const { loginUrl, username, password, totpCode } = request;

    const tab = await chrome.tabs.create({ url: loginUrl });
    const tabId = tab.id;

    await waitForTabLoaded(tabId);

    await chrome.scripting.executeScript({
      target: { tabId },
      func: submitHiddenForm,
      args: [loginUrl, username, password]
    });

    if (totpCode) {
      await waitForTabLoaded(tabId, 20000);
      await new Promise(r => setTimeout(r, 1000));

      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.js']
        });
        await chrome.tabs.sendMessage(tabId, {
          action: 'fillTotpCode',
          totpCode
        });
      } catch (e) {
        // 静默失败
      }
    }

    sendResponse({ success: true });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

function submitHiddenForm(loginUrl, username, password) {
  const form = document.createElement("form");
  form.setAttribute("method", "POST");
  form.setAttribute("action", loginUrl);
  form.setAttribute("target", "_self");

  const unInput = document.createElement("input");
  unInput.setAttribute("type", "hidden");
  unInput.setAttribute("name", "un");
  unInput.setAttribute("value", username);

  const pwInput = document.createElement("input");
  pwInput.setAttribute("type", "hidden");
  pwInput.setAttribute("name", "pw");
  pwInput.setAttribute("value", password);

  const startUrlInput = document.createElement("input");
  startUrlInput.setAttribute("type", "hidden");
  startUrlInput.setAttribute("name", "startUrl");
  startUrlInput.setAttribute("value", loginUrl);

  form.appendChild(unInput);
  form.appendChild(pwInput);
  form.appendChild(startUrlInput);
  document.body.appendChild(form);
  form.submit();
}

function waitForTabLoaded(tabId, timeout = 30000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, timeout);

    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 500);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function handleFillTotpCode(request, sendResponse) {
  try {
    // 找到普通浏览器窗口（排除 Side Panel、DevTools 等）
    const windows = await chrome.windows.getAll({
      populate: true,
      windowTypes: ['normal']
    });
    
    let targetWindow = windows.find(w => w.focused) || windows[0];
    if (!targetWindow) {
      sendResponse({ success: false, error: '未找到浏览器窗口' });
      return;
    }
    
    const tab = targetWindow.tabs.find(t => t.active);
    if (!tab || !tab.id) {
      sendResponse({ success: false, error: '未找到活动标签页' });
      return;
    }

    try {
      await chrome.tabs.sendMessage(tab.id, {
        action: 'fillTotpCode',
        totpCode: request.totpCode
      });
    } catch (sendError) {
      if (sendError.message && sendError.message.includes('Receiving end does not exist')) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });
        await chrome.tabs.sendMessage(tab.id, {
          action: 'fillTotpCode',
          totpCode: request.totpCode
        });
      } else {
        throw sendError;
      }
    }

    sendResponse({ success: true });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}
