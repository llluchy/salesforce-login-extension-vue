const STORAGE_KEY = 'salesforce_environments';
const STORAGE_KEY_GROUPS = 'salesforce_groups';
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
let groups = [];
let editingEnvId = null;
let deletingEnvId = null;
let editingGroupId = null;
let deletingGroupId = null;
let isSecondaryModal = false;

document.addEventListener('DOMContentLoaded', async () => {
  await loadGroups();
  await loadEnvironments();
  renderGroupedEnvList();
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

async function loadGroups() {
  try {
    const result = await chrome.storage.sync.get(STORAGE_KEY_GROUPS);
    groups = result[STORAGE_KEY_GROUPS] || [];
  } catch (e) {
    console.error('Failed to load groups from sync:', e);
    try {
      const localResult = await chrome.storage.local.get(STORAGE_KEY_GROUPS);
      groups = localResult[STORAGE_KEY_GROUPS] || [];
    } catch (localErr) {
      groups = [];
    }
  }
}

async function saveGroups() {
  try {
    await chrome.storage.sync.set({ [STORAGE_KEY_GROUPS]: groups });
    await chrome.storage.local.set({ [STORAGE_KEY_GROUPS]: groups });
  } catch (e) {
    console.error('Failed to save groups:', e);
    try {
      await chrome.storage.local.set({ [STORAGE_KEY_GROUPS]: groups });
    } catch (localErr) {
      console.error('Failed to save groups to local:', localErr);
    }
  }
}

function setupEventListeners() {
  document.getElementById('addEnvBtn').addEventListener('click', openAddModal);
  document.getElementById('addGroupBtn').addEventListener('click', () => openGroupModal(false));

  const editEnvironmentSelect = document.getElementById('editEnvironment');
  editEnvironmentSelect.addEventListener('change', () => {
    const group = document.getElementById('editCustomEnvGroup');
    group.style.display = editEnvironmentSelect.value === 'custom' ? 'flex' : 'none';
  });

  document.getElementById('cancelEditBtn').addEventListener('click', closeModal);
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', closeModal);
  });

  document.getElementById('saveEditBtn').addEventListener('click', handleSaveForm);
  document.getElementById('cancelDeleteBtn').addEventListener('click', closeDeleteModal);
  document.getElementById('confirmDeleteBtn').addEventListener('click', confirmDelete);

  document.getElementById('scanQRBtn').addEventListener('click', scanQRCode);
  document.getElementById('uploadQRBtn').addEventListener('click', () => {
    document.getElementById('qrFileInput').click();
  });
  document.getElementById('qrFileInput').addEventListener('change', handleQRUpload);
  document.getElementById('unbindTotpBtn').addEventListener('click', unbindTotp);

  document.getElementById('quickAddGroupBtn').addEventListener('click', () => openGroupModal(true));
  document.getElementById('cancelGroupBtn').addEventListener('click', closeGroupModal);
  document.querySelectorAll('#groupModal .modal-close').forEach(btn => {
    btn.addEventListener('click', closeGroupModal);
  });
  document.getElementById('saveGroupBtn').addEventListener('click', handleSaveGroup);

  document.getElementById('cancelDeleteGroupBtn').addEventListener('click', closeDeleteGroupModal);
  document.querySelectorAll('#deleteGroupModal .modal-close').forEach(btn => {
    btn.addEventListener('click', closeDeleteGroupModal);
  });
  document.getElementById('confirmDeleteGroupBtn').addEventListener('click', confirmDeleteGroup);

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

    const groupHeader = e.target.closest('.group-header');
    if (groupHeader && !e.target.closest('.group-action-btn')) {
      const groupId = groupHeader.dataset.groupId;
      toggleGroupCollapse(groupId);
      return;
    }

    const groupActionBtn = e.target.closest('.group-action-btn');
    if (groupActionBtn && groupActionBtn.dataset.action) {
      const action = groupActionBtn.dataset.action;
      const groupId = groupActionBtn.dataset.groupId;

      if (action === 'editGroup') {
        openEditGroupModal(groupId);
      } else if (action === 'deleteGroup') {
        openDeleteGroupModal(groupId);
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
        renderGroupedEnvList();
        showToast('数据已同步');
      });
    }
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
  refreshGroupSelect();
  document.getElementById('editGroup').value = '';
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
  refreshGroupSelect();
  document.getElementById('editGroup').value = env.groupId || '';
  updateMFAStatusUI(!!env.totpSecret);
  document.getElementById('editModal').classList.add('show');
}

