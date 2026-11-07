<script setup lang="ts">
/**
 * S02: everything the applicant needs on a single page: consent, the code, and its status
 * (spec §5 S02, §10.3). The server decides the state; this page polls it and draws it.
 */
import QRCode from 'qrcode';
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { buildAssistLink } from '../../../shared/assistLink';
import type { GrantCreatedResponse, MyAssistanceResponse, Receipt } from '../../../shared/contract';
import { ApiError, api, isAccessLost } from '../api/client';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import FullPageState from '../components/FullPageState.vue';
import { activityLabel, isWarningActivity } from '../lib/activity';
import { refocusIfLost } from '../lib/focus';
import { kindFromError, type S07Kind } from '../lib/pageState';
import { startPolling } from '../lib/poller';
import { copyText, shareLink } from '../lib/share';
import { formatCountdown, formatTaipeiDateTime, formatTaipeiTime, remainingMs, serverClock } from '../lib/time';
import { announce } from '../stores/announcer';
import { clearIssuedToken, issuedToken } from '../stores/issuedToken';
import { loadService, service } from '../stores/service';

const POLL_INTERVAL_MS = 5000;

const STATE_ANNOUNCEMENTS: Partial<Record<MyAssistanceResponse['state'], string>> = {
  active: '有人正在協助',
  completed: '代辦者已模擬送出',
  revoked: '這次協助已停止',
  expired: '協助碼已到期',
};

const loaded = ref(false);
const pageKind = ref<S07Kind | null>(null);
const grant = shallowRef<MyAssistanceResponse | null>(null);
const receipt = shallowRef<Receipt | null>(null);
const nowMs = ref(serverClock.now());
const connectionLost = ref(false);
const busy = ref(false);
const actionError = ref('');
const stopDialogOpen = ref(false);
const qrDataUrl = ref('');
const shareStatus = ref('');
const showManualCopy = ref(false);

/** The code on screen, only if it belongs to the grant the server says is current. */
const token = computed(() => {
  const issued = issuedToken.value;
  return issued && issued.grantId === grant.value?.grantId ? issued.token : null;
});

const assistLink = computed(() =>
  token.value && service.value ? buildAssistLink(service.value.publicOrigin, token.value) : '',
);

const state = computed(() => grant.value?.state ?? null);

const deadline = computed(() => {
  if (state.value === 'issued') return grant.value?.claimExpiresAt ?? null;
  if (state.value === 'active') return grant.value?.accessExpiresAt ?? null;
  return null;
});

const remaining = computed(() => (deadline.value ? remainingMs(deadline.value, nowMs.value) : 0));
const countdown = computed(() => formatCountdown(remaining.value));
const receiptNo = computed(() => receipt.value?.receiptNo ?? grant.value?.receiptNo ?? null);

// ---- Reading the state --------------------------------------------------------------------

/** Bumped by every action, so a poll that started earlier cannot overwrite the newer result. */
let latestRequest = 0;

function applyGrant(next: MyAssistanceResponse | null): void {
  const previous = grant.value;
  if (next) serverClock.sync(next.serverNow);
  nowMs.value = serverClock.now();

  if (next?.state !== 'issued') clearIssuedToken();
  if (next?.grantId !== previous?.grantId) receipt.value = null;

  grant.value = next;

  if (previous && next && (previous.state !== next.state || previous.grantId !== next.grantId)) {
    // The new state explains what happened, so an older "could not …" message no longer applies.
    actionError.value = '';
    const message = STATE_ANNOUNCEMENTS[next.state];
    if (message) announce(message);
    refocusIfLost();
  }
  void loadReceipt(next);
}

/** The time of the receipt lives on the case: my-assistance only has its number. */
async function loadReceipt(current: MyAssistanceResponse | null): Promise<void> {
  if (!current?.caseId || !current.receiptNo || receipt.value) return;
  try {
    const data = await api.getApplicantCase(current.caseId);
    if (grant.value?.grantId === current.grantId) receipt.value = data.receipt;
  } catch {
    // receiptNo from my-assistance still shows, and the next poll tries again.
  }
}

