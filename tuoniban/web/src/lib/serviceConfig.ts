/** Helpers for reading the fixed service config. Screens never hard-code its values. */
import {
  REQUIREMENT_ID,
  type AttachmentInfo,
  type CaseFormData,
  type FieldErrors,
  type FieldId,
  type ServiceConfigResponse,
  type ServiceField,
  type ServiceFieldOption,
} from '../../../shared/contract';
import { validateForSubmit, type FormRules } from '../../../shared/form';

export const ATTACHMENT_REQUIRED_MESSAGE = '請上傳一份合成練習附件。';

export function fieldConfig(service: ServiceConfigResponse, id: FieldId): ServiceField | undefined {
  return service.fields.find((field) => field.id === id);
}

export function optionFor(
  service: ServiceConfigResponse,
  id: FieldId,
  value: string | null,
): ServiceFieldOption | undefined {
  return fieldConfig(service, id)?.options?.find((option) => option.value === value);
}

/** The label to show for a chosen option, such as a site's name instead of its id. */
export function optionLabel(service: ServiceConfigResponse, id: FieldId, value: string | null): string {
  return optionFor(service, id, value)?.label ?? '未選擇';
}

export function formRules(service: ServiceConfigResponse): FormRules {
  return { locationIds: fieldConfig(service, 'locationPreference')?.options?.map((option) => option.value) ?? [] };
}

export interface OptionGroup {
  label: string | null;
  options: ServiceFieldOption[];
}

/** Keeps the config's order and gathers options under their group, one <optgroup> per district. */
export function groupOptions(options: readonly ServiceFieldOption[]): OptionGroup[] {
  const groups: OptionGroup[] = [];
  for (const option of options) {
    const label = option.group ?? null;
    const group = groups.find((candidate) => candidate.label === label);
    if (group) group.options.push(option);
    else groups.push({ label, options: [option] });
  }
  return groups;
}

/** The competition requires open data to be cited wherever it is used. */
export function locationSourceNote(service: ServiceConfigResponse): string | null {
  const source = service.openDataSources[0];
  if (!source) return null;
  return `資料來源：${source.datasetName}（${source.provider}，${source.licence}）。${source.usage}`;
}

/** Everything that must be complete before S05, in one place for S04 and S05 to share. */
export function submitErrors(
  form: CaseFormData,
  attachment: AttachmentInfo | null,
  now: Date,
  service: ServiceConfigResponse,
): FieldErrors {
  const errors = validateForSubmit(form, now, formRules(service));
  if (!attachment) errors[REQUIREMENT_ID] = ATTACHMENT_REQUIRED_MESSAGE;
  return errors;
}

export function attachmentTypeLabel(mime: string): string {
  if (mime === 'application/pdf') return 'PDF';
  if (mime === 'image/png') return 'PNG';
  if (mime === 'image/jpeg') return 'JPEG';
  return '檔案';
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
