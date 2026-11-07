export const DISTRICTS = ['松山區', '信義區', '大安區', '中山區', '中正區', '大同區', '萬華區', '文山區', '南港區', '內湖區', '士林區', '北投區'] as const;
export type District = typeof DISTRICTS[number];
export type AnswerState = 'yes' | 'no' | 'unknown';
export interface Answers {
  district: District | 'other' | 'unknown' | '';
  need: 'home' | 'other' | 'unknown' | '';
  hasCare: AnswerState | '';
  hasManager: AnswerState | '';
  preferredTime: string;
}
export const EMPTY_ANSWERS: Answers = { district: '', need: '', hasCare: '', hasManager: '', preferredTime: '' };
export interface Provider {
  id: string;
  name: string;
  address: string;
  phone: string;
  extension: string;
  mobile: string;
  serviceAreaRaw: string;
  districts: string[];
  scopeStatus: 'explicit' | 'needs-confirmation';
  respiteCode: string;
  shortCareCode: string;
  sourceRowId: string;
}
export type RuleId = 'R0' | 'R1' | 'R2' | 'R3' | 'R4';
export interface Guidance {
  id: RuleId;
  label: string;
  title: string;
  description: string;
  contact: string;
  tasks: string[];
}
export type TaskStatus = 'todo' | 'waiting' | 'done';
export interface Plan {
  schemaVersion: 1;
  ruleVersion: string;
  dataVersion: string;
  answers: Answers;
  ruleId: RuleId;
  provider: Pick<Provider, 'id' | 'name' | 'phone' | 'extension'> | null;
  summary: string;
  tasks: { id: string; title: string; status: TaskStatus }[];
  updatedAt: string;
}