async function refresh(): Promise<void> {
  const request = ++latestRequest;
  try {
    const next = await api.getMyAssistance();
    if (request !== latestRequest) return;
    connectionLost.value = false;
    applyGrant(next);
  } catch (error) {
    if (request === latestRequest && !isAccessLost(error)) connectionLost.value = true;
  }
}

/** `quiet` is the background retry after a failed first load: it never flashes the page. */
async function loadPage(quiet = false): Promise<void> {
  if (!quiet) pageKind.value = null;
  try {
    const [, current] = await Promise.all([loadService(), api.getMyAssistance()]);
    pageKind.value = null;
    applyGrant(current);
    loaded.value = true;
  } catch (error) {
    if (!quiet && !isAccessLost(error)) pageKind.value = kindFromError(error) ?? 'network';
  }
}

let stopPolling: () => void = () => {};
let clockTimer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  void loadPage();
  // While an action runs, its own answer decides the state, so polling sits it out.
  // Until the first load succeeds, polling retries it, so the page recovers by itself.
  stopPolling = startPolling(
    () => (busy.value ? Promise.resolve() : loaded.value ? refresh() : loadPage(true)),
    POLL_INTERVAL_MS,
  );
  // The visible countdown ticks every second but is never announced: only state changes are.
  clockTimer = setInterval(() => {
    nowMs.value = serverClock.now();
  }, 1000);
});

onBeforeUnmount(() => {
  stopPolling();
  clearInterval(clockTimer);
});

/** The server has the last word on expiry, so at zero we ask it instead of assuming. */
let refreshedAtDeadline: string | null = null;
watch(remaining, (value) => {
  if (value === 0 && deadline.value && refreshedAtDeadline !== deadline.value) {
    refreshedAtDeadline = deadline.value;
    void refresh();
  }
});

// ---- Drawing the QR code -------------------------------------------------------------------

watch(
  assistLink,
  async (link) => {
    qrDataUrl.value = '';
    shareStatus.value = '';
    showManualCopy.value = false;
    if (!link) return;
    try {
      // margin is the quiet zone, in modules. 480 px keeps it sharp on high-density screens.
      const url = await QRCode.toDataURL(link, { width: 480, margin: 4, errorCorrectionLevel: 'M' });
      if (assistLink.value === link) qrDataUrl.value = url;
    } catch {
      // The link itself still works: show the selectable field instead of the code.
      showManualCopy.value = true;
    }
  },
  { immediate: true },
);

// ---- Actions -------------------------------------------------------------------------------

/** Runs one action at a time. Afterwards the server's answer decides what is on screen. */
async function runAction(failureMessage: string, action: () => Promise<void>): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  actionError.value = '';
  latestRequest += 1; // Any poll already on its way started before this action: ignore it.
  try {
    await action();
  } catch (error) {
    if (isAccessLost(error)) return;
    // ACTIVE_ASSISTANCE_EXISTS and friends mean this page was out of date, which a refresh fixes.
    const stateChanged = error instanceof ApiError && error.status === 409;
    if (!stateChanged) {
      actionError.value = failureMessage;
      announce(failureMessage);
    }
    await refresh();
  } finally {
    busy.value = false;
  }
}

function adoptNewCode(created: GrantCreatedResponse): void {
  issuedToken.value = { grantId: created.grantId, token: created.token };
  applyGrant({
    grantId: created.grantId,
    state: created.state,
    claimExpiresAt: created.claimExpiresAt,
    accessExpiresAt: created.accessExpiresAt,
    caseId: null,
    receiptNo: null,
    activity: [{ kind: 'code_issued', at: created.serverNow, count: 1 }],
    serverNow: created.serverNow,
  });
}

/** Consent, or starting over after 已停止 / 已到期 / 已送出: always a new grant (spec §10.3). */
function createCode(): Promise<void> {
  return runAction('目前無法產生協助碼，請再試一次。', async () => {
    adoptNewCode(await api.createGrant(service.value?.consentVersion));
    announce('協助碼已產生');
  });
}

/** Only for a code still waiting to be claimed. The server invalidates the old one first. */
function reissueCode(): Promise<void> {
  const grantId = grant.value?.grantId;
  if (!grantId) return Promise.resolve();
  return runAction('目前無法重新產碼，請再試一次。', async () => {
    adoptNewCode(await api.reissueGrant(grantId));
    announce('已重新產碼，舊的協助碼已失效');
  });
}

