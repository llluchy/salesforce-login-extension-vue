let environments = [];
let activeEnvId = null;
let logs = [];
let selectedLog = null;
let isPolling = false;
let readLogIds = new Set();
let elements = {};
let activeAppFilter = '';
let activeStatusFilter = '';
let activeUserFilter = 'current';
let currentUserName = null;
let logLineCache = [];

// Search related state
let searchState = {
  isSearching: false,
  isSearchActive: false,
  searchQuery: '',
  searchResults: [],
  searchAbortController: null,
  logSnapshots: {} // 存储日志快照 { logId: { log: {...}, body: "..." } }
};

// Status constants
const SUCCESS_STATUSES = ['Success', '成功', '成功', '成功'];

// Smart polling variables
const ACTIVE_INTERVAL = 3000; // 3 seconds when active
const INACTIVE_INTERVAL = 120000; // 2 minutes when inactive
const INACTIVITY_TIMEOUT = 300000; // 5 minutes before switching to slow polling

let currentPollingInterval = ACTIVE_INTERVAL;
let lastActivityTime = Date.now();
let activityTimerInterval = null;
let pollingProgressInterval = null;
let pollingProgress = 100;

// TraceFlag renewal variables
let traceFlagRenewalInterval = null;
let processAutomatedRenewalInterval = null;

// Settings state
let settings = {
  autoRenewCurrentUser: true,
  renewIntervalCurrentUser: 50,
  autoStartProcessAutomated: false,
  autoRenewProcessAutomated: false,
  renewIntervalProcessAutomated: 50
};

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const icons = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="toast-icon"><polyline points="20 6 9 17 4 12"></polyline></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="toast-icon"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="toast-icon"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>'
  };

  toast.innerHTML = `${icons[type] || icons.success}${message}`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease-out';
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 2000);
}

function toggleTheme() {
  const isDark = document.body.classList.toggle('dark');
  saveTheme(isDark);
  showToast(isDark ? '已切换到深色模式' : '已切换到浅色模式', 'info');
}

function saveTheme(isDark) {
  try {
    localStorage.setItem('salesforce-log-viewer-theme', isDark ? 'dark' : 'light');
  } catch (e) {
    console.warn('Failed to save theme preference:', e);
  }
}

function loadTheme() {
  try {
    const savedTheme = localStorage.getItem('salesforce-log-viewer-theme');
    const isDark = savedTheme === 'dark';
    if (isDark) {
      document.body.classList.add('dark');
    }
  } catch (e) {
    console.warn('Failed to load theme preference:', e);
  }
}

// Settings functions
function loadSettings() {
  try {
    const saved = localStorage.getItem('salesforce-log-viewer-settings');
    if (saved) {
      settings = { ...settings, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.warn('Failed to load settings:', e);
  }
}

function saveSettings() {
  try {
    localStorage.setItem('salesforce-log-viewer-settings', JSON.stringify(settings));
  } catch (e) {
    console.warn('Failed to save settings:', e);
  }
}

function openSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (modal) {
    // 填充当前设置值
    document.getElementById('settingAutoRenewCurrentUser').checked = settings.autoRenewCurrentUser;
    document.getElementById('settingRenewIntervalCurrentUser').value = settings.renewIntervalCurrentUser;
    document.getElementById('settingAutoStartProcessAutomated').checked = settings.autoStartProcessAutomated;
    document.getElementById('settingAutoRenewProcessAutomated').checked = settings.autoRenewProcessAutomated;
    document.getElementById('settingRenewIntervalProcessAutomated').value = settings.renewIntervalProcessAutomated;
    
    modal.style.display = 'flex';
  }
}

function closeSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

function saveSettingsFromModal() {
  settings.autoRenewCurrentUser = document.getElementById('settingAutoRenewCurrentUser').checked;
  settings.renewIntervalCurrentUser = Math.max(1, Math.min(60, parseInt(document.getElementById('settingRenewIntervalCurrentUser').value) || 50));
  settings.autoStartProcessAutomated = document.getElementById('settingAutoStartProcessAutomated').checked;
  settings.autoRenewProcessAutomated = document.getElementById('settingAutoRenewProcessAutomated').checked;
  settings.renewIntervalProcessAutomated = Math.max(1, Math.min(60, parseInt(document.getElementById('settingRenewIntervalProcessAutomated').value) || 50));
  
  saveSettings();
  closeSettingsModal();
  showToast('设置已保存', 'success');
  
  // 重启续期定时器以应用新设置
  restartTraceFlagRenewal();
  if (settings.autoStartProcessAutomated || settings.autoRenewProcessAutomated) {
    restartProcessAutomatedRenewal();
  }
}

function restartTraceFlagRenewal() {
  stopTraceFlagRenewal();
  if (settings.autoRenewCurrentUser) {
    startTraceFlagRenewal();
  }
}

function restartProcessAutomatedRenewal() {
  stopProcessAutomatedRenewal();
  if (settings.autoRenewProcessAutomated) {
    startProcessAutomatedRenewal();
  }
}

document.addEventListener('DOMContentLoaded', init);

function init() {
  loadTheme();
  loadSettings();
  initElements();
  setupEventListeners();
  initSearchUI();
  loadState();
}

function initElements() {
  elements = {
    envSelector: document.getElementById('envSelector'),
    refreshBtn: document.getElementById('refreshBtn'),
    welcomeView: document.getElementById('welcomeView'),
    mainView: document.getElementById('mainView'),
    logsList: document.getElementById('logsList'),
    loadingState: document.getElementById('loadingState'),
    emptyState: document.getElementById('emptyState'),
    logMeta: document.getElementById('detailMeta'),
    logBody: document.getElementById('logBody'),
    detailEmpty: document.getElementById('detailEmpty'),
    detailContent: document.getElementById('detailContent'),
    downloadBtn: document.getElementById('downloadBtn'),
    markAllReadBtn: document.getElementById('markAllReadBtn'),
    filterButtons: document.getElementById('filterButtons'),
    statusFilterButtons: document.getElementById('statusFilterButtons'),
    userFilterButtons: document.getElementById('userFilterButtons'),
    userName: document.getElementById('userName'),
    activityTimer: document.getElementById('activityTimer'),
    activityTimerValue: document.getElementById('activityTimerValue'),
    pollingBar: document.getElementById('pollingBar'),
    pollingInterval: document.getElementById('pollingInterval'),
    themeToggle: document.getElementById('themeToggle'),
    loadingOverlay: document.getElementById('loadingOverlay'),
    // Activity bar elements
    activityLogBtn: document.getElementById('activityLogBtn'),
    activitySearchBtn: document.getElementById('activitySearchBtn'),
    logView: document.getElementById('logView'),
    searchView: document.getElementById('searchView'),
    // Search related elements
    searchInput: document.getElementById('searchInput'),
    searchBtn: document.getElementById('searchBtn'),
    clearSearchBtn: document.getElementById('clearSearchBtn'),
    searchLoadingState: document.getElementById('searchLoadingState'),
    searchProgress: document.getElementById('searchProgress'),
    cancelSearchBtn: document.getElementById('cancelSearchBtn'),
    searchEmptyState: document.getElementById('searchEmptyState'),
    searchResultsList: document.getElementById('searchResultsList'),
    searchMyLogs: document.getElementById('searchMyLogs'),
    searchUnread: document.getElementById('searchUnread')
  };
}

function showLoading() {
  if (elements.loadingOverlay) {
    elements.loadingOverlay.style.display = 'flex';
  }
}

function hideLoading() {
  if (elements.loadingOverlay) {
    elements.loadingOverlay.style.display = 'none';
  }
}

function setupEventListeners() {
  elements.themeToggle.addEventListener('click', toggleTheme);
  elements.refreshBtn.addEventListener('click', refreshEnvironments);
  elements.envSelector.addEventListener('change', handleEnvChange);
  elements.downloadBtn.addEventListener('click', downloadLog);
  elements.markAllReadBtn.addEventListener('click', markAllAsRead);
  
  // Activity bar event listeners
  if (elements.activityLogBtn) {
    elements.activityLogBtn.addEventListener('click', () => switchToView('log'));
  }
  if (elements.activitySearchBtn) {
    elements.activitySearchBtn.addEventListener('click', () => switchToView('search'));
  }
  
  // Search related event listeners
  if (elements.searchInput) {
    elements.searchInput.addEventListener('input', handleSearchInput);
    elements.searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        handleSearch();
      }
    });
  }
  if (elements.searchBtn) {
    elements.searchBtn.addEventListener('click', handleSearch);
  }
  if (elements.clearSearchBtn) {
    elements.clearSearchBtn.addEventListener('click', clearSearch);
  }
  if (elements.cancelSearchBtn) {
    elements.cancelSearchBtn.addEventListener('click', cancelSearch);
  }
  
  // Filter panel collapse toggle
  const filterCollapseBtn = document.getElementById('filterCollapseBtn');
  const filterPanel = document.getElementById('filterPanel');
  if (filterCollapseBtn && filterPanel) {
    const filterCollapseText = filterCollapseBtn.querySelector('.filter-collapse-text');
    filterCollapseBtn.addEventListener('click', () => {
      filterPanel.classList.toggle('collapsed');
      if (filterCollapseText) {
        if (filterPanel.classList.contains('collapsed')) {
          filterCollapseText.textContent = '展开筛选';
        } else {
          filterCollapseText.textContent = '收起筛选';
        }
      }
    });
  }
  
  // Settings modal event listeners
  const userInfoBtn = document.getElementById('userInfoBtn');
  const settingsModalClose = document.getElementById('settingsModalClose');
  const settingsCancelBtn = document.getElementById('settingsCancelBtn');
  const settingsSaveBtn = document.getElementById('settingsSaveBtn');
  const settingsModal = document.getElementById('settingsModal');
  
  if (userInfoBtn) {
    userInfoBtn.addEventListener('click', openSettingsModal);
  }
  if (settingsModalClose) {
    settingsModalClose.addEventListener('click', closeSettingsModal);
  }
  if (settingsCancelBtn) {
    settingsCancelBtn.addEventListener('click', closeSettingsModal);
  }
  if (settingsSaveBtn) {
    settingsSaveBtn.addEventListener('click', saveSettingsFromModal);
  }
  if (settingsModal) {
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) {
        closeSettingsModal();
      }
    });
  }
  
  const filterBtns = elements.filterButtons.querySelectorAll('.filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeAppFilter = btn.dataset.filter;
      filterLogs();
    });
  });
  
  const statusFilterBtns = elements.statusFilterButtons.querySelectorAll('.filter-btn');
  statusFilterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      statusFilterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeStatusFilter = btn.dataset.status;
      filterLogs();
    });
  });
  
  const userFilterBtns = elements.userFilterButtons.querySelectorAll('.filter-btn');
  userFilterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      userFilterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeUserFilter = btn.dataset.user;
      filterLogs();
    });
  });
  
  // Detail view filter buttons
  const debugOnlyBtn = document.getElementById('debugOnlyBtn');
  if (debugOnlyBtn) {
    debugOnlyBtn.addEventListener('click', toggleDebugOnly);
  }

  // Process Automated trace button
  const trackProcessAutomatedBtn = document.getElementById('trackProcessAutomatedBtn');
  if (trackProcessAutomatedBtn) {
    trackProcessAutomatedBtn.addEventListener('click', handleTrackProcessAutomated);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'polling-update') {
      if (message.error) {
        console.error('Polling error:', message.error);
        if (message.error.includes('Session expired')) {
          stopPolling();
          showSessionExpired();
        }
      } else {
        updateLogs(message.data);
      }
    } else if (message.action === 'environments-updated') {
      environments = message.environments;
      updateEnvSelector();
      updateUserNameDisplay();
      updateUserFilterButton();
      
      if (!activeEnvId && environments.length > 0) {
        activeEnvId = environments[0].id;
        showMainView();
        fetchLogs();
        startPolling();
        startTraceFlagRenewal(true);
      }
    }
  });

  // Activity detection - using event delegation on document
  document.addEventListener('click', handleUserActivity);
  document.addEventListener('scroll', handleUserActivity, true);
  document.addEventListener('mousemove', handleUserActivity);
  document.addEventListener('keydown', handleUserActivity);
  
  // Window cleanup on close/unload
  window.addEventListener('beforeunload', cleanup);
  window.addEventListener('unload', cleanup);
}

