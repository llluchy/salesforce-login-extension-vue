const SALESFORCE_API_VERSION = 'v59.0';

// Environment storage
let environments = {}; // { envId: { sessionId, instanceUrl, connectedAt } }
let activeEnvId = null;
let pollingInterval = null;

// Keep track of opened window to avoid duplicates
let logViewerWindowId = null;

// Open window when clicking extension icon
chrome.action.onClicked.addListener(async (tab) => {
  if (logViewerWindowId) {
    try {
      await chrome.windows.update(logViewerWindowId, { focused: true });
      return;
    } catch (e) {
      logViewerWindowId = null;
    }
  }
  
  // Create window FIRST for instant feedback
  const window = await chrome.windows.create({
    url: 'window/index.html',
    type: 'popup',
    width: 500,
    height: 700,
    left: 100,
    top: 100
  });
  
  if (window.id) {
    logViewerWindowId = window.id;
  }
  
  // Discover environments in background AFTER window is shown
  // This gives instant UI response while data loads
  discoverAllSalesforceTabs().catch(console.error);
});

// Listen for window closed event to reset id
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === logViewerWindowId) {
    logViewerWindowId = null;
  }
});

// Auto-detect environment from active tab
async function autoDetectEnvironment(tabId, url) {
  try {
    // Clear old userName first - never use cached data
    if (activeEnvId && environments[activeEnvId]) {
      environments[activeEnvId].userName = undefined;
    }
    
    const session = await extractSessionFromTab(tabId);
    
    if (session) {
      const envId = await addEnvironment(session);
      
      activeEnvId = envId;
      
      // Fetch and save current user name
      const userName = await fetchCurrentUserName(envId);
      
      if (userName) {
        environments[envId].userName = userName;
      }
      
      // Enable debug logging (create TraceFlag)
      await enableDebugLogging(envId);
      
      await saveState();
    }
  } catch (error) {
    console.error('[DEBUG] autoDetectEnvironment error:', error);
  }
}

// Discover all Salesforce tabs and extract sessions
async function discoverAllSalesforceTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    
    // Filter Salesforce tabs first
    const sfTabs = tabs.filter(tab => 
      tab.url && 
      !tab.url.startsWith('chrome-extension://') &&
      (tab.url.includes('salesforce.com') || tab.url.includes('force.com') ||
       tab.url.includes('cloudforce.com') || tab.url.includes('visualforce.com'))
    );
    
    // Process all tabs in parallel for faster discovery
    await Promise.all(sfTabs.map(async (tab) => {
      try {
        const session = await extractSessionFromTab(tab.id);
        if (session) {
          await addEnvironment(session);
        }
      } catch (error) {
        console.warn('[DEBUG] discoverAllSalesforceTabs tab error:', error);
      }
    }));
    
    // Save state after discovery
    await saveState();
    
    // Notify window if it's open
    notifyWindow();
    
  } catch (error) {
    console.error('[DEBUG] [ENV] Error discovering tabs:', error);
  }
}

// Notify window about environment updates
function notifyWindow() {
  if (!logViewerWindowId) return;
  
  chrome.windows.get(logViewerWindowId, (window) => {
    if (window && window.tabs && window.tabs.length > 0) {
      const tabId = window.tabs[0].id;
      chrome.tabs.sendMessage(tabId, {
        action: 'environments-updated',
        environments: Object.values(environments)
      }).catch(() => {});
    }
  });
}

// Extract session from tab
async function extractSessionFromTab(tabId) {
  try {
    // First check the tab URL
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url) {
      return null;
    }
    
    // Check if it's a chrome-extension URL or non-Salesforce URL
    if (tab.url.startsWith('chrome-extension://')) {
      return null;
    }
    if (!tab.url.includes('salesforce.com') && !tab.url.includes('force.com') && 
        !tab.url.includes('cloudforce.com') && !tab.url.includes('visualforce.com')) {
      return null;
    }


    // First get the correct Salesforce host
    const sfHost = await getSfHost(tab.url, tab.cookieStoreId);

    if (!sfHost) {
      return null;
    }

    // Now get the session from the correct host
    const session = await getSession(sfHost, tab.cookieStoreId);
    
    if (session) {
      return {
        sessionId: session.key,
        instanceUrl: `https://${session.hostname}`,
        hostname: session.hostname
      };
    }
    
    return null;
  } catch (error) {
    console.error('Extract session failed:', error);
    return null;
  }
}

