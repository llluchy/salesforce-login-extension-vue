<template>
  <AuthScreen v-if="!isAuthed" @authed="onAuthed" />
  <div v-else class="app-container">
    <Toolbar
      :env-count="environments.length"
      :max-environments="MAX_ENVIRONMENTS"
      :account-email="currentUser?.email || ''"
      @add-env="openEditModal"
      @add-group="openGroupModal"
      @share="shareDialogVisible = true"
      @account="accountDialogVisible = true"
      @debug="debugDialogVisible = true"
    />
    
    <div class="env-list" ref="envListRef">
      <GroupSection
        v-for="group in displayGroups"
        :key="group.id"
        :group="group"
        :environments="getEnvsByGroup(group.id)"
        :groups="groups"
        @toggle-collapse="toggleGroupCollapse"
        @edit-group="openEditGroupModal"
        @delete-group="confirmDeleteGroup"
        @login="handleLogin"
        @edit-env="openEditModal"
        @clone-env="handleCloneEnv"
        @delete-env="confirmDeleteEnv"
        @copy-success="handleCopySuccess"
        @drag-env="handleEnvDrag"
      />
    </div>
    
    <EditModal
      :visible="editModalVisible"
      :env="editingEnv"
      :groups="groups"
      :is-slave="false"
      @close="closeEditModal"
      @save="handleSaveEnv"
      @add-group="handleAddGroupFromModal"
      @scan-qr="handleScanQR"
    />
    
    <GroupModal
      :visible="groupModalVisible"
      :group="editingGroup"
      @close="closeGroupModal"
      @save="handleSaveGroup"
    />
    
    <DeleteModal
      :visible="deleteModalVisible"
      :type="deleteType"
      :name="deleteName"
      @close="closeDeleteModal"
      @confirm="handleConfirmDelete"
    />

    

    <AccountDialog
      :visible="accountDialogVisible"
      @close="accountDialogVisible = false"
      @signed-out="onSignedOut"
    />

    <ShareDialog
      :visible="shareDialogVisible"
      :environments="environments"
      @close="shareDialogVisible = false"
      @accepted="handleShareAccepted"
    />

    <Toast
      :visible="toastVisible"
      :message="toastMessage"
      :type="toastType"
      @close="closeToast"
    />

    <PasskeyDebugger v-if="debugDialogVisible" @close="debugDialogVisible = false" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import Sortable from 'sortablejs'
import { MAX_ENVIRONMENTS } from './utils/constants'
import { generateUuid } from './utils/crypto'
import { useStorage } from './composables/useStorage'
import { useAuth } from './composables/useAuth'
import { migrateLocalToSupabase } from './utils/migration'
import { useLogin } from './composables/useLogin'
import { initPasskeyBridge, destroyPasskeyBridge } from './composables/usePasskeyBridge'
import { useTotp } from './composables/useTotp'
import syncLog from './utils/syncLogger'
import Toolbar from './components/Toolbar.vue'
import GroupSection from './components/GroupSection.vue'
import EditModal from './components/EditModal.vue'
import GroupModal from './components/GroupModal.vue'
import DeleteModal from './components/DeleteModal.vue'
import Toast from './components/Toast.vue'
import AuthScreen from './components/AuthScreen.vue'
import AccountDialog from './components/AccountDialog.vue'
import ShareDialog from './components/ShareDialog.vue'
import PasskeyDebugger from './components/PasskeyDebugger.vue'

const { loadEnvironments, saveEnvironments, deleteEnvironment, loadGroups, saveGroups, deleteGroup } = useStorage()
const { isAuthed, getCryptoKeyRaw, currentUser, getSession, getUnlockStatus } = useAuth()
const { login } = useLogin()
const { generateCode, fillTotpCode } = useTotp()

const environments = ref([])
const groups = ref([])
const envListRef = ref(null)
const toolbarRef = ref(null)

const editModalVisible = ref(false)
const groupModalVisible = ref(false)
const deleteModalVisible = ref(false)
const toastVisible = ref(false)
const manualBindVisible = ref(false)
const accountDialogVisible = ref(false)
const shareDialogVisible = ref(false)
const debugDialogVisible = ref(false)