function handleSaveForm() {
  const alias = document.getElementById('editAlias').value.trim();
  const username = document.getElementById('editUsername').value.trim();
  const password = document.getElementById('editPassword').value;
  const type = document.getElementById('editEnvironment').value;
  const customEnv = document.getElementById('editCustomEnv').value.trim();
  const totpSecret = document.getElementById('editTotpSecret').value.trim().toUpperCase().replace(/[^A-Z2-7]/g, '');
  const groupId = document.getElementById('editGroup').value || null;

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
        totpSecret: totpSecret || undefined,
        groupId
      };
      saveEnvironments();
      renderGroupedEnvList();
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
      totpSecret: totpSecret || undefined,
      groupId
    };
    environments.push(newEnv);
    saveEnvironments();
    renderGroupedEnvList();
    updateCountDisplay();
    closeModal();
    showToast('已添加');
  }
}

function renderGroupedEnvList() {
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

  const groupedEnvs = {};

  groupedEnvs[''] = environments.filter(e => !e.groupId);

  groups.forEach(g => {
    groupedEnvs[g.id] = environments.filter(e => e.groupId === g.id);
  });

  const orderedGroups = [
    { id: '', name: '未选择', isVirtual: true, collapsed: false },
    ...groups.sort((a, b) => a.order - b.order)
  ];

  envList.innerHTML = orderedGroups.map(group => `
    <div class="group-section ${group.collapsed ? 'collapsed' : ''}"
         data-group-id="${group.id}">
      <div class="group-header" data-group-id="${group.id}">
        <div class="group-title-wrapper">
          <svg class="group-collapse-icon" viewBox="0 0 24 24">
            <path d="M7 10l5 5 5-5z"/>
          </svg>
          <span class="group-name">${escapeHtml(group.name)}</span>
          <span class="group-count">${groupedEnvs[group.id]?.length || 0}</span>
        </div>
        ${!group.isVirtual ? `
        <div class="group-actions">
          <button class="group-action-btn group-drag-handle" draggable="true" data-group-id="${group.id}" title="拖拽排序">
            <svg viewBox="0 0 24 24"><path d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
          </button>
          <button class="group-action-btn" data-action="editGroup" data-group-id="${group.id}" title="编辑分组">
            <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
          </button>
          <button class="group-action-btn" data-action="deleteGroup" data-group-id="${group.id}" title="删除分组">
            <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
        </div>
        ` : ''}
      </div>
      <div class="group-content" data-group-content="${group.id}">
        ${(groupedEnvs[group.id] || []).map(env => renderEnvItem(env)).join('')}
        ${(groupedEnvs[group.id]?.length === 0) ? `
          <div class="empty-group-hint">该分组暂无环境</div>
        ` : ''}
      </div>
    </div>
  `).join('');

  setupDragListeners();
}

function renderEnvItem(env) {
  return `
    <div class="env-wrapper" data-id="${env.id}">
      <div class="env-item" data-id="${env.id}" data-group-id="${env.groupId || ''}">
        <div class="env-info">
          <div class="env-alias">${escapeHtml(env.alias)}</div>
          <div class="env-meta">
            <span class="env-type-tag ${env.type}">${TYPE_LABELS[env.type] || env.type}</span>
            <span class="env-username">${escapeHtml(env.username)}</span>
          </div>
        </div>
        <div class="env-actions">
          <button class="env-action-btn env-drag-handle" draggable="true" data-id="${env.id}" title="拖拽排序">
            <svg viewBox="0 0 24 24"><path d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
          </button>
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
  `;
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
    console.log('[loginEnv] 方式1: SOAP API 登录', { type: env.type, url: env.url, username: env.username });
    const soapResult = await chrome.runtime.sendMessage({
      action: 'soapLogin',
      type: env.type,
      url: env.url,
      username: env.username,
      password: env.password
    });
    console.log('[loginEnv] SOAP 响应', soapResult);

    if (soapResult && soapResult.success && soapResult.ok) {
      console.log('[loginEnv] SOAP 登录成功，解析 XML');
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(soapResult.xmlText, 'text/xml');

      const sessionIdEl = xmlDoc.querySelector('sessionId');
      const serverUrlEl = xmlDoc.querySelector('serverUrl');
      console.log('[loginEnv] XML 解析', { sessionId: sessionIdEl?.textContent, serverUrl: serverUrlEl?.textContent });

      if (sessionIdEl && serverUrlEl) {
        const frontdoorUrl = buildFrontdoorUrl(serverUrlEl.textContent, sessionIdEl.textContent);
        console.log('[loginEnv] frontdoor URL', frontdoorUrl);
        chrome.tabs.create({ url: frontdoorUrl });
        showToast('登录成功');
        return;
      }
    }

    console.log('[loginEnv] SOAP 失败，切换方式2: 隐藏表单POST');
    await formPostLogin(env, envId);

  } catch (error) {
    console.log('[loginEnv] 异常，切换隐藏表单POST', error);
    await formPostLogin(env, envId);
  }
}

