<script setup lang="ts">
/**
 * S05: the helper checks the summary, asks the applicant to confirm it, and only then
 * simulates submitting (spec §5 S05, §10.6; info.md F09). While the applicant decides,
 * this page polls the case so the answer shows up by itself.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { HelperCaseResponse } from '../../../shared/contract';
import { ApiError, api, isAccessLost } from '../api/client';
import CaseSummary from '../components/CaseSummary.vue';
import FullPageState from '../components/FullPageState.vue';
import { newIdempotencyKey } from '../lib/idempotencyKey';
import { kindFromError, type S07Kind } from '../lib/pageState';
import { caseRoute } from '../lib/routes';
import { startPolling } from '../lib/poller';
import { locationSourceNote, submitErrors } from '../lib/serviceConfig';
import { createSubmitFlow, type SubmitOutcome } from '../lib/submitFlow';
import { serverClock } from '../lib/time';
import { announce } from '../stores/announcer';
import { setPendingFieldErrors } from '../stores/pendingErrors';
import { loadService, service } from '../stores/service';

const props = defineProps<{ id: string }>();
const router = useRouter();

const CHECKING_MESSAGE = '正在確認送出結果';
const RETRY_MESSAGE = '這次送出沒有完成，內容仍是草稿。可以再試一次。';
const UNKNOWN_MESSAGE = '目前還無法確認送出結果。請確認網路後再確認一次。';
const CONFLICT_MESSAGE = '這份需求已在其他分頁或裝置變更，請重新載入摘要再確認。';
const ASK_FAILED_MESSAGE = '目前無法送交本人確認，請再試一次。';
const POLL_INTERVAL_MS = 5000;

const pageKind = ref<S07Kind | null>(null);
const caseData = shallowRef<HelperCaseResponse | null>(null);
const statusBox = ref<HTMLElement | null>(null);
const asking = ref(false);
const askError = ref('');

const flow = createSubmitFlow({
  submit: (body) => api.submit(props.id, body),
  getCase: () => api.getHelperCase(props.id),
  newKey: newIdempotencyKey,
});

const phase = flow.phase;
const inFlight = computed(
  () => asking.value || phase.value === 'submitting' || phase.value === 'checking',
);
const confirmation = computed(() => caseData.value?.confirmation ?? 'none');

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

/** While waiting on the applicant: pick up their answer, or notice the draft moved on elsewhere. */
async function pollConfirmation(): Promise<void> {
  const current = caseData.value;
  if (!current || current.confirmation !== 'pending' || inFlight.value) return;
  try {
    const next = await api.getHelperCase(props.id);
    if (caseData.value !== current) return; // Something newer replaced the case meanwhile.
    serverClock.sync(next.serverNow);
    if (next.state === 'submitted' || next.revision !== current.revision) {
      await load();
      return;
    }
    caseData.value = next;
    if (next.confirmation === 'confirmed') announce('本人已確認，可以模擬送出');
    else if (next.confirmation === 'returned') announce('本人退回了這份內容');
  } catch (error) {
    // A dropped connection is retried by the next poll. Stopped or expired shows S07.
    const kind = isAccessLost(error) ? null : kindFromError(error);
    if (kind && kind !== 'network') pageKind.value = kind;
  }
}

let stopPolling: () => void = () => {};

onMounted(() => {
  void load();
  stopPolling = startPolling(pollConfirmation, POLL_INTERVAL_MS);
});

onBeforeUnmount(() => stopPolling());

async function askApplicant(): Promise<void> {
  const data = caseData.value;
  if (!data || inFlight.value) return;
  asking.value = true;
  askError.value = '';
  try {
    caseData.value = await api.requestConfirmation(props.id, data.revision);
    announce('已送交本人確認');
  } catch (error) {
    if (isAccessLost(error)) return;
    if (error instanceof ApiError && error.code === 'VALIDATION_FAILED' && error.fieldErrors) {
      setPendingFieldErrors(props.id, error.fieldErrors);
      await router.replace(caseRoute(props.id, 'edit'));
    } else if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
      await load();
    } else if (kindFromError(error) && kindFromError(error) !== 'network') {
      pageKind.value = kindFromError(error);
    } else {
      askError.value = ASK_FAILED_MESSAGE;
      announce(ASK_FAILED_MESSAGE);
    }
  } finally {
    asking.value = false;
  }
}

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

      <CaseSummary :form="form" :attachment-ready="caseData.attachment !== null" id-prefix="summary" />

      <p v-if="sourceNote" class="source-note">{{ sourceNote }}</p>
      <p class="muted">這是模擬需求登記，<br />不代表健檢名額或正式預約成功。</p>

      <!-- The applicant's say on this exact version (info.md F09). The poller announces changes. -->
      <div v-if="confirmation === 'pending'" class="card card--tint">
        <p class="card__title">已送交本人確認</p>
        <p class="muted">請本人在自己的手機上確認這份內容。確認後這裡會自動更新，就能模擬送出。</p>
      </div>
      <div v-else-if="confirmation === 'confirmed'" class="card card--tint">
        <p class="card__title"><span aria-hidden="true">✓ </span>本人已確認這份內容</p>
        <p class="muted">如果再修改，需要請本人重新確認。</p>
      </div>
      <div v-else-if="confirmation === 'returned'" class="notice">
        <p><span aria-hidden="true">ⓘ </span>本人退回了這份內容。請返回修改，或確認無誤後再次送交本人確認。</p>
      </div>
      <p v-if="askError" class="notice notice--error"><span aria-hidden="true">⚠ </span>{{ askError }}</p>

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
          v-if="confirmation === 'none' || confirmation === 'returned'"
          type="button"
          class="btn btn--primary"
          :aria-disabled="inFlight"
          @click="askApplicant"
        >
          {{ asking ? '送交中' : confirmation === 'returned' ? '再次送交本人確認' : '送交本人確認' }}
        </button>
        <button
          v-else-if="confirmation === 'confirmed' && (phase === 'idle' || phase === 'retry' || phase === 'submitting')"
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