function cleanup() {
  stopPolling();
  stopTraceFlagRenewal();
  stopProcessAutomatedRenewal();
  stopActivityTimer();
  stopPollingProgress();
  // 清除所有保存的 Session 数据
  chrome.runtime.sendMessage({ action: 'clear-all-sessions' });
}

async function loadState() {
  const response = await sendMessage({ action: 'get-state' });
  
  if (response.success) {
    environments = response.environments;
    activeEnvId = response.activeEnvId;
    currentUserName = response.currentUserName || null;
    
    updateEnvSelector();
    updateUserNameDisplay();
    updateUserFilterButton();
    
    // 如果没有激活的环境，但有可用环境，自动选择第一个
    if (!activeEnvId && environments.length > 0) {
      activeEnvId = environments[0].id;
      
      showMainView();
      fetchLogs();
      startPolling();
      if (settings.autoRenewCurrentUser) {
        startTraceFlagRenewal(true);
      }
      // 开启插件后立刻续期 Process Automated
      if (settings.autoStartProcessAutomated) {
        startProcessAutomatedRenewal();
      }
    } else if (activeEnvId) {
      showMainView();
      fetchLogs();
      startPolling();
      if (settings.autoRenewCurrentUser) {
        startTraceFlagRenewal(true);
      }
      // 开启插件后立刻续期 Process Automated
      if (settings.autoStartProcessAutomated) {
        startProcessAutomatedRenewal();
      }
    }
  }
  
  checkAutoConnect();
}

async function connectToActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  
  try {
    const response = await sendMessage({
      action: 'connect-to-tab',
      tabId: tab.id
    });
    
    if (response.success) {
      environments = response.environments;
      activeEnvId = response.envId;
      currentUserName = response.userName || null;
      updateEnvSelector();
      updateUserNameDisplay();
      updateUserFilterButton();
      showMainView();
      fetchLogs();
      startPolling();
      if (settings.autoRenewCurrentUser) {
        startTraceFlagRenewal(true);
      }
      if (settings.autoStartProcessAutomated) {
        startProcessAutomatedRenewal();
      }
    } else {
      console.error('[DEBUG] Connection failed:', response.error);
    }
  } catch (error) {
    console.error('[DEBUG] Connection error:', error);
  }
}

async function disconnect() {
  // 不需要手动断开，保持连接状态
}

async function handleEnvChange() {
  const newEnvId = elements.envSelector.value;
  
  // Stop polling first
  stopPolling();
  
  // Cancel any ongoing search
  if (searchState.isSearching) {
    cancelSearch();
  }
  
  // Complete reset of all state - like fresh initialization
  logs = [];
  selectedLog = null;
  readLogIds.clear();
  logLineCache = [];
  filteredLineCache = [];
  
  // Reset filters
  activeAppFilter = '';
  activeStatusFilter = '';
  activeUserFilter = 'current';
  
  // Reset search state completely
  searchState.searchQuery = '';
  searchState.searchResults = [];
  searchState.isSearchActive = false;
  searchState.logSnapshots = {};
  
  // Reset UI elements
  if (elements.searchInput) {
    elements.searchInput.value = '';
  }
  if (elements.clearSearchBtn) {
    elements.clearSearchBtn.style.display = 'none';
  }
  if (elements.searchResultsList) {
    elements.searchResultsList.innerHTML = '';
  }
  
  // Reset log list view
  if (elements.logList) {
    elements.logList.innerHTML = '';
  }
  
  // Reset detail view
  showDetailEmpty();
  
  // Reset filter buttons to default state
  resetFilterButtons();
  
  if (!newEnvId) {
    if (activeEnvId) {
      stopTraceFlagRenewal();
      activeEnvId = null;
      currentUserName = null;
      showWelcomeView();
    }
    return;
  }
  
  const response = await sendMessage({
    action: 'switch-environment',
    envId: newEnvId
  });
  
  if (response.success) {
    environments = response.environments;
    activeEnvId = newEnvId;
    
    // Update user name
    currentUserName = response.userName || null;
    updateUserNameDisplay();
    
    // Update user filter button
    updateUserFilterButton();
    
    updateEnvSelector();
    showMainView();
    
    // Fetch fresh logs for new environment
    await fetchLogs();
    
    // Restart polling
    startPolling();
    
    // Restart TraceFlag renewal based on settings
    if (settings.autoRenewCurrentUser) {
      startTraceFlagRenewal(true);
    }
    
    // Restart Process Automated renewal based on settings
    if (settings.autoRenewProcessAutomated) {
      startProcessAutomatedRenewal();
    }
  } else {
    alert('切换环境失败：' + (response.error || '未知错误'));
  }
}