// Get the correct Salesforce host (from the reference project)
async function getSfHost(url, cookieStoreId) {
  try {
    const currentDomain = new URL(url).hostname;
    
    // First try to get the sid from current URL
    const currentSid = await chrome.cookies.get({
      url: url,
      name: "sid",
      storeId: cookieStoreId
    });
    
    if (!currentSid) {
      return currentDomain;
    }
    
    // If we have a sid, extract the org ID and find the correct domain
    const [orgId] = currentSid.value.split("!");
    const orderedDomains = [
      "salesforce.com", 
      "cloudforce.com", 
      "salesforce.mil", 
      "cloudforce.mil", 
      "sfcrmproducts.cn", 
      "force.com",
      "my.salesforce.com",
      "lightning.force.com"
    ];
    
    // Check each domain in order
    for (const domain of orderedDomains) {
      try {
        const cookies = await chrome.cookies.getAll({
          name: "sid",
          domain: domain,
          secure: true,
          storeId: cookieStoreId
        });
        
        const sessionCookie = cookies.find(c => 
          c.value.startsWith(orgId + "!") && 
          c.domain !== "help.salesforce.com"
        );
        
        if (sessionCookie) {
          return sessionCookie.domain;
        }
      } catch (error) {
        console.error('[DEBUG] getSfHost domain check error:', error);
      }
    }
    
    // Fall back to current domain
    return currentDomain;
  } catch (error) {
    console.error('Error in getSfHost:', error);
    try {
      return new URL(url).hostname;
    } catch {
      return null;
    }
  }
}

// Get session from host (from the reference project)
async function getSession(sfHost, cookieStoreId) {
  try {
    const cookie = await chrome.cookies.get({
      name: "sid",
      storeId: cookieStoreId,
      url: "https://" + sfHost
    });
    
    if (!cookie) {
      return null;
    }
    
    return {
      key: cookie.value,
      hostname: cookie.domain
    };
  } catch (error) {
    console.error('Error in getSession:', error);
    return null;
  }
}

// Add new environment
async function addEnvironment(session) {
  const envId = generateEnvId(session.instanceUrl);
  
  // Check if already exists
  if (environments[envId]) {
    // Update existing session and CLEAR old userName to force re-fetch
    environments[envId] = {
      ...environments[envId],
      sessionId: session.sessionId,
      instanceUrl: session.instanceUrl,
      hostname: session.hostname,
      connectedAt: Date.now(),
      userName: undefined // Clear old user name to force re-fetch
    };
  } else {
    environments[envId] = {
      id: envId,
      name: getEnvName(session.instanceUrl),
      sessionId: session.sessionId,
      instanceUrl: session.instanceUrl,
      hostname: session.hostname,
      connectedAt: Date.now()
    };
  }
  
  return envId;
}

// Generate environment ID from URL
function generateEnvId(instanceUrl) {
  const hostname = new URL(instanceUrl).hostname;
  return btoa(hostname).replace(/[^a-zA-Z0-9]/g, '');
}

// Get environment display name
function getEnvName(instanceUrl) {
  const hostname = new URL(instanceUrl).hostname;
  if (hostname.includes('sandbox') || hostname.includes('cs')) {
    return 'Sandbox';
  }
  if (hostname.includes('test')) {
    return 'Test';
  }
  return 'Production';
}

