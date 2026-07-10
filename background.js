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
