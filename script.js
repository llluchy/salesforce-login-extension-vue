const STORAGE_KEY = 'salesforce_environments';
const SERVER_CONFIG_KEY = 'salesforce_server_config';
const MAX_ENVIRONMENTS = 50;

const TYPE_URLS = {
  production: 'https://login.salesforce.com',
  sandbox: 'https://test.salesforce.com',
  custom: ''
};

const TYPE_LABELS = {
  production: 'Production',
  sandbox: 'SandBox',
  custom: '自定义'
};

let environments = [];
let editingEnvId = null;
let deletingEnvId = null;
let serverConfig = {};

document.addEventListener('DOMContentLoaded', async () => {
  await loadEnvironments();
  await loadServerConfig();
  renderEnvList();
  updateCountDisplay();
  setupEventListeners();
});

async function loadEnvironments() {
  try {
    const result = await chrome.storage.sync.get(STORAGE_KEY);
    environments = result[STORAGE_KEY] || [];
  } catch (e) {
    console.error('Failed to load environments from sync:', e);
    try {
      const localResult = await chrome.storage.local.get(STORAGE_KEY);
      environments = localResult[STORAGE_KEY] || [];
    } catch (localErr) {
      environments = [];
    }
  }
}

async function saveEnvironments() {
  try {
    await chrome.storage.sync.set({ [STORAGE_KEY]: environments });
    await chrome.storage.local.set({ [STORAGE_KEY]: environments });
  } catch (e) {
    console.error('Failed to save environments:', e);
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: environments });
    } catch (localErr) {
      console.error('Failed to save to local:', localErr);
    }
  }
}

async function loadServerConfig() {
  try {
    const result = await chrome.storage.local.get(SERVER_CONFIG_KEY);
    serverConfig = result[SERVER_CONFIG_KEY] || {};
  } catch (e) {
    serverConfig = {};
  }
}

async function saveServerConfig() {
  try {
    await chrome.storage.local.set({ [SERVER_CONFIG_KEY]: serverConfig });
  } catch (e) {
    console.error('Failed to save server config:', e);
  }
}

function setupEventListeners() {
  document.getElementById('addEnvBtn').addEventListener('click', openAddModal);
  document.getElementById('syncBtn').addEventListener('click', handleSync);
  document.getElementById('serverConfigBtn').addEventListener('click', openServerConfigModal);

  const editEnvironmentSelect = document.getElementById('editEnvironment');
  editEnvironmentSelect.addEventListener('change', () => {
    const group = document.getElementById('editCustomEnvGroup');
    group.style.display = editEnvironmentSelect.value === 'custom' ? 'flex' : 'none';
  });

  document.getElementById('cancelEditBtn').addEventListener('click', closeModal);
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', closeModal);
  });
  document.getElementById('editModal').addEventListener('click', (e) => {
    if (e.target.id === 'editModal') closeModal();
  });
  document.getElementById('deleteModal').addEventListener('click', (e) => {
    if (e.target.id === 'deleteModal') closeDeleteModal();
  });
  document.getElementById('serverConfigModal').addEventListener('click', (e) => {
    if (e.target.id === 'serverConfigModal') closeServerConfigModal();
  });

  document.getElementById('saveEditBtn').addEventListener('click', handleSaveForm);
  document.getElementById('cancelDeleteBtn').addEventListener('click', closeDeleteModal);
  document.getElementById('confirmDeleteBtn').addEventListener('click', confirmDelete);
  document.getElementById('saveServerConfigBtn').addEventListener('click', saveServerConfigForm);
  document.getElementById('cancelServerConfigBtn').addEventListener('click', closeServerConfigModal);
  document.getElementById('uploadDataBtn').addEventListener('click', uploadDataToServer);
  document.getElementById('downloadDataBtn').addEventListener('click', downloadDataFromServer);

  document.getElementById('scanQRBtn').addEventListener('click', scanQRCode);
  document.getElementById('uploadQRBtn').addEventListener('click', () => {
    document.getElementById('qrFileInput').click();
  });
  document.getElementById('qrFileInput').addEventListener('change', handleQRUpload);
  document.getElementById('unbindTotpBtn').addEventListener('click', unbindTotp);

  document.getElementById('envList').addEventListener('click', (e) => {
    const btn = e.target.closest('.env-action-btn');
    if (btn) {
      const action = btn.dataset.action;
      const envId = btn.dataset.id;

      if (!action || !envId) return;

      switch (action) {
        case 'login':
          loginEnv(envId);
          break;
        case 'showCode':
          toggleTotpNote(envId);
          break;
        case 'edit':
          openEditModal(envId);
          break;
        case 'clone':
          cloneEnv(envId);
          break;
        case 'delete':
          deleteEnv(envId);
          break;
      }
      return;
    }

    const codeEl = e.target.closest('.totp-code');
    if (codeEl) {
      const envId = codeEl.dataset.codeDisplay;
      if (envId) copyTotpCode(envId);
    }
  });

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && changes[STORAGE_KEY]) {
      loadEnvironments().then(() => {
        renderEnvList();
        showToast('数据已同步');
      });
    }
  });
}

