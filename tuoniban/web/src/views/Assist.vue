<script setup lang="ts">
/**
 * /assist#token=…, the page a shared link or a phone's own camera opens (spec §5 S03).
 *
 * The token sits in the fragment so it never reaches a server log. We remove it from the address
 * bar only after a definitive server answer: on a network failure it must stay, so that both
 * the retry button and a reload still work.
 */
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { tokenFromFragment } from '../../../shared/assistLink';
import { api, isAccessLost } from '../api/client';
import FullPageState from '../components/FullPageState.vue';
import { kindFromError, type S07Kind } from '../lib/pageState';
import { routeAfterRedeem } from '../lib/routes';
import { announce } from '../stores/announcer';
import { enterAs } from '../stores/session';

const route = useRoute();
const router = useRouter();
const pageKind = ref<S07Kind | null>(null);

/** vue-router keeps the current URL in history.state.current, so that must lose the token too. */
function removeFragment(): void {
  history.replaceState({ ...history.state, current: location.pathname }, '', location.pathname);
}

async function open(): Promise<void> {
  pageKind.value = null;
  announce('正在開啟協助');
  try {
    try {
      await enterAs('helper');
    } catch (error) {
      // This call skips the client's go-home handler, so a refusal here (for example a
      // PUBLIC_ORIGIN that does not match the address in use) must not leave us waiting.
      pageKind.value = kindFromError(error) ?? 'network';
      return;
    }
    const token = tokenFromFragment(location.hash);
    if (!token) {
      removeFragment();
      pageKind.value = 'invalid';
      return;
    }
    const result = await api.redeem(token);
    removeFragment();
    await router.replace(routeAfterRedeem(result));
  } catch (error) {
    if (isAccessLost(error)) return; // The API client is already taking us home.
    const kind = kindFromError(error) ?? 'network';
    // Network trouble, 5xx and 429 are not an answer about the token, so keep it for a retry.
    if (kind !== 'network') removeFragment();
    pageKind.value = kind;
  }
}

onMounted(open);

// Opening another link while this page is showing only changes the fragment, which does not remount us.
watch(
  () => route.hash,
  (hash) => {
    if (hash) void open();
  },
);
</script>

<template>
  <FullPageState v-if="pageKind" :kind="pageKind" @retry="open" />
  <div v-else class="page">
    <h1 tabindex="-1">正在開啟協助</h1>
    <p class="muted">請稍候，正在確認這個協助碼。</p>
  </div>
</template>
