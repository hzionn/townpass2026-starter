import type { ServiceConfigResponse } from '../../../shared/contract';

export const PUBLIC_ORIGIN = 'https://tuoniban.example';
export const TOKEN = 'A'.repeat(43);

/** Just enough service config for the views under test. */
export const SERVICE: ServiceConfigResponse = {
  id: 'healthcheck-demo',
  name: '長者健檢預約需求（模擬）',
  schemaVersion: 1,
  isDemo: true,
  mode: 'preference-request',
  consentVersion: 'demo-consent-v1',
  consentText: '產生後，可讓持碼的人協助填寫本次需求、上傳練習附件並模擬送出。不會提供你的身分原值。',
  dataSource: 'demo_seed',
  openDataSources: [],
  publicOrigin: PUBLIC_ORIGIN,
  fields: [],
  attachment: {
    requirementId: 'practice-document',
    label: '合成練習附件',
    required: true,
    acceptedMimeTypes: ['application/pdf', 'image/png', 'image/jpeg'],
    acceptAttribute: '.pdf,.png,.jpg,.jpeg',
    maxBytes: 5 * 1024 * 1024,
    hint: 'PDF / PNG / JPEG，最多 5 MiB。',
    warning: '僅上傳合成練習文件，請勿使用真實證件。',
  },
  limits: { claimMinutes: 10, accessMinutes: 60, sessionHours: 8 },
  dateRange: { min: '2026-11-08', max: '2026-12-07' },
  serverNow: '2026-11-07T06:00:00.000Z',
};