function handleSync() {
  const syncBtn = document.getElementById('syncBtn');
  syncBtn.classList.add('syncing');
  
  chrome.storage.sync.get(STORAGE_KEY).then(() => {
    syncBtn.classList.remove('syncing');
    showToast('同步完成');
  }).catch(() => {
    syncBtn.classList.remove('syncing');
    showToast('同步失败，请检查网络');
  });
}

function openAddModal() {
  if (environments.length >= MAX_ENVIRONMENTS) {
    showToast(`已达最大数量（${MAX_ENVIRONMENTS}条），请删除部分环境后再添加`);
    return;
  }

  editingEnvId = null;
  document.getElementById('modalTitle').textContent = '添加环境';
  document.getElementById('editAlias').value = '';
  document.getElementById('editUsername').value = '';
  document.getElementById('editPassword').value = '';
  document.getElementById('editEnvironment').value = 'production';
  document.getElementById('editCustomEnv').value = '';
  document.getElementById('editCustomEnvGroup').style.display = 'none';
  document.getElementById('editTotpSecret').value = '';
  updateMFAStatusUI(false);
  document.getElementById('editModal').classList.add('show');
}

function openEditModal(envId) {
  const env = environments.find(e => e.id === envId);
  if (!env) return;

  editingEnvId = envId;
  document.getElementById('modalTitle').textContent = '编辑环境';
  document.getElementById('editAlias').value = env.alias || '';
  document.getElementById('editUsername').value = env.username || '';
  document.getElementById('editPassword').value = env.password || '';
  document.getElementById('editEnvironment').value = env.type || 'production';
  document.getElementById('editCustomEnv').value = env.url || '';
  document.getElementById('editCustomEnvGroup').style.display = (env.type === 'custom') ? 'flex' : 'none';
  document.getElementById('editTotpSecret').value = env.totpSecret || '';
  updateMFAStatusUI(!!env.totpSecret);
  document.getElementById('editModal').classList.add('show');
}

function openServerConfigModal() {
  document.getElementById('serverUrl').value = serverConfig.url || '';
  document.getElementById('apiKey').value = serverConfig.apiKey || '';
  document.getElementById('serverConfigModal').classList.add('show');
}

function closeServerConfigModal() {
  document.getElementById('serverConfigModal').classList.remove('show');
}

function saveServerConfigForm() {
  const url = document.getElementById('serverUrl').value.trim();
  const apiKey = document.getElementById('apiKey').value.trim();

  serverConfig = { url, apiKey };
  saveServerConfig();
  closeServerConfigModal();
  showToast('服务器配置已保存');
}

