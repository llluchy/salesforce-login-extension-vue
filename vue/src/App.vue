<template>
  <div class="app-container">
    <VerificationHelper
      :environments="environments"
      :auth-request="passkeyAuthRequest"
      @select-env="handleSelectEnvForPasskey"
      @create-env="handleCreateEnvForPasskey"
      @dismiss="handleDismissPasskey"
    />

    <Toolbar
      ref="toolbarRef"
      :env-count="environments.length"
      :max-environments="MAX_ENVIRONMENTS"
      @add-env="openEditModal"
      @add-group="openGroupModal"
      @test-passkey="testPasskeyFlow"
      @export-backup="handleExportBackup"
      @import-backup="handleImportBackupClick"
      @import-file="handleImportBackup"
      @manual-bind="openManualBind()"
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

    <ManualBindModal
      :visible="manualBindVisible"
      :env="manualBindEnv"
      :environments="environments"
      @close="closeManualBind"
      @bound="handleManualBound"
    />

    <Toast
      :visible="toastVisible"
      :message="toastMessage"
      :type="toastType"
      @close="closeToast"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import Sortable from 'sortablejs'
import { MAX_ENVIRONMENTS } from './utils/constants'
import { useStorage } from './composables/useStorage'
import { useLogin } from './composables/useLogin'
import { useTotp } from './composables/useTotp'
import { usePasskey } from './composables/usePasskey'
import Toolbar from './components/Toolbar.vue'
import GroupSection from './components/GroupSection.vue'
import EditModal from './components/EditModal.vue'
import GroupModal from './components/GroupModal.vue'
import DeleteModal from './components/DeleteModal.vue'
import Toast from './components/Toast.vue'
import VerificationHelper from './components/VerificationHelper.vue'
import ManualBindModal from './components/ManualBindModal.vue'

const { loadEnvironments, saveEnvironments, loadGroups, saveGroups } = useStorage()
const { login } = useLogin()
const { generateCode, fillTotpCode } = useTotp()
const { authRequest: passkeyAuthRequest, dismissAuthRequest, notifyPasskeySelected, triggerMockAuthRequest } = usePasskey()

const environments = ref([])
const groups = ref([])
const envListRef = ref(null)
const toolbarRef = ref(null)

const editModalVisible = ref(false)
const groupModalVisible = ref(false)
const deleteModalVisible = ref(false)
const toastVisible = ref(false)
const manualBindVisible = ref(false)

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
  if (env.id) {
    const index = environments.value.findIndex(e => e.id === env.id)
    if (index !== -1) {
      environments.value[index] = env
    }
  } else {
    env.id = Date.now().toString()
    environments.value.push(env)
  }
  
  if (pendingPasskeyAuthRequest.value) {
    console.log('[App] 在创建环境时存在 pendingPasskeyAuthRequest', pendingPasskeyAuthRequest.value)
    await bindPasskeyToEnv(env, pendingPasskeyAuthRequest.value)
    
    if (pendingPasskeyAuthRequest.value?.tabId) {
      console.log('[App] 发送 selectPasskeyForAuth（新建环境）, tabId:', pendingPasskeyAuthRequest.value.tabId, 'requestId:', pendingPasskeyAuthRequest.value.requestId)
      await notifyPasskeySelected(pendingPasskeyAuthRequest.value.tabId, {
        type: 'system',
        credentialId: 'system',
        envId: env.id,
        rpId: pendingPasskeyAuthRequest.value.rpId
      }, pendingPasskeyAuthRequest.value.requestId)
    }
    
    pendingPasskeyAuthRequest.value = null
    await dismissAuthRequest()
    showToast(`环境 ${env.alias} 已创建并绑定 Passkey`, 'success')
  } else {
    showToast(env.id ? '环境已更新' : '环境已创建')
  }
  
  await saveEnvironments(environments.value)
  closeEditModal()
}

const handleSaveGroup = async (group) => {
  if (group.id) {
    const index = groups.value.findIndex(g => g.id === group.id)
    if (index !== -1) {
      groups.value[index] = group
    }
  } else {
    group.id = Date.now().toString()
    groups.value.push(group)
  }
  await saveGroups(groups.value)
  closeGroupModal()
  showToast(group.id ? '分组已更新' : '分组已创建')
}

const handleConfirmDelete = async () => {
  if (deleteType.value === 'env') {
    environments.value = environments.value.filter(e => e.id !== deleteId.value)
    await saveEnvironments(environments.value)
    showToast('环境已删除')
  } else {
    environments.value.forEach(e => {
      if (e.groupId === deleteId.value) {
        e.groupId = 'ungrouped'
      }
    })
    groups.value = groups.value.filter(g => g.id !== deleteId.value)
    await saveEnvironments(environments.value)
    await saveGroups(groups.value)
    showToast('分组已删除')
  }
  closeDeleteModal()
}

const handleCloneEnv = (env) => {
  const cloned = {
    ...env,
    id: Date.now().toString(),
    alias: `${env.alias} (克隆)`
  }
  environments.value.push(cloned)
  saveEnvironments(environments.value)
  showToast('环境已克隆')
}

