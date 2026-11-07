import { describe, expect, it } from 'vitest';
import { errorCode, openCase, saveDraft, submittedCase } from '../support/flows.js';
import { JPEG_BYTES, PDF_BYTES, PNG_BYTES, pdfOfSize } from '../support/files.js';
import type { Harness } from '../support/harness.js';

const FIVE_MIB = 5 * 1024 * 1024;

export function attachmentSuite(h: Harness): void {
  async function expectNothingStored(caseId: string, revision = 1) {
    expect(await h.count('attachments')).toBe(0);
    expect(await h.countBlobs()).toBe(0);
    const res = await h.storage.db.get<{ revision: number }>('SELECT revision FROM cases WHERE id = ?', [caseId]);
    expect(res?.revision).toBe(revision);
  }

  describe('uploading (AT08, §10.5)', () => {
    it('stores a valid PDF privately and bumps the revision', async () => {
      const { helper, caseId } = await openCase(h);
      const res = await helper.upload(caseId, { expectedRevision: 1, filename: '王小明-身分證.pdf' });
      expect(res.status).toBe(201);
      expect(Object.keys(res.body.data).sort()).toEqual(['attachment', 'revision']);
      expect(res.body.data.revision).toBe(2);
      expect(res.body.data.attachment).toEqual({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        displayName: '練習附件 1',
        mime: 'application/pdf',
        size: PDF_BYTES.length,
      });
      expect(res.text).not.toContain('王小明');
      expect(await h.countBlobs()).toBe(1);

      const reloaded = await helper.get(`/api/cases/${caseId}`);
      expect(reloaded.body.data.attachment).toEqual(res.body.data.attachment);
      expect(reloaded.body.data.revision).toBe(2);
      expect(reloaded.text).not.toContain('blob-');

      const stored = await h.storage.db.get<{ storage_key: string }>('SELECT storage_key FROM attachments');
      expect(stored?.storage_key).toMatch(/^blob-[0-9a-f]{48}$/);
    });

    it('accepts PNG and JPEG with matching names', async () => {
      for (const [bytes, filename, contentType] of [
        [PNG_BYTES, 'photo.PNG', 'image/png'],
        [JPEG_BYTES, 'scan.jpg', 'image/jpeg'],
        [JPEG_BYTES, 'scan.jpeg', 'image/jpeg'],
      ] as const) {
        const { applicant, helper, grant, caseId } = await openCase(h);
        const res = await helper.upload(caseId, { expectedRevision: 1, bytes, filename, contentType });
        expect(res.status, filename).toBe(201);
        expect(res.body.data.attachment.mime).toBe(contentType);
        // Close this grant so the next round can open a new one.
        await applicant.post(`/api/assistance-grants/${grant.grantId}/revoke`, {});
      }
    });

    it('rejects a 0 byte file with 422 on the attachment field', async () => {
      const { helper, caseId } = await openCase(h);
      const res = await helper.upload(caseId, { expectedRevision: 1, bytes: Buffer.alloc(0) });
      expect(res.status).toBe(422);
      expect(errorCode(res)).toBe('VALIDATION_FAILED');
      expect(Object.keys(res.body.error.fieldErrors)).toEqual(['practice-document']);
      await expectNothingStored(caseId);
    });

    it('accepts exactly 5 MiB and rejects one byte more with 413', async () => {
      const { helper, caseId } = await openCase(h);
      const over = await helper.upload(caseId, { expectedRevision: 1, bytes: pdfOfSize(FIVE_MIB + 1) });
      expect(over.status).toBe(413);
      expect(errorCode(over)).toBe('FILE_TOO_LARGE');
      expect(over.body.error.fieldErrors['practice-document']).toBe('檔案太大，最多 5 MiB。');
      await expectNothingStored(caseId);

      const exact = await helper.upload(caseId, { expectedRevision: 1, bytes: pdfOfSize(FIVE_MIB) });
      expect(exact.status).toBe(201);
      expect(exact.body.data.attachment.size).toBe(FIVE_MIB);
    });

    it('reports 413 even when the file arrives before the text fields', async () => {
      const { helper, caseId } = await openCase(h);
      const res = await helper.upload(caseId, { expectedRevision: 1, bytes: pdfOfSize(FIVE_MIB + 10), fileFirst: true });
      expect(res.status).toBe(413);
      await expectNothingStored(caseId);
    });

    it('rejects content, MIME and extension that disagree with 415', async () => {
      const mismatches = [
        { bytes: Buffer.from('this is not really a pdf'), filename: 'fake.pdf', contentType: 'application/pdf' },
        { bytes: PNG_BYTES, filename: 'image.pdf', contentType: 'application/pdf' },
        { bytes: PNG_BYTES, filename: 'image.png', contentType: 'application/pdf' },
        { bytes: PDF_BYTES, filename: 'doc.png', contentType: 'application/pdf' },
        { bytes: PDF_BYTES, filename: 'doc', contentType: 'application/pdf' },
        { bytes: PDF_BYTES, filename: 'doc.pdf', contentType: 'text/html' },
        { bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), filename: 'x.svg', contentType: 'image/svg+xml' },
      ];
      const { helper, caseId } = await openCase(h);
      for (const file of mismatches) {
        const res = await helper.upload(caseId, { expectedRevision: 1, ...file });
        expect(res.status, file.filename).toBe(415);
        expect(errorCode(res)).toBe('FILE_TYPE_NOT_ALLOWED');
        expect(res.body.error.fieldErrors['practice-document']).toBeTruthy();
      }
      await expectNothingStored(caseId);
    });

    it('refuses a second attachment with ATTACHMENT_EXISTS, ahead of the revision check', async () => {
      const { helper, caseId } = await openCase(h);
      await helper.upload(caseId, { expectedRevision: 1 });
      const second = await helper.upload(caseId, { expectedRevision: 2 });
      expect(second.status).toBe(409);
      expect(errorCode(second)).toBe('ATTACHMENT_EXISTS');
      // A retry after a lost response still carries the old revision.
      expect(errorCode(await helper.upload(caseId, { expectedRevision: 1 }))).toBe('ATTACHMENT_EXISTS');
      expect(await h.count('attachments')).toBe(1);
      expect(await h.countBlobs()).toBe(1);
    });

    it('refuses two files in one request', async () => {
      const { helper, caseId } = await openCase(h);
      const res = await helper.upload(caseId, { expectedRevision: 1, secondFile: true });
      expect(res.status).toBe(422);
      expect(res.body.error.fieldErrors['practice-document']).toBe('一次只能上傳一份附件。');
      await expectNothingStored(caseId);
    });

    it('checks requirementId and expectedRevision', async () => {
      const { helper, caseId } = await openCase(h);
      const wrongRequirement = await helper.upload(caseId, { expectedRevision: 1, requirementId: 'id-card' });
      expect(wrongRequirement.status).toBe(422);
      expect(Object.keys(wrongRequirement.body.error.fieldErrors)).toEqual(['practice-document']);
      expect(errorCode(await helper.upload(caseId, { expectedRevision: null }))).toBe('INVALID_JSON');
      expect(errorCode(await helper.upload(caseId, { expectedRevision: 'abc' }))).toBe('INVALID_JSON');
      const stale = await helper.upload(caseId, { expectedRevision: 7 });
      expect(stale.status).toBe(409);
      expect(errorCode(stale)).toBe('VERSION_CONFLICT');
      await expectNothingStored(caseId);
    });

    it('treats a missing file as a field error and a non-multipart body as malformed', async () => {
      const { helper, caseId } = await openCase(h);
      const noFile = await helper.agent
        .post(`/api/cases/${caseId}/attachments`)
        .set('Origin', h.config.publicOrigin)
        .field('requirementId', 'practice-document')
        .field('expectedRevision', '1');
      expect(noFile.status).toBe(422);
      expect(noFile.body.error.fieldErrors['practice-document']).toBe('請選擇要上傳的檔案。');
      // Not multipart at all: a structure problem.
      const json = await helper.post(`/api/cases/${caseId}/attachments`, { requirementId: 'practice-document' });
      expect(json.status).toBe(400);
      expect(errorCode(json)).toBe('INVALID_JSON');
      await expectNothingStored(caseId);
    });

    it('rejects strangers before reading the file', async () => {
      const { applicant, caseId } = await openCase(h);
      const stranger = await h.browser().login('helper');
      const big = pdfOfSize(FIVE_MIB + 1);
      expect((await stranger.upload(caseId, { expectedRevision: 1, bytes: big })).status).toBe(404);
      expect((await applicant.upload(caseId, { expectedRevision: 1, bytes: big })).status).toBe(403);
      expect((await h.browser().upload(caseId, { expectedRevision: 1, bytes: big })).status).toBe(401);
      expect((await stranger.upload('not-a-uuid', { expectedRevision: 1 })).status).toBe(404);
      await expectNothingStored(caseId);
    });

    it('refuses uploads after submission', async () => {
      const done = await submittedCase(h);
      const res = await done.helper.upload(done.caseId, { expectedRevision: done.result.revision });
      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe('ALREADY_SUBMITTED');
      expect(await h.countBlobs()).toBe(1);
    });
  });

  describe('deleting and re-uploading (AT08, §10.5)', () => {
    it('deletes the attachment and its bytes, then accepts a new one', async () => {
      const { helper, caseId } = await openCase(h);
      const uploaded = await helper.upload(caseId, { expectedRevision: 1 });
      const attachmentId = uploaded.body.data.attachment.id;
      const res = await helper.delete(`/api/cases/${caseId}/attachments/${attachmentId}`, { expectedRevision: 2 });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { attachment: null, revision: 3 } });
      expect(await h.count('attachments')).toBe(0);
      expect(await h.countBlobs()).toBe(0);
      expect((await helper.get(`/api/cases/${caseId}`)).body.data.attachment).toBeNull();

      const again = await helper.upload(caseId, { expectedRevision: 3, bytes: PNG_BYTES, filename: 'a.png', contentType: 'image/png' });
      expect(again.status).toBe(201);
      expect(again.body.data.revision).toBe(4);
      expect(again.body.data.attachment.id).not.toBe(attachmentId);
    });

    it('returns 404 for an attachment that is not on this case, and checks the revision', async () => {
      const { helper, caseId } = await openCase(h);
      const uploaded = await helper.upload(caseId, { expectedRevision: 1 });
      const attachmentId = uploaded.body.data.attachment.id;
      const unknown = await helper.delete(`/api/cases/${caseId}/attachments/00000000-0000-4000-8000-000000000000`, {
        expectedRevision: 2,
      });
      expect(unknown.status).toBe(404);
      expect((await helper.delete(`/api/cases/${caseId}/attachments/not-a-uuid`, { expectedRevision: 2 })).status).toBe(404);
      const stale = await helper.delete(`/api/cases/${caseId}/attachments/${attachmentId}`, { expectedRevision: 1 });
      expect(errorCode(stale)).toBe('VERSION_CONFLICT');
      expect(errorCode(await helper.delete(`/api/cases/${caseId}/attachments/${attachmentId}`, {}))).toBe('INVALID_JSON');
      expect(await h.count('attachments')).toBe(1);
    });

    it('refuses deletion after submission', async () => {
      const done = await submittedCase(h);
      const attachmentId = (await done.helper.get(`/api/cases/${done.caseId}`)).body.data.attachment.id;
      const res = await done.helper.delete(`/api/cases/${done.caseId}/attachments/${attachmentId}`, {
        expectedRevision: done.result.revision,
      });
      expect(errorCode(res)).toBe('ALREADY_SUBMITTED');
      expect(await h.countBlobs()).toBe(1);
    });
  });

  describe('storage failures (AT08)', () => {
    it('leaves no metadata when the blob cannot be written', async () => {
      const { helper, caseId } = await openCase(h);
      await h.startApp({
        deps: {
          blobs: {
            put: async () => {
              throw new Error('disk full at /secret/path');
            },
            delete: (key) => h.storage.blobs.delete(key),
            clear: () => h.storage.blobs.clear(),
          },
        },
      });
      const res = await helper.upload(caseId, { expectedRevision: 1 });
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: { code: 'TEMPORARY_ERROR', message: '系統暫時無法處理，請再試一次。' } });
      await expectNothingStored(caseId);
    });

    it('removes the blob when the metadata transaction fails', async () => {
      const { helper, caseId } = await openCase(h);
      const revision = await saveDraft(helper, caseId, 1);
      // Losing the race against a concurrent save leaves the blob unreferenced: it must go.
      const res = await helper.upload(caseId, { expectedRevision: revision - 1 });
      expect(errorCode(res)).toBe('VERSION_CONFLICT');
      await expectNothingStored(caseId, revision);
    });
  });
}
