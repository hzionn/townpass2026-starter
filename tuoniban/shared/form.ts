/**
 * Form rules for spec v1.3 §6.2, shared so the browser and the server cannot disagree.
 * The browser uses these for instant feedback; the server's verdict is the one that counts.
 */
import {
  FIELD_IDS,
  PERIOD_VALUES,
  type CaseFormData,
  type FieldErrors,
  type FieldId,
  type PreferredPeriod,
} from './contract.js';

export const HELPER_NAME_MAX = 30;
export const NOTES_MAX = 300;
const DATE_MIN_OFFSET_DAYS = 1;
const DATE_MAX_OFFSET_DAYS = 30;
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

const MESSAGES = {
  location: '請選擇偏好地點。',
  date: '請選擇明日起 30 天內的日期。',
  period: '請選擇偏好時段。',
  companion: '請選擇是否需要陪同。',
  helperNameRequired: '請填寫代辦稱呼。',
  helperNameFormat: `代辦稱呼請填 1–${HELPER_NAME_MAX} 字，不可包含控制字元。`,
  helperPhoneRequired: '請填寫代辦聯絡電話。',
  helperPhoneFormat: '請輸入 09 開頭、共 10 位數字的合成號碼。',
  notes: `其他需求最多 ${NOTES_MAX} 字，不可包含控制字元。`,
} as const;

/**
 * Rules that depend on the service config rather than being fixed here. The server
 * passes its own site list; the browser passes the option ids from the service config.
 */
export interface FormRules {
  locationIds: readonly string[];
}

export function emptyFormData(): CaseFormData {
  return {
    locationPreference: null,
    preferredDate: null,
    preferredPeriod: null,
    companionRequired: null,
    helperName: '',
    helperPhone: '',
    notes: '',
  };
}

/** Taiwan has no daylight saving, so a fixed +08:00 offset is exact. */
export function taipeiDateString(now: Date): string {
  return new Date(now.getTime() + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDaysToDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Tomorrow through 30 days from now, both inclusive, on the Taipei calendar. */
export function allowedDateRange(now: Date): { min: string; max: string } {
  const today = taipeiDateString(now);
  return {
    min: addDaysToDate(today, DATE_MIN_OFFSET_DAYS),
    max: addDaysToDate(today, DATE_MAX_OFFSET_DAYS),
  };
}

function isRealCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Counts user-perceived code points, so one emoji or CJK character counts as one. */
function charCount(value: string): number {
  return Array.from(value).length;
}

/** C0 controls and DEL, except tab and newlines, which a multi-line field may contain. */
function hasControlChars(value: string, allowNewlines: boolean): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (allowNewlines && (code === 0x09 || code === 0x0a || code === 0x0d)) continue;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export interface DraftValidationResult {
  /** Normalised values. A field with an error keeps its empty value here. */
  form: CaseFormData;
  fieldErrors: FieldErrors;
}

/**
 * Draft rules: anything may be empty, but whatever is present must be well-formed
 * (spec §5 S04, §10.4). Accepts unknown values because this also guards raw JSON
 * from the network: a wrong type is a field error, not a crash.
 */
export function validateDraft(raw: Record<FieldId, unknown>, now: Date, rules: FormRules): DraftValidationResult {
  const form = emptyFormData();
  const fieldErrors: FieldErrors = {};

  const location = raw.locationPreference;
  if (location !== null && location !== undefined && location !== '') {
    if (typeof location === 'string' && rules.locationIds.includes(location)) {
      form.locationPreference = location;
    } else {
      fieldErrors.locationPreference = MESSAGES.location;
    }
  }

  const date = raw.preferredDate;
  if (date !== null && date !== undefined && date !== '') {
    const range = allowedDateRange(now);
    if (typeof date === 'string' && isRealCalendarDate(date) && date >= range.min && date <= range.max) {
      form.preferredDate = date;
    } else {
      fieldErrors.preferredDate = MESSAGES.date;
    }
  }

  const period = raw.preferredPeriod;
  if (period !== null && period !== undefined && period !== '') {
    if (PERIOD_VALUES.includes(period as PreferredPeriod)) {
      form.preferredPeriod = period as PreferredPeriod;
    } else {
      fieldErrors.preferredPeriod = MESSAGES.period;
    }
  }

  const companion = raw.companionRequired;
  if (companion !== null && companion !== undefined) {
    if (typeof companion === 'boolean') {
      form.companionRequired = companion;
    } else {
      fieldErrors.companionRequired = MESSAGES.companion;
    }
  }

  const helperName = raw.helperName;
  if (helperName !== null && helperName !== undefined) {
    if (typeof helperName === 'string') {
      const trimmed = helperName.trim();
      if (charCount(trimmed) > HELPER_NAME_MAX || hasControlChars(trimmed, false)) {
        fieldErrors.helperName = MESSAGES.helperNameFormat;
      } else {
        form.helperName = trimmed;
      }
    } else {
      fieldErrors.helperName = MESSAGES.helperNameFormat;
    }
  }

  const helperPhone = raw.helperPhone;
  if (helperPhone !== null && helperPhone !== undefined && helperPhone !== '') {
    if (typeof helperPhone === 'string' && /^09\d{8}$/.test(helperPhone.trim())) {
      form.helperPhone = helperPhone.trim();
    } else {
      fieldErrors.helperPhone = MESSAGES.helperPhoneFormat;
    }
  }

  const notes = raw.notes;
  if (notes !== null && notes !== undefined) {
    if (typeof notes === 'string') {
      const trimmed = notes.trim();
      if (charCount(trimmed) > NOTES_MAX || hasControlChars(trimmed, true)) {
        fieldErrors.notes = MESSAGES.notes;
      } else {
        form.notes = trimmed;
      }
    } else {
      fieldErrors.notes = MESSAGES.notes;
    }
  }

  return { form, fieldErrors };
}

/**
 * Submit rules: draft rules plus every required field present. The server re-runs this
 * at submit time because a date valid when saved can fall out of range by midnight.
 * Attachment presence is checked separately because it is not part of form data.
 */
export function validateForSubmit(form: CaseFormData, now: Date, rules: FormRules): FieldErrors {
  const { fieldErrors } = validateDraft({ ...form }, now, rules);
  if (form.locationPreference === null) fieldErrors.locationPreference ??= MESSAGES.location;
  if (form.preferredDate === null) fieldErrors.preferredDate ??= MESSAGES.date;
  if (form.preferredPeriod === null) fieldErrors.preferredPeriod ??= MESSAGES.period;
  if (form.companionRequired === null) fieldErrors.companionRequired ??= MESSAGES.companion;
  if (form.helperName.trim() === '') fieldErrors.helperName ??= MESSAGES.helperNameRequired;
  if (form.helperPhone.trim() === '') fieldErrors.helperPhone ??= MESSAGES.helperPhoneRequired;
  return fieldErrors;
}

/** The on-screen order, used to focus the first error (spec §5.1). */
export function firstErrorField(errors: FieldErrors): string | null {
  for (const id of FIELD_IDS) {
    if (errors[id]) return id;
  }
  return errors['practice-document'] ? 'practice-document' : null;
}
