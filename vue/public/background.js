chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (error) {
    console.error('Failed to open side panel:', error);
  }
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => {
    console.error('Failed to set panel behavior:', error);
  });

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

  if (request.action === 'contentLog') {
    console.log(`[content:${sender.tab?.id || '?'}] ${request.message}`);
    sendResponse({ success: true });
    return true;
  }

  // ========== Passkey 拦截处理 ==========

  if (request.action === 'webauthnGetIntercepted') {
    let tabId = sender.tab?.id;
    console.log('[SF Passkey BG] 收到认证请求');
    console.log('[SF Passkey BG] requestId:', request.requestId);
    console.log('[SF Passkey BG] rpId:', request.rpId);
    console.log('[SF Passkey BG] tabId (from sender):', tabId);

    chrome.storage.local.set({
      __sf_passkey_auth_request: {
        requestId: request.requestId,
        tabId: tabId,
        rpId: request.rpId,
        challenge: request.challenge,
        allowCredentials: request.allowCredentials,
        timestamp: Date.now()
      }
    }, () => {
      console.log('[SF Passkey BG] 已存储认证请求到 storage');
    });

    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#FF5722' });

    const openSidePanel = async () => {
      if (!tabId) {
        try {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tabs.length > 0) {
            tabId = tabs[0].id;
            console.log('[SF Passkey BG] 通过 tabs.query 获取 tabId:', tabId);
          }
        } catch (e) {
          console.error('[SF Passkey BG] tabs.query 失败:', e);
        }
      }

      if (tabId) {
        try {
          await chrome.sidePanel.open({ tabId: tabId });
          console.log('[SF Passkey BG] 已打开 Side Panel');
        } catch (e) {
          console.error('[SF Passkey BG] 打开 Side Panel 失败:', e);
          
          try {
            await chrome.action.openPopup();
            console.log('[SF Passkey BG] 降级到打开 popup');
          } catch (e2) {
            console.error('[SF Passkey BG] 打开 popup 也失败:', e2);
          }
        }
      } else {
        console.warn('[SF Passkey BG] 无法获取 tabId，无法打开 Side Panel');
      }
    };

    openSidePanel();

    sendResponse({ intercept: true });
    return true;
  }

  if (request.action === 'webauthnCreateIntercepted') {
    const tabId = sender.tab?.id;
    console.log('[SF Passkey BG] 收到注册请求');
    console.log('[SF Passkey BG] requestId:', request.requestId);
    console.log('[SF Passkey BG] rpId:', request.rpId);
    console.log('[SF Passkey BG] tabId:', tabId);

    chrome.storage.local.set({
      __sf_passkey_auth_request: {
        requestId: request.requestId,
        tabId: tabId,
        rpId: request.rpId,
        challenge: request.challenge,
        allowCredentials: [],
        type: 'create',
        timestamp: Date.now()
      }
    });

    chrome.action.setBadgeText({ text: '+' });
    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });

    if (tabId) {
      chrome.sidePanel.open({ tabId: tabId }).then(() => {
        console.log('[SF Passkey BG] 已打开 Side Panel（注册）');
      }).catch((e) => {
        console.error('[SF Passkey BG] 打开 Side Panel 失败:', e);
      });
    }

    sendResponse({ intercept: true });
    return true;
  }

  if (request.action === 'passkeyRegistered') {
    chrome.storage.local.set({
      __sf_passkey_pending_registration: {
        credentialId: request.credentialId,
        rpId: request.rpId,
        userHandle: request.userHandle,
        timestamp: Date.now()
      }
    });
    sendResponse({ success: true });
    return true;
  }

  // ========== 私钥存储和检索 ==========

  if (request.action === 'storePrivateKey') {
    console.log('[SF Passkey BG] 存储私钥，credentialId:', request.credentialId, 'envId:', request.envId);
    chrome.storage.local.get('__sf_passkey_credentials', (result) => {
      const credentials = result.__sf_passkey_credentials || [];
      credentials.push({
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
      });
      chrome.storage.local.set({ __sf_passkey_credentials: credentials }, () => {
        console.log('[SF Passkey BG] 私钥已存储，共', credentials.length, '个凭证');
        sendResponse({ success: true });
      });
    });
    return true;
  }

  if (request.action === 'getStoredCredentials') {
    console.log('[SF Passkey BG] 获取存储的凭证，rpId:', request.rpId);
    chrome.storage.local.get('__sf_passkey_credentials', (result) => {
      const allCredentials = result.__sf_passkey_credentials || [];
      const filtered = request.rpId
        ? allCredentials.filter(c => c.rpId === request.rpId)
        : allCredentials;
      console.log('[SF Passkey BG] 找到', filtered.length, '个匹配凭证');
      sendResponse({ credentials: filtered });
    });
    return true;
  }

  if (request.action === 'updateCredential') {
    console.log('[SF Passkey BG] 更新凭证，credentialId:', request.credential?.credentialId);
    chrome.storage.local.get('__sf_passkey_credentials', (result) => {
      const credentials = result.__sf_passkey_credentials || [];
      const index = credentials.findIndex(c => c.credentialId === request.credential?.credentialId);
      if (index !== -1) {
        credentials[index] = { ...credentials[index], ...request.credential };
        chrome.storage.local.set({ __sf_passkey_credentials: credentials }, () => {
          sendResponse({ success: true });
        });
      } else {
        sendResponse({ success: false, error: 'Credential not found' });
      }
    });
    return true;
  }

  if (request.action === 'selectPasskeyForAuth') {
    const { tabId, credential, requestId } = request;

    console.log('[SF Passkey BG] 收到 selectPasskeyForAuth，tabId:', tabId, 'requestId:', requestId, 'credential:', credential);

    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        action: 'passkeySelected',
        requestId: requestId,
        credential: credential
      }).then(() => {
        console.log('[SF Passkey BG] 已发送 passkeySelected 到 tab', tabId);
      }).catch((e) => {
        console.error('[SF Passkey BG] 发送 passkeySelected 到 tab 失败:', e);
      });
    }

    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'cancelPasskeySelection') {
    const { tabId, requestId } = request;

    console.log('[SF Passkey BG] 收到 cancelPasskeySelection，tabId:', tabId, 'requestId:', requestId);

    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        action: 'passkeySelectionCancelled',
        requestId: requestId
      }).then(() => {
        console.log('[SF Passkey BG] 已发送 passkeySelectionCancelled 到 tab', tabId);
      }).catch((e) => {
        console.error('[SF Passkey BG] 发送 passkeySelectionCancelled 到 tab 失败:', e);
      });
    }

    sendResponse({ success: true });
    return true;
  }

  // ========== Passkey 备份与恢复 ==========

  if (request.action === 'exportPasskeyBackup') {
    chrome.storage.local.get(['__sf_passkey_credentials', '__sf_environments'], (result) => {
      const backup = {
        version: 1,
        exportedAt: new Date().toISOString(),
        credentials: result.__sf_passkey_credentials || [],
        environments: result.__sf_environments || []
      };
      console.log('[SF Passkey BG] 导出备份，凭证数:', backup.credentials.length, '环境数:', backup.environments.length);
      sendResponse({ success: true, backup });
    });
    return true;
  }

  if (request.action === 'importPasskeyBackup') {
    const backup = request.backup;
    if (!backup || !Array.isArray(backup.credentials)) {
      sendResponse({ success: false, error: '备份文件格式无效' });
      return true;
    }

    chrome.storage.local.get(['__sf_passkey_credentials', '__sf_environments'], (result) => {
      const existingCreds = result.__sf_passkey_credentials || [];
      const existingEnvs = result.__sf_environments || [];

      // 按 credentialId 去重合并凭证
      const mergedCreds = [...existingCreds];
      let newCredCount = 0;
      for (const cred of backup.credentials) {
        if (!mergedCreds.find(c => c.credentialId === cred.credentialId)) {
          mergedCreds.push(cred);
          newCredCount++;
        }
      }

      // 按 id 去重合并环境
      const mergedEnvs = [...existingEnvs];
      let newEnvCount = 0;
      if (Array.isArray(backup.environments)) {
        for (const env of backup.environments) {
          if (!mergedEnvs.find(e => e.id === env.id)) {
            mergedEnvs.push(env);
            newEnvCount++;
          }
        }
      }

      chrome.storage.local.set({
        __sf_passkey_credentials: mergedCreds,
        __sf_environments: mergedEnvs
      }, () => {
        console.log('[SF Passkey BG] 导入备份完成，新增凭证:', newCredCount, '新增环境:', newEnvCount);
        sendResponse({
          success: true,
          imported: {
            credentials: newCredCount,
            environments: newEnvCount,
            totalCredentials: mergedCreds.length,
            totalEnvironments: mergedEnvs.length
          }
        });
      });
    });
    return true;
  }

  // 手动绑定单个凭证（粘贴完整 JSON 或从列表选择更新 envId）
  if (request.action === 'manualBindCredential') {
    const cred = request.credential;
    if (!cred || !cred.credentialId) {
      sendResponse({ success: false, error: '凭证数据不完整：需要 credentialId' });
      return true;
    }

    chrome.storage.local.get('__sf_passkey_credentials', (result) => {
      const existingCreds = result.__sf_passkey_credentials || [];
      const index = existingCreds.findIndex(c => c.credentialId === cred.credentialId);

      if (index !== -1) {
        // 凭证已存在，只更新 envId 和其他传入字段
        const existing = existingCreds[index];
        const updated = {
          ...existing,
          ...cred
        };
        // 确保 privateKeyJwk 不会被空值覆盖
        if (!cred.privateKeyJwk && existing.privateKeyJwk) {
          updated.privateKeyJwk = existing.privateKeyJwk;
        }
        if (!cred.publicKeyJwk && existing.publicKeyJwk) {
          updated.publicKeyJwk = existing.publicKeyJwk;
        }
        existingCreds[index] = updated;
        console.log('[SF Passkey BG] 手动绑定：更新已存在的凭证 envId:', cred.credentialId, '→', cred.envId);
      } else {
        // 凭证不存在，需要完整数据
        if (!cred.privateKeyJwk) {
          sendResponse({ success: false, error: '凭证数据不完整：新凭证需要 privateKeyJwk' });
          return;
        }
        const newCred = {
          credentialId: cred.credentialId,
          rpId: cred.rpId || 'salesforce.com',
          privateKeyJwk: cred.privateKeyJwk,
          publicKeyJwk: cred.publicKeyJwk || null,
          userId: cred.userId || '',
          userName: cred.userName || '',
          userDisplayName: cred.userDisplayName || '',
          envId: cred.envId || null,
          signCount: cred.signCount || 0,
          createdAt: cred.createdAt || Date.now()
        };
        existingCreds.push(newCred);
        console.log('[SF Passkey BG] 手动绑定：新增凭证', cred.credentialId);
      }

      chrome.storage.local.set({ __sf_passkey_credentials: existingCreds }, () => {
        sendResponse({
          success: true,
          total: existingCreds.length,
          action: index !== -1 ? 'updated' : 'added'
        });
      });
    });
    return true;
  }

  // 按 credentialId 导出单个凭证（控制台调试用）
  if (request.action === 'exportCredentialById') {
    const credId = request.credentialId;
    if (!credId) {
      sendResponse({ success: false, error: '缺少 credentialId' });
      return true;
    }
    chrome.storage.local.get('__sf_passkey_credentials', (result) => {
      const creds = result.__sf_passkey_credentials || [];
      const found = creds.find(c => c.credentialId === credId);
      if (found) {
        sendResponse({ success: true, credential: found });
      } else {
        sendResponse({ success: false, error: '未找到该 credentialId 对应的凭证' });
      }
    });
    return true;
  }

  // 列出所有凭证的 credentialId（用于在 UI 中选择绑定）
  if (request.action === 'listAllCredentials') {
    chrome.storage.local.get('__sf_passkey_credentials', (result) => {
      const creds = result.__sf_passkey_credentials || [];
      sendResponse({
        success: true,
        credentials: creds.map(c => ({
          credentialId: c.credentialId,
          rpId: c.rpId,
          userId: c.userId,
          userName: c.userName,
          envId: c.envId,
          createdAt: c.createdAt,
          hasPrivateKey: !!c.privateKeyJwk
        }))
      });
    });
    return true;
  }
});

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

    console.log('[handleLoginAction] 开始登录', { type: env.type, username: env.username, loginUrl });

    const tab = await chrome.tabs.create({ url: loginUrl });
    const tabId = tab.id;

    await waitForTabLoaded(tabId);
    console.log('[handleLoginAction] 登录页加载完成，注入隐藏表单');

    await chrome.scripting.executeScript({
      target: { tabId },
      func: submitHiddenForm,
      args: [loginUrl, env.username, env.password]
    });
    console.log('[handleLoginAction] 隐藏表单已提交');

    sendResponse({ success: true });
  } catch (error) {
    console.error('[handleLoginAction] 错误', error);
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

    console.log('[formPostLogin] 开始隐藏表单POST登录', { loginUrl, username, hasTotp: !!totpCode });

    const tab = await chrome.tabs.create({ url: loginUrl });
    const tabId = tab.id;

    await waitForTabLoaded(tabId);
    console.log('[formPostLogin] 登录页加载完成，注入隐藏表单');

    await chrome.scripting.executeScript({
      target: { tabId },
      func: submitHiddenForm,
      args: [loginUrl, username, password]
    });
    console.log('[formPostLogin] 隐藏表单已提交');

    if (totpCode) {
      console.log('[formPostLogin] 等待MFA页面加载，准备填入TOTP');
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
        console.log('[formPostLogin] TOTP填入指令已发送');
      } catch (e) {
        console.log('[formPostLogin] TOTP填入失败', e.message);
      }
    }

    sendResponse({ success: true });
  } catch (error) {
    console.error('[formPostLogin] 错误', error);
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