function resetFilterButtons() {
  // Reset app filter buttons
  const appButtons = document.querySelectorAll('[data-filter="app"]');
  appButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === '');
  });
  
  // Reset status filter buttons
  const statusButtons = document.querySelectorAll('[data-filter="status"]');
  statusButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === '');
  });
  
  // Reset user filter buttons
  const userButtons = document.querySelectorAll('[data-filter="user"]');
  userButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === 'current');
  });
}

function showWelcomeView() {
  elements.welcomeView.style.display = 'flex';
  elements.mainView.style.display = 'none';
}

function showMainView() {
  elements.welcomeView.style.display = 'none';
  elements.mainView.style.display = 'flex';
  showDetailEmpty();
}

function showDetailEmpty() {
  elements.detailEmpty.style.display = 'flex';
  elements.detailContent.style.display = 'none';
}

function showDetailContent() {
  elements.detailEmpty.style.display = 'none';
  elements.detailContent.style.display = 'flex';
}

async function refreshEnvironments() {
  
  try {
    const response = await sendMessage({ action: 'refresh-environments' });
    
    if (response.success) {
      environments = response.environments;
      if (response.activeEnvId) {
        activeEnvId = response.activeEnvId;
      }
      updateEnvSelector();
      updateUserNameDisplay();
    } else {
      console.error('[DEBUG] Failed to refresh environments:', response.error);
    }
  } catch (error) {
    console.error('[DEBUG] Error refreshing environments:', error);
  }
}

function updateEnvSelector() {
  elements.envSelector.innerHTML = '<option value="">选择环境</option>';
  
  environments.forEach(env => {
    const option = document.createElement('option');
    option.value = env.id;
    option.textContent = `${env.name} - ${env.hostname}`;
    if (env.id === activeEnvId) {
      option.selected = true;
    }
    elements.envSelector.appendChild(option);
  });
}

async function fetchLogs() {
  if (!activeEnvId) return;
  
  elements.loadingState.style.display = 'flex';
  elements.emptyState.style.display = 'none';
  elements.logsList.innerHTML = '';
  
  try {
    const response = await sendMessage({
      action: 'fetch-logs',
      limit: 200
    });
    
    if (response.success) {
      updateLogs(response.data);
    } else {
      if (response.error === 'Session expired') {
        stopPolling();
        showSessionExpired();
      } else {
        throw new Error(response.error);
      }
    }
  } catch (error) {
    if (error.message !== 'No active environment') {
      console.error('[DEBUG] Fetch logs error:', error);
    }
    if (error.message === 'Session expired') {
      stopPolling();
      showSessionExpired();
    } else if (error.message === 'No active environment') {
      showSessionExpired();
    } else {
      elements.emptyState.style.display = 'flex';
      elements.emptyState.querySelector('p').textContent = '加载失败';
    }
  } finally {
    elements.loadingState.style.display = 'none';
  }
}

function updateLogs(data) {
  const newRecords = data?.records || [];
  
  // Incremental update: merge new logs with existing, avoid duplicates
  const existingIds = new Set(logs.map(log => log.Id));
  const uniqueNewRecords = newRecords.filter(log => !existingIds.has(log.Id));
  
  
  if (uniqueNewRecords.length > 0) {
    // Add new logs to the beginning (newest first)
    logs = [...uniqueNewRecords, ...logs];
    
    // Sort by StartTime descending (newest first)
    logs.sort((a, b) => new Date(b.StartTime) - new Date(a.StartTime));
    
    // Limit to 200 - remove oldest (at the end)
    if (logs.length > 200) {
      const removedCount = logs.length - 200;
      logs = logs.slice(0, 200);
    }
    
  }
  
  elements.loadingState.style.display = 'none';
  
  if (logs.length === 0) {
    elements.emptyState.style.display = 'flex';
    elements.logsList.innerHTML = '';
    updateLogsCount(0, 0);
  } else {
    elements.emptyState.style.display = 'none';
    filterLogs();
  }
}

function updateUserNameDisplay() {
  if (elements.userName) {
    elements.userName.textContent = currentUserName || '-';
  }
}

function updateUserFilterButton() {
  const currentUserBtn = document.getElementById('currentUserBtn');
  if (currentUserBtn && currentUserName) {
    currentUserBtn.textContent = currentUserName;
  }
}

function updateLogsCount(filteredCount, totalCount) {
  const countEl = document.getElementById('logsCount');
  if (countEl) {
    if (filteredCount === totalCount) {
      countEl.textContent = `${totalCount}`;
    } else {
      countEl.textContent = `${filteredCount}/${totalCount}`;
    }
  }
}

function filterLogs() {
  const filtered = logs.filter(log => {
    const matchesApp = !activeAppFilter || log.Application === activeAppFilter;
    
    let matchesStatus = true;
    if (activeStatusFilter === 'success') {
      matchesStatus = SUCCESS_STATUSES.includes(log.Status);
    } else if (activeStatusFilter === 'error') {
      matchesStatus = !SUCCESS_STATUSES.includes(log.Status);
    }
    
    let matchesUser = true;
    if (activeUserFilter === 'current' && currentUserName) {
      matchesUser = log.LogUser?.Name === currentUserName;
    }
    
    return matchesApp && matchesStatus && matchesUser;
  });
  
  updateLogsCount(filtered.length, logs.length);
  renderLogs(filtered);
}

function renderLogs(logsToRender = []) {
  elements.logsList.innerHTML = '';
  
  logsToRender.forEach(log => {
    const card = createLogCard(log);
    elements.logsList.appendChild(card);
  });
}

function createLogCard(log) {
  const type = log.Application || 'System';
  const duration = log.DurationMilliseconds || 0;
  const durationClass = duration > 5000 ? 'error' : duration > 1000 ? 'slow' : '';
  const status = log.Status || 'Unknown';
  const isSuccess = SUCCESS_STATUSES.includes(status);
  const isSelected = selectedLog?.Id === log.Id;
  const isRead = readLogIds.has(log.Id);
  
  const card = document.createElement('div');
  card.className = `log-card ${isSelected ? 'selected' : ''} ${isRead ? 'read' : ''}`;
  
  const formatTime = (dateStr) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleTimeString('zh-CN', { hour12: false }) || '-';
  };
  
  card.innerHTML = `
    <div class="log-card-header">
      <div class="log-header-left">
        <span class="log-status ${isSuccess ? 'success' : 'error'}">
          ${isSuccess ? '✓' : '✗'}
        </span>
        <span class="log-operation">${log.Operation || 'Unknown'}</span>
        <span class="log-type ${type}">${log.Application || 'System'}</span>
        <span class="log-time">${formatTime(log.StartTime)}</span>
        <span class="log-size">${formatSize(log.LogLength || 0)}</span>
        <span class="log-duration ${durationClass}">${formatDuration(duration)}</span>
      </div>
    </div>
  `;
  
  card.addEventListener('click', () => openLogDetail(log));
  
  return card;
}

