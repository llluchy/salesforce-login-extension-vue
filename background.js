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
});

async function handleStartAreaQR(sendResponse) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      sendResponse({ success: false, error: '未找到活动标签页' });
      return;
    }

    const url = tab.url || '';
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('edge://') || url === '') {
      sendResponse({ success: false, error: '当前页面不支持截屏操作' });
      return;
    }

    const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' });

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