async function formPostLogin(env, envId) {
  const loginUrl = env.url || TYPE_URLS[env.type];
  let totpCode = null;

  if (env.totpSecret) {
    try {
      totpCode = await TOTP.generate(env.totpSecret);
    } catch (e) {
      console.log('[formPostLogin] TOTP 生成失败', e);
    }
  }

  try {
    await chrome.runtime.sendMessage({
      action: 'formPostLogin',
      loginUrl,
      username: env.username,
      password: env.password,
      totpCode
    });
    showToast('登录中');
    if (env.totpSecret) {
      showTotpNote(envId);
    }
  } catch (error) {
    chrome.tabs.create({ url: loginUrl });
    showToast('请手动登录');
    if (env.totpSecret) {
      showTotpNote(envId);
    }
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

// ========== 分组管理功能 ==========

function openGroupModal(isSecondary = false) {
  isSecondaryModal = isSecondary;
  editingGroupId = null;
  document.getElementById('groupModalTitle').textContent = '创建分组';
  document.getElementById('groupName').value = '';

  if (isSecondary) {
    document.getElementById('editModal').style.zIndex = '100';
    document.getElementById('groupModal').style.zIndex = '150';
  }

  document.getElementById('groupModal').classList.add('show');
}

function closeGroupModal() {
  document.getElementById('groupModal').classList.remove('show');
  editingGroupId = null;

  if (isSecondaryModal) {
    isSecondaryModal = false;
    refreshGroupSelect();
    document.getElementById('editModal').style.zIndex = '100';
  }
}

function handleSaveGroup() {
  const name = document.getElementById('groupName').value.trim();

  if (!name) {
    showToast('请输入分组名称');
    return;
  }

  if (editingGroupId) {
    const group = groups.find(g => g.id === editingGroupId);
    if (!group) return;

    if (groups.some(g => g.id !== editingGroupId && g.name === name)) {
      showToast('分组名称已存在');
      return;
    }

    group.name = name;
    saveGroups();
    closeGroupModal();
    renderGroupedEnvList();
    showToast('分组已更新');
  } else {
    if (groups.some(g => g.name === name)) {
      showToast('分组名称已存在');
      return;
    }

    const newGroup = {
      id: 'group_' + Date.now(),
      name,
      order: groups.length,
      collapsed: false
    };

    groups.push(newGroup);
    saveGroups();
    closeGroupModal();

    if (!isSecondaryModal) {
      renderGroupedEnvList();
    }

    showToast('分组已创建');
  }
}

function refreshGroupSelect() {
  const select = document.getElementById('editGroup');
  const currentValue = select.value;

  select.innerHTML = `
    <option value="">未选择</option>
    ${groups.map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('')}
  `;

  if (groups.some(g => g.id === currentValue)) {
    select.value = currentValue;
  } else {
    select.value = '';
  }
}

function openEditGroupModal(groupId) {
  const group = groups.find(g => g.id === groupId);
  if (!group) return;

  editingGroupId = groupId;
  document.getElementById('groupModalTitle').textContent = '编辑分组';
  document.getElementById('groupName').value = group.name;
  document.getElementById('groupModal').classList.add('show');
}

function openDeleteGroupModal(groupId) {
  const group = groups.find(g => g.id === groupId);
  if (!group) return;

  deletingGroupId = groupId;
  document.getElementById('deleteGroupName').textContent = group.name;
  document.getElementById('deleteGroupModal').classList.add('show');
}

function closeDeleteGroupModal() {
  document.getElementById('deleteGroupModal').classList.remove('show');
  deletingGroupId = null;
}

function confirmDeleteGroup() {
  if (!deletingGroupId) return;

  environments.forEach(env => {
    if (env.groupId === deletingGroupId) {
      env.groupId = null;
    }
  });

  groups = groups.filter(g => g.id !== deletingGroupId);

  groups.sort((a, b) => a.order - b.order);
  groups.forEach((g, i) => g.order = i);

  saveGroups();
  saveEnvironments();
  closeDeleteGroupModal();
  renderGroupedEnvList();
  showToast('分组已删除');
}

function toggleGroupCollapse(groupId) {
  if (groupId === '') return;

  const group = groups.find(g => g.id === groupId);
  if (!group) return;

  group.collapsed = !group.collapsed;
  saveGroups();

  const section = document.querySelector(`.group-section[data-group-id="${groupId}"]`);
  if (section) {
    section.classList.toggle('collapsed', group.collapsed);
  }
}

// ========== 拖拽功能 ==========

let draggedEnvId = null;
let draggedEnvGroupId = null;
let placeholderElement = null;
let draggedGroupId = null;
let currentDropPosition = null;
let groupPlaceholderElement = null;
let expandedGroups = [];

function setupDragListeners() {
  console.log('[DRAG] setupDragListeners called');
  
  const envList = document.getElementById('envList');
  if (envList) {
    envList.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
  }

  const envDragHandles = document.querySelectorAll('.env-drag-handle[draggable="true"]');
  console.log('[DRAG] Found', envDragHandles.length, 'env-drag-handle elements');
  envDragHandles.forEach((handle, i) => {
    console.log('[DRAG] Env handle', i, ':', handle.dataset.id, 'parent:', handle.closest('.env-wrapper')?.dataset.id);
    handle.addEventListener('dragstart', handleEnvDragStart);
    handle.addEventListener('dragend', handleEnvDragEnd);
  });

  const envWrappers = document.querySelectorAll('.env-wrapper');
  console.log('[DRAG] Found', envWrappers.length, 'env-wrapper elements');
  envWrappers.forEach(wrapper => {
    wrapper.addEventListener('dragover', handleEnvDragOver);
    wrapper.addEventListener('drop', handleEnvDrop);
  });

  const groupHeaders = document.querySelectorAll('.group-header');
  console.log('[DRAG] Found', groupHeaders.length, 'group-header elements');
  groupHeaders.forEach(header => {
    header.addEventListener('dragover', handleEnvDragOver);
    header.addEventListener('drop', handleEnvDrop);
  });

  const groupContents = document.querySelectorAll('.group-content');
  console.log('[DRAG] Found', groupContents.length, 'group-content elements');
  groupContents.forEach(content => {
    content.addEventListener('dragover', handleEnvDragOver);
    content.addEventListener('drop', handleEnvDrop);
  });

  const groupDragHandles = document.querySelectorAll('.group-drag-handle[draggable="true"]');
  console.log('[DRAG] Found', groupDragHandles.length, 'group-drag-handle elements');
  groupDragHandles.forEach((handle, i) => {
    console.log('[DRAG] Group handle', i, ':', handle.dataset.groupId, 'parent:', handle.closest('.group-section')?.dataset.groupId);
    handle.addEventListener('dragstart', handleGroupDragStart);
    handle.addEventListener('dragend', handleGroupDragEnd);
  });

  const groupSections = document.querySelectorAll('.group-section');
  console.log('[DRAG] Found', groupSections.length, 'group-section elements');
  groupSections.forEach(section => {
    section.addEventListener('dragover', handleGroupDragOver);
    section.addEventListener('drop', handleGroupDrop);
  });
}

function handleEnvDragStart(e) {
  e.stopPropagation();
  console.log('[DRAG] handleEnvDragStart called');
  console.log('[DRAG]   e.target:', e.target.tagName, e.target.className);
  console.log('[DRAG]   e.currentTarget:', e.currentTarget.tagName, e.currentTarget.className);

  const handle = e.currentTarget;
  draggedEnvId = handle.dataset.id;
  console.log('[DRAG]   handle.dataset.id:', draggedEnvId);

  const wrapper = handle.closest('.env-wrapper');
  console.log('[DRAG]   wrapper found:', !!wrapper, 'wrapper.dataset.id:', wrapper?.dataset.id);
  if (!wrapper) {
    console.log('[DRAG]   ERROR: wrapper not found!');
    return;
  }

  const envItem = wrapper.querySelector('.env-item');
  draggedEnvGroupId = envItem ? envItem.dataset.groupId || '' : '';
  console.log('[DRAG]   draggedEnvGroupId:', draggedEnvGroupId);

  wrapper.classList.add('dragging');
  handle.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', draggedEnvId);

  placeholderElement = document.createElement('div');
  placeholderElement.className = 'drag-placeholder';
  placeholderElement.textContent = '拖拽到此处';

  document.querySelectorAll('.group-content').forEach(c => c.classList.add('drag-active'));

  const envList = document.getElementById('envList');
  if (envList) envList.classList.add('drag-active');
  
  console.log('[DRAG] handleEnvDragStart completed successfully');
}

function handleEnvDragEnd(e) {
  e.stopPropagation();
  console.log('[DRAG] handleEnvDragEnd called');

  const handle = e.currentTarget;
  handle.classList.remove('dragging');

  const wrapper = handle.closest('.env-wrapper');
  if (wrapper) wrapper.classList.remove('dragging');

  if (placeholderElement && placeholderElement.parentNode) {
    placeholderElement.parentNode.removeChild(placeholderElement);
  }

  placeholderElement = null;
  draggedEnvId = null;
  draggedEnvGroupId = null;
  currentDropPosition = null;

  document.querySelectorAll('.group-content').forEach(c => c.classList.remove('drag-active'));

  const envList = document.getElementById('envList');
  if (envList) envList.classList.remove('drag-active');
  
  console.log('[DRAG] handleEnvDragEnd completed');
}

function handleEnvDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  
  console.log('[DRAG] handleEnvDragOver called');
  console.log('[DRAG]   e.target:', e.target.tagName, e.target.className);

  if (!placeholderElement) {
    console.log('[DRAG]   placeholderElement is null, skipping');
    return;
  }

  const targetWrapper = e.target.closest('.env-wrapper');
  const groupHeader = e.target.closest('.group-header');
  const groupContent = e.target.closest('.group-content');

  console.log('[DRAG]   targetWrapper:', targetWrapper?.dataset.id);
  console.log('[DRAG]   groupHeader:', groupHeader?.dataset.groupId);
  console.log('[DRAG]   groupContent:', groupContent?.dataset.groupContent);

  if (e.target === placeholderElement || placeholderElement.contains(e.target)) {
    console.log('[DRAG]   over placeholder, skipping');
    return;
  }

  let newPosition = null;

  if (targetWrapper && targetWrapper.dataset.id !== draggedEnvId) {
    const rect = targetWrapper.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const side = e.clientY < midY ? 'before' : 'after';
    newPosition = { type: side, refId: targetWrapper.dataset.id };
    console.log('[DRAG]   newPosition:', JSON.stringify(newPosition));
  } else if (groupHeader) {
    newPosition = { type: 'append', refId: 'group_' + groupHeader.dataset.groupId };
    console.log('[DRAG]   newPosition (groupHeader):', JSON.stringify(newPosition));
  } else if (groupContent) {
    newPosition = { type: 'append', refId: 'group_' + groupContent.dataset.groupContent };
    console.log('[DRAG]   newPosition (groupContent):', JSON.stringify(newPosition));
  } else {
    console.log('[DRAG]   no valid target found');
  }

  if (positionsEqual(currentDropPosition, newPosition)) {
    console.log('[DRAG]   position unchanged, skipping');
    return;
  }
  currentDropPosition = newPosition;

  if (placeholderElement.parentNode) {
    placeholderElement.parentNode.removeChild(placeholderElement);
  }

  if (targetWrapper && targetWrapper.dataset.id !== draggedEnvId) {
    const parentNode = targetWrapper.parentNode;
    if (!parentNode) {
      console.log('[DRAG]   ERROR: parentNode is null');
      return;
    }

    const rect = targetWrapper.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;

    if (e.clientY < midY) {
      parentNode.insertBefore(placeholderElement, targetWrapper);
      console.log('[DRAG]   inserted before:', targetWrapper.dataset.id);
    } else {
      parentNode.insertBefore(placeholderElement, targetWrapper.nextSibling);
      console.log('[DRAG]   inserted after:', targetWrapper.dataset.id);
    }
  } else if (groupHeader) {
    const groupId = groupHeader.dataset.groupId;
    const content = document.querySelector(`.group-content[data-group-content="${groupId}"]`);
    if (content) {
      content.appendChild(placeholderElement);
      console.log('[DRAG]   appended to group:', groupId);
    } else {
      console.log('[DRAG]   ERROR: group-content not found for:', groupId);
    }
  } else if (groupContent) {
    groupContent.appendChild(placeholderElement);
    console.log('[DRAG]   appended to group-content:', groupContent.dataset.groupContent);
  }
}

function positionsEqual(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.type === b.type && a.refId === b.refId;
}

function handleEnvDrop(e) {
  e.preventDefault();
  console.log('[DRAG] handleEnvDrop called');
  console.log('[DRAG]   draggedEnvId:', draggedEnvId);

  if (!draggedEnvId) {
    console.log('[DRAG]   ERROR: draggedEnvId is null');
    return;
  }

  const targetWrapper = e.target.closest('.env-wrapper');
  const groupHeader = e.target.closest('.group-header');
  const groupContent = e.target.closest('.group-content');

  console.log('[DRAG]   targetWrapper:', targetWrapper?.dataset.id);
  console.log('[DRAG]   groupHeader:', groupHeader?.dataset.groupId);
  console.log('[DRAG]   groupContent:', groupContent?.dataset.groupContent);

  let targetGroupId = null;

  // 确定目标分组 ID
  if (groupContent) {
    targetGroupId = groupContent.dataset.groupContent || null;
    console.log('[DRAG]   targetGroupId from groupContent:', targetGroupId);
  } else if (groupHeader) {
    targetGroupId = groupHeader.dataset.groupId || null;
    console.log('[DRAG]   targetGroupId from groupHeader:', targetGroupId);
  } else if (targetWrapper) {
    // 从目标环境卡片获取分组 ID
    const parentContent = targetWrapper.closest('.group-content');
    targetGroupId = parentContent?.dataset.groupContent || null;
    console.log('[DRAG]   targetGroupId from targetWrapper:', targetGroupId);
  }

  // 更新环境的 groupId
  const envIndex = environments.findIndex(env => env.id === draggedEnvId);
  console.log('[DRAG]   envIndex:', envIndex);
  if (envIndex !== -1) {
    environments[envIndex].groupId = targetGroupId;
    console.log('[DRAG]   updated groupId to:', targetGroupId);
  }

  // 重新排序环境数组
  reorderAllEnvironments();

  saveEnvironments();
  renderGroupedEnvList();
  
  console.log('[DRAG] handleEnvDrop completed');
}

function reorderAllEnvironments() {
  // 遍历所有分组内容区域，按 DOM 顺序重排环境
  const allGroupContents = document.querySelectorAll('.group-content');
  const reorderedEnvs = [];

  allGroupContents.forEach(content => {
    const envWrappers = content.querySelectorAll('.env-wrapper');
    envWrappers.forEach(wrapper => {
      const envId = wrapper.dataset.id;
      const env = environments.find(e => e.id === envId);
      if (env) {
        reorderedEnvs.push(env);
      }
    });
  });

  if (reorderedEnvs.length === environments.length) {
    environments = reorderedEnvs;
  }
}

function handleGroupDragStart(e) {
  if (e.target.closest('.env-wrapper')) {
    console.log('[DRAG] handleGroupDragStart skipped - inside env-wrapper');
    return;
  }

  e.stopPropagation();
  console.log('[DRAG] handleGroupDragStart called');
  console.log('[DRAG]   e.target:', e.target.tagName, e.target.className);
  console.log('[DRAG]   e.currentTarget:', e.currentTarget.tagName, e.currentTarget.className);

  const handle = e.currentTarget;
  draggedGroupId = handle.dataset.groupId;
  console.log('[DRAG]   draggedGroupId:', draggedGroupId);
  if (!draggedGroupId) {
    console.log('[DRAG]   ERROR: draggedGroupId is null');
    return;
  }

  const section = handle.closest('.group-section');
  console.log('[DRAG]   section found:', !!section, 'section.dataset.groupId:', section?.dataset.groupId);
  if (!section) {
    console.log('[DRAG]   ERROR: section not found!');
    return;
  }

  section.classList.add('dragging');
  handle.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', 'group:' + draggedGroupId);

  expandedGroups = [];
  document.querySelectorAll('.group-section').forEach(s => {
    if (!s.classList.contains('collapsed')) {
      expandedGroups.push(s.dataset.groupId);
    }
    s.classList.add('collapsed');
  });

  groupPlaceholderElement = document.createElement('div');
  groupPlaceholderElement.className = 'group-drag-placeholder';

  const envList = document.getElementById('envList');
  if (envList) envList.classList.add('drag-active');
  
  console.log('[DRAG] handleGroupDragStart completed successfully');
}

function handleGroupDragEnd(e) {
  console.log('[DRAG] handleGroupDragEnd called');

  const handle = e.currentTarget;
  handle.classList.remove('dragging');

  const section = handle.closest('.group-section');
  if (section) {
    section.classList.remove('dragging');
  }
  draggedGroupId = null;

  if (groupPlaceholderElement && groupPlaceholderElement.parentNode) {
    groupPlaceholderElement.parentNode.removeChild(groupPlaceholderElement);
  }
  groupPlaceholderElement = null;

  document.querySelectorAll('.group-section').forEach(s => {
    if (expandedGroups.includes(s.dataset.groupId)) {
      s.classList.remove('collapsed');
    }
  });
  expandedGroups = [];

  const envList = document.getElementById('envList');
  if (envList) envList.classList.remove('drag-active');
  
  console.log('[DRAG] handleGroupDragEnd completed');
}

function handleGroupDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  
  console.log('[DRAG] handleGroupDragOver called');
  console.log('[DRAG]   e.target:', e.target.tagName, e.target.className);

  if (!draggedGroupId) {
    console.log('[DRAG]   draggedGroupId is null, skipping');
    return;
  }
  console.log('[DRAG]   draggedGroupId:', draggedGroupId);

  if (e.target.closest('.env-wrapper')) {
    console.log('[DRAG]   over env-wrapper, skipping');
    return;
  }

  const targetSection = e.target.closest('.group-section');
  console.log('[DRAG]   targetSection:', targetSection?.dataset.groupId);
  if (!targetSection || !targetSection.dataset.groupId || targetSection.dataset.groupId === draggedGroupId) {
    console.log('[DRAG]   invalid targetSection');
    return;
  }

  document.querySelectorAll('.group-header').forEach(h => h.classList.remove('drag-over'));

  if (groupPlaceholderElement && groupPlaceholderElement.parentNode) {
    groupPlaceholderElement.parentNode.removeChild(groupPlaceholderElement);
  }

  const envList = document.getElementById('envList');
  if (envList) {
    const rect = targetSection.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;

    if (e.clientY < midY) {
      envList.insertBefore(groupPlaceholderElement, targetSection);
    } else {
      envList.insertBefore(groupPlaceholderElement, targetSection.nextSibling);
    }
  }

  const targetHeader = targetSection.querySelector('.group-header');
  if (targetHeader) {
    targetHeader.classList.add('drag-over');
  }
}

