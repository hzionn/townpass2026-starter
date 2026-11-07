import { describe, expect, it, vi } from 'vitest';
import type {
  AttachmentInfo,
  AttachmentRequirement,
  CaseFormData,
  HelperCaseResponse,
  SaveDraftRequest,
} from '../../../shared/contract';
import { emptyFormData } from '../../../shared/form';
import { ApiError, NetworkError } from '../api/client';
import { useCaseDraft, type CaseDraftDeps } from './caseDraft';

const NOW = Date.parse('2026-11-07T06:00:00Z'); // 14:00 in Taipei
const ATTACHMENT: AttachmentInfo = { id: 'att-1', displayName: '練習附件 1', mime: 'application/pdf', size: 618 };
const RULES: AttachmentRequirement = {
  requirementId: 'practice-document',
  label: '合成練習附件',
  required: true,
  acceptedMimeTypes: ['application/pdf'],
  acceptAttribute: '.pdf',
  maxBytes: 1000,
  hint: 'PDF / PNG / JPEG，最多 5 MiB。',
  warning: '請勿使用真實證件',
};

function serverCase(overrides: Partial<HelperCaseResponse> = {}, form: Partial<CaseFormData> = {}): HelperCaseResponse {
  return {
    caseId: 'case-1',
    serviceId: 'healthcheck-demo',
    schemaVersion: 1,
    state: 'draft',
    canEdit: true,
    revision: 1,
    applicantLabel: '申請者 A',
    protectedDataStatus: 'ready',
    formData: { ...emptyFormData(), ...form },
    attachment: null,
    receipt: null,
    accessExpiresAt: '2026-11-07T07:00:00Z',
    serverNow: '2026-11-07T06:00:00Z',
    ...overrides,
  };
}

function setup(initial = serverCase()) {
  const api = {
    getHelperCase: vi.fn<CaseDraftDeps['api']['getHelperCase']>().mockResolvedValue(initial),
    saveDraft: vi.fn<CaseDraftDeps['api']['saveDraft']>(),
    uploadAttachment: vi.fn<CaseDraftDeps['api']['uploadAttachment']>(),
    deleteAttachment: vi.fn<CaseDraftDeps['api']['deleteAttachment']>(),
  };
  const draft = useCaseDraft('case-1', {
    api,
    now: () => NOW,
    rules: () => ({ locationIds: ['site-a', 'site-b'] }),
    attachmentRules: () => RULES,
  });
  return { api, draft };
}

/** What the server answers to a save: the submitted form, one revision later. */
function savedEcho(body: SaveDraftRequest): HelperCaseResponse {
  return serverCase({ revision: body.expectedRevision + 1, serverNow: '2026-11-07T06:01:00Z' }, body.formData);
}

describe('S04 draft: dirty tracking', () => {
  it('is clean after loading and dirty only while it differs from the server copy', async () => {
    const { draft } = setup(serverCase({}, { helperName: '小王' }));
    await draft.load();
    expect(draft.isDirty.value).toBe(false);

    draft.setField('helperName', '小王王');
    expect(draft.isDirty.value).toBe(true);
    draft.setField('helperName', '小王');
    expect(draft.isDirty.value).toBe(false);
  });

  it('stores an empty choice as null, never as a value', async () => {
    const { draft } = setup();
    await draft.load();
    draft.setField('locationPreference', 'site-a');
    draft.setField('locationPreference', '');
    expect(draft.form.locationPreference).toBeNull();
    expect(draft.isDirty.value).toBe(false);
  });
});