const editingEnv = ref(null)
const editingGroup = ref(null)
const deleteType = ref('env')
const deleteName = ref('')
const deleteId = ref(null)
const manualBindEnv = ref(null)

const toastMessage = ref('')
const toastType = ref('success')

const displayGroups = computed(() => {
  const ungroupedCount = environments.value.filter(e => !e.groupId || e.groupId === 'ungrouped').length
  
  const result = []
  
  if (ungroupedCount > 0) {
    result.push({
      id: 'ungrouped',
      name: '未选择分组',
      isVirtual: true,
      collapsed: false
    })
  }
  
  result.push(...groups.value)
  
  return result
})

const getEnvsByGroup = (groupId) => {
  return environments.value.filter(env => {
    if (groupId === 'ungrouped') {
      return !env.groupId || env.groupId === 'ungrouped'
    }
    return env.groupId === groupId
  })
}

const showToast = (message, type = 'success') => {
  toastMessage.value = message
  toastType.value = type
  toastVisible.value = true
  setTimeout(() => {
    toastVisible.value = false
  }, 3000)
}

const openEditModal = (env = null) => {
  editingEnv.value = env ? { ...env } : null
  editModalVisible.value = true
}

const closeEditModal = () => {
  editingEnv.value = null
  editModalVisible.value = false
}

const openGroupModal = (group = null) => {
  editingGroup.value = group ? { ...group } : null
  groupModalVisible.value = true
}

const openEditGroupModal = (group) => {
  openGroupModal(group)
}

const closeGroupModal = () => {
  editingGroup.value = null
  groupModalVisible.value = false
}

const confirmDeleteEnv = (env) => {
  deleteType.value = 'env'
  deleteName.value = env.alias || env.username
  deleteId.value = env.id
  deleteModalVisible.value = true
}

const confirmDeleteGroup = (group) => {
  deleteType.value = 'group'
  deleteName.value = group.name
  deleteId.value = group.id
  deleteModalVisible.value = true
}

const closeDeleteModal = () => {
  deleteType.value = 'env'
  deleteName.value = ''
  deleteId.value = null
  deleteModalVisible.value = false
}

const handleSaveEnv = async (env) => {
  syncLog.group('App.handleSaveEnv 保存环境')
  syncLog.info('输入', syncLog.envSummary(env))
  if (env.id) {
    const index = environments.value.findIndex(e => e.id === env.id)
    if (index !== -1) {
      environments.value[index] = env
    }
  } else {
    env.id = generateUuid()
    environments.value.push(env)
  }

  // 只保存当前新增/编辑的环境，避免全量 upsert 带来副作用
  const targetEnv = environments.value.find(e => e.id === env.id)
  const result = await saveEnvironments([targetEnv])
  syncLog.info('saveEnvironments 返回', {
    success: result?.success,
    error: result?.error
  })
  if (result?.success) {
    showToast(env.id ? '环境已更新' : '环境已创建')
  } else {
    showToast('保存失败：' + (result?.error || ''), 'error')
  }
  closeEditModal()
  syncLog.groupEnd()
}

const handleSaveGroup = async (group) => {
  if (group.id) {
    const index = groups.value.findIndex(g => g.id === group.id)
    if (index !== -1) {
      groups.value[index] = group
    }
  } else {
    group.id = generateUuid()
    groups.value.push(group)
  }
  const result = await saveGroups(groups.value)
  closeGroupModal()
  if (result?.success) {
    showToast(group.id ? '分组已更新' : '分组已创建')
  } else {
    showToast('保存失败：' + (result?.error || ''), 'error')
  }
}