async function openLogDetail(log, jumpToLine = null) {
  selectedLog = log;
  
  readLogIds.add(log.Id);
  
  filterLogs();
  
  showDetailContent();
  
  const status = log.Status || 'Unknown';
  const isSuccess = SUCCESS_STATUSES.includes(status);
  
  const metaItems = [
    { label: '状态', value: status, isStatus: true, isSuccess: isSuccess },
    { label: '操作', value: log.Operation || 'Unknown' },
    { label: '应用', value: log.Application || 'Unknown' },
    { label: '请求', value: log.Request || 'Unknown' },
    { label: '位置', value: log.Location || 'Unknown' },
    { label: '用户', value: log.LogUser?.Name || 'Unknown' },
    { label: '耗时', value: formatDuration(log.DurationMilliseconds || 0) },
    { label: '大小', value: formatSize(log.LogLength || 0) },
    { label: '时间', value: new Date(log.StartTime).toLocaleString() }
  ];
  
  elements.logMeta.innerHTML = metaItems.map(item => {
    if (item.isStatus) {
      return `
        <div class="detail-meta-item detail-status-item">
          <span>${item.label}：</span>
          <strong class="status-badge ${item.isSuccess ? 'success' : 'error'}">${item.value}</strong>
        </div>
      `;
    }
    return `
      <div class="detail-meta-item">
        <span>${item.label}：</span>
        <strong>${item.value}</strong>
      </div>
    `;
  }).join('');
  
  // 显示 loading 状态
  showLoading();
  
  try {
    const response = await sendMessage({
      action: 'fetch-log-body',
      logId: log.Id
    });
    
    if (response.success) {
      await displayLogBodyAsync(response.data);
      
      // If jumpToLine is specified, scroll to that line after log loads
      if (jumpToLine !== null) {
        // We need to wait for the log to render, then scroll
        const checkAndScroll = () => {
        // 直接定位到目标行，避免 scrollTop→startIndex→transform 累积误差
        const targetIndex = jumpToLine - 1;
        if (targetIndex < 0 || targetIndex >= filteredLineCache.length) {
          return;
        }
        
        const tbody = document.getElementById('logTableBody');
        const contentEl = document.getElementById('virtualScrollContent');
        if (!tbody || !contentEl) {
          setTimeout(checkAndScroll, 100);
          return;
        }
        
        // 计算可见区域的起始索引（不加缓冲，用于精确定位）
        const buffer = 20;
        let startIndex = Math.max(0, targetIndex - buffer);
        const endIndex = Math.min(startIndex + virtualScrollState.visibleCount, filteredLineCache.length);
        
        // 直接设置 virtualScrollState.startIndex
        virtualScrollState.startIndex = startIndex;
        
        // 手动渲染可见行
        tbody.innerHTML = '';
        const fragment = document.createDocumentFragment();
        for (let i = startIndex; i < endIndex; i++) {
          fragment.appendChild(renderRow(filteredLineCache[i]));
        }
        tbody.appendChild(fragment);
        
        // 直接设置 transform，不经过 scrollTop 计算
        contentEl.style.transform = `translateY(${startIndex * virtualScrollState.rowHeight}px)`;
        
        // 同步列宽
        syncTableColumnWidths();
        
        // 设置 scrollTop 使容器滚动到正确位置
        elements.logBody.scrollTop = targetIndex * virtualScrollState.rowHeight;
        
        // 绑定复制事件
        bindCopyEvents();
        
        // 高亮目标行
        setTimeout(() => {
          const allRows = tbody.querySelectorAll('tr');
          const rowInRendered = targetIndex - startIndex;
          const targetLine = allRows[rowInRendered];
          if (targetLine) {
            targetLine.style.background = 'rgba(245, 158, 11, 0.25)';
            setTimeout(() => {
              targetLine.style.background = '';
            }, 10000);
          }
        }, 50);
        };
        setTimeout(checkAndScroll, 100);
      }
    } else {
      elements.logBody.innerHTML = '<div class="log-line"><div class="log-line-content">加载失败：' + response.error + '</div></div>';
    }
  } catch (error) {
    console.error('[DEBUG] fetch-log-body error:', error);
    elements.logBody.innerHTML = '<div class="log-line"><div class="log-line-content">加载失败：' + error.message + '</div></div>';
  } finally {
    // 隐藏 loading 状态
    hideLoading();
  }
}

// 虚拟滚动实现
let parsedLineCache = [];
let filteredLineCache = []; // 筛选后的行数据
let detailFilterState = {
  debugOnly: false // 是否只显示 USER_DEBUG
};
let virtualScrollState = {
  rowHeight: 32, // 估计每行高度
  visibleCount: 100, // 渲染的可见行数（包括缓冲区）
  startIndex: 0, // 起始索引
  scrollHandler: null
};

// 解析单行数据
function parseLine(line, index) {
  const timePattern = /^\d{2}:\d{2}:\d{2}\.\d+\s*\(\d+\)/;
  let time = '';
  let type = '';
  let content = '';
  
  const parts = line.split('|');
  if (parts.length >= 3) {
    const firstPart = parts[0]?.trim() || '';
    if (timePattern.test(firstPart)) {
      time = firstPart;
      type = parts[1]?.trim() || '';
      content = parts.slice(2).join('|');
    } else {
      content = line;
    }
  } else {
    content = line;
  }
  
  return { index, time, type, content, line };
}

// HTML转义函数
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 渲染单行
function renderRow(data) {
  // 直接使用原始类型文本作为类名（转为大写，无空格）
  const typeClass = (data.type || '').toUpperCase().replace(/\s+/g, '_');
  const tr = document.createElement('tr');
  tr.dataset.line = data.index;
  tr.innerHTML = `
    <td class="line-number">${data.index + 1}</td>
    <td class="copy-btn">
      <button class="log-line-copy" data-line="${data.index}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
        </svg>
      </button>
    </td>
    <td class="time">${escapeHtml(data.time)}</td>
    <td class="type ${typeClass}">${escapeHtml(data.type)}</td>
    <td class="content">${escapeHtml(data.content)}</td>
  `;
  return tr;
}

// 筛选数据
function applyDetailFilter(lines) {
  if (!detailFilterState.debugOnly) {
    return lines;
  }
  
  // 只筛选类型包含 USER_DEBUG 的行
  return lines.filter(line => {
    const upperType = (line.type || '').toUpperCase();
    return upperType.includes('USER_DEBUG');
  });
}

// 切换 debug only 筛选
function toggleDebugOnly() {
  detailFilterState.debugOnly = !detailFilterState.debugOnly;
  
  const debugOnlyBtn = document.getElementById('debugOnlyBtn');
  if (debugOnlyBtn) {
    debugOnlyBtn.classList.toggle('active', detailFilterState.debugOnly);
  }
  
  // 重新应用筛选并渲染
  refreshDetailView();
  
  // 显示 toast 提示
  showToast(detailFilterState.debugOnly ? '已筛选 USER_DEBUG 行' : '已取消筛选', 'info');
}

// 刷新详情视图
function refreshDetailView() {
  if (!parsedLineCache || parsedLineCache.length === 0) {
    return;
  }
  
  // 重新应用筛选
  filteredLineCache = applyDetailFilter(parsedLineCache);
  
  // 重置滚动位置
  if (elements.logBody) {
    elements.logBody.scrollTop = 0;
  }
  
  // 重新渲染
  renderDetailView();
}

// 同步表头和表体的列宽
function syncTableColumnWidths() {
  const headerTable = elements.logBody.querySelector('table.log-table-header');
  const bodyTable = elements.logBody.querySelector('table.log-table-body');
  if (!headerTable || !bodyTable) return;

  const headerCells = headerTable.querySelectorAll('thead th');
  const bodyCells = bodyTable.querySelectorAll('tbody tr:first-child td');

  if (headerCells.length === 0 || bodyCells.length === 0) return;

  // 首先让表格自然渲染，然后同步宽度
  requestAnimationFrame(() => {
    headerCells.forEach((th, index) => {
      if (bodyCells[index]) {
        const width = th.offsetWidth;
        bodyCells[index].style.width = width + 'px';
        bodyCells[index].style.minWidth = width + 'px';
        th.style.width = width + 'px';
        th.style.minWidth = width + 'px';
      }
    });
  });
}

