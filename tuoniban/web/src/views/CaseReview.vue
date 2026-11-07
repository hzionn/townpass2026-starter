<script setup lang="ts">
/** S05: the helper checks the summary and simulates submitting (spec §5 S05, §10.6). */
import { computed, nextTick, onMounted, ref, shallowRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { HelperCaseResponse } from '../../../shared/contract';
import { api, isAccessLost } from '../api/client';
import FullPageState from '../components/FullPageState.vue';
import { newIdempotencyKey } from '../lib/idempotencyKey';
import { kindFromError, type S07Kind } from '../lib/pageState';
import { caseRoute } from '../lib/routes';
import { locationSourceNote, optionFor, optionLabel, submitErrors } from '../lib/serviceConfig';
import { createSubmitFlow, type SubmitOutcome } from '../lib/submitFlow';
import { formatCalendarDate, serverClock } from '../lib/time';
import { announce } from '../stores/announcer';
import { setPendingFieldErrors } from '../stores/pendingErrors';
import { loadService, service } from '../stores/service';

const props = defineProps<{ id: string }>();
const router = useRouter();

const CHECKING_MESSAGE = '正在確認送出結果';
const RETRY_MESSAGE = '這次送出沒有完成，內容仍是草稿。可以再試一次。';
const UNKNOWN_MESSAGE = '目前還無法確認送出結果。請確認網路後再確認一次。';
const CONFLICT_MESSAGE = '這份需求已在其他分頁或裝置變更，請重新載入摘要再確認。';

const pageKind = ref<S07Kind | null>(null);
const caseData = shallowRef<HelperCaseResponse | null>(null);
const statusBox = ref<HTMLElement | null>(null);

const flow = createSubmitFlow({
  submit: (body) => api.submit(props.id, body),
  getCase: () => api.getHelperCase(props.id),
  newKey: newIdempotencyKey,
});

const phase = flow.phase;
const inFlight = computed(() => phase.value === 'submitting' || phase.value === 'checking');

const statusMessage = computed(() => {
  switch (phase.value) {
    case 'checking':
      return CHECKING_MESSAGE;
    case 'retry':
      return RETRY_MESSAGE;
    case 'unknown':
      return UNKNOWN_MESSAGE;
    case 'conflict':
      return CONFLICT_MESSAGE;
    default:
      return '';
  }
});

const form = computed(() => caseData.value?.formData ?? null);
const sourceNote = computed(() => (service.value ? locationSourceNote(service.value) : null));

const location = computed(() =>
  service.value && form.value ? optionLabel(service.value, 'locationPreference', form.value.locationPreference) : '',
);
const locationDetail = computed(() =>
  service.value && form.value
    ? optionFor(service.value, 'locationPreference', form.value.locationPreference)?.detail
    : undefined,
);
const period = computed(() =>
  service.value && form.value ? optionLabel(service.value, 'preferredPeriod', form.value.preferredPeriod) : '',
);

watch(statusMessage, (message) => {
  if (!message) return;
  announce(message);
  void nextTick(() => statusBox.value?.focus());
});

async function load(): Promise<void> {
  pageKind.value = null;
  caseData.value = null;
  flow.reset();
  try {
    const [config, data] = await Promise.all([loadService(), api.getHelperCase(props.id)]);
    serverClock.sync(data.serverNow);
    if (data.state === 'submitted' || !data.canEdit) {
      await router.replace(caseRoute(props.id, 'result'));
      return;
    }
    // Reached by a deep link, or another tab removed something: back to the form to fix it.
    const errors = submitErrors(data.formData, data.attachment, new Date(serverClock.now()), config);
    if (Object.keys(errors).length > 0) {
      setPendingFieldErrors(props.id, errors);
      await router.replace(caseRoute(props.id, 'edit'));
      return;
    }
    caseData.value = data;
  } catch (error) {
    if (!isAccessLost(error)) pageKind.value = kindFromError(error) ?? 'network';
  }
}

onMounted(load);

function handleOutcome(outcome: SubmitOutcome): void {
  switch (outcome.kind) {
    case 'submitted':
      void router.replace(caseRoute(props.id, 'result'));
      break;
    case 'validation':
      setPendingFieldErrors(props.id, outcome.fieldErrors);
      void router.replace(caseRoute(props.id, 'edit'));
      break;
    case 'blocked':
      if (!isAccessLost(outcome.error)) pageKind.value = kindFromError(outcome.error) ?? 'network';
      break;
    default:
    // conflict, retry and unknown are drawn from `phase`, and announced by the watcher above.
  }
}

async function confirmSubmit(): Promise<void> {
  const data = caseData.value;
  if (!data || inFlight.value) return;
  announce('送出中');
  handleOutcome(await flow.submit(data.revision));
}

async function checkAgain(): Promise<void> {
  if (!inFlight.value) handleOutcome(await flow.check());
}

function backToEdit(): void {
  if (!inFlight.value) void router.push(caseRoute(props.id, 'edit'));
}
</script>

<template>
  <FullPageState v-if="pageKind" :kind="pageKind" @retry="load" />
  <div v-else class="page">
    <h1 tabindex="-1">確認這次需求</h1>
    <p v-if="!caseData || !form" class="muted">載入中…</p>

    <template v-else>
      <p class="helping-label">正在協助：{{ caseData.applicantLabel }}</p>

      <section class="card" aria-labelledby="summary-preference">
        <h2 id="summary-preference" class="card__title">偏好安排</h2>
        <p class="muted">地點：{{ location }}</p>
        <p v-if="locationDetail" class="muted">地址：{{ locationDetail }}</p>
        <p class="muted">日期：{{ form.preferredDate ? formatCalendarDate(form.preferredDate) : '未選擇' }}</p>
        <p class="muted">時段：{{ period }}</p>
        <p class="muted">陪同：{{ form.companionRequired ? '需要' : '不需要' }}</p>
        <p class="muted summary-notes">其他需求：{{ form.notes || '未填寫' }}</p>
      </section>

      <section class="card" aria-labelledby="summary-contact">
        <h2 id="summary-contact" class="card__title">代辦聯絡</h2>
        <p class="muted">稱呼：{{ form.helperName }}</p>
        <p class="muted">電話：{{ form.helperPhone }}</p>
      </section>

      <section class="card" aria-labelledby="summary-data">
        <h2 id="summary-data" class="card__title">資料與附件</h2>
        <p class="muted">身分資料：已備妥，原值不顯示</p>
        <p class="muted">練習附件：已上傳 {{ caseData.attachment ? 1 : 0 }} 份</p>
      </section>

      <p v-if="sourceNote" class="source-note">{{ sourceNote }}</p>
      <p class="muted">這是模擬需求登記，<br />不代表健檢名額或正式預約成功。</p>

      <div v-if="statusMessage" ref="statusBox" class="notice" tabindex="-1">
        <p><span aria-hidden="true">ⓘ </span>{{ statusMessage }}</p>
        <button v-if="phase === 'unknown'" type="button" class="btn btn--secondary" @click="checkAgain">
          再次確認結果
        </button>
        <button v-else-if="phase === 'conflict'" type="button" class="btn btn--secondary" @click="load">
          重新載入摘要
        </button>
      </div>

      <div class="actions">
        <button
          v-if="phase === 'idle' || phase === 'retry' || phase === 'submitting'"
          type="button"
          class="btn btn--primary"
          :aria-disabled="inFlight"
          @click="confirmSubmit"
        >
          {{ phase === 'submitting' ? '送出中' : phase === 'retry' ? '再次確認並模擬送出' : '確認並模擬送出' }}
        </button>
        <button type="button" class="btn btn--secondary" :aria-disabled="inFlight" @click="backToEdit">返回修改</button>
      </div>
    </template>
  </div>
</template>