// Test connection
async function testConnection(envId) {
  const env = environments[envId];
  if (!env) return { success: false, error: 'Environment not found' };
  
  try {
    const url = `${env.instanceUrl}/services/data/${SALESFORCE_API_VERSION}/limits`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${env.sessionId}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      return { success: true };
    } else if (response.status === 401) {
      // Session expired
      delete environments[envId];
      await saveState();
      return { success: false, error: 'Session expired' };
    } else {
      return { success: false, error: 'Connection failed' };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Make API request
async function makeApiRequest(endpoint, options = {}) {
  const env = environments[activeEnvId];
  if (!env) {
    throw new Error('No active environment');
  }
  
  const url = env.instanceUrl + endpoint;
  
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${env.sessionId}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    
    if (response.status === 401) {
      // Mark environment as expired but don't delete immediately
      environments[activeEnvId].sessionExpired = true;
      await saveState();
      
      // Try to refresh session from active Salesforce tabs
      const refreshed = await tryRefreshSession(activeEnvId);
      if (refreshed) {
        // Retry with new session
        return await makeApiRequest(endpoint, options);
      }
      
      throw new Error('Session expired');
    }
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} - ${errorText}`);
    }
    
    if (response.status === 204) {
      return null;
    }
    
    return await response.json();
  } catch (error) {
    throw error;
  }
}

// Try to refresh session by looking for active Salesforce tabs
async function tryRefreshSession(envId) {
  try {
    const env = environments[envId];
    if (!env) return false;
    
    // Get all tabs
    const tabs = await chrome.tabs.query({});
    
    for (const tab of tabs) {
      if (tab.url && (tab.url.includes('salesforce.com') || tab.url.includes('force.com'))) {
        try {
          const session = await extractSessionFromTab(tab.id);
          if (session) {
            const newEnvId = generateEnvId(session.instanceUrl);
            if (newEnvId === envId) {
              // Update the session
              environments[envId] = {
                ...environments[envId],
                sessionId: session.sessionId,
                sessionExpired: false,
                connectedAt: Date.now()
              };
              await saveState();
              return true;
            }
          }
        } catch (e) {
        }
      }
    }
    return false;
  } catch (error) {
    console.error('Error in tryRefreshSession:', error);
    return false;
  }
}

// Fetch Apex Logs
async function fetchApexLogs(limit = 50) {
  const env = environments[activeEnvId];
  if (!env) {
    throw new Error('No active environment');
  }
  
  const soql = `
    SELECT Id, Status, Request, Operation, Application,
           StartTime, Location, LogUserId, LogUser.Name,
           DurationMilliseconds, LogLength
    FROM ApexLog
    ORDER BY StartTime DESC, Id DESC
    LIMIT ${limit}
  `.replace(/\s+/g, ' ').trim();
  
  const query = encodeURIComponent(soql);
  const result = await makeApiRequest(`/services/data/${SALESFORCE_API_VERSION}/query/?q=${query}`);
  
  return result;
}

// Fetch current user name via API
async function fetchCurrentUserName(envId) {
  
  const env = environments[envId];
  
  if (!env) {
    return null;
  }
  
  try {
    // Use Chatter API to get current user
    const endpoint = `/services/data/${SALESFORCE_API_VERSION}/chatter/users/me`;
    
    const result = await makeApiRequestForEnv(envId, endpoint);
    
    if (result?.name) {
      const userName = result.name;
      return userName;
    } else if (result) {
    }
    return null;
  } catch (error) {
    console.error('[DEBUG] [USER-FLOW] fetchCurrentUserName error:', error.message);
    return null;
  }
}

// Debug Level name for Apex Log Viewer
const DEBUG_LEVEL_NAME = 'ApexLogViewer_Debug';

// Create or get DebugLevel for trace flag (using Tooling API)
async function getOrCreateDebugLevel(envId) {
  
  try {
    // First, try to find existing DebugLevel (Tooling API)
    const soql = `SELECT Id FROM DebugLevel WHERE DeveloperName = '${DEBUG_LEVEL_NAME}' LIMIT 1`;
    const queryResult = await makeApiRequestForEnv(envId, `/services/data/${SALESFORCE_API_VERSION}/tooling/query/?q=${encodeURIComponent(soql)}`);
    
    if (queryResult?.records?.length > 0) {
      return queryResult.records[0].Id;
    }
    
    // Create new DebugLevel if not found (Tooling API)
    // All categories set to 'Finest' for maximum detail
    const debugLevelData = {
      DeveloperName: DEBUG_LEVEL_NAME,
      MasterLabel: 'Apex Log Viewer Debug',
      ApexCode: 'Finest',
      ApexProfiling: 'Finest',
      Callout: 'Finest',
      Database: 'Finest',
      System: 'Finest',
      Validation: 'Finest',
      Visualforce: 'Finest',
      Workflow: 'Finest'
    };
    
    const endpoint = `/services/data/${SALESFORCE_API_VERSION}/tooling/sobjects/DebugLevel`;
    
    const createResult = await makeApiRequestForEnv(envId, endpoint, {
      method: 'POST',
      body: JSON.stringify(debugLevelData)
    });
    
    
    if (createResult?.id) {
      return createResult.id;
    }
    
    console.error('[DEBUG] [TRACE-FLAG] Failed to create DebugLevel:', createResult);
    return null;
  } catch (error) {
    console.error('[DEBUG] [TRACE-FLAG] getOrCreateDebugLevel error:', error.message);
    return null;
  }
}

// Create or update TraceFlag for current user (using Tooling API)
async function createTraceFlag(envId, debugLevelId, durationMinutes = 60) {
  
  if (!debugLevelId) {
    console.error('[DEBUG] [TRACE-FLAG] No DebugLevelId provided');
    return null;
  }
  
  try {
    // First, get current user ID (using Chatter API - not Tooling API)
    const userInfo = await makeApiRequestForEnv(envId, `/services/data/${SALESFORCE_API_VERSION}/chatter/users/me`);
    
    if (!userInfo?.id) {
      console.error('[DEBUG] [TRACE-FLAG] Could not get current user ID');
      return null;
    }
    
    const userId = userInfo.id;
    
    // Check if there's ANY existing TraceFlag for this user
    // Salesforce doesn't allow multiple TraceFlags for the same user
    const soql = `SELECT Id, DebugLevelId FROM TraceFlag WHERE TracedEntityId = '${userId}' LIMIT 1`;
    
    const existingResult = await makeApiRequestForEnv(envId, `/services/data/${SALESFORCE_API_VERSION}/tooling/query/?q=${encodeURIComponent(soql)}`);
    
    // Calculate new expiration date (durationMinutes from now)
    const startDate = new Date();
    const expirationDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);
    
    let resultId = null;
    
    if (existingResult?.records?.length > 0) {
      // Update existing TraceFlag - renew expiration date
      // Note: StartDate is read-only after creation, can only update ExpirationDate
      const existingId = existingResult.records[0].Id;
      const existingDebugLevelId = existingResult.records[0].DebugLevelId;
      
      const updateData = {
        ExpirationDate: expirationDate.toISOString()
      };
      
      // Also update DebugLevelId if it's different
      if (existingDebugLevelId !== debugLevelId) {
        updateData.DebugLevelId = debugLevelId;
      }
      
      console.log('[DEBUG] [TRACE-FLAG] Updating existing TraceFlag:', existingId, 'with data:', updateData);
      
      const updateEndpoint = `/services/data/${SALESFORCE_API_VERSION}/tooling/sobjects/TraceFlag/${existingId}`;
      
      try {
        await makeApiRequestForEnv(envId, updateEndpoint, {
          method: 'PATCH',
          body: JSON.stringify(updateData)
        });
        
        console.log('[DEBUG] [TRACE-FLAG] Update success, new expiration:', expirationDate.toISOString());
        resultId = existingId;
      } catch (updateError) {
        console.error('[DEBUG] [TRACE-FLAG] Update failed:', updateError.message);
        throw updateError;
      }
    } else {
      // Create new TraceFlag
      
      const traceFlagData = {
        TracedEntityId: userId,
        DebugLevelId: debugLevelId,
        LogType: 'USER_DEBUG',
        StartDate: startDate.toISOString(),
        ExpirationDate: expirationDate.toISOString()
      };
      
      
      const createEndpoint = `/services/data/${SALESFORCE_API_VERSION}/tooling/sobjects/TraceFlag`;
      
      const createResult = await makeApiRequestForEnv(envId, createEndpoint, {
        method: 'POST',
        body: JSON.stringify(traceFlagData)
      });
      
      
      if (createResult?.id) {
        resultId = createResult.id;
      } else {
        console.error('[DEBUG] [TRACE-FLAG] Failed to create TraceFlag:', createResult);
      }
    }
    
    return resultId;
  } catch (error) {
    console.error('[DEBUG] [TRACE-FLAG] createTraceFlag error:', error.message);
    return null;
  }
}

// Enable debug logging by creating TraceFlag
async function enableDebugLogging(envId, durationMinutes = 60) {
  
  try {
    // Step 1: Get or create DebugLevel
    const debugLevelId = await getOrCreateDebugLevel(envId);
    if (!debugLevelId) {
      console.error('[DEBUG] [TRACE-FLAG] Could not get or create DebugLevel');
      return false;
    }
    
    // Step 2: Create TraceFlag for current user
    const traceFlagId = await createTraceFlag(envId, debugLevelId, durationMinutes);
    if (!traceFlagId) {
      console.error('[DEBUG] [TRACE-FLAG] Could not create TraceFlag');
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('[DEBUG] [TRACE-FLAG] enableDebugLogging error:', error.message);
    return false;
  }
}

// Get Process Automated user ID by SOQL query
async function getProcessAutomatedUserId(envId) {
  const soql = "SELECT Id FROM User WHERE Name = 'Process Automated' LIMIT 1";
  const queryResult = await makeApiRequestForEnv(
    envId,
    `/services/data/${SALESFORCE_API_VERSION}/query/?q=${encodeURIComponent(soql)}`
  );

  if (queryResult && queryResult.records && queryResult.records.length > 0) {
    return queryResult.records[0].Id;
  }
  return null;
}

// Create or renew TraceFlag for Process Automated user
async function createOrRenewProcessAutomatedTraceFlag(envId, debugLevelId, userId, durationMinutes = 60) {
  // Check if there's ANY existing TraceFlag for this user
  // Salesforce doesn't allow multiple TraceFlags for the same user
  const soql = `SELECT Id, DebugLevelId FROM TraceFlag WHERE TracedEntityId = '${userId}' LIMIT 1`;
  const existingResult = await makeApiRequestForEnv(
    envId,
    `/services/data/${SALESFORCE_API_VERSION}/tooling/query/?q=${encodeURIComponent(soql)}`
  );

  const startDate = new Date();
  const expirationDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);

  if (existingResult && existingResult.records && existingResult.records.length > 0) {
    // Update existing TraceFlag - renew expiration date only
    // Note: StartDate is read-only after creation
    const existingId = existingResult.records[0].Id;
    const existingDebugLevelId = existingResult.records[0].DebugLevelId;
    
    const updateData = {
      ExpirationDate: expirationDate.toISOString()
    };
    
    // Also update DebugLevelId if it's different
    if (existingDebugLevelId !== debugLevelId) {
      updateData.DebugLevelId = debugLevelId;
    }
    
    await makeApiRequestForEnv(
      envId,
      `/services/data/${SALESFORCE_API_VERSION}/tooling/sobjects/TraceFlag/${existingId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(updateData)
      }
    );
    return existingId;
  } else {
    // Create new TraceFlag
    const createResult = await makeApiRequestForEnv(
      envId,
      `/services/data/${SALESFORCE_API_VERSION}/tooling/sobjects/TraceFlag`,
      {
        method: 'POST',
        body: JSON.stringify({
          TracedEntityId: userId,
          DebugLevelId: debugLevelId,
          LogType: 'USER_DEBUG',
          StartDate: startDate.toISOString(),
          ExpirationDate: expirationDate.toISOString()
        })
      }
    );

    if (createResult && createResult.id) {
      return createResult.id;
    }
    return null;
  }
}