function confirmStop(): void {
  if (!busy.value) stopDialogOpen.value = true;
}

async function stopAssistance(): Promise<void> {
  stopDialogOpen.value = false;
  const current = grant.value;
  if (!current) return;
  await runAction('目前無法停止協助，請再試一次。', async () => {
    const result = await api.revokeGrant(current.grantId);
    serverClock.sync(result.serverNow);
    applyGrant({ ...current, state: result.state, serverNow: result.serverNow });
    // The activity log gains a "stopped" line; fetch it now rather than at the next poll.
    await refresh();
  });
}

async function onShare(): Promise<void> {
  const link = assistLink.value;
  if (!link) return;
  const outcome = await shareLink(link);
  if (outcome === 'copied') reportCopied();
  else if (outcome === 'manual') offerManualCopy();
}

async function onCopy(): Promise<void> {
  const link = assistLink.value;
  if (!link) return;
  if (await copyText(link)) reportCopied();
  else offerManualCopy();
}

function reportCopied(): void {
  shareStatus.value = '已複製連結。';
  showManualCopy.value = false;
  announce('已複製連結');
}

function offerManualCopy(): void {
  shareStatus.value = '無法自動複製，請長按下方連結選取後複製。';
  showManualCopy.value = true;
  announce(shareStatus.value);
}

function selectAll(event: FocusEvent): void {
  (event.target as HTMLInputElement).select();
}
</script>

