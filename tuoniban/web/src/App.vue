<script setup lang="ts">
import AppHeader from './components/AppHeader.vue';
import { liveMessage } from './stores/announcer';
</script>

<template>
  <AppHeader />
  <main class="app-main">
    <RouterView />
  </main>
  <!-- The app's single live region: saved, submitting and status changes are announced here. -->
  <div class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{{ liveMessage }}</div>
</template>
