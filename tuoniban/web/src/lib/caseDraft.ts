/**
 * The S04 form's state and rules, kept apart from the screen so they can be unit tested.
 *
 * Three ideas hold it together:
 * - `revision` is a single variable, updated by every successful save, upload and delete.
 * - "Dirty" means the form differs from what the server last confirmed, so a failed save
 *   stays dirty on its own. Nothing can pretend to have saved.
 * - Only one write runs at a time, otherwise two writes would race on the same revision.
 */
import { computed, reactive, ref, shallowRef } from 'vue';
import {
  FIELD_IDS,
  REQUIREMENT_ID,
  type AttachmentInfo,
  type AttachmentRequirement,
  type CaseFormData,
  type FieldErrors,
  type FieldId,
  type HelperCaseResponse,
} from '../../../shared/contract';
import { emptyFormData, validateDraft, type FormRules } from '../../../shared/form';
import { ApiError, api, isAccessLost, isOutcomeUnknown } from '../api/client';
import { kindFromError, type S07Kind } from './pageState';

export type WriteResult =
  /** The write is confirmed by the server. */
  | { status: 'ok' }
  /** Another write is still running; nothing was sent. */
  | { status: 'busy' }
  /** Field errors are now set. */
  | { status: 'invalid' }
  /** Someone else changed the case. The input is kept and `conflict` is set. */
  | { status: 'conflict' }
  /** Network or temporary trouble. The input is kept and the user may retry. */
  | { status: 'failed'; message: string }
  /** The case was already submitted: go to the result page. */
  | { status: 'submitted' }
  /** Stopped, expired or gone: show this S07 state. */
  | { status: 'blocked'; kind: S07Kind }
  /** The session is gone. The API client is already going home. */
  | { status: 'access-lost' };

export type WriteKind = 'save' | 'upload' | 'delete';

export const UNSAVED_MESSAGE = '目前連不上，內容還沒有儲存。請確認網路後再試一次。';
const RATE_LIMITED_MESSAGE = '操作太頻繁，請稍候再試。內容還沒有儲存。';
const UPLOAD_FAILED_MESSAGE = '上傳沒有完成，請再試一次。';
const UPLOAD_UNKNOWN_MESSAGE = '無法確認上傳結果。請確認網路後再試一次。';
const DELETE_FAILED_MESSAGE = '刪除沒有完成，請再試一次。';
const EXISTING_ATTACHMENT_MESSAGE = '已有一份附件，請先刪除再換檔。';

/** Optional choices are stored as null when unanswered, but form controls report ''. */
const NULL_WHEN_EMPTY: readonly FieldId[] = ['locationPreference', 'preferredDate', 'preferredPeriod'];

function serialize(form: CaseFormData): string {
  return JSON.stringify(FIELD_IDS.map((id) => form[id]));
}

export interface CaseDraftDeps {
  api: Pick<typeof api, 'getHelperCase' | 'saveDraft' | 'uploadAttachment' | 'deleteAttachment'>;
  /** Server time in ms: date rules must not depend on the device clock. */
  now: () => number;
  rules: () => FormRules;
  attachmentRules: () => AttachmentRequirement;
}