const handleConfirmDelete = async () => {
  if (deleteType.value === 'env') {
    // 伪删除：仅标记数据库中的 is_deleted=true
    const result = await deleteEnvironment(deleteId.value)
    if (result?.success) {
      // 同时从本地视图移除
      environments.value = environments.value.filter(e => e.id !== deleteId.value)
      showToast('环境已删除')
    } else {
      showToast('删除失败：' + (result?.error || ''), 'error')
    }
  } else {
    const delResult = await deleteGroup(deleteId.value)
    if (!delResult?.success) {
      showToast('删除分组失败：' + (delResult?.error || ''), 'error')
      closeDeleteModal()
      return
    }
    environments.value.forEach(e => {
      if (e.groupId === deleteId.value) {
        e.groupId = 'ungrouped'
      }
    })
    groups.value = groups.value.filter(g => g.id !== deleteId.value)
    await saveEnvironments(environments.value)
    showToast('分组已删除')
  }
  closeDeleteModal()
}

const handleCloneEnv = async (env) => {
  const now = Date.now()
  const cloned = {
    ...env,
    id: generateUuid(),
    alias: `${env.alias} (克隆)`,
    createdAt: now,
    updatedAt: now
  }
  environments.value.push(cloned)
  const result = await saveEnvironments(environments.value)
  if (result?.success) {
    showToast('环境已克隆')
  } else {
    showToast('克隆失败：' + (result?.error || ''), 'error')
  }
}

const handleLogin = async (env) => {
  try {
    try {
      let passkeysToStore = [];
      if (Array.isArray(env.passkeys)) {
        passkeysToStore = env.passkeys;
      } else if (env.passkeys && typeof env.passkeys === 'object') {
        passkeysToStore = Object.values(env.passkeys);
      }
      const hasPrivateKey = passkeysToStore.length > 0 && passkeysToStore.every(pk => !!pk.privateKeyJwk);
      console.log('[handleLogin] 存储 pendingLoginEnv', { 
        envId: env.id, 
        passkeyCount: passkeysToStore.length,
        hasPrivateKey: hasPrivateKey,
        firstPkFields: passkeysToStore.length > 0 ? Object.keys(passkeysToStore[0]) : []
      });
      await chrome.storage.session.set({
        pendingLoginEnv: {
          id: env.id,
          alias: env.alias,
          username: env.username,
          password: env.password,
          type: env.type,
          customUrl: env.customUrl,
          totpSecret: env.totpSecret,
          passkeys: passkeysToStore,
          createdAt: Date.now()
        }
      })
    } catch (e) {
      console.warn('暂存 loginEnv 失败', e)
    }

    await login(env)
    showToast('登录成功')
  } catch (error) {
    showToast(error.message || '登录失败', 'error')
  }
}

// ========== Passkey 备份与恢复 ==========