describe('S04 draft: saving', () => {
  it('sends all seven fields with the expected revision, then takes the new revision', async () => {
    const { api, draft } = setup();
    await draft.load();
    api.saveDraft.mockImplementation(async (_id, body) => savedEcho(body));

    draft.setField('helperName', '  小王  ');
    await expect(draft.save()).resolves.toEqual({ status: 'ok' });

    const [, body] = api.saveDraft.mock.calls[0]!;
    expect(body.expectedRevision).toBe(1);
    expect(Object.keys(body.formData).sort()).toEqual(Object.keys(emptyFormData()).sort());
    expect(body.formData.companionRequired).toBeNull(); // not answered stays null, never false
    expect(body.formData.helperName).toBe('小王');
    expect(draft.revision.value).toBe(2);
    expect(draft.isDirty.value).toBe(false);
    expect(draft.form.helperName).toBe('小王');
    expect(draft.lastSavedAt.value).toBe('2026-11-07T06:01:00Z');
  });

  it('keeps what the user typed while the save was on its way', async () => {
    const { api, draft } = setup();
    await draft.load();
    let answer: (value: HelperCaseResponse) => void = () => {};
    api.saveDraft.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));

    draft.setField('helperName', '小王');
    const saving = draft.save();
    draft.setField('notes', '需要輪椅');
    answer(savedEcho(api.saveDraft.mock.calls[0]![1]));
    await saving;

    expect(draft.form.notes).toBe('需要輪椅');
    expect(draft.isDirty.value).toBe(true);
    expect(draft.revision.value).toBe(2);
  });

  it('validates formats before sending and sends nothing when they are wrong', async () => {
    const { api, draft } = setup();
    await draft.load();
    draft.setField('helperPhone', '12345');
    await expect(draft.save()).resolves.toEqual({ status: 'invalid' });
    expect(draft.fieldErrors.value.helperPhone).toBeDefined();
    expect(api.saveDraft).not.toHaveBeenCalled();
  });

  it('allows an incomplete draft', async () => {
    const { api, draft } = setup();
    await draft.load();
    api.saveDraft.mockImplementation(async (_id, body) => savedEcho(body));
    draft.setField('notes', '只填了備註');
    await expect(draft.save()).resolves.toEqual({ status: 'ok' });
  });

  it('never pretends to have saved when the network fails', async () => {
    const { api, draft } = setup();
    await draft.load();
    api.saveDraft.mockRejectedValueOnce(new NetworkError(false));
    draft.setField('helperName', '小王');

    const result = await draft.save();
    expect(result.status).toBe('failed');
    expect(draft.isDirty.value).toBe(true);
    expect(draft.form.helperName).toBe('小王');
    expect(draft.revision.value).toBe(1);
    expect(draft.lastSavedAt.value).toBeNull();
  });

  it('maps server field errors onto fields', async () => {
    const { api, draft } = setup();
    await draft.load();
    api.saveDraft.mockRejectedValueOnce(
      new ApiError(422, 'VALIDATION_FAILED', 'x', { preferredDate: '請選擇明日起 30 天內的日期。' }),
    );
    draft.setField('helperName', '小王');
    await expect(draft.save()).resolves.toEqual({ status: 'invalid' });
    expect(draft.fieldErrors.value).toEqual({ preferredDate: '請選擇明日起 30 天內的日期。' });
  });

  it('flags a conflict and keeps the input when another tab changed the case', async () => {
    const { api, draft } = setup();
    await draft.load();
    api.saveDraft.mockRejectedValueOnce(new ApiError(409, 'VERSION_CONFLICT', 'x'));
    api.getHelperCase.mockResolvedValueOnce(serverCase({ revision: 2 }, { helperName: '別人填的' }));

    draft.setField('helperName', '小王');
    await expect(draft.save()).resolves.toEqual({ status: 'conflict' });
    expect(draft.conflict.value).toBe(true);
    expect(draft.form.helperName).toBe('小王');
    expect(draft.revision.value).toBe(1);
  });

  it('recognises its own save whose response was lost, instead of reporting a conflict', async () => {
    const { api, draft } = setup();
    await draft.load();
    api.saveDraft.mockRejectedValueOnce(new ApiError(409, 'VERSION_CONFLICT', 'x'));
    api.getHelperCase.mockResolvedValueOnce(serverCase({ revision: 2 }, { helperName: '小王' }));

    draft.setField('helperName', '小王');
    await expect(draft.save()).resolves.toEqual({ status: 'ok' });
    expect(draft.conflict.value).toBe(false);
    expect(draft.revision.value).toBe(2);
    expect(draft.isDirty.value).toBe(false);
  });

  it('reports a submitted case so the page can show the result', async () => {
    const { api, draft } = setup();
    await draft.load();
    api.saveDraft.mockRejectedValueOnce(new ApiError(409, 'ALREADY_SUBMITTED', 'x'));
    draft.setField('helperName', '小王');
    await expect(draft.save()).resolves.toEqual({ status: 'submitted' });
  });

  it('reports revoked access, and discard() leaves nothing behind', async () => {
    const { api, draft } = setup();
    await draft.load();
    api.saveDraft.mockRejectedValueOnce(new ApiError(403, 'ASSISTANCE_REVOKED', 'x'));
    draft.setField('helperName', '小王');
    await expect(draft.save()).resolves.toEqual({ status: 'blocked', kind: 'revoked' });

    draft.discard();
    expect(draft.form).toEqual(emptyFormData());
    expect(draft.isDirty.value).toBe(false);
  });

  it('runs one write at a time', async () => {
    const { api, draft } = setup();
    await draft.load();
    api.saveDraft.mockReturnValueOnce(new Promise(() => {}));
    draft.setField('helperName', '小王');
    void draft.save();
    await expect(draft.save()).resolves.toEqual({ status: 'busy' });
    await expect(draft.upload(new File(['%PDF'], 'a.pdf'))).resolves.toEqual({ status: 'busy' });
    expect(api.saveDraft).toHaveBeenCalledTimes(1);
  });
});