<template>
  <FullPageState v-if="pageKind" :kind="pageKind" @retry="loadPage()" />
  <div v-else class="page">
    <h1 tabindex="-1">我的協助碼</h1>
    <h2 class="section-title">{{ service?.name ?? '長者健檢預約需求（模擬）' }}</h2>

    <p v-if="!loaded" class="muted">載入中…</p>

    <template v-else>
      <!-- Before a code exists: read and agree -->
      <template v-if="grant === null">
        <p class="muted">{{ service?.consentText }}</p>
        <button type="button" class="btn btn--primary" :aria-disabled="busy" @click="createCode">
          同意並產生協助碼
        </button>
      </template>

      <!-- Waiting to be claimed, and the code is still in this page's memory -->
      <template v-else-if="state === 'issued' && token">
        <p class="muted">持碼的人可協助本次填寫、練習附件及模擬送出；不會取得你的身分原值。</p>
        <div class="qr-card">
          <img
            v-if="qrDataUrl"
            class="qr-card__image"
            :src="qrDataUrl"
            width="240"
            height="240"
            alt="協助碼 QR Code。請讓你信任的人用手機掃描，或改用下方的分享連結。"
          />
        </div>
        <p class="status-line" role="timer">待領取 · 剩餘 {{ countdown }}</p>
        <p class="muted">{{ formatTaipeiTime(grant.claimExpiresAt) }} 前有效。只交給你信任的人。</p>

        <div class="actions">
          <button type="button" class="btn btn--primary" @click="onShare">分享連結</button>
          <button type="button" class="btn btn--secondary" @click="onCopy">複製連結</button>
        </div>
        <p v-if="shareStatus" class="notice"><span aria-hidden="true">ⓘ </span>{{ shareStatus }}</p>
        <div v-if="showManualCopy" class="field">
          <label for="assist-link-manual" class="field__label">協助連結</label>
          <input
            id="assist-link-manual"
            class="control"
            type="text"
            readonly
            :value="assistLink"
            @focus="selectAll"
          />
        </div>

        <div class="link-row">
          <button type="button" class="link-button" :aria-disabled="busy" @click="reissueCode">重新產碼</button>
          <span aria-hidden="true">·</span>
          <button type="button" class="link-button" :aria-disabled="busy" @click="confirmStop">停止協助</button>
        </div>
      </template>

      <!-- Waiting to be claimed, but the page was refreshed: GET never returns the token -->
      <template v-else-if="state === 'issued'">
        <p class="status-line" role="timer">待領取 · 剩餘 {{ countdown }}</p>
        <p class="muted">為了安全，舊的協助碼不會再次顯示。需要分享時，請重新產碼；舊碼會同時失效。</p>
        <div class="actions">
          <button type="button" class="btn btn--primary" :aria-disabled="busy" @click="reissueCode">重新產碼</button>
          <button type="button" class="btn btn--secondary" :aria-disabled="busy" @click="confirmStop">停止協助</button>
        </div>
      </template>

      <!-- Claimed: there is no QR code to show any more -->
      <template v-else-if="state === 'active'">
        <div class="card card--tint">
          <p class="card__title">有人正在協助</p>
          <p class="status-line" role="timer">協助權限剩餘 {{ countdown }}</p>
          <p class="muted">代辦者不會取得你的身分原值。你隨時可以停止協助。</p>
        </div>
        <button type="button" class="btn btn--secondary" :aria-disabled="busy" @click="confirmStop">停止協助</button>
      </template>

      <!-- Finished or ended -->
      <template v-else>
        <div v-if="state === 'completed'" class="status-circle status-circle--success" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="44" height="44" focusable="false">
            <path d="M5 13l5 5L19 7" fill="none" stroke="currentColor" stroke-width="3" />
          </svg>
        </div>
        <div v-else class="status-circle status-circle--warning" aria-hidden="true">!</div>

        <p class="section-title">
          {{ state === 'completed' ? '代辦者已模擬送出' : state === 'revoked' ? '這次協助已停止' : '協助已到期' }}
        </p>
        <p v-if="state === 'revoked'" class="muted">代辦者不能再操作這次協助。已送出的內容不會自動撤回。</p>
        <p v-else-if="state === 'expired'" class="muted">這次協助的有效時間已過。需要協助時，請重新產碼。</p>

        <div v-if="receiptNo" class="card">
          <p class="card__title">模擬回執</p>
          <p class="muted">模擬編號：{{ receiptNo }}</p>
          <p v-if="receipt" class="muted">送出時間：{{ formatTaipeiDateTime(receipt.submittedAt) }}</p>
        </div>
        <p v-if="receiptNo" class="strong-note">資料已存入展示系統，尚未送交政府或醫院。不是正式預約成功。</p>

        <p class="muted">{{ service?.consentText }}</p>
        <div class="actions">
          <button type="button" class="btn btn--primary" :aria-disabled="busy" @click="createCode">
            {{ state === 'completed' ? '同意並產生新的協助碼' : '重新產碼' }}
          </button>
          <button
            v-if="state === 'completed'"
            type="button"
            class="btn btn--secondary"
            :aria-disabled="busy"
            @click="confirmStop"
          >
            停止協助
          </button>
        </div>
      </template>

      <!-- What happened during this assistance (info.md E05). Polled with the state, never announced. -->
      <section v-if="grant && grant.activity.length > 0" class="activity" aria-labelledby="activity-title">
        <h2 id="activity-title" class="section-title">協助紀錄</h2>
        <p class="muted">只記錄誰在什麼時候做了什麼，不包含填寫內容或附件。</p>
        <ol class="activity__list">
          <li
            v-for="(event, index) in grant.activity"
            :key="`${event.kind}-${event.at}-${index}`"
            class="activity__item"
            :class="{ 'activity__item--warning': isWarningActivity(event) }"
          >
            <time class="activity__time" :datetime="event.at">{{ formatTaipeiTime(event.at) }}</time>
            <span><span v-if="isWarningActivity(event)" aria-hidden="true">⚠ </span>{{ activityLabel(event) }}</span>
          </li>
        </ol>
      </section>

      <p v-if="actionError" class="notice notice--error"><span aria-hidden="true">⚠ </span>{{ actionError }}</p>
      <p v-if="connectionLost" class="muted connection-note">
        <span aria-hidden="true">ⓘ </span>連線中斷，畫面可能不是最新狀態，會自動重試。
      </p>
    </template>

    <ConfirmDialog
      :open="stopDialogOpen"
      message="停止後，代辦者不能再操作這次協助。已送出的內容不會自動撤回。"
      cancel-label="繼續協助"
      confirm-label="停止協助"
      @cancel="stopDialogOpen = false"
      @confirm="stopAssistance"
    />
  </div>
</template>
