<script setup lang="ts">
/**
 * S03: scan or paste a code. Whatever arrives is untrusted, so all of it goes through
 * parseAssistLink, and we only ever POST the token: we never navigate to scanned content.
 */
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { parseAssistLink } from '../../../shared/assistLink';
import { ApiError, api, isAccessLost } from '../api/client';
import FullPageState from '../components/FullPageState.vue';
import { startCameraScan } from '../lib/camera';
import { kindFromError, type S07Kind } from '../lib/pageState';
import { routeAfterRedeem } from '../lib/routes';
import { isInTownPass, scanWithBridge } from '../lib/townpassBridge';
import { announce } from '../stores/announcer';
import { loadService, service } from '../stores/service';

const NOT_OUR_CODE_MESSAGE = '這不是託你辦協助碼。請使用本人提供的託你辦連結。';
const EMPTY_LINK_MESSAGE = '請先貼上協助連結。';
const CAMERA_UNAVAILABLE_MESSAGE = '無法開啟相機。請改用下方的貼上協助連結。';

const router = useRouter();
const pageKind = ref<S07Kind | null>(null);
const scanning = ref<'none' | 'camera' | 'bridge'>('none');
const opening = ref(false);
const pastedLink = ref('');
const linkError = ref('');
const scanNotice = ref('');
const video = ref<HTMLVideoElement | null>(null);
const pasteInput = ref<HTMLInputElement | null>(null);

let stopScanning: () => void = () => {};
/** What 重試 on the S07 network state should run again. */
let retryAction: () => Promise<void> = prepare;

async function prepare(): Promise<void> {
  pageKind.value = null;
  try {
    await loadService();
  } catch (error) {
    retryAction = prepare;
    pageKind.value = kindFromError(error);
  }
}

onMounted(prepare);
onBeforeUnmount(() => stopScanning());

function resetAfterRescan(): void {
  pageKind.value = null;
  pastedLink.value = '';
  linkError.value = '';
  scanNotice.value = '';
}

async function redeem(token: string): Promise<void> {
  if (opening.value) return;
  opening.value = true;
  announce('正在開啟協助');
  try {
    const result = await api.redeem(token);
    await router.replace(routeAfterRedeem(result));
  } catch (error) {
    if (isAccessLost(error)) return; // The API client is already taking us home.
    const kind = kindFromError(error);
    if (kind) {
      retryAction = () => redeem(token);
      pageKind.value = kind;
    } else {
      linkError.value = error instanceof ApiError ? error.message : NOT_OUR_CODE_MESSAGE;
    }
  } finally {
    opening.value = false;
  }
}

function retryFailedAction(): void {
  pageKind.value = null;
  void retryAction();
}

/** Returns the token if this is really one of our links, or null. */
function tokenFrom(raw: unknown): string | null {
  const config = service.value;
  if (!config) return null;
  const parsed = parseAssistLink(raw, config.publicOrigin);
  return parsed.ok ? parsed.token : null;
}

function onScanned(raw: string): void {
  stopScanning();
  scanning.value = 'none';
  const token = tokenFrom(raw);
  if (token) {
    void redeem(token);
  } else {
    scanNotice.value = NOT_OUR_CODE_MESSAGE;
    announce(NOT_OUR_CODE_MESSAGE);
  }
}

function explainCameraUnavailable(): void {
  stopScanning();
  scanning.value = 'none';
  scanNotice.value = CAMERA_UNAVAILABLE_MESSAGE;
  announce(CAMERA_UNAVAILABLE_MESSAGE);
  pasteInput.value?.focus();
}

async function startBridgeScan(): Promise<void> {
  const scan = scanWithBridge();
  stopScanning = scan.cancel;
  scanning.value = 'bridge';
  try {
    const raw = await scan.result;
    scanning.value = 'none';
    // Cancelling, or reading nothing, is not an error (spec §4.2): stay here without a fuss.
    if (raw !== null) onScanned(raw);
  } catch {
    explainCameraUnavailable();
  }
}

async function startBrowserScan(): Promise<void> {
  scanning.value = 'camera';
  await nextTick();
  if (!video.value) return;
  const scan = startCameraScan(video.value, onScanned);
  stopScanning = scan.stop;
  announce('相機已開啟，請對準協助碼');
  try {
    await scan.ready;
  } catch {
    explainCameraUnavailable();
  }
}

function startScan(): void {
  if (opening.value || scanning.value !== 'none') return;
  scanNotice.value = '';
  linkError.value = '';
  // Not getUserMedia in the app: TPWebView sets no onPermissionRequest, so it would likely fail.
  void (isInTownPass() ? startBridgeScan() : startBrowserScan());
}

function cancelScan(): void {
  stopScanning();
  scanning.value = 'none';
  announce('已取消掃描');
}

function submitPastedLink(): void {
  if (opening.value) return;
  linkError.value = '';
  const token = tokenFrom(pastedLink.value);
  if (token) {
    void redeem(token);
    return;
  }
  linkError.value = pastedLink.value.trim() === '' ? EMPTY_LINK_MESSAGE : NOT_OUR_CODE_MESSAGE;
  announce(linkError.value);
  pasteInput.value?.focus();
}
</script>

<template>
  <FullPageState v-if="pageKind" :kind="pageKind" @retry="retryFailedAction" @reset="resetAfterRescan" />
  <div v-else class="page">
    <h1 tabindex="-1">掃碼開始協助</h1>
    <p>使用申請者提供的協助碼，<br />直接接續這次需求。</p>

    <div class="camera-area">
      <video
        v-show="scanning === 'camera'"
        ref="video"
        class="camera-area__video"
        muted
        playsinline
        aria-label="相機畫面，請對準協助碼"
      ></video>
      <p v-if="scanning !== 'camera'" class="camera-area__label">相機掃碼區</p>
    </div>

    <button v-if="scanning === 'camera'" type="button" class="btn btn--secondary" @click="cancelScan">取消掃描</button>
    <button v-else type="button" class="btn btn--primary" :aria-disabled="opening" @click="startScan">
      掃描協助碼
    </button>
    <p v-if="scanNotice" class="notice"><span aria-hidden="true">ⓘ </span>{{ scanNotice }}</p>

    <form class="paste-form" novalidate @submit.prevent="submitPastedLink">
      <label for="assist-link" class="field__label">或貼上協助連結</label>
      <input
        id="assist-link"
        ref="pasteInput"
        v-model="pastedLink"
        class="control"
        type="text"
        inputmode="url"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        placeholder="https://.../assist#token=..."
        :aria-invalid="linkError ? 'true' : 'false'"
        :aria-describedby="linkError ? 'assist-link-error' : undefined"
      />
      <p v-if="linkError" id="assist-link-error" class="field__error">
        <span aria-hidden="true">⚠ </span>{{ linkError }}
      </p>
      <button type="submit" class="btn btn--primary" :aria-disabled="opening">
        {{ opening ? '正在開啟協助' : '開始協助' }}
      </button>
    </form>

    <p class="muted">相機無法開啟時，可改用貼上連結。</p>
    <p class="muted">連結只用來開啟這次協助，<br />不是政府身分驗證。</p>
  </div>
</template>
