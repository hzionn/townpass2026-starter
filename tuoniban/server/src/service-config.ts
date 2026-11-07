import {
  CONSENT_VERSION,
  REQUIREMENT_ID,
  SCHEMA_VERSION,
  SERVICE_ID,
  type ServiceConfigResponse,
  type ServiceFieldOption,
} from '../../shared/contract.js';
import { allowedDateRange, HELPER_NAME_MAX, NOTES_MAX, type FormRules } from '../../shared/form.js';
import { ACCESS_MINUTES, CLAIM_MINUTES, SERVICE_NAME, SESSION_HOURS } from './constants.js';
import { HEALTHCHECK_SITES, HEALTHCHECK_SITES_SOURCE } from './data/healthcheckSites.js';
import { ACCEPTED_MIME_TYPES, formatBytes } from './upload-rules.js';

/**
 * Real institutions from open data replace the spec's two fictional sites (IMPLEMENTATION.md).
 * To go back to fictional sites, change this list: validation and the form both read from it.
 */
const LOCATION_OPTIONS: ServiceFieldOption[] = HEALTHCHECK_SITES.map((site) => ({
  value: site.id,
  label: site.name,
  group: site.district,
  detail: site.address,
}));

export const FORM_RULES: FormRules = {
  locationIds: LOCATION_OPTIONS.map((option) => option.value),
};

/** The fixed public form definition. Contains no applicant values. */
export function buildServiceConfig(
  config: { publicOrigin: string; maxUploadBytes: number },
  now: Date,
): ServiceConfigResponse {
  return {
    id: SERVICE_ID,
    name: SERVICE_NAME,
    schemaVersion: SCHEMA_VERSION,
    isDemo: true,
    mode: 'preference-request',
    consentVersion: CONSENT_VERSION,
    consentText: '產生後，可讓持碼的人協助填寫本次需求、上傳練習附件並模擬送出。不會提供你的身分原值。',
    dataSource: 'demo_seed',
    openDataSources: [
      {
        datasetName: HEALTHCHECK_SITES_SOURCE.datasetName,
        provider: HEALTHCHECK_SITES_SOURCE.provider,
        landingPage: HEALTHCHECK_SITES_SOURCE.landingPage,
        licence: HEALTHCHECK_SITES_SOURCE.licence,
        lastChanged: HEALTHCHECK_SITES_SOURCE.lastChanged,
        usage: '偏好地點的選項來自這份公開資料。預約本身是模擬，不會送出真實預約。',
      },
    ],
    publicOrigin: config.publicOrigin,
    fields: [
      {
        id: 'locationPreference',
        label: '偏好地點',
        type: 'select',
        required: true,
        placeholder: '請選擇地點',
        options: LOCATION_OPTIONS,
      },
      {
        id: 'preferredDate',
        label: '偏好日期',
        type: 'date',
        required: true,
        hint: '明日起 30 天內，非保證名額。',
      },
      {
        id: 'preferredPeriod',
        label: '偏好時段',
        type: 'select',
        required: true,
        placeholder: '請選擇時段',
        options: [
          { value: 'morning', label: '上午' },
          { value: 'afternoon', label: '下午' },
        ],
      },
      {
        id: 'companionRequired',
        label: '需要陪同嗎？',
        type: 'boolean',
        required: true,
      },
      {
        id: 'helperName',
        label: '代辦稱呼',
        type: 'text',
        required: true,
        placeholder: '例如：小王',
        maxLength: HELPER_NAME_MAX,
      },
      {
        id: 'helperPhone',
        label: '代辦聯絡電話',
        type: 'tel',
        required: true,
        placeholder: '使用合成手機號碼',
        hint: '展示請用 09 開頭共 10 位數字的合成號碼。',
      },
      {
        id: 'notes',
        label: '其他需求',
        type: 'textarea',
        required: false,
        placeholder: '請勿填入證號或病歷',
        hint: '請勿填入證號或病歷。',
        maxLength: NOTES_MAX,
      },
    ],
    attachment: {
      requirementId: REQUIREMENT_ID,
      label: '合成練習附件',
      required: true,
      acceptedMimeTypes: ACCEPTED_MIME_TYPES,
      acceptAttribute: '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg',
      maxBytes: config.maxUploadBytes,
      hint: `PDF / PNG / JPEG，最多 ${formatBytes(config.maxUploadBytes)}。`,
      warning: '僅上傳合成練習文件，請勿使用真實證件。',
    },
    limits: {
      claimMinutes: CLAIM_MINUTES,
      accessMinutes: ACCESS_MINUTES,
      sessionHours: SESSION_HOURS,
    },
    dateRange: allowedDateRange(now),
    serverNow: now.toISOString(),
  };
}
