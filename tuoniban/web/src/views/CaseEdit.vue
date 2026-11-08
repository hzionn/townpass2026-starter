<script setup lang="ts">
/** S04: the helper fills in the form and the practice attachment (spec §5 S04, §6). */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { onBeforeRouteLeave, useRouter } from 'vue-router';
import { firstErrorField } from '../../../shared/form';
import { REQUIREMENT_ID, type FieldErrors, type ServiceField } from '../../../shared/contract';
import { api, isAccessLost } from '../api/client';
import AttachmentField from '../components/AttachmentField.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import FullPageState from '../components/FullPageState.vue';
import ServiceFormField from '../components/ServiceFormField.vue';
import { useCaseDraft, type WriteResult } from '../lib/caseDraft';
import { kindFromError, type S07Kind } from '../lib/pageState';
import { caseRoute } from '../lib/routes';
import { formRules, locationSourceNote, submitErrors } from '../lib/serviceConfig';
import { formatTaipeiTime, serverClock } from '../lib/time';
import { announce } from '../stores/announcer';
import { takePendingFieldErrors } from '../stores/pendingErrors';
import { loadService, service } from '../stores/service';
import { session } from '../stores/session';

const props = defineProps<{ id: string }>();
const router = useRouter();

const UPLOADING_MESSAGE = '附件還在上傳，請等上傳完成再繼續。';
const CHECK_FIELDS_MESSAGE = '請確認標示的欄位。';
const SAMPLE_FAILED_MESSAGE = '無法取得內建範例，請再試一次。';
const SAMPLE_PATH = '/samples/practice-document.pdf';

const draft = useCaseDraft(props.id, {
  api,
  now: () => serverClock.now(),
  rules: () => (service.value ? formRules(service.value) : { locationIds: [] }),
  attachmentRules: () => {
    if (!service.value) throw new Error('Service config is not loaded');
    return service.value.attachment;
  },
});

const ready = ref(false);
const pageKind = ref<S07Kind | null>(null);
const applicantLabel = ref('');
const notice = ref('');
const conflictBanner = ref<HTMLElement | null>(null);
const leaveDialogOpen = ref(false);
const reloading = ref(false);

/** Re-runs whichever write failed from the network, for the 重試 button. */
const retryWrite = shallowRef<(() => void) | null>(null);

/** Spec §5 S04: the form is split into 偏好安排, 代辦聯絡 and 練習附件. */
const CONTACT_FIELDS: readonly string[] = ['helperName', 'helperPhone'];
const formFields = computed<ServiceField[]>(() => service.value?.fields ?? []);
const formSections = computed(() => [
  { id: 'preferences', title: '偏好安排', fields: formFields.value.filter((f) => !CONTACT_FIELDS.includes(f.id)) },
  { id: 'contact', title: '代辦聯絡', fields: formFields.value.filter((f) => CONTACT_FIELDS.includes(f.id)) },
]);
const sourceNote = computed(() => (service.value ? locationSourceNote(service.value) : null));

const saveStatus = computed(() => {
  if (draft.writing.value === 'save') return '儲存中…';
  const parts: string[] = [];
  if (draft.lastSavedAt.value) parts.push(`最後儲存 ${formatTaipeiTime(draft.lastSavedAt.value)}`);
  if (draft.isDirty.value) parts.push('尚有未儲存內容');
  return parts.join(' · ');
});

function fieldError(id: keyof FieldErrors): string | undefined {
  return draft.fieldErrors.value[id];
}

/** Stopped, expired or submitted elsewhere: nothing typed may survive to be seen again. */
async function goToResult(): Promise<void> {
  draft.discard();
  await router.replace(caseRoute(props.id, 'result'));
}

function showFullPageState(kind: S07Kind): void {
  if (kind !== 'network') draft.discard();
  pageKind.value = kind;
}

async function load(): Promise<void> {
  pageKind.value = null;
  ready.value = false;
  try {
    const [, data] = await Promise.all([loadService({ force: true }), draft.load()]);
    serverClock.sync(data.serverNow);
    if (data.state === 'submitted' || !data.canEdit) {
      await goToResult();
      return;
    }
    applicantLabel.value = data.applicantLabel;
    ready.value = true;

    const pending = takePendingFieldErrors(props.id);
    if (pending) showFieldErrors(pending);
  } catch (error) {
    if (!isAccessLost(error)) showFullPageState(kindFromError(error) ?? 'network');
  }
}

onMounted(load);

function focusField(id: string): void {
  const element = document.getElementById(`field-${id}`) as HTMLInputElement | null;
  if (element && !element.disabled) element.focus();
  else document.getElementById(`field-${id}-status`)?.focus();
}

