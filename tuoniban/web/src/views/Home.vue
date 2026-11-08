<script setup lang="ts">
/** S01: the shared entry page. */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { Persona } from '../../../shared/contract';
import { caseRoute } from '../lib/routes';
import { announce } from '../stores/announcer';
import { enterAs, refreshSession, session } from '../stores/session';

const ENTRY_FAILED_MESSAGE = '目前無法進入，請再試一次';
const SOURCE_URL = 'https://github.com/hzionn/townpass2026-starter';

const router = useRouter();
const entering = ref(false);
const error = ref('');

const recentCaseId = computed(() => session.value?.recentCaseId ?? null);

onMounted(() => {
  // Only decides whether 繼續上次協助 shows, so a failure here is not worth interrupting anyone.
  refreshSession().catch(() => {});
});

async function enter(persona: Persona, destination: string): Promise<void> {
  if (entering.value) return;
  entering.value = true;
  error.value = '';
  try {
    await enterAs(persona);
    await router.push(destination);
  } catch {
    error.value = ENTRY_FAILED_MESSAGE;
    announce(ENTRY_FAILED_MESSAGE);
  } finally {
    entering.value = false;
  }
}

function continueLastCase(): void {
  if (recentCaseId.value) void enter('helper', caseRoute(recentCaseId.value, 'edit'));
}
</script>

<template>
  <div class="page">
    <h1 tabindex="-1">你想怎麼使用？</h1>
    <p class="lead">讓信任的人幫忙，<br />由你決定。</p>

    <div class="entry">
      <div class="card">
        <h2 class="card__title">我要請人幫忙</h2>
        <p id="entry-applicant" class="muted">產生協助碼，讓親近的人接續操作。</p>
      </div>
      <button
        type="button"
        class="btn btn--primary"
        aria-describedby="entry-applicant"
        :aria-disabled="entering"
        @click="enter('applicant', '/my-assistance')"
      >
        我要請人幫忙
      </button>
    </div>

    <div class="entry">
      <div class="card">
        <h2 class="card__title">我要幫忙</h2>
        <p id="entry-helper" class="muted">用自己的手機掃碼，協助填寫需求。</p>
      </div>
      <button
        type="button"
        class="btn btn--secondary"
        aria-describedby="entry-helper"
        :aria-disabled="entering"
        @click="enter('helper', '/scan')"
      >
        我要幫忙
      </button>
    </div>

    <p v-if="error" class="notice notice--error"><span aria-hidden="true">⚠ </span>{{ error }}</p>

    <button
      v-if="recentCaseId"
      type="button"
      class="link-button link-button--large"
      :aria-disabled="entering"
      @click="continueLastCase"
    >
      繼續上次協助 <span aria-hidden="true">→</span>
    </button>

    <p class="muted home-note">本展示只使用虛構資料，<br />未連接政府或醫院。</p>
    <!-- AGPL-3.0 §13: people using the service over a network can get its source. -->
    <p class="muted">
      <a :href="SOURCE_URL" class="source-link" rel="noopener">原始碼（AGPL-3.0）</a>
    </p>
  </div>
</template>