// 渲染详情视图
function renderDetailView() {
  const tbody = document.getElementById('logTableBody');
  const spacer = document.getElementById('virtualScrollSpacer');
  if (!tbody || !spacer) return;

  // 使用筛选后的数据
  const currentData = filteredLineCache;

  // 更新占位高度
  spacer.style.height = (currentData.length * virtualScrollState.rowHeight) + 'px';

  // 重置 startIndex
  virtualScrollState.startIndex = 0;

  // 重新渲染可见行
  renderVisibleRowsForView();
}

// 渲染可见行
function renderVisibleRowsForView() {
  const tbody = document.getElementById('logTableBody');
  if (!tbody) return;

  const scrollTop = elements.logBody.scrollTop;
  let startIndex = Math.floor(scrollTop / virtualScrollState.rowHeight);
  startIndex = Math.max(0, startIndex - 20); // 向前缓冲
  const endIndex = Math.min(startIndex + virtualScrollState.visibleCount, filteredLineCache.length);

  virtualScrollState.startIndex = startIndex;

  // 清空 tbody 并重新渲染可见行
  tbody.innerHTML = '';
  const fragment = document.createDocumentFragment();

  for (let i = startIndex; i < endIndex; i++) {
    fragment.appendChild(renderRow(filteredLineCache[i]));
  }

  tbody.appendChild(fragment);

  // 定位内容
  const content = document.getElementById('virtualScrollContent');
  if (content) {
    content.style.transform = `translateY(${startIndex * virtualScrollState.rowHeight}px)`;
  }

  // 同步列宽
  syncTableColumnWidths();

  bindCopyEvents();
}

// 异步渲染 log body，使用虚拟滚动
async function displayLogBodyAsync(body, jumpToLine = null) {
  // 清理之前的滚动事件
  if (virtualScrollState.scrollHandler) {
    elements.logBody.removeEventListener('scroll', virtualScrollState.scrollHandler);
  }

  // 重置筛选状态
  detailFilterState.debugOnly = false;
  const debugOnlyBtn = document.getElementById('debugOnlyBtn');
  if (debugOnlyBtn) {
    debugOnlyBtn.classList.remove('active');
  }

  if (!body) {
    logLineCache = [];
    parsedLineCache = [];
    filteredLineCache = [];
    elements.logBody.innerHTML = '<div class="log-table-empty">日志内容为空</div>';
    return;
  }

  const logText = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  logLineCache = logText.split('\n');

  // 预解析所有行数据
  parsedLineCache = logLineCache.map((line, i) => parseLine(line, i));
  filteredLineCache = [...parsedLineCache]; // 初始时筛选数据 = 原始数据

  // 计算容器高度和可见行数
  const containerHeight = Math.max(elements.logBody.clientHeight, 400);
  virtualScrollState.visibleCount = Math.ceil(containerHeight / virtualScrollState.rowHeight) + 50;
  virtualScrollState.startIndex = 0;

  // 渲染初始视图
  elements.logBody.innerHTML = `
    <div class="log-table-header-wrapper">
      <table class="log-table log-table-header">
        <thead>
          <tr>
            <th class="line-number">#</th>
            <th class="copy-btn"></th>
            <th class="time" data-column="time">时间<span class="resize-handle"></span></th>
            <th class="type" data-column="type">类型<span class="resize-handle"></span></th>
            <th class="content">内容</th>
          </tr>
        </thead>
      </table>
    </div>
    <div class="virtual-scroll-spacer" id="virtualScrollSpacer">
      <div class="virtual-scroll-content" id="virtualScrollContent">
        <table class="log-table log-table-body">
          <tbody id="logTableBody"></tbody>
        </table>
      </div>
    </div>
  `;

  // 初始渲染
  renderDetailView();

  // 同步初始列宽
  syncTableColumnWidths();

  // 如果指定了跳转行，滚动到该行并高亮
  if (jumpToLine !== null) {
    const checkAndScroll = () => {
    // 直接定位到目标行，避免 scrollTop→startIndex→transform 累积误差
    const targetIndex = jumpToLine - 1;
    if (targetIndex < 0 || targetIndex >= filteredLineCache.length) {
      return;
    }
    
    const tbody = document.getElementById('logTableBody');
    const contentEl = document.getElementById('virtualScrollContent');
    if (!tbody || !contentEl) {
      setTimeout(checkAndScroll, 100);
      return;
    }
    
    // 计算可见区域的起始索引（不加缓冲，用于精确定位）
    const buffer = 20;
    let startIndex = Math.max(0, targetIndex - buffer);
    const endIndex = Math.min(startIndex + virtualScrollState.visibleCount, filteredLineCache.length);
    
    // 直接设置 virtualScrollState.startIndex
    virtualScrollState.startIndex = startIndex;
    
    // 手动渲染可见行
    tbody.innerHTML = '';
    const fragment = document.createDocumentFragment();
    for (let i = startIndex; i < endIndex; i++) {
      fragment.appendChild(renderRow(filteredLineCache[i]));
    }
    tbody.appendChild(fragment);
    
    // 直接设置 transform，不经过 scrollTop 计算
    contentEl.style.transform = `translateY(${startIndex * virtualScrollState.rowHeight}px)`;
    
    // 同步列宽
    syncTableColumnWidths();
    
    // 设置 scrollTop 使容器滚动到正确位置
    // 目标行在可视区域顶部需要 scrollTop = targetIndex * rowHeight
    elements.logBody.scrollTop = targetIndex * virtualScrollState.rowHeight;
    
    // 绑定复制事件
    bindCopyEvents();
    
    // 高亮目标行
    setTimeout(() => {
      const allRows = tbody.querySelectorAll('tr');
      const rowInRendered = targetIndex - startIndex;
      const targetLine = allRows[rowInRendered];
      if (targetLine) {
        targetLine.style.background = 'rgba(245, 158, 11, 0.25)';
        setTimeout(() => {
          targetLine.style.background = '';
        }, 10000);
      }
    }, 50);
    };
    setTimeout(checkAndScroll, 100);
  }

  // 防抖滚动处理
  let scrollRAF = null;
  virtualScrollState.scrollHandler = () => {
    if (!scrollRAF) {
      scrollRAF = requestAnimationFrame(() => {
        renderVisibleRowsForView();
        scrollRAF = null;
      });
    }
  };

  elements.logBody.addEventListener('scroll', virtualScrollState.scrollHandler);
}