function showFieldErrors(errors: FieldErrors): void {
  draft.fieldErrors.value = errors;
  focusFirstError();
}

function focusFirstError(): void {
  announce(CHECK_FIELDS_MESSAGE);
  void nextTick(() => {
    const id = firstErrorField(draft.fieldErrors.value);
    if (id) focusField(id);
  });
}

function focusConflictBanner(): void {
  void nextTick(() => conflictBanner.value?.focus());
}

/** The one place that turns a write's result into what the user sees. */
function reportFailure(result: WriteResult, retry: () => void): void {
  switch (result.status) {
    case 'invalid':
      focusFirstError();
      break;
    case 'conflict':
      announce('這份草稿已在其他分頁或裝置變更。');
      focusConflictBanner();
      break;
    case 'failed':
      notice.value = result.message;
      retryWrite.value = retry;
      announce(result.message);
      break;
    case 'submitted':
      void goToResult();
      break;
    case 'blocked':
      showFullPageState(result.kind);
      break;
    default:
  }
}

async function saveDraft(): Promise<boolean> {
  notice.value = '';
  retryWrite.value = null;
  if (draft.conflict.value) {
    focusConflictBanner();
    return false;
  }
  if (draft.writing.value === 'upload') {
    draft.setAttachmentError(UPLOADING_MESSAGE);
    focusField(REQUIREMENT_ID);
    return false;
  }
  announce('儲存中');
  const result = await draft.save();
  if (result.status === 'ok') {
    announce('已儲存');
    return true;
  }
  reportFailure(result, () => void saveDraft());
  return false;
}

async function goNext(): Promise<void> {
  notice.value = '';
  retryWrite.value = null;
  if (draft.conflict.value) {
    focusConflictBanner();
    return;
  }
  if (draft.writing.value === 'upload') {
    draft.setAttachmentError(UPLOADING_MESSAGE);
    announce(UPLOADING_MESSAGE);
    focusField(REQUIREMENT_ID);
    return;
  }
  if (draft.writing.value || !service.value) return;

  const errors = submitErrors(draft.form, draft.attachment.value, new Date(serverClock.now()), service.value);
  if (Object.keys(errors).length > 0) {
    showFieldErrors(errors);
    return;
  }

  if (draft.isDirty.value) {
    announce('儲存中');
    const result = await draft.save();
    if (result.status !== 'ok') {
      reportFailure(result, () => void goNext());
      return;
    }
    announce('已儲存');
  }
  await router.push(caseRoute(props.id, 'review'));
}

async function uploadFile(file: File): Promise<void> {
  notice.value = '';
  retryWrite.value = null;
  if (draft.conflict.value) {
    focusConflictBanner();
    return;
  }
  announce('上傳中');
  const result = await draft.upload(file);
  if (result.status === 'ok') {
    announce('已上傳');
    void nextTick(() => document.getElementById(`field-${REQUIREMENT_ID}-status`)?.focus());
    return;
  }
  reportFailure(result, () => void uploadFile(file));
}

/** Goes through the same upload API. File pickers in TownPass's WebView are not yet verified. */
async function useBuiltInSample(): Promise<void> {
  try {
    const response = await fetch(SAMPLE_PATH);
    if (!response.ok) throw new Error(`Sample responded ${response.status}`);
    const blob = await response.blob();
    await uploadFile(new File([blob], 'practice-document.pdf', { type: 'application/pdf' }));
  } catch {
    draft.setAttachmentError(SAMPLE_FAILED_MESSAGE);
    announce(SAMPLE_FAILED_MESSAGE);
  }
}

async function removeAttachment(): Promise<void> {
  notice.value = '';
  retryWrite.value = null;
  if (draft.conflict.value) {
    focusConflictBanner();
    return;
  }
  announce('刪除中');
  const result = await draft.removeAttachment();
  if (result.status === 'ok') {
    announce('已刪除附件');
    void nextTick(() => document.getElementById(`field-${REQUIREMENT_ID}`)?.focus());
    return;
  }
  reportFailure(result, () => void removeAttachment());
}

function runRetry(): void {
  retryWrite.value?.();
}

/** The banner's text warns that this throws away unsaved input (spec §4.2). */
async function reloadFromServer(): Promise<void> {
  if (reloading.value) return;
  reloading.value = true;
  notice.value = '';
  try {
    const data = await draft.load();
    serverClock.sync(data.serverNow);
    if (data.state === 'submitted' || !data.canEdit) {
      await goToResult();
      return;
    }
    announce('已重新載入');
    void nextTick(() => document.querySelector<HTMLElement>('h1')?.focus());
  } catch (error) {
    if (isAccessLost(error)) return;
    const kind = kindFromError(error) ?? 'network';
    if (kind === 'network') notice.value = '目前連不上，請確認網路後再按一次重新載入。';
    else showFullPageState(kind);
  } finally {
    reloading.value = false;
  }
}