const handleLogin = async (env) => {
  try {
    await login(env)
    showToast('登录成功')
  } catch (error) {
    showToast(error.message || '登录失败', 'error')
  }
}

const pendingPasskeyAuthRequest = ref(null)

const handleSelectEnvForPasskey = async ({ env, type, authRequest }) => {
  console.log('[App] handleSelectEnvForPasskey 被调用', { type, envId: env?.id, requestId: authRequest?.requestId, tabId: authRequest?.tabId })
  try {
    if (type === 'create') {
      await bindPasskeyToEnv(env, authRequest)
      showToast(`Passkey 已绑定到 ${env.alias}`, 'success')

      if (authRequest?.tabId) {
        console.log('[App] 发送 selectPasskeyForAuth 到 background, tabId:', authRequest.tabId, 'requestId:', authRequest.requestId)
        await notifyPasskeySelected(authRequest.tabId, {
          type: 'system',
          credentialId: 'system',
          envId: env.id,
          rpId: authRequest.rpId
        }, authRequest.requestId)
      } else {
        console.warn('[App] authRequest.tabId 为空，无法通知 page-world')
      }
    } else {
      const passkey = env.passkeys?.find(pk => pk.rpId === authRequest.rpId)
      if (passkey && authRequest?.tabId) {
        console.log('[App] 发送 selectPasskeyForAuth 到 background, tabId:', authRequest.tabId, 'requestId:', authRequest.requestId)
        await notifyPasskeySelected(authRequest.tabId, passkey, authRequest.requestId)
        showToast('正在使用 Passkey 验证...', 'info')
      }
    }
    await dismissAuthRequest()
  } catch (error) {
    console.error('Passkey selection error:', error)
    showToast('Passkey 验证失败', 'error')
  }
}

const handleCreateEnvForPasskey = async ({ authRequest }) => {
  console.log('[App] handleCreateEnvForPasskey 被调用', authRequest)
  pendingPasskeyAuthRequest.value = authRequest
  editingEnv.value = {
    alias: '',
    type: 'sandbox',
    username: '',
    password: '',
    passkeys: []
  }
  editModalVisible.value = true
}

const bindPasskeyToEnv = async (env, authRequest) => {
  if (!env.passkeys) {
    env.passkeys = []
  }
  
  const existingPasskey = env.passkeys.find(pk => pk.rpId === authRequest.rpId)
  if (!existingPasskey) {
    env.passkeys.push({
      id: 'pk_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      rpId: authRequest.rpId,
      challenge: authRequest.challenge,
      createdAt: Date.now()
    })
    await saveEnvironments(environments.value)
  }
}

const handleDismissPasskey = async () => {
  await dismissAuthRequest()
}

const testPasskeyFlow = async () => {
  if (typeof chrome !== 'undefined' && chrome.storage) {
    await chrome.storage.local.set({
      __sf_passkey_auth_request: {
        rpId: 'salesforce.com',
        challenge: 'test-challenge-data',
        allowCredentials: [],
        type: 'get',
        timestamp: Date.now()
      }
    })
    showToast('已模拟 Passkey 登录请求，验证助手已弹出', 'info')
  } else {
    triggerMockAuthRequest('salesforce.com')
    showToast('已模拟 Passkey 请求，验证助手已弹出', 'info')
  }
}

// ========== Passkey 备份与恢复 ==========

const handleExportBackup = async () => {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'exportPasskeyBackup' })
    if (!response?.success) {
      showToast(response?.error || '导出失败', 'error')
      return
    }

    const backup = response.backup
    if (backup.credentials.length === 0 && backup.environments.length === 0) {
      showToast('没有可备份的数据', 'error')
      return
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

    showToast(`已导出 ${backup.credentials.length} 个凭证、${backup.environments.length} 个环境`, 'success')
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

    const response = await chrome.runtime.sendMessage({
      action: 'importPasskeyBackup',
      backup: backup
    })

    if (!response?.success) {
      showToast(response?.error || '导入失败', 'error')
      return
    }

    // 重新加载环境列表
    environments.value = await loadEnvironments()
    groups.value = await loadGroups()

    const info = response.imported
    showToast(`导入完成：新增 ${info.credentials} 个凭证、${info.environments} 个环境`, 'success')
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
    id: Date.now().toString(),
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

onMounted(async () => {
  environments.value = await loadEnvironments()
  groups.value = await loadGroups()
  nextTick(() => {
    initGroupSortable()
  })
})

onBeforeUnmount(() => {
  if (groupSortable) {
    groupSortable.destroy()
    groupSortable = null
  }
})
</script>

<style scoped>
.app-container {
  min-height: 100vh;
  background-color: #f3f3f3;
}

.env-list {
  padding: 10px;
}

:global(.group-ghost) {
  opacity: 0.4;
  background-color: #fff3e0 !important;
  border: 2px dashed #ff9800 !important;
}

:global(.group-chosen) {
  background-color: #fff8e1;
}

:global(.group-drag) {
  opacity: 0.85;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  transition: none !important;
}
</style>