// 绑定复制和双击事件
function bindCopyEvents() {
  if (!elements.logBody) return;
  
  // 绑定复制按钮事件
  const copyBtns = elements.logBody.querySelectorAll('.log-line-copy');
  copyBtns.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const lineIndex = parseInt(btn.dataset.line);
      if (logLineCache[lineIndex]) {
        navigator.clipboard.writeText(logLineCache[lineIndex]).then(() => {
          btn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 6L9 17l-5-5"></path>
            </svg>
          `;
          setTimeout(() => {
            btn.innerHTML = `
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            `;
          }, 1000);
        }).catch(err => {
          console.error('[DEBUG] Copy error:', err);
        });
      }
    });
  });
  
  // 绑定双击单元格复制事件
  const dataCells = elements.logBody.querySelectorAll('tbody td');
  dataCells.forEach((cell) => {
    cell.addEventListener('dblclick', (e) => {
      const cellText = cell.textContent.trim();
      if (cellText) {
        navigator.clipboard.writeText(cellText).then(() => {
          cell.style.backgroundColor = '#E3F2FD';
          showToast('已复制到剪贴板');
          setTimeout(() => {
            cell.style.backgroundColor = '';
          }, 1000);
        }).catch(err => {
          console.error('[DEBUG] Copy cell error:', err);
          showToast('复制失败', 'error');
        });
      }
    });
  });
  
  // 绑定列宽拖动事件
  bindColumnResize();
}

function bindColumnResize() {
  const headerTable = elements.logBody.querySelector('table.log-table-header');
  const bodyTable = elements.logBody.querySelector('table.log-table-body');
  if (!headerTable || !bodyTable) return;

  const headerCells = headerTable.querySelectorAll('thead th .resize-handle');

  headerCells.forEach(handle => {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const th = handle.parentElement;
      const column = th.dataset.column;
      if (!column || column === 'content') return; // 内容列不允许调整宽度

      const colIndex = Array.from(th.parentElement.children).indexOf(th);
      const startX = e.clientX;
      const startWidth = th.offsetWidth;
      const allRows = bodyTable.querySelectorAll('tbody tr');

      const onMouseMove = (moveEvent) => {
        const diff = moveEvent.clientX - startX;
        const newWidth = Math.max(50, startWidth + diff);

        // 更新表头宽度
        th.style.width = newWidth + 'px';
        th.style.minWidth = newWidth + 'px';

        // 更新所有行的对应列宽度
        allRows.forEach(row => {
          const cells = row.children;
          if (cells[colIndex]) {
            cells[colIndex].style.width = newWidth + 'px';
            cells[colIndex].style.minWidth = newWidth + 'px';
          }
        });
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.classList.remove('resizing');
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.body.classList.add('resizing');
    });
  });
}

async function downloadLog() {
  if (!selectedLog) return;
  
  
  // 显示加载状态
  elements.downloadBtn.disabled = true;
  const originalTitle = elements.downloadBtn.title;
  elements.downloadBtn.title = '获取中...';
  
  // 获取实际log内容
  let logContent = '';
  try {
    const response = await sendMessage({
      action: 'fetch-log-body',
      logId: selectedLog.Id
    });
    
    if (response.success) {
      logContent = response.data;
    } else {
      logContent = 'Failed to fetch log content: ' + response.error;
      console.error('[DEBUG] Failed to fetch log:', response.error);
    }
  } catch (error) {
    logContent = 'Error fetching log: ' + error.message;
    console.error('[DEBUG] Error fetching log:', error);
  }
  
  // 恢复按钮状态
  elements.downloadBtn.disabled = false;
  elements.downloadBtn.title = originalTitle;
  
  // 下载JSON格式（包含元数据和实际内容）
  const content = JSON.stringify({
    metadata: {
      id: selectedLog.Id,
      operation: selectedLog.Operation,
      application: selectedLog.Application,
      user: selectedLog.LogUser?.Name,
      startTime: selectedLog.StartTime,
      duration: selectedLog.DurationMilliseconds,
      size: selectedLog.LogLength
    },
    body: logContent
  }, null, 2);
  
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `apex-log-${selectedLog.Id}.json`;
  a.click();
  URL.revokeObjectURL(url);
  
}

function showSessionExpired() {
  elements.welcomeView.style.display = 'flex';
  elements.mainView.style.display = 'none';
  // 自动重连逻辑在后台处理
}

function markAllAsRead() {
  logs.forEach(log => readLogIds.add(log.Id));
  filterLogs();
}

function startPolling() {
  if (isPolling) return;
  
  isPolling = true;
  
  // Start activity timer
  resetActivityTimer();
  
  // Start polling progress animation
  startPollingProgress();
  
  sendMessage({ action: 'start-polling', interval: currentPollingInterval });
}

function stopPolling() {
  if (!isPolling) return;
  
  isPolling = false;
  
  sendMessage({ action: 'stop-polling' });
  
  // Stop activity timer and polling progress
  stopActivityTimer();
  stopPollingProgress();
}

function startTraceFlagRenewal(immediate = false) {
  if (traceFlagRenewalInterval) {
    return;
  }
  
  // Renew immediately on first start if configured
  if (immediate) {
    renewTraceFlag();
  }
  
  // Then renew based on settings interval (convert minutes to milliseconds)
  // Trigger renewal 30 seconds before expiration
  const intervalMs = settings.renewIntervalCurrentUser * 60 * 1000 - 30000;
  traceFlagRenewalInterval = setInterval(renewTraceFlag, intervalMs);
}

function stopTraceFlagRenewal() {
  if (traceFlagRenewalInterval) {
    clearInterval(traceFlagRenewalInterval);
    traceFlagRenewalInterval = null;
  }
}

async function handleTrackProcessAutomated() {
  if (!activeEnvId) {
    showToast('请先选择环境', 'error');
    return;
  }

  showLoading();
  try {
    const response = await sendMessage({ 
      action: 'track-process-automated',
      duration: settings.renewIntervalProcessAutomated
    });
    if (response.success) {
      showToast(`Process Automated 追踪已创建/续期（${settings.renewIntervalProcessAutomated}分钟）`, 'success');
      // 启动自动续期定时器
      startProcessAutomatedRenewal();
    } else {
      showToast('创建失败: ' + (response.error || '未知错误'), 'error');
    }
  } catch (error) {
    showToast('操作失败: ' + error.message, 'error');
  } finally {
    hideLoading();
  }
}

function startProcessAutomatedRenewal() {
  // 清除已有的定时器
  stopProcessAutomatedRenewal();
  
  // 立即续期一次
  renewProcessAutomatedTraceFlag();
  
  // 根据设置间隔自动续期（转换分钟为毫秒）
  // Trigger renewal 30 seconds before expiration
  const intervalMs = settings.renewIntervalProcessAutomated * 60 * 1000 - 30000;
  processAutomatedRenewalInterval = setInterval(renewProcessAutomatedTraceFlag, intervalMs);
}

function stopProcessAutomatedRenewal() {
  if (processAutomatedRenewalInterval) {
    clearInterval(processAutomatedRenewalInterval);
    processAutomatedRenewalInterval = null;
  }
}

async function renewProcessAutomatedTraceFlag() {
  if (!activeEnvId) return;
  
  try {
    const response = await sendMessage({ 
      action: 'track-process-automated',
      duration: settings.renewIntervalProcessAutomated
    });
    if (!response.success) {
      if (response.error !== 'No active environment') {
        console.error('[DEBUG] Failed to renew Process Automated TraceFlag:', response.error);
      }
    }
  } catch (error) {
    if (error.message !== 'No active environment') {
      console.error('[DEBUG] Error renewing Process Automated TraceFlag:', error.message);
    }
  }
}

async function renewTraceFlag() {
  if (!activeEnvId) return;
  
  
  try {
    // 传递续期间隔参数给 background
    const response = await sendMessage({ 
      action: 'renew-traceflag',
      duration: settings.renewIntervalCurrentUser
    });
    if (!response.success) {
      if (response.error !== 'No active environment') {
        console.error('[DEBUG] Failed to renew TraceFlag:', response.error);
      }
    }
  } catch (error) {
    if (error.message !== 'No active environment') {
      console.error('[DEBUG] Error renewing TraceFlag:', error.message);
    }
  }
}

function handleUserActivity() {
  lastActivityTime = Date.now();
  resetActivityTimer();
  
  // If we were in slow polling mode, switch back to active mode
  if (currentPollingInterval !== ACTIVE_INTERVAL) {
    switchToActivePolling();
  }
}

function resetActivityTimer() {
  stopActivityTimer();
  
  activityTimerInterval = setInterval(() => {
    const now = Date.now();
    const inactiveMs = now - lastActivityTime;
    const inactiveSeconds = Math.floor(inactiveMs / 1000);
    
    updateActivityTimerDisplay(inactiveSeconds);
    
    // Check if we should switch to slow polling
    if (inactiveSeconds >= INACTIVITY_TIMEOUT / 1000 && currentPollingInterval === ACTIVE_INTERVAL) {
      switchToSlowPolling();
    }
  }, 1000);
}

function stopActivityTimer() {
  if (activityTimerInterval) {
    clearInterval(activityTimerInterval);
    activityTimerInterval = null;
  }
}

function updateActivityTimerDisplay(seconds) {
  if (!elements.activityTimerValue) return;
  
  elements.activityTimerValue.textContent = seconds;
  
  // Update visual state
  elements.activityTimer.classList.remove('warning', 'critical');
  if (seconds >= INACTIVITY_TIMEOUT / 1000) {
    elements.activityTimer.classList.add('critical');
  } else if (seconds >= (INACTIVITY_TIMEOUT / 1000) * 0.7) {
    elements.activityTimer.classList.add('warning');
  }
}

function switchToActivePolling() {
  currentPollingInterval = ACTIVE_INTERVAL;
  
  // Update polling interval display
  if (elements.pollingInterval) {
    elements.pollingInterval.textContent = '3s';
  }
  
  // Update polling bar
  if (elements.pollingBar) {
    elements.pollingBar.classList.remove('slow');
  }
  
  // Restart polling with new interval
  if (isPolling) {
    stopPolling();
    startPolling();
  }
  
  // Reset activity timer
  lastActivityTime = Date.now();
  resetActivityTimer();
  
  // Restart polling progress animation
  startPollingProgress();
}

function switchToSlowPolling() {
  currentPollingInterval = INACTIVE_INTERVAL;
  
  // Update polling interval display
  if (elements.pollingInterval) {
    elements.pollingInterval.textContent = '2m';
  }
  
  // Update polling bar
  if (elements.pollingBar) {
    elements.pollingBar.classList.add('slow');
  }
  
  // Restart polling with new interval
  if (isPolling) {
    stopPolling();
    startPolling();
  }
  
  // Restart polling progress animation
  startPollingProgress();
}

function startPollingProgress() {
  stopPollingProgress();
  
  pollingProgress = 100;
  
  const updateInterval = Math.max(100, currentPollingInterval / 100); // Update at least every 100ms
  
  pollingProgressInterval = setInterval(() => {
    pollingProgress -= (100 / (currentPollingInterval / updateInterval));
    
    if (pollingProgress <= 0) {
      pollingProgress = 100;
    }
    
    updatePollingProgressDisplay();
  }, updateInterval);
}

function stopPollingProgress() {
  if (pollingProgressInterval) {
    clearInterval(pollingProgressInterval);
    pollingProgressInterval = null;
  }
}

function updatePollingProgressDisplay() {
  if (!elements.pollingBar) return;
  
  elements.pollingBar.style.width = `${pollingProgress}%`;
}

function formatDate(dateString) {
  const date = new Date(dateString);
  
  // 显示具体时间格式：YYYY-MM-DD HH:mm:ss
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}m`;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function checkAutoConnect() {
  if (activeEnvId) return;
  
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (tab && tab.url && (tab.url.includes('salesforce.com') || tab.url.includes('force.com'))) {
    await connectToActiveTab();
  }
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) {
        const errorMessage = chrome.runtime.lastError.message;
        if (errorMessage.includes('Could not establish connection') || 
            errorMessage.includes('Receiving end does not exist')) {
          console.warn('[DEBUG] Background script not ready yet, retrying...');
          setTimeout(() => {
            sendMessage(message).then(resolve).catch(reject);
          }, 500);
        } else {
          reject(new Error(errorMessage));
        }
      } else {
        resolve(response);
      }
    });
  });
}