const handleExportBackup = async () => {
  try {
    const [creds, envs] = await Promise.all([
      loadPasskeyCredentials(),
      loadEnvironments()
    ])

    if (creds.length === 0 && envs.length === 0) {
      showToast('没有可备份的数据', 'error')
      return
    }

    const backup = {
      version: 2,
      exportedAt: new Date().toISOString(),
      credentials: creds,
      environments: envs
    }

    const json = JSON.stringify(backup, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const filename = `salesforce-passkey-backup-${dateStr}.json`

    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    showToast(`已导出 ${creds.length} 个凭证、${envs.length} 个环境`, 'success')
  } catch (error) {
    console.error('Export backup error:', error)
    showToast(error.message || '导出失败', 'error')
  }
}

const handleImportBackupClick = () => {
  const input = toolbarRef.value?.fileInputRef
  if (input) {
    input.value = ''
    input.click()
  }
}

const handleImportBackup = async (event) => {
  const file = event.target.files?.[0]
  if (!file) return

  try {
    const text = await file.text()
    const backup = JSON.parse(text)

    if (!backup.credentials || !Array.isArray(backup.credentials)) {
      showToast('备份文件格式无效', 'error')
      return
    }

    let credCount = 0
    for (const cred of backup.credentials) {
      const r = await savePasskeyCredential(cred)
      if (r?.success) credCount++
    }

    let envCount = 0
    if (Array.isArray(backup.environments) && backup.environments.length > 0) {
      const existing = await loadEnvironments()
      const merged = [...existing]
      for (const env of backup.environments) {
        if (!merged.find(e => e.id === env.id)) {
          merged.push(env)
          envCount++
        }
      }
      await saveEnvironments(merged)
    }

    environments.value = await loadEnvironments()
    groups.value = await loadGroups()

    showToast(`导入完成：新增 ${credCount} 个凭证、${envCount} 个环境`, 'success')
  } catch (error) {
    console.error('Import backup error:', error)
    showToast(error.message || '导入失败：文件格式错误', 'error')
  }
}

// ========== 手动绑定 Passkey 凭证 ==========

const openManualBind = (env = null) => {
  manualBindEnv.value = env
  manualBindVisible.value = true
}

const closeManualBind = () => {
  manualBindVisible.value = false
  manualBindEnv.value = null
}

const handleManualBound = async ({ envId, credentialId, rpId }) => {
  if (envId) {
    const env = environments.value.find(e => e.id === envId)
    if (env) {
      if (!env.passkeys) env.passkeys = []
      const existing = env.passkeys.find(pk => pk.credentialId === credentialId)
      if (!existing) {
        env.passkeys.push({
          id: 'pk_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
          credentialId,
          rpId: rpId || 'salesforce.com',
          createdAt: Date.now()
        })
        await saveEnvironments(environments.value)
      }
    }
  }
  showToast('凭证已绑定', 'success')
}

// 暴露给外部调用（例如环境卡片右键菜单）
defineExpose({ openManualBind })

const handleShowTotp = async (env) => {
  if (env.totpSecret) {
    const code = await generateCode(env.totpSecret)
    if (code) {
      showToast(`验证码: ${code}`, 'info')
      try {
        await fillTotpCode(code)
      } catch (e) {
        console.log('Auto-fill failed, code:', code)
      }
    } else {
      showToast('无法生成验证码', 'error')
    }
  }
}

const handleAddGroupFromModal = async (groupName) => {
  const newGroup = {
    id: generateUuid(),
    name: groupName,
    isVirtual: false,
    collapsed: false
  }
  groups.value.push(newGroup)
  await saveGroups(groups.value)
  return newGroup
}

const handleCopySuccess = (code) => {
  showToast(`验证码 ${code} 已复制到剪贴板`, 'success')
}

const handleScanQR = async () => {
  try {
    const result = await scanQR()
    if (result && result.secret) {
      if (editingEnv.value) {
        editingEnv.value.totpSecret = result.secret
      }
    }
  } catch (error) {
    showToast(error || '扫码失败', 'error')
  }
}

const toggleGroupCollapse = async (groupId) => {
  if (groupId === 'ungrouped') return
  const group = groups.value.find(g => g.id === groupId)
  if (group) {
    group.collapsed = !group.collapsed
    await saveGroups(groups.value)
  }
}

const handleEnvDrag = async ({ fromGroupId, toGroupId, fromIndex, toIndex }) => {
  const fromEnvs = getEnvsByGroup(fromGroupId)
  const toEnvs = getEnvsByGroup(toGroupId)

  const movedEnv = fromEnvs[fromIndex]
  if (!movedEnv) return

  movedEnv.groupId = toGroupId

  const allEnvs = []

  displayGroups.value.forEach(group => {
    const groupEnvs = getEnvsByGroup(group.id)

    if (group.id === fromGroupId && group.id === toGroupId) {
      // 同一分组内移动
      const [removed] = groupEnvs.splice(fromIndex, 1)
      groupEnvs.splice(toIndex, 0, removed)
      allEnvs.push(...groupEnvs)
    } else if (group.id === fromGroupId) {
      // 从该分组移出
      const filtered = groupEnvs.filter(e => e.id !== movedEnv.id)
      allEnvs.push(...filtered)
    } else if (group.id === toGroupId) {
      // 移入该分组
      const before = toEnvs.slice(0, toIndex)
      const after = toEnvs.slice(toIndex)
      allEnvs.push(...before, movedEnv, ...after)
    } else {
      allEnvs.push(...groupEnvs)
    }
  })

  environments.value = allEnvs
  await saveEnvironments(environments.value)
}

let groupSortable = null

const initGroupSortable = () => {
  if (!envListRef.value) return

  if (groupSortable) {
    groupSortable.destroy()
    groupSortable = null
  }

  groupSortable = new Sortable(envListRef.value, {
    handle: '.group-drag-handle',
    animation: 150,
    ghostClass: 'group-ghost',
    chosenClass: 'group-chosen',
    dragClass: 'group-drag',
    filter: '.group-section[data-group-id="ungrouped"], .group-content',
    preventOnFilter: true,
    onMove: (evt) => {
      const related = evt.related
      if (related) {
        const content = related.closest('.group-content')
        if (content) {
          return false
        }
      }
      return true
    },
    onEnd: (evt) => {
      if (evt.to && evt.to !== envListRef.value) {
        return
      }

      const ungroupedCount = environments.value.filter(e => !e.groupId || e.groupId === 'ungrouped').length
      const offset = ungroupedCount > 0 ? 1 : 0
      
      const fromIndex = evt.oldIndex - offset
      const toIndex = evt.newIndex - offset

      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return

      const realGroups = [...groups.value]
      if (fromIndex >= 0 && fromIndex < realGroups.length &&
          toIndex >= 0 && toIndex < realGroups.length) {
        const [moved] = realGroups.splice(fromIndex, 1)
        realGroups.splice(toIndex, 0, moved)
        groups.value = realGroups
        saveGroups(groups.value)
      }
    }
  })
}

const closeToast = () => {
  toastVisible.value = false
}

// ========== 登录态与数据加载 ==========

const loadData = async () => {
  syncLog.group('App.loadData 加载数据')
  try {
    console.log('[App] loadData 开始，当前 isAuthed:', isAuthed.value)
    console.log('[App] loadData 当前 currentUser:', currentUser.value)
    
    environments.value = await loadEnvironments()
    console.log('[App] loadEnvironments 返回', environments.value.length, '个环境')
    
    groups.value = await loadGroups()
    console.log('[App] loadGroups 返回', groups.value.length, '个分组')
    
    syncLog.info('加载完成', {
      envs: environments.value.length,
      groups: groups.value.length
    })
    nextTick(() => {
      initGroupSortable()
    })
  } catch (e) {
    syncLog.error('加载数据失败', e)
    showToast('加载数据失败：' + (e.message || ''), 'error')
  } finally {
    syncLog.groupEnd()
  }
}

// 防止 onAuthed 被重复触发（emit + watch 可能同时触发）
let _onAuthedRunning = false

const onAuthed = async () => {
  if (_onAuthedRunning) {
    console.log('[App] onAuthed 正在执行中，跳过重复触发')
    return
  }
  _onAuthedRunning = true
  syncLog.info('App.onAuthed 登录成功，开始加载数据')

  // 首次登录时尝试迁移本地旧数据到 Supabase（云端有数据则自动跳过）
  try {
    console.log('[App] onAuthed 开始迁移检查')
    const result = await migrateLocalToSupabase()
    console.log('[App] onAuthed 迁移结果', result)
    if (result?.success) {
      const m = result.migrated
      showToast(`已迁移 ${m.environments} 个环境、${m.groups} 个分组、${m.passkeys} 个凭证到云端`, 'success')
    }
  } catch (e) {
    syncLog.error('迁移本地数据失败', e)
    console.error('[App] onAuthed 迁移异常', e)
  }

  console.log('[App] onAuthed 初始化 Passkey Bridge')
  try {
    initPasskeyBridge()
    console.log('[App] onAuthed Passkey Bridge 初始化完成')
  } catch (e) {
    syncLog.error('初始化 Passkey Bridge 失败', e)
    console.error('[App] onAuthed Passkey Bridge 异常', e)
  }

  console.log('[App] onAuthed 调用 loadData')
  try {
    await loadData()
    console.log('[App] onAuthed loadData 完成')
  } catch (e) {
    syncLog.error('加载数据失败', e)
    console.error('[App] onAuthed loadData 异常', e)
  } finally {
    _onAuthedRunning = false
  }
}

// 监听 isAuthed 变化，当登录状态变为 true 时自动触发数据加载
// 解决 AuthScreen 在 signIn 后立即销毁导致 emit('authed') 失效的问题
let _authTriggered = false
watch(isAuthed, (newVal, oldVal) => {
  if (newVal === true && oldVal === false && !_authTriggered) {
    _authTriggered = true
    console.log('[App] watch isAuthed 触发 onAuthed')
    onAuthed().catch(err => {
      console.error('[App] watch onAuthed 异常', err)
    }).finally(() => {
      _authTriggered = false
    })
  }
})

const onSignedOut = () => {
  syncLog.info('App.onSignedOut 退出登录，清空本地视图')
  destroyPasskeyBridge()
  accountDialogVisible.value = false
  environments.value = []
  groups.value = []
  if (groupSortable) {
    groupSortable.destroy()
    groupSortable = null
  }
}

// 接受分享成功后刷新环境列表
const handleShareAccepted = async () => {
  syncLog.info('App.handleShareAccepted 接受分享成功，刷新环境列表')
  try {
    const envs = await loadEnvironments()
    environments.value = envs
    showToast('已添加副环境')
  } catch (e) {
    console.error('[App] handleShareAccepted 刷新失败', e)
  }
}

onMounted(async () => {
  syncLog.group('App.onMounted 应用启动')

  // 输出当前扩展运行环境概览
  try {
    const runtimeInfo = {
      extensionId: chrome.runtime?.id,
      manifestVersion: chrome.runtime?.getManifest?.()?.manifest_version,
      extensionVersion: chrome.runtime?.getManifest?.()?.version,
      extensionName: chrome.runtime?.getManifest?.()?.name,
      isDev: !('update_url' in (chrome.runtime?.getManifest?.() || {})),
      hasStorageLocal: !!(chrome.storage && chrome.storage.local)
    }
    runtimeInfo.isFromWebStore = !runtimeInfo.isDev
    syncLog.info('扩展运行环境', runtimeInfo)
  } catch (e) {
    syncLog.warn('获取运行时信息失败', e.message)
  }

  // 检查 Supabase 登录态
  // 流程：
  //   1. getSession 恢复 currentUser（如有持久 session）
  //   2. 检查今日解锁计数器
  //   3. 若今日已解锁且 session 有效 → 自动进入主页（但需要密码才能解密数据）
  //   4. 否则 → AuthScreen 显示要求输入密码
  try {
    await getSession()
    const unlockStatus = await getUnlockStatus()
    syncLog.info('会话检查完成', {
      isAuthed: isAuthed.value,
      hasCryptoKey: !!getCryptoKeyRaw(),
      hasCurrentUser: !!currentUser.value,
      unlockStatus
    })

    // 若 getSession 已恢复 session 且今日已解锁过 → 直接进入主页
    if (currentUser.value && !unlockStatus.needPassword) {
      // 但 isAuthed 还是 false（密钥未派生），数据需要密码才能解密
      // 这种情况显示 AuthScreen 但提示已登录
      syncLog.info('今日已解锁过密码，等待用户输入密码派生密钥')
    }
    // 否则 AuthScreen 自动显示
  } catch (e) {
    syncLog.error('会话检查失败', e)
  }

  syncLog.groupEnd()
})

onBeforeUnmount(() => {
  destroyPasskeyBridge()
  if (groupSortable) {
    groupSortable.destroy()
    groupSortable = null
  }
})
</script>

<style scoped>
.app-container {
  min-height: 100vh;
  background-color: #eef5fc;
}

.env-list {
  padding: 10px;
}

:global(.group-ghost) {
  opacity: 0.4;
  background-color: #e3f2fd !important;
  border: 2px dashed #1976d2 !important;
}

:global(.group-chosen) {
  background-color: #bbdefb;
}

:global(.group-drag) {
  opacity: 0.85;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  transition: none !important;
}
</style>