export function useCaseDraft(caseId: string, deps: CaseDraftDeps) {
  const form = reactive<CaseFormData>(emptyFormData());
  const baseline = ref(serialize(form));
  const revision = ref(0);
  const attachment = shallowRef<AttachmentInfo | null>(null);
  const fieldErrors = ref<FieldErrors>({});
  const conflict = ref(false);
  const writing = ref<WriteKind | null>(null);
  const lastSavedAt = ref<string | null>(null);

  const isDirty = computed(() => serialize(form) !== baseline.value);

  function setField(id: FieldId, value: string | boolean | null): void {
    const stored = value === '' && NULL_WHEN_EMPTY.includes(id) ? null : value;
    (form as unknown as Record<FieldId, string | boolean | null>)[id] = stored;
    clearError(id);
  }

  function clearError(id: keyof FieldErrors): void {
    if (!fieldErrors.value[id]) return;
    const { [id]: _removed, ...others } = fieldErrors.value;
    fieldErrors.value = others;
  }

  function setAttachmentError(message: string): void {
    fieldErrors.value = { ...fieldErrors.value, [REQUIREMENT_ID]: message };
  }

  /** Replaces everything with the server's copy. Only for loading: this discards unsaved input. */
  function adopt(data: HelperCaseResponse): void {
    Object.assign(form, data.formData);
    baseline.value = serialize(data.formData);
    revision.value = data.revision;
    attachment.value = data.attachment;
    fieldErrors.value = {};
    conflict.value = false;
  }

  async function load(): Promise<HelperCaseResponse> {
    const data = await deps.api.getHelperCase(caseId);
    adopt(data);
    return data;
  }

  /** Spec §5 S07: when access really ended, nothing typed may linger for 返回 to bring back. */
  function discard(): void {
    Object.assign(form, emptyFormData());
    baseline.value = serialize(form);
    attachment.value = null;
    fieldErrors.value = {};
    conflict.value = false;
  }

  /** Turns an error every write shares into a result. */
  function classify(error: unknown): WriteResult {
    if (isAccessLost(error)) return { status: 'access-lost' };
    if (error instanceof ApiError) {
      if (error.code === 'VERSION_CONFLICT') {
        conflict.value = true;
        return { status: 'conflict' };
      }
      if (error.code === 'ALREADY_SUBMITTED') return { status: 'submitted' };
      if (error.code === 'VALIDATION_FAILED') {
        fieldErrors.value = error.fieldErrors;
        return { status: 'invalid' };
      }
      if (error.code === 'RATE_LIMITED') return { status: 'failed', message: RATE_LIMITED_MESSAGE };
    }
    const kind = kindFromError(error);
    if (kind && kind !== 'network') return { status: 'blocked', kind };
    return { status: 'failed', message: UNSAVED_MESSAGE };
  }

  /**
   * A save whose response was lost looks like a conflict on retry, because our own write
   * already raised the revision. If the server holds exactly what we meant to save, it worked.
   */
  async function saveAlreadyApplied(sent: CaseFormData, typedAtSend: string): Promise<boolean> {
    try {
      const data = await deps.api.getHelperCase(caseId);
      if (data.state !== 'draft' || serialize(data.formData) !== serialize(sent)) return false;
      acceptSaved(data, typedAtSend);
      return true;
    } catch {
      return false;
    }
  }

  function acceptSaved(saved: HelperCaseResponse, typedAtSend: string): void {
    revision.value = saved.revision;
    attachment.value = saved.attachment;
    baseline.value = serialize(saved.formData);
    // Take the server's tidied values, unless the user kept typing while the request was out.
    if (serialize(form) === typedAtSend) Object.assign(form, saved.formData);
    fieldErrors.value = {};
    conflict.value = false;
    lastSavedAt.value = saved.serverNow;
  }

  async function save(): Promise<WriteResult> {
    if (writing.value) return { status: 'busy' };

    const checked = validateDraft({ ...form }, new Date(deps.now()), deps.rules());
    if (Object.keys(checked.fieldErrors).length > 0) {
      fieldErrors.value = checked.fieldErrors;
      return { status: 'invalid' };
    }

    const typedAtSend = serialize(form);
    writing.value = 'save';
    try {
      const saved = await deps.api.saveDraft(caseId, {
        expectedRevision: revision.value,
        formData: checked.form,
      });
      acceptSaved(saved, typedAtSend);
      return { status: 'ok' };
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === 'VERSION_CONFLICT' &&
        (await saveAlreadyApplied(checked.form, typedAtSend))
      ) {
        return { status: 'ok' };
      }
      return classify(error);
    } finally {
      writing.value = null;
    }
  }

  /**
   * After a lost response, ask the server what is true. Takes only the revision and the
   * attachment, so unsaved form input stays exactly as the user left it. If someone else
   * saved the form meanwhile, adopting their revision would let our next save silently
   * overwrite theirs, so that is a conflict instead (spec §4.2).
   */
  async function realignAttachment(isDone: (data: HelperCaseResponse) => boolean, failed: string): Promise<WriteResult> {
    try {
      const data = await deps.api.getHelperCase(caseId);
      if (data.state === 'submitted' || !data.canEdit) return { status: 'submitted' };
      attachment.value = data.attachment;
      if (serialize(data.formData) !== baseline.value) {
        conflict.value = true;
        return { status: 'conflict' };
      }
      revision.value = data.revision;
      if (isDone(data)) return { status: 'ok' };
      setAttachmentError(failed);
      return { status: 'invalid' };
    } catch (error) {
      if (isOutcomeUnknown(error)) {
        setAttachmentError(UPLOAD_UNKNOWN_MESSAGE);
        return { status: 'invalid' };
      }
      return classify(error);
    }
  }

  async function upload(file: File): Promise<WriteResult> {
    if (writing.value) return { status: 'busy' };
    clearError(REQUIREMENT_ID);

    if (attachment.value) {
      setAttachmentError(EXISTING_ATTACHMENT_MESSAGE);
      return { status: 'invalid' };
    }
    const rules = deps.attachmentRules();
    if (file.size > rules.maxBytes) {
      setAttachmentError(`檔案太大。${rules.hint}`);
      return { status: 'invalid' };
    }

    writing.value = 'upload';
    try {
      const uploaded = await deps.api.uploadAttachment(caseId, file, revision.value);
      attachment.value = uploaded.attachment;
      revision.value = uploaded.revision;
      clearError(REQUIREMENT_ID); // e.g. 「附件還在上傳」 from pressing 下一步 meanwhile
      return { status: 'ok' };
    } catch (error) {
      if (isOutcomeUnknown(error) || (error instanceof ApiError && error.code === 'ATTACHMENT_EXISTS')) {
        return await realignAttachment((data) => data.attachment !== null, UPLOAD_FAILED_MESSAGE);
      }
      if (error instanceof ApiError && (error.code === 'FILE_TOO_LARGE' || error.code === 'FILE_TYPE_NOT_ALLOWED')) {
        setAttachmentError(error.fieldErrors[REQUIREMENT_ID] ?? error.message);
        return { status: 'invalid' };
      }
      return classify(error);
    } finally {
      writing.value = null;
    }
  }

  async function removeAttachment(): Promise<WriteResult> {
    const current = attachment.value;
    if (writing.value || !current) return { status: 'busy' };
    clearError(REQUIREMENT_ID);

    writing.value = 'delete';
    try {
      const deleted = await deps.api.deleteAttachment(caseId, current.id, revision.value);
      attachment.value = deleted.attachment;
      revision.value = deleted.revision;
      return { status: 'ok' };
    } catch (error) {
      if (isOutcomeUnknown(error) || (error instanceof ApiError && error.code === 'NOT_FOUND')) {
        return await realignAttachment((data) => data.attachment === null, DELETE_FAILED_MESSAGE);
      }
      return classify(error);
    } finally {
      writing.value = null;
    }
  }

  return {
    form,
    revision,
    attachment,
    fieldErrors,
    conflict,
    writing,
    lastSavedAt,
    isDirty,
    setField,
    setAttachmentError,
    load,
    discard,
    save,
    upload,
    removeAttachment,
  };
}