// ========== Search Related Functions ==========
function initSearchUI() {
  if (!elements.searchInput || !elements.searchBtn) return;

  // Initialize search button state
  updateSearchButtonState();
}

let currentView = 'log';

function switchToView(view) {
  if (currentView === view) return;
  
  currentView = view;
  
  // Update activity bar buttons
  if (elements.activityLogBtn) {
    elements.activityLogBtn.classList.toggle('active', view === 'log');
  }
  if (elements.activitySearchBtn) {
    elements.activitySearchBtn.classList.toggle('active', view === 'search');
  }
  
  // Update views
  if (elements.logView) {
    elements.logView.classList.toggle('active', view === 'log');
  }
  if (elements.searchView) {
    elements.searchView.classList.toggle('active', view === 'search');
  }
  
  // Handle polling based on view
  if (view === 'log') {
    // Switching to log view - resume polling
    if (activeEnvId && !isPolling) {
      startPolling();
    }
  } else {
    // Switching to search view - pause polling
    if (isPolling) {
      stopPolling();
    }
  }
}

function updateSearchButtonState() {
  if (!elements.searchInput || !elements.searchBtn) return;
  
  const hasContent = elements.searchInput.value.trim().length > 0;
  elements.searchBtn.disabled = !hasContent;
}

function handleSearchInput() {
  updateSearchButtonState();
  handleUserActivity();
}

let wasPollingBeforeSearch = false;

async function handleSearch() {
  const query = elements.searchInput.value.trim();
  if (!query || !activeEnvId) return;

  // If already searching, do nothing
  if (searchState.isSearching) return;

  searchState.searchQuery = query;
  searchState.isSearching = true;
  searchState.searchAbortController = new AbortController();

  // Show search loading state
  showSearchLoading();

  // Pause polling and remember state
  wasPollingBeforeSearch = isPolling;
  if (wasPollingBeforeSearch) {
    stopPolling();
  }

  try {
    // Get filter options
    const filterMyLogs = elements.searchMyLogs?.checked ?? true;
    const filterUnread = elements.searchUnread?.checked ?? true;

    // Pre-filter logs based on options (粗筛)
    let filteredLogs = logs;
    
    if (filterMyLogs && currentUserName) {
      filteredLogs = filteredLogs.filter(log => log.LogUser?.Name === currentUserName);
    }
    
    if (filterUnread) {
      filteredLogs = filteredLogs.filter(log => !readLogIds.has(log.Id));
    }

    // Now search through filtered logs
    searchState.searchResults = [];
    const totalLogs = filteredLogs.length;
    let processedLogs = 0;

    for (const log of filteredLogs) {
      if (searchState.searchAbortController.signal.aborted) {
        break;
      }

      processedLogs++;
      updateSearchProgress(processedLogs, totalLogs);

      try {
        const logBody = await fetchLogBodyForSearch(log.Id);
        
        if (searchState.searchAbortController.signal.aborted) {
          break;
        }

        // 保存日志快照，用于后续快速打开
        searchState.logSnapshots[log.Id] = {
          log: { ...log },  // 浅拷贝日志基本信息
          body: logBody     // 保存日志内容
        };

        const matches = searchInLogBody(logBody, query);
        
        if (matches.length > 0) {
          searchState.searchResults.push({
            log: log,
            matches: matches
          });
        }
      } catch (error) {
        console.error('[DEBUG] Error searching log:', log.Id, error);
      }

      // Small delay to prevent UI blocking
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    if (!searchState.searchAbortController.signal.aborted) {
      // Search completed, render results
      searchState.isSearchActive = true;
      renderSearchResults();
    } else {
      // Search was cancelled - resume polling
      if (wasPollingBeforeSearch && activeEnvId && !isPolling) {
        startPolling();
      }
    }
  } catch (error) {
    console.error('[DEBUG] Search error:', error);
    showToast('搜索失败，请重试', 'error');
    // On error, also resume polling
    if (wasPollingBeforeSearch && activeEnvId && !isPolling) {
      startPolling();
    }
  } finally {
    searchState.isSearching = false;
    searchState.searchAbortController = null;
    hideSearchLoading();
  }
}

function cancelSearch() {
  if (searchState.searchAbortController) {
    searchState.searchAbortController.abort();
  }
  searchState.isSearching = false;
  hideSearchLoading();
  showToast('搜索已取消', 'info');
  
  // Resume polling on cancel
  if (wasPollingBeforeSearch && activeEnvId && !isPolling) {
    startPolling();
  }
}

function clearSearch() {
  // Clear search state
  searchState.searchQuery = '';
  searchState.searchResults = [];
  searchState.isSearchActive = false;
  
  // Clear UI
  if (elements.searchInput) {
    elements.searchInput.value = '';
  }
  if (elements.clearSearchBtn) {
    elements.clearSearchBtn.style.display = 'none';
  }
  
  // Hide search loading and empty states
  if (elements.searchLoadingState) {
    elements.searchLoadingState.style.display = 'none';
  }
  if (elements.searchEmptyState) {
    elements.searchEmptyState.style.display = 'none';
  }
  
  // Clear search results list
  if (elements.searchResultsList) {
    elements.searchResultsList.innerHTML = '';
  }
  
  updateSearchButtonState();
}

async function fetchLogBodyForSearch(logId) {
  const response = await sendMessage({
    action: 'fetch-log-body',
    envId: activeEnvId,
    logId: logId
  });

  if (!response.success) {
    throw new Error(response.error);
  }

  return response.data;
}

function searchInLogBody(logBody, query) {
  const matches = [];
  const lines = logBody.split('\n');
  const queryLower = query.toLowerCase();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineLower = line.toLowerCase();
    const index = lineLower.indexOf(queryLower);
    
    if (index !== -1) {
      matches.push({
        lineNumber: i + 1,
        lineContent: line,
        matchIndex: index,
        matchLength: query.length
      });
    }
  }

  return matches;
}