// Main function: Track Process Automated - find user, create/renew TraceFlag
async function trackProcessAutomated(envId, durationMinutes = 60) {
  try {
    // Step 1: Find Process Automated user
    const userId = await getProcessAutomatedUserId(envId);
    if (!userId) {
      return { success: false, error: '未找到 Process Automated 用户' };
    }

    // Step 2: Get or create DebugLevel (reuse existing function)
    const debugLevelId = await getOrCreateDebugLevel(envId);
    if (!debugLevelId) {
      return { success: false, error: '无法获取 DebugLevel' };
    }

    // Step 3: Create or renew TraceFlag for Process Automated
    const traceFlagId = await createOrRenewProcessAutomatedTraceFlag(envId, debugLevelId, userId, durationMinutes);
    if (!traceFlagId) {
      return { success: false, error: '无法创建/续期 TraceFlag' };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Make API request for specific environment
async function makeApiRequestForEnv(envId, endpoint, options = {}) {
  
  const env = environments[envId];
  
  if (!env) {
    throw new Error('Environment not found');
  }
  
  const url = env.instanceUrl + endpoint;
  
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${env.sessionId}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    
    if (response.status === 401) {
      throw new Error('Session expired');
    }
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} - ${errorText}`);
    }
    
    if (response.status === 204) {
      return null;
    }
    
    const jsonResult = await response.json();
    return jsonResult;
  } catch (error) {
    throw error;
  }
}

// Fetch log body
async function fetchLogBody(logId) {
  const env = environments[activeEnvId];
  if (!env) {
    throw new Error('No active environment');
  }
  
  const url = `${env.instanceUrl}/services/data/${SALESFORCE_API_VERSION}/sobjects/ApexLog/${logId}/Body`;
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${env.sessionId}`
      }
    });
    
    if (response.status === 401) {
      environments[activeEnvId].sessionExpired = true;
      await saveState();
      
      const refreshed = await tryRefreshSession(activeEnvId);
      if (refreshed) {
        return await fetchLogBody(logId);
      }
      
      throw new Error('Session expired');
    }
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} - ${errorText}`);
    }
    
    return await response.text();
  } catch (error) {
    throw error;
  }
}

// Start polling
function startPolling(callback, intervalMs = 3000) {
  stopPolling();
  
  pollingInterval = setInterval(async () => {
    if (activeEnvId && environments[activeEnvId] && !environments[activeEnvId].sessionExpired) {
      try {
        const result = await fetchApexLogs();
        callback(null, result);
      } catch (error) {
        // If session expired, stop polling
        if (error.message === 'Session expired') {
          stopPolling();
          callback(error, null);
        } else {
          callback(error, null);
        }
      }
    }
  }, intervalMs);
  
  // Initial fetch
  if (activeEnvId && environments[activeEnvId] && !environments[activeEnvId].sessionExpired) {
    (async () => {
      try {
        const result = await fetchApexLogs();
        callback(null, result);
      } catch (error) {
        callback(error, null);
      }
    })();
  }
}

// Stop polling
function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

// Save state to storage
async function saveState() {
  await chrome.storage.local.set({
    'salesforce-environments': environments,
    'salesforce-active-env': activeEnvId
  });
}

// Load state from storage
async function loadState() {
  const result = await chrome.storage.local.get([
    'salesforce-environments',
    'salesforce-active-env'
  ]);
  
  environments = result['salesforce-environments'] || {};
  activeEnvId = result['salesforce-active-env'];
}

// Initialize
loadState();

// Handle messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.action) {
        case 'connect-to-tab': {
          const session = await extractSessionFromTab(message.tabId);
          if (!session) {
            sendResponse({ success: false, error: 'Could not extract session' });
            return;
          }
          
          const envId = await addEnvironment(session);
          const testResult = await testConnection(envId);
          
          if (testResult.success) {
            activeEnvId = envId;
            environments[envId].sessionExpired = false;
            
            // Fetch and save current user name
            const userName = await fetchCurrentUserName(envId);
            if (userName) {
              environments[envId].userName = userName;
            }
            
            // Enable debug logging (create TraceFlag)
            await enableDebugLogging(envId);
            
            await saveState();
            sendResponse({ 
              success: true, 
              envId, 
              environments: Object.values(environments),
              userName: environments[envId].userName
            });
          } else {
            sendResponse({ success: false, error: testResult.error });
          }
          break;
        }
        
        case 'refresh-session': {
          if (!message.tabId) {
            sendResponse({ success: false, error: 'No tab ID provided' });
            return;
          }
          
          const session = await extractSessionFromTab(message.tabId);
          if (!session) {
            sendResponse({ success: false, error: 'Could not extract session' });
            return;
          }
          
          const envId = await addEnvironment(session);
          const testResult = await testConnection(envId);
          
          if (testResult.success) {
            if (!activeEnvId) {
              activeEnvId = envId;
            }
            environments[envId].sessionExpired = false;
            
            // Fetch and save current user name
            const userName = await fetchCurrentUserName(envId);
            if (userName) {
              environments[envId].userName = userName;
            }
            
            // Enable debug logging (create TraceFlag)
            await enableDebugLogging(envId);
            
            await saveState();
            sendResponse({ 
              success: true, 
              envId, 
              environments: Object.values(environments),
              userName: environments[envId].userName
            });
          } else {
            sendResponse({ success: false, error: testResult.error });
          }
          break;
        }
        
        case 'disconnect': {
          delete environments[message.envId];
          if (activeEnvId === message.envId) {
            activeEnvId = null;
            stopPolling();
          }
          await saveState();
          sendResponse({ success: true, environments: Object.values(environments) });
          break;
        }
        
        case 'refresh-environments': {
          await discoverAllSalesforceTabs();
          await saveState();
          sendResponse({ 
            success: true, 
            environments: Object.values(environments),
            activeEnvId 
          });
          break;
        }
        
        case 'switch-environment': {
          const testResult = await testConnection(message.envId);
          if (testResult.success) {
            activeEnvId = message.envId;
            
            // Fetch user name if not already present
            const env = environments[message.envId];
            if (env && !env.userName) {
              const userName = await fetchCurrentUserName(message.envId);
              if (userName) {
                env.userName = userName;
              }
            }
            
            await saveState();
            sendResponse({ 
              success: true, 
              environments: Object.values(environments),
              userName: environments[message.envId]?.userName
            });
          } else {
            sendResponse({ success: false, error: testResult.error });
          }
          break;
        }
        
        case 'get-state': {
          sendResponse({
            success: true,
            environments: Object.values(environments),
            activeEnvId,
            currentUserName: activeEnvId ? environments[activeEnvId]?.userName : null
          });
          break;
        }
        
        case 'clear-all-sessions': {
          // 关闭插件时清空所有 Session 数据
          environments = {};
          activeEnvId = null;
          await chrome.storage.local.remove('salesforce-environments');
          sendResponse({ success: true });
          break;
        }
        
        case 'fetch-logs': {
          if (!activeEnvId) {
            sendResponse({ success: false, error: 'No active environment' });
            return;
          }
          
          const logs = await fetchApexLogs(message.limit);
          sendResponse({ success: true, data: logs });
          break;
        }
        
        case 'fetch-log-body': {
          if (!activeEnvId) {
            sendResponse({ success: false, error: 'No active environment' });
            return;
          }
          
          const body = await fetchLogBody(message.logId);
          sendResponse({ success: true, data: body });
          break;
        }
        
        case 'start-polling': {
          startPolling((error, data) => {
            chrome.runtime.sendMessage({
              action: 'polling-update',
              error: error?.message,
              data
            });
          }, message.interval || 3000);
          sendResponse({ success: true });
          break;
        }
        
        case 'stop-polling': {
          stopPolling();
          sendResponse({ success: true });
          break;
        }
        
        case 'renew-traceflag': {
          if (!activeEnvId) {
            sendResponse({ success: false, error: 'No active environment' });
            return;
          }
          
          // 接收前端传递的续期间隔参数（分钟）
          const durationMinutes = message.duration || 60;
          const result = await enableDebugLogging(activeEnvId, durationMinutes);
          
          if (result) {
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'Failed to renew TraceFlag' });
          }
          break;
        }

        case 'track-process-automated': {
          if (!activeEnvId) {
            sendResponse({ success: false, error: 'No active environment' });
            return;
          }

          // 接收前端传递的续期间隔参数（分钟）
          const durationMinutes = message.duration || 60;
          const result = await trackProcessAutomated(activeEnvId, durationMinutes);
          sendResponse(result);
          break;
        }
        
        default: {
          sendResponse({ success: false, error: 'Unknown action' });
        }
      }
    } catch (error) {
      console.error('Message handler error:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();
  
  return true;
});