describe('S04 draft: attachment', () => {
  const file = new File(['%PDF-1.4'], 'practice.pdf', { type: 'application/pdf' });

  it('uploads with the current revision and takes the new one', async () => {
    const { api, draft } = setup();
    await draft.load();
    api.uploadAttachment.mockResolvedValueOnce({ attachment: ATTACHMENT, revision: 2 });
    await expect(draft.upload(file)).resolves.toEqual({ status: 'ok' });
    expect(api.uploadAttachment).toHaveBeenCalledWith('case-1', file, 1);
    expect(draft.attachment.value).toEqual(ATTACHMENT);
    expect(draft.revision.value).toBe(2);
  });

  it('after a lost upload response, takes only revision and attachment from the server', async () => {
    const { api, draft } = setup();
    await draft.load();
    draft.setField('helperName', '還沒存的稱呼');
    api.uploadAttachment.mockRejectedValueOnce(new NetworkError(true));
    api.getHelperCase.mockResolvedValueOnce(serverCase({ revision: 2, attachment: ATTACHMENT }));

    await expect(draft.upload(file)).resolves.toEqual({ status: 'ok' });
    expect(draft.attachment.value).toEqual(ATTACHMENT);
    expect(draft.revision.value).toBe(2);
    expect(draft.form.helperName).toBe('還沒存的稱呼');
    expect(draft.isDirty.value).toBe(true);
  });

  it('when another tab saved the form meanwhile, reports a conflict instead of taking its revision', async () => {
    const { api, draft } = setup();
    await draft.load();
    draft.setField('helperName', '還沒存的稱呼');
    api.uploadAttachment.mockRejectedValueOnce(new ApiError(409, 'ATTACHMENT_EXISTS', '已有附件', {}));
    api.getHelperCase.mockResolvedValueOnce(
      serverCase({ revision: 3, attachment: ATTACHMENT }, { helperName: '另一個分頁存的值' }),
    );

    await expect(draft.upload(file)).resolves.toEqual({ status: 'conflict' });
    expect(draft.conflict.value).toBe(true);
    expect(draft.revision.value).toBe(1);
    expect(draft.form.helperName).toBe('還沒存的稱呼');
  });

  it('clears an earlier attachment error once the upload succeeds', async () => {
    const { api, draft } = setup();
    await draft.load();
    draft.setAttachmentError('附件還在上傳，請稍候。');
    api.uploadAttachment.mockResolvedValueOnce({ attachment: ATTACHMENT, revision: 2 });
    await expect(draft.upload(file)).resolves.toEqual({ status: 'ok' });
    expect(draft.fieldErrors.value['practice-document']).toBeUndefined();
  });

  it('reports a lost upload that did not happen as a failure to retry', async () => {
    const { api, draft } = setup();
    await draft.load();
    api.uploadAttachment.mockRejectedValueOnce(new NetworkError(false));
    api.getHelperCase.mockResolvedValueOnce(serverCase({ revision: 1, attachment: null }));
    await expect(draft.upload(file)).resolves.toEqual({ status: 'invalid' });
    expect(draft.fieldErrors.value['practice-document']).toBe('上傳沒有完成，請再試一次。');
    expect(draft.attachment.value).toBeNull();
  });

  it('realigns on ATTACHMENT_EXISTS instead of uploading a second file', async () => {
    const { api, draft } = setup();
    await draft.load();
    api.uploadAttachment.mockRejectedValueOnce(new ApiError(409, 'ATTACHMENT_EXISTS', 'x'));
    api.getHelperCase.mockResolvedValueOnce(serverCase({ revision: 2, attachment: ATTACHMENT }));
    await expect(draft.upload(file)).resolves.toEqual({ status: 'ok' });
    expect(api.uploadAttachment).toHaveBeenCalledTimes(1);
    expect(draft.attachment.value).toEqual(ATTACHMENT);
  });

  it('checks the size limit before uploading, though the server has the final say', async () => {
    const { api, draft } = setup();
    await draft.load();
    const big = new File([new Uint8Array(RULES.maxBytes + 1)], 'big.pdf', { type: 'application/pdf' });
    await expect(draft.upload(big)).resolves.toEqual({ status: 'invalid' });
    expect(api.uploadAttachment).not.toHaveBeenCalled();
  });

  it('shows the server reason for a rejected file on the attachment field', async () => {
    const { api, draft } = setup();
    await draft.load();
    api.uploadAttachment.mockRejectedValueOnce(
      new ApiError(415, 'FILE_TYPE_NOT_ALLOWED', '只接受 PDF、PNG、JPEG。', {
        'practice-document': '檔案內容與格式不符。',
      }),
    );
    await expect(draft.upload(file)).resolves.toEqual({ status: 'invalid' });
    expect(draft.fieldErrors.value['practice-document']).toBe('檔案內容與格式不符。');
  });

  it('requires deleting before replacing', async () => {
    const { api, draft } = setup(serverCase({ attachment: ATTACHMENT }));
    await draft.load();
    await expect(draft.upload(file)).resolves.toEqual({ status: 'invalid' });
    expect(api.uploadAttachment).not.toHaveBeenCalled();

    api.deleteAttachment.mockResolvedValueOnce({ attachment: null, revision: 2 });
    await expect(draft.removeAttachment()).resolves.toEqual({ status: 'ok' });
    expect(api.deleteAttachment).toHaveBeenCalledWith('case-1', 'att-1', 1);
    expect(draft.attachment.value).toBeNull();
    expect(draft.revision.value).toBe(2);
  });

  it('does not count an uploaded attachment as unsaved input', async () => {
    const { api, draft } = setup();
    await draft.load();
    api.uploadAttachment.mockResolvedValueOnce({ attachment: ATTACHMENT, revision: 2 });
    await draft.upload(file);
    expect(draft.isDirty.value).toBe(false);
  });
});