function renderSearchResults() {
  if (!elements.searchResultsList || !elements.searchEmptyState) return;

  // Show clear search button when there are results or active search
  if (elements.clearSearchBtn && (searchState.searchResults.length > 0 || searchState.searchQuery)) {
    elements.clearSearchBtn.style.display = 'inline-flex';
  }

  elements.searchResultsList.innerHTML = '';

  if (searchState.searchResults.length === 0) {
    elements.searchEmptyState.style.display = 'flex';
    elements.searchResultsList.style.display = 'none';
    return;
  }

  elements.searchEmptyState.style.display = 'none';
  elements.searchResultsList.style.display = 'flex';

  for (const result of searchState.searchResults) {
    const card = renderSearchResultCard(result);
    elements.searchResultsList.appendChild(card);
  }
}

function renderSearchResultCard(result) {
  const card = document.createElement('div');
  card.className = 'search-result-card';
  
  const log = result.log;
  const isSuccess = SUCCESS_STATUSES.includes(log.Status);
  const logType = log.Application || 'System';
  const timeStr = formatDate(log.StartTime);

  // Build header
  const header = document.createElement('div');
  header.className = 'search-result-card-header';
  
  const headerLeft = document.createElement('div');
  headerLeft.className = 'search-result-card-header-left';
  
  const operation = document.createElement('div');
  operation.className = 'search-result-operation';
  operation.textContent = log.Operation || 'Unknown';
  
  headerLeft.appendChild(operation);
  
  const meta = document.createElement('div');
  meta.className = 'search-result-meta';
  
  const statusBadge = document.createElement('span');
  statusBadge.className = `log-status ${isSuccess ? 'success' : 'error'}`;
  statusBadge.textContent = log.Status || 'Unknown';
  
  const typeSpan = document.createElement('span');
  typeSpan.className = `log-type ${logType}`;
  typeSpan.textContent = log.LogType || logType;
  
  const timeSpan = document.createElement('span');
  timeSpan.textContent = timeStr.split(' ')[1]; // Only show time
  
  meta.appendChild(statusBadge);
  meta.appendChild(typeSpan);
  meta.appendChild(timeSpan);
  
  header.appendChild(headerLeft);
  header.appendChild(meta);
  
  // Build matches
  const matchesContainer = document.createElement('div');
  matchesContainer.className = 'search-result-matches';
  
  for (const match of result.matches) {
    const matchLine = document.createElement('div');
    matchLine.className = 'search-match-line';
    matchLine.dataset.logId = log.Id;
    matchLine.dataset.lineNumber = match.lineNumber;
    
    const lineNumber = document.createElement('span');
    lineNumber.className = 'search-match-line-number';
    lineNumber.textContent = `#${match.lineNumber}`;
    
    const lineContent = document.createElement('span');
    lineContent.className = 'search-match-line-content';
    
    // Highlight the match
    const beforeMatch = match.lineContent.substring(0, match.matchIndex);
    const matchText = match.lineContent.substring(match.matchIndex, match.matchIndex + match.matchLength);
    const afterMatch = match.lineContent.substring(match.matchIndex + match.matchLength);
    
    lineContent.innerHTML = `${escapeHtml(beforeMatch)}<span class="search-match-highlight">${escapeHtml(matchText)}</span>${escapeHtml(afterMatch)}`;
    
    matchLine.appendChild(lineNumber);
    matchLine.appendChild(lineContent);
    
    // Click to jump to line
    matchLine.addEventListener('click', (e) => {
      e.stopPropagation();
      handleSearchMatchClick(log.Id, match.lineNumber);
    });
    
    matchesContainer.appendChild(matchLine);
  }
  
  card.appendChild(header);
  card.appendChild(matchesContainer);
  
  // Click card to view log
  card.addEventListener('click', () => {
    handleSearchResultClick(log.Id);
  });
  
  return card;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function handleSearchResultClick(logId) {
  // 优先从快照打开，不需要再次请求 API
  const snapshot = searchState.logSnapshots[logId];
  if (snapshot) {
    openLogDetailFromSnapshot(snapshot);
  } else {
    // 如果快照不存在，从主列表打开
    const log = logs.find(l => l.Id === logId);
    if (log) {
      openLogDetail(log);
    }
  }
}

function handleSearchMatchClick(logId, lineNumber) {
  // 优先从快照打开，不需要再次请求 API
  const snapshot = searchState.logSnapshots[logId];
  if (snapshot) {
    openLogDetailFromSnapshot(snapshot, lineNumber);
  } else {
    // 如果快照不存在，从主列表打开
    const log = logs.find(l => l.Id === logId);
    if (log) {
      openLogDetail(log, lineNumber);
    }
  }
}

function openLogDetailFromSnapshot(snapshot, lineNumber) {
  // 直接使用快照中的日志信息打开详情，不需要请求 API
  const log = snapshot.log;
  
  selectedLog = log;
  readLogIds.add(log.Id);
  filterLogs();
  showDetailContent();
  
  const status = log.Status || 'Unknown';
  const isSuccess = SUCCESS_STATUSES.includes(status);
  
  const metaItems = [
    { label: '状态', value: status, isStatus: true, isSuccess: isSuccess },
    { label: '操作', value: log.Operation || 'Unknown' },
    { label: '应用', value: log.Application || 'Unknown' },
    { label: '请求', value: log.Request || 'Unknown' },
    { label: '位置', value: log.Location || 'Unknown' },
    { label: '用户', value: log.LogUser?.Name || 'Unknown' },
    { label: '耗时', value: formatDuration(log.DurationMilliseconds || 0) },
    { label: '大小', value: formatSize(log.LogLength || 0) },
    { label: '时间', value: new Date(log.StartTime).toLocaleString() }
  ];
  
  elements.logMeta.innerHTML = metaItems.map(item => {
    if (item.isStatus) {
      return `
        <div class="detail-meta-item detail-status-item">
          <span>${item.label}：</span>
          <strong class="status-badge ${item.isSuccess ? 'success' : 'error'}">${item.value}</strong>
        </div>
      `;
    }
    return `
      <div class="detail-meta-item">
        <span>${item.label}：</span>
        <strong>${item.value}</strong>
      </div>
    `;
  }).join('');
  
  displayLogBodyAsync(snapshot.body, lineNumber);
}

function showSearchLoading() {
  if (elements.searchLoadingState) {
    elements.searchLoadingState.style.display = 'flex';
  }
}

function hideSearchLoading() {
  if (elements.searchLoadingState) {
    elements.searchLoadingState.style.display = 'none';
  }
}

function updateSearchProgress(current, total) {
  if (elements.searchProgress) {
    elements.searchProgress.textContent = `${current} / ${total}`;
  }
}