// ---- Leaving with unsaved input (spec §5 S04) --------------------------------------------------

let resolveLeave: ((leave: boolean) => void) | null = null;

onBeforeRouteLeave(() => {
  // No session means the API client is going home: nothing here can be saved any more.
  if (!draft.isDirty.value || !session.value) return true;
  leaveDialogOpen.value = true;
  return new Promise<boolean>((resolve) => {
    resolveLeave = resolve;
  });
});

function answerLeave(leave: boolean): void {
  leaveDialogOpen.value = false;
  resolveLeave?.(leave);
  resolveLeave = null;
}

function warnBeforeUnload(event: BeforeUnloadEvent): void {
  if (draft.isDirty.value) event.preventDefault();
}

window.addEventListener('beforeunload', warnBeforeUnload);
onBeforeUnmount(() => window.removeEventListener('beforeunload', warnBeforeUnload));
</script>

<template>
  <FullPageState v-if="pageKind" :kind="pageKind" @retry="load" />
  <div v-else class="page">
    <h1 tabindex="-1">協助填寫需求</h1>
    <p v-if="!ready" class="muted">載入中…</p>

    <template v-else-if="service">
      <p class="helping-label">正在協助：{{ applicantLabel }}</p>

      <div class="card card--tint">
        <p class="card__title">身分資料已備妥</p>
        <p class="muted">由虛構示範資料提供。<br />代辦者無法查看敏感原值。</p>
      </div>

      <h2 class="section-title">{{ service.name }}</h2>

      <form class="case-form" novalidate @submit.prevent="goNext">
        <section
          v-for="section in formSections"
          :key="section.id"
          class="form-section"
          :aria-labelledby="`section-${section.id}`"
        >
          <h3 :id="`section-${section.id}`" class="form-section__title">{{ section.title }}</h3>
          <ServiceFormField
            v-for="field in section.fields"
            :key="field.id"
            :field="field"
            :model-value="draft.form[field.id]"
            :error="fieldError(field.id)"
            :min="field.type === 'date' ? service.dateRange.min : undefined"
            :max="field.type === 'date' ? service.dateRange.max : undefined"
            @update:model-value="draft.setField(field.id, $event)"
          >
            <template v-if="field.id === 'locationPreference' && sourceNote" #after-control>
              <p class="source-note">{{ sourceNote }}</p>
            </template>
          </ServiceFormField>
        </section>

        <section class="form-section" aria-labelledby="section-attachment">
          <h3 id="section-attachment" class="form-section__title">練習附件</h3>
          <AttachmentField
            :requirement="service.attachment"
            :attachment="draft.attachment.value"
            :writing="draft.writing.value"
            :error="fieldError(REQUIREMENT_ID)"
            @selected="uploadFile"
            @use-sample="useBuiltInSample"
            @remove="removeAttachment"
          />
        </section>

        <div v-if="draft.conflict.value" ref="conflictBanner" class="banner" tabindex="-1">
          <p class="banner__title"><span aria-hidden="true">⚠ </span>這份草稿已在其他分頁或裝置變更</p>
          <p>這頁的內容還沒有儲存，也不會覆蓋對方的變更。按重新載入會放棄這頁未儲存的內容。</p>
          <button type="button" class="btn btn--secondary" :aria-disabled="reloading" @click="reloadFromServer">
            重新載入
          </button>
        </div>

        <div v-if="notice" class="notice notice--error">
          <p><span aria-hidden="true">⚠ </span>{{ notice }}</p>
          <button v-if="retryWrite" type="button" class="btn btn--secondary" @click="runRetry">重試</button>
        </div>

        <p v-if="saveStatus" class="save-status">{{ saveStatus }}</p>

        <div class="actions">
          <button type="button" class="btn btn--secondary" :aria-disabled="draft.writing.value === 'save'" @click="saveDraft">
            儲存草稿
          </button>
          <button type="submit" class="btn btn--primary" :aria-disabled="draft.writing.value === 'save'">
            下一步：確認內容
          </button>
        </div>
      </form>
    </template>

    <ConfirmDialog
      :open="leaveDialogOpen"
      message="尚有未儲存內容，確定離開？"
      cancel-label="留在這頁"
      confirm-label="確定離開"
      @cancel="answerLeave(false)"
      @confirm="answerLeave(true)"
    />
  </div>
</template>
