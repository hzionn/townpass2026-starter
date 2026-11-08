<script setup lang="ts">
import { useRoute } from 'vue-router';
import { isInTownPass } from '../lib/townpassBridge';

// TownPass already shows the page title in its own title bar, so inside the app our brand
// would appear twice. There we keep only a way back home and the demo label.
const inTownPass = isInTownPass();
const route = useRoute();
</script>

<template>
  <header class="app-header" :class="{ 'app-header--in-app': inTownPass }">
    <div class="app-header__inner">
      <template v-if="inTownPass">
        <RouterLink v-if="route.path !== '/'" to="/" class="app-header__home">回首頁</RouterLink>
      </template>
      <RouterLink v-else to="/" class="app-header__title" aria-label="託你辦，回首頁">託你辦</RouterLink>
      <!-- Always visible, so nobody mistakes this for a completed government check (spec S01). -->
      <span class="chip">模擬服務</span>
    </div>
  </header>
</template>