function handleGroupDrop(e) {
  e.preventDefault();
  console.log('[DRAG] handleGroupDrop called');
  console.log('[DRAG]   draggedGroupId:', draggedGroupId);

  if (!draggedGroupId) {
    console.log('[DRAG]   ERROR: draggedGroupId is null');
    return;
  }

  const targetSection = e.target.closest('.group-section');
  console.log('[DRAG]   targetSection:', targetSection?.dataset.groupId);
  if (!targetSection || !targetSection.dataset.groupId || targetSection.dataset.groupId === draggedGroupId) {
    console.log('[DRAG]   invalid targetSection');
    return;
  }

  const targetGroupId = targetSection.dataset.groupId;
  console.log('[DRAG]   targetGroupId:', targetGroupId);

  const draggedGroup = groups.find(g => g.id === draggedGroupId);
  const targetGroup = groups.find(g => g.id === targetGroupId);

  console.log('[DRAG]   draggedGroup:', draggedGroup?.name);
  console.log('[DRAG]   targetGroup:', targetGroup?.name);

  if (!draggedGroup || !targetGroup) {
    console.log('[DRAG]   ERROR: draggedGroup or targetGroup not found');
    return;
  }

  const draggedOrder = draggedGroup.order;
  const targetOrder = targetGroup.order;

  if (draggedOrder < targetOrder) {
    groups.forEach(g => {
      if (g.order > draggedOrder && g.order <= targetOrder) {
        g.order--;
      }
    });
    draggedGroup.order = targetOrder;
  } else {
    groups.forEach(g => {
      if (g.order >= targetOrder && g.order < draggedOrder) {
        g.order++;
      }
    });
    draggedGroup.order = targetOrder;
  }

  saveGroups();
  renderGroupedEnvList();
}