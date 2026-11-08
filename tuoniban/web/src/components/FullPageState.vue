<script setup lang="ts">
/**
 * S07, the shared full-page state (spec §5 S07). It takes over its screen without changing the
 * route, so it handles what a route change normally would: the page title and the focus.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { focusPageHeading } from '../lib/focus';
import { S07_ACTION_LABEL, S07_COPY, type S07Action, type S07Kind } from '../lib/pageState';
import { pageTitle } from '../lib/pageTitle';

const props = defineProps<{ kind: S07Kind }>();

const emit = defineEmits<{
  /** 重試: re-run whatever failed. */
  retry: [];
  /** 重新掃碼 while already on /scan, where navigating there would do nothing. */
  reset: [];
}>();

const route = useRoute();
const router = useRouter();
const heading = ref<HTMLElement | null>(null);
const copy = computed(() => S07_COPY[props.kind]);

function act(action: S07Action): void {
  if (action === 'retry') emit('retry');
  else if (action === 'home') void router.push('/');
  else if (route.path === '/scan') emit('reset');
  else void router.push('/scan');
}

function takeOverPage(): void {
  document.title = pageTitle(copy.value.title);
  heading.value?.focus();
}

onMounted(takeOverPage);
watch(() => props.kind, takeOverPage, { flush: 'post' });

onUnmounted(() => {
  document.title = pageTitle(route.meta.title);
  focusPageHeading();
});
</script>

<template>
  <div class="page state-page">
    <h1 ref="heading" tabindex="-1">{{ copy.title }}</h1>
    <div class="status-circle status-circle--warning" aria-hidden="true">!</div>
    <p class="state-page__statement">{{ copy.statement }}</p>
    <p v-if="copy.detail" class="muted">{{ copy.detail }}</p>
    <div class="actions">
      <button type="button" class="btn btn--primary" @click="act(copy.primary)">
        {{ S07_ACTION_LABEL[copy.primary] }}
      </button>
      <button v-if="copy.secondary" type="button" class="btn btn--secondary" @click="act(copy.secondary)">
        {{ S07_ACTION_LABEL[copy.secondary] }}
      </button>
    </div>
  </div>
</template>