async function uploadDataToServer() {
  if (!serverConfig.url || !serverConfig.apiKey) {
    showToast('请先配置服务器地址和API Key');
    return;
  }

  const btn = document.getElementById('uploadDataBtn');
  const originalText = btn.textContent;
  btn.textContent = '上传中...';
  btn.disabled = true;

  try {
    const response = await fetch(serverConfig.url + '/api/salesforce/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': serverConfig.apiKey
      },
      body: JSON.stringify({ data: environments })
    });

    if (response.ok) {
      showToast('数据上传成功');
    } else {
      showToast('上传失败');
    }
  } catch (e) {
    console.error('Upload failed:', e);
    showToast('上传失败，请检查网络');
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

async function downloadDataFromServer() {
  if (!serverConfig.url || !serverConfig.apiKey) {
    showToast('请先配置服务器地址和API Key');
    return;
  }

  const btn = document.getElementById('downloadDataBtn');
  const originalText = btn.textContent;
  btn.textContent = '下载中...';
  btn.disabled = true;

  try {
    const response = await fetch(serverConfig.url + '/api/salesforce/download', {
      method: 'GET',
      headers: {
        'X-API-Key': serverConfig.apiKey
      }
    });

    if (response.ok) {
      const result = await response.json();
      if (result.data && Array.isArray(result.data)) {
        environments = result.data;
        saveEnvironments();
        renderEnvList();
        showToast('数据下载成功');
      } else {
        showToast('服务器返回数据格式错误');
      }
    } else {
      showToast('下载失败');
    }
  } catch (e) {
    console.error('Download failed:', e);
    showToast('下载失败，请检查网络');
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

function handleSaveForm() {
  const alias = document.getElementById('editAlias').value.trim();
  const username = document.getElementById('editUsername').value.trim();
  const password = document.getElementById('editPassword').value;
  const type = document.getElementById('editEnvironment').value;
  const customEnv = document.getElementById('editCustomEnv').value.trim();
  const totpSecret = document.getElementById('editTotpSecret').value.trim().toUpperCase().replace(/[^A-Z2-7]/g, '');

  if (!alias) {
    showToast('请输入别名');
    return;
  }
  if (!username) {
    showToast('请输入账号');
    return;
  }
  if (!password) {
    showToast('请输入密码');
    return;
  }

  let url = TYPE_URLS[type] || '';
  if (type === 'custom') {
    if (!customEnv) {
      showToast('请输入自定义环境地址');
      return;
    }
    url = customEnv;
  }

  if (editingEnvId) {
    const index = environments.findIndex(e => e.id === editingEnvId);
    if (index !== -1) {
      environments[index] = {
        ...environments[index],
        alias,
        username,
        password,
        type,
        url,
        totpSecret: totpSecret || undefined
      };
      saveEnvironments();
      renderEnvList();
      closeModal();
      showToast('已更新');
    }
  } else {
    const newEnv = {
      id: 'env_' + Date.now(),
      alias,
      username,
      password,
      type,
      url,
      totpSecret: totpSecret || undefined
    };
    environments.push(newEnv);
    saveEnvironments();
    renderEnvList();
    updateCountDisplay();
    closeModal();
    showToast('已添加');
  }
}

function renderEnvList() {
  const envList = document.getElementById('envList');

  if (environments.length === 0) {
    envList.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="#ccc"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z"/></svg>
        <p>暂无已添加环境</p>
        <p class="empty-hint">点击右上角"+"添加</p>
      </div>
    `;
    return;
  }

  envList.innerHTML = environments.map(env => `
    <div class="env-wrapper" data-id="${env.id}">
      <div class="env-item" data-id="${env.id}">
        <div class="env-info">
          <div class="env-alias">${escapeHtml(env.alias)}</div>
          <div class="env-meta">
            <span class="env-type-tag ${env.type}">${TYPE_LABELS[env.type] || env.type}</span>
            <span class="env-username">${escapeHtml(env.username)}</span>
          </div>
        </div>
        <div class="env-actions">
          <button class="env-action-btn login" data-action="login" data-id="${env.id}" title="登录">
            <svg viewBox="0 0 24 24"><path d="M11 7L9.6 8.4l2.6 2.6H2v2h10.2l-2.6 2.6L11 17l5-5-5-5zm9 12h-8v2h8c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-8v2h8v14z"/></svg>
          </button>
          ${env.totpSecret ? `
          <button class="env-action-btn totp" data-action="showCode" data-id="${env.id}" title="显示验证码">
            <svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>
          </button>
          ` : ''}
          <button class="env-action-btn" data-action="edit" data-id="${env.id}" title="编辑">
            <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
          </button>
          <button class="env-action-btn" data-action="clone" data-id="${env.id}" title="克隆">
            <svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
          </button>
          <button class="env-action-btn" data-action="delete" data-id="${env.id}" title="删除">
            <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
        </div>
      </div>
      <div class="totp-note" data-totp-id="${env.id}" style="display: none;">
        <div class="totp-code" data-code-display="${env.id}">------</div>
        <div class="totp-timer">
          <div class="totp-timer-bar" data-timer-bar="${env.id}"></div>
        </div>
      </div>
    </div>
  `).join('');
}

async function loginEnv(envId) {
  const env = environments.find(e => e.id === envId);
  if (!env) return;

  if (!env.username || !env.password) {
    showToast('该环境缺少账号或密码，请先编辑');
    return;
  }

  showToast('登录中...');

  try {
    console.log('[loginEnv] 发送 soapLogin 请求', { type: env.type, url: env.url, username: env.username });
    const result = await chrome.runtime.sendMessage({
      action: 'soapLogin',
      type: env.type,
      url: env.url,
      username: env.username,
      password: env.password
    });
    console.log('[loginEnv] 收到 background 响应', result);

    if (!result || !result.success) {
      console.log('[loginEnv] 请求失败，回退到手动登录');
      fallbackToManualLogin(env, envId);
      return;
    }

    if (!result.ok) {
      console.log('[loginEnv] HTTP 状态非 OK，解析 SOAP 错误');
      const errorMsg = parseSOAPFault(result.xmlText);
      console.log('[loginEnv] 解析到错误信息', errorMsg);
      if (errorMsg.includes('MFA') || errorMsg.includes('Multi-Factor') || errorMsg.includes('multi-factor')) {
        showToast('MFA认证，请使用验证码登录');
        fallbackToManualLogin(env, envId);
      } else {
        showToast(errorMsg);
      }
      return;
    }

    console.log('[loginEnv] HTTP OK，开始解析 XML');
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(result.xmlText, 'text/xml');

    const sessionIdEl = xmlDoc.querySelector('sessionId');
    const serverUrlEl = xmlDoc.querySelector('serverUrl');
    console.log('[loginEnv] XML 解析结果', { sessionId: sessionIdEl?.textContent, serverUrl: serverUrlEl?.textContent });

    if (!sessionIdEl || !serverUrlEl) {
      showToast('登录响应解析失败');
      return;
    }

    const frontdoorUrl = buildFrontdoorUrl(serverUrlEl.textContent, sessionIdEl.textContent);
    console.log('[loginEnv] 拼接 frontdoor URL', frontdoorUrl);
    chrome.tabs.create({ url: frontdoorUrl });
    showToast('登录成功');

  } catch (error) {
    console.log('[loginEnv] catch 异常', error);
    fallbackToManualLogin(env, envId);
  }
}

function fallbackToManualLogin(env, envId) {
  const loginUrl = env.url || TYPE_URLS[env.type];
  chrome.tabs.create({ url: loginUrl });
  showToast('请手动登录');
  if (env.totpSecret) {
    showTotpNote(envId);
  }
}

function parseSOAPFault(xmlText) {
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
    const faultstring = xmlDoc.querySelector('faultstring');
    if (faultstring) {
      const msg = faultstring.textContent;
      if (msg.includes('MFA') || msg.includes('Multi-Factor') || msg.includes('multi-factor')) {
        return '账号启用了MFA，请使用手动登录';
      }
      if (msg.includes('Invalid username') || msg.includes('Invalid password')) {
        return '账号或密码错误';
      }
      return msg;
    }
  } catch (e) {
    console.log('[parseSOAPFault] 解析失败', e);
  }
  return '登录失败，请检查网络连接';
}

function buildFrontdoorUrl(serverUrl, sessionId) {
  const domainMatch = serverUrl.match(/https:\/\/[^/]+/);
  if (!domainMatch) {
    throw new Error('无法解析服务器地址');
  }
  const domain = domainMatch[0];
  return `${domain}/secur/frontdoor.jsp?sid=${sessionId}&retURL=%2Fhome%2Fhome.jsp`;
}

function cloneEnv(envId) {
  if (environments.length >= MAX_ENVIRONMENTS) {
    showToast(`已达最大数量（${MAX_ENVIRONMENTS}条），请删除部分环境后再克隆`);
    return;
  }

  const env = environments.find(e => e.id === envId);
  if (!env) return;

  const newEnv = {
    ...env,
    id: 'env_' + Date.now(),
    alias: env.alias + ' (副本)'
  };

  environments.push(newEnv);
  saveEnvironments();
  renderEnvList();
  updateCountDisplay();
  showToast('已克隆');
}

function deleteEnv(envId) {
  const env = environments.find(e => e.id === envId);
  if (!env) return;

  deletingEnvId = envId;
  document.getElementById('deleteEnvName').textContent = env.alias;
  document.getElementById('deleteModal').classList.add('show');
}

function closeDeleteModal() {
  document.getElementById('deleteModal').classList.remove('show');
  deletingEnvId = null;
}

function confirmDelete() {
  if (!deletingEnvId) return;

  environments = environments.filter(e => e.id !== deletingEnvId);
  saveEnvironments();
  renderEnvList();
  updateCountDisplay();
  closeDeleteModal();
  showToast('已删除');
}

function closeModal() {
  document.getElementById('editModal').classList.remove('show');
  editingEnvId = null;
}

function updateCountDisplay() {
  const countEl = document.getElementById('envCount');
  if (!countEl) return;

  const count = environments.length;
  countEl.textContent = `${count} / ${MAX_ENVIRONMENTS}`;

  countEl.classList.remove('count-warning', 'count-danger');
  if (count > 45) {
    countEl.classList.add('count-danger');
  } else if (count > 40) {
    countEl.classList.add('count-warning');
  }

  const addBtn = document.getElementById('addEnvBtn');
  if (addBtn) {
    addBtn.disabled = count >= MAX_ENVIRONMENTS;
  }
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 200);
  }, 2000);
}

function escapeHtml(text) {
  if (text == null) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function updateMFAStatusUI(isBound) {
  const statusEl = document.getElementById('mfaStatus');
  const unbindBtn = document.getElementById('unbindTotpBtn');
  if (!statusEl || !unbindBtn) return;

  if (isBound) {
    statusEl.textContent = '已绑定';
    statusEl.className = 'mfa-status bound';
    unbindBtn.style.display = 'inline-block';
  } else {
    statusEl.textContent = '未绑定';
    statusEl.className = 'mfa-status';
    unbindBtn.style.display = 'none';
  }
}

async function scanQRCode() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'startAreaQR' });
    if (!response || !response.success) {
      throw new Error(response?.error || '截屏失败');
    }
    const result = await parseQRCode(response.dataUrl);
    if (result) {
      document.getElementById('editTotpSecret').value = result;
      updateMFAStatusUI(true);
      showToast('二维码识别成功');
    } else {
      showToast('未识别到二维码，请重新框选或尝试上传图片');
    }
  } catch (e) {
    let msg = e.message;
    if (msg.includes('当前页面不支持')) {
      msg = '当前页面不支持截屏，请换页后重试或使用上传图片';
    } else if (msg.includes('user cancelled')) {
      msg = '已取消选择';
    } else {
      msg = '截屏失败，请尝试上传图片';
    }
    showToast(msg);
  }
}

async function handleQRUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    const result = await parseQRCode(e.target.result);
    if (result) {
      document.getElementById('editTotpSecret').value = result;
      updateMFAStatusUI(true);
      showToast('二维码识别成功');
    } else {
      showToast('未识别到二维码，请重试');
    }
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

async function parseQRCode(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, canvas.width, canvas.height);
      if (code && code.data) {
        const secret = TOTP.extractSecretFromURI(code.data);
        resolve(secret);
      } else {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function unbindTotp() {
  document.getElementById('editTotpSecret').value = '';
  updateMFAStatusUI(false);
  showToast('已解绑');
}

let totpTimer = null;
let currentTotpEnvId = null;

function toggleTotpNote(envId) {
  if (currentTotpEnvId === envId) {
    hideTotpNote();
    return;
  }
  if (currentTotpEnvId) {
    hideTotpNote();
  }
  showTotpNote(envId);
}

async function showTotpNote(envId) {
  const env = environments.find(e => e.id === envId);
  if (!env || !env.totpSecret) return;

  currentTotpEnvId = envId;
  const note = document.querySelector(`.totp-note[data-totp-id="${envId}"]`);
  if (note) note.style.display = 'flex';

  await refreshTotpDisplay();

  if (totpTimer) clearInterval(totpTimer);
  totpTimer = setInterval(refreshTotpDisplay, 1000);
}

function hideTotpNote() {
  if (!currentTotpEnvId) return;
  const note = document.querySelector(`.totp-note[data-totp-id="${currentTotpEnvId}"]`);
  if (note) note.style.display = 'none';
  currentTotpEnvId = null;
  if (totpTimer) {
    clearInterval(totpTimer);
    totpTimer = null;
  }
}

async function refreshTotpDisplay() {
  if (!currentTotpEnvId) return;

  const env = environments.find(e => e.id === currentTotpEnvId);
  if (!env || !env.totpSecret) {
    hideTotpNote();
    return;
  }

  try {
    const code = await TOTP.generate(env.totpSecret);
    const remaining = TOTP.getRemainingSeconds();
    const percentage = (remaining / 30) * 100;

    const codeEl = document.querySelector(`.totp-code[data-code-display="${currentTotpEnvId}"]`);
    const barEl = document.querySelector(`.totp-timer-bar[data-timer-bar="${currentTotpEnvId}"]`);
    if (codeEl) codeEl.textContent = code;
    if (barEl) barEl.style.width = percentage + '%';
  } catch (e) {
    console.error('TOTP generation failed:', e);
    const codeEl = document.querySelector(`.totp-code[data-code-display="${currentTotpEnvId}"]`);
    if (codeEl) codeEl.textContent = '------';
  }
}

async function copyTotpCode(envId) {
  const display = document.querySelector(`.totp-code[data-code-display="${envId}"]`);
  if (!display) return;
  const code = display.textContent;
  if (!code || code === '------') return;

  try {
    await navigator.clipboard.writeText(code);
    showToast('验证码已复制');
  } catch (e) {
    showToast('复制失败');
  }
}