import { describe, expect, it } from 'vitest';
import type { CaseFormData, FieldId } from './contract.js';
import {
  addDaysToDate,
  allowedDateRange,
  emptyFormData,
  firstErrorField,
  taipeiDateString,
  validateDraft,
  validateForSubmit,
} from './form.js';

// 2026-11-07 14:00 in Taipei.
const NOW = new Date('2026-11-07T06:00:00.000Z');

const RULES = { locationIds: ['site-a', 'site-b'] };

const complete: CaseFormData = {
  locationPreference: 'site-a',
  preferredDate: '2026-11-08',
  preferredPeriod: 'morning',
  companionRequired: false,
  helperName: '小王',
  helperPhone: '0900000000',
  notes: '',
};

function draft(overrides: Partial<Record<FieldId, unknown>>) {
  return validateDraft({ ...emptyFormData(), ...overrides } as Record<FieldId, unknown>, NOW, RULES);
}

describe('Taipei dates', () => {
  it('rolls to the next calendar day at 16:00 UTC', () => {
    expect(taipeiDateString(new Date('2026-11-07T15:59:59.000Z'))).toBe('2026-11-07');
    expect(taipeiDateString(new Date('2026-11-07T16:00:00.000Z'))).toBe('2026-11-08');
  });

  it('adds days across a month boundary', () => {
    expect(addDaysToDate('2026-11-30', 1)).toBe('2026-12-01');
  });

  it('allows tomorrow through 30 days from now', () => {
    expect(allowedDateRange(NOW)).toEqual({ min: '2026-11-08', max: '2026-12-07' });
  });
});

describe('validateDraft', () => {
  it('accepts a completely empty draft', () => {
    expect(draft({}).fieldErrors).toEqual({});
  });

  it('treats empty strings on choice fields as not answered', () => {
    const { form, fieldErrors } = draft({ locationPreference: '', preferredDate: '', preferredPeriod: '' });
    expect(fieldErrors).toEqual({});
    expect(form.locationPreference).toBeNull();
    expect(form.preferredDate).toBeNull();
    expect(form.preferredPeriod).toBeNull();
  });

  // AT07: yesterday, today, tomorrow, 30 days from now, 31 days from now.
  it.each([
    ['2026-11-06', false],
    ['2026-11-07', false],
    ['2026-11-08', true],
    ['2026-12-07', true],
    ['2026-12-08', false],
  ])('date %s accepted: %s', (preferredDate, accepted) => {
    expect(draft({ preferredDate }).fieldErrors.preferredDate === undefined).toBe(accepted);
  });

  it.each(['2026-02-31', '2026/11/08', '20261108', 20261108, true])('rejects malformed date %s', (preferredDate) => {
    expect(draft({ preferredDate }).fieldErrors.preferredDate).toBeDefined();
  });

  it('accepts only locations from the configured list', () => {
    expect(draft({ locationPreference: 'site-b' }).form.locationPreference).toBe('site-b');
  });

  it.each(['site-c', 1, {}])('rejects unknown location %s', (locationPreference) => {
    expect(draft({ locationPreference }).fieldErrors.locationPreference).toBeDefined();
  });

  it('never treats a non-boolean as a companion answer', () => {
    expect(draft({ companionRequired: 'false' }).fieldErrors.companionRequired).toBeDefined();
    expect(draft({ companionRequired: 0 }).fieldErrors.companionRequired).toBeDefined();
    expect(draft({ companionRequired: null }).form.companionRequired).toBeNull();
    expect(draft({ companionRequired: false }).form.companionRequired).toBe(false);
  });

  it('trims helperName and counts code points, not UTF-16 units', () => {
    expect(draft({ helperName: '  小王  ' }).form.helperName).toBe('小王');
    expect(draft({ helperName: '😀'.repeat(30) }).fieldErrors.helperName).toBeUndefined();
    expect(draft({ helperName: '字'.repeat(31) }).fieldErrors.helperName).toBeDefined();
  });

  it('allows a blank helperName in a draft but rejects control characters', () => {
    expect(draft({ helperName: '   ' }).fieldErrors.helperName).toBeUndefined();
    expect(draft({ helperName: '小\u0000王' }).fieldErrors.helperName).toBeDefined();
  });

  it.each([
    ['0900000000', true],
    ['09000000', false],
    ['0800000000', false],
    ['09000000000', false],
    ['09-0000000', false],
    [900000000, false],
  ])('phone %s accepted: %s', (helperPhone, accepted) => {
    expect(draft({ helperPhone }).fieldErrors.helperPhone === undefined).toBe(accepted);
  });

  it('limits notes to 300 characters and allows newlines', () => {
    expect(draft({ notes: '字'.repeat(300) }).fieldErrors.notes).toBeUndefined();
    expect(draft({ notes: '字'.repeat(301) }).fieldErrors.notes).toBeDefined();
    expect(draft({ notes: '第一行\n第二行' }).fieldErrors.notes).toBeUndefined();
  });

  it('never echoes the submitted value in an error message', () => {
    const secret = 'A123456789-SECRET';
    const { fieldErrors } = draft({ preferredDate: secret, helperPhone: secret, locationPreference: secret });
    expect(JSON.stringify(fieldErrors)).not.toContain(secret);
  });
});

describe('validateForSubmit', () => {
  it('passes a complete form', () => {
    expect(validateForSubmit(complete, NOW, RULES)).toEqual({});
  });

  it('reports every missing required field but not the optional notes', () => {
    const errors = validateForSubmit(emptyFormData(), NOW, RULES);
    expect(Object.keys(errors).sort()).toEqual(
      ['companionRequired', 'helperName', 'helperPhone', 'locationPreference', 'preferredDate', 'preferredPeriod'].sort(),
    );
  });

  it('accepts false as a real answer to the companion question', () => {
    expect(validateForSubmit({ ...complete, companionRequired: false }, NOW, RULES).companionRequired).toBeUndefined();
    expect(validateForSubmit({ ...complete, companionRequired: null }, NOW, RULES).companionRequired).toBeDefined();
  });

  it('rejects a whitespace-only helperName', () => {
    expect(validateForSubmit({ ...complete, helperName: '   ' }, NOW, RULES).helperName).toBeDefined();
  });

  it('re-checks the date against the current day', () => {
    const afterMidnight = new Date('2026-11-07T16:10:00.000Z');
    expect(validateForSubmit(complete, afterMidnight, RULES).preferredDate).toBeDefined();
  });
});

describe('firstErrorField', () => {
  it('follows on-screen order, with the attachment last', () => {
    expect(firstErrorField({ notes: 'x', preferredDate: 'y' })).toBe('preferredDate');
    expect(firstErrorField({ 'practice-document': 'x' })).toBe('practice-document');
    expect(firstErrorField({})).toBeNull();
  });
});
