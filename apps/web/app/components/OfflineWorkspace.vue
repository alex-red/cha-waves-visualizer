<script setup lang="ts">
defineProps<{
  state: {
    supported: boolean; enabled: boolean; busy: boolean; ready: boolean; online: boolean; updateReady: boolean
    notice: string; error: string; version: string; assetCount: number; totalBytes: number
    persistenceState: string; usageBytes: number | null; quotaBytes: number | null
  }
  disabled: boolean
  actionError: string
}>()
defineEmits<{ enable: []; check: []; update: []; disable: []; persist: [] }>()
function size(bytes: number) { return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB` }
</script>

<template>
  <section class="ow-panel" aria-labelledby="offline-title" data-testid="offline-workspace">
    <div class="ow-heading"><h3 id="offline-title">Offline workspace</h3><span :class="{ 'ow-disconnected': !state.online }" data-testid="offline-connection">{{ state.online ? 'Connected' : 'Offline' }}</span></div>
    <p>Keep a copy of the app on this device to open and edit your homes without a connection.</p>
    <p class="ow-status" data-testid="offline-status" :data-ready="state.ready" :data-enabled="state.enabled" role="status">{{ state.busy ? 'Preparing workspace…' : state.ready ? 'Ready to open offline' : state.enabled ? 'Offline copy needs attention' : 'Offline copy is off' }}</p>
    <p v-if="state.ready && state.version" class="ow-build">Build {{ state.version.slice(0, 12) }} · {{ state.assetCount }} files · {{ size(state.totalBytes) }}</p>
    <p v-if="!state.supported" class="ow-note">Offline caching needs a supported browser and an HTTPS site or local preview.</p>
    <p v-if="state.updateReady" class="ow-update" data-testid="offline-update-notice">A complete update is ready. Save this home and reload to use it. Other open tabs can keep their current app until reloaded.</p>
    <div class="ow-actions">
      <button v-if="!state.enabled || !state.ready" data-testid="offline-enable" :disabled="disabled || !state.supported || !state.online" @click="$emit('enable')">{{ state.enabled ? 'Repair offline copy' : 'Make available offline' }}</button>
      <template v-if="state.enabled">
        <button v-if="state.updateReady" class="ow-primary" data-testid="offline-apply-update" :disabled="disabled" @click="$emit('update')">Save and reload update</button>
        <button v-else data-testid="offline-check-update" :disabled="disabled || !state.online" @click="$emit('check')">Check for updates</button>
        <button data-testid="offline-disable" :disabled="disabled" @click="$emit('disable')">Remove offline copy</button>
      </template>
    </div>
    <p v-if="state.notice" class="ow-note" role="status">{{ state.notice }}</p>
    <p v-if="actionError || state.error" class="ow-error" role="alert">{{ actionError || state.error }}</p>
    <div class="ow-storage">
      <strong>Local storage</strong>
      <p v-if="state.persistenceState === 'granted'" data-testid="offline-persistence">Persistent storage granted for this site.</p>
      <p v-else-if="state.persistenceState === 'declined'" data-testid="offline-persistence">The browser declined persistent storage. You can still work locally and export backups.</p>
      <p v-else-if="state.persistenceState === 'unavailable'" data-testid="offline-persistence">Persistent storage requests are unavailable in this browser.</p>
      <p v-else data-testid="offline-persistence">The browser may clear local data when it needs space.</p>
      <p v-if="state.usageBytes != null && state.quotaBytes != null" class="ow-build">Site usage {{ size(state.usageBytes) }} of approximately {{ size(state.quotaBytes) }}</p>
      <button v-if="state.persistenceState !== 'granted' && state.persistenceState !== 'unavailable'" data-testid="offline-persist" :disabled="disabled" @click="$emit('persist')">Request persistent storage</button>
    </div>
    <p class="ow-note">Export JSON backups for a portable copy of your projects. Removing the offline app keeps saved homes; clearing site data can remove both.</p>
  </section>
</template>

<style scoped>
.ow-panel { margin-top: 26px; padding-top: 22px; border-top: 1px solid #d8d8cd; color: #38443d; }
.ow-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.ow-heading h3 { margin: 0; font: 23px Georgia, serif; color: #233d33; }
.ow-heading span { border: 1px solid #bacbbd; border-radius: 20px; padding: 4px 9px; font-size: 11px; color: #285a48; }
.ow-heading .ow-disconnected { color: #935a3c; border-color: #d7b49e; }
.ow-panel p { font-size: 13px; line-height: 1.55; margin: 10px 0; }
.ow-panel .ow-status { font-size: 15px; color: #244f3d; font-weight: 600; margin-bottom: 4px; }
.ow-panel .ow-build { font-size: 11px; color: #69746b; overflow-wrap: anywhere; }
.ow-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 15px; }
.ow-panel button { border: 1px solid #a7b5a6; background: #f5f4eb; color: #294e3d; border-radius: 5px; padding: 9px 12px; font: inherit; font-size: 12px; cursor: pointer; }
.ow-panel button:hover:enabled { background: #e7eddf; }
.ow-panel button:focus-visible { outline: 2px solid #285a48; outline-offset: 3px; }
.ow-panel button:disabled { opacity: .5; cursor: default; }
.ow-panel .ow-primary { background: #264e3c; color: #fffdf0; }
.ow-panel .ow-update { background: #e7eddf; padding: 12px; border-left: 3px solid #477356; }
.ow-panel .ow-note { color: #69746b; font-size: 12px; }
.ow-panel .ow-error { color: #9b402c; }
.ow-storage { margin-top: 20px; border-top: 1px dashed #c6cdbf; padding-top: 16px; }
.ow-storage strong { font-size: 13px; }
</style>
