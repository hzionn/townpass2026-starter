import { DISTRICTS, type Answers, type Guidance, type Plan, type Provider } from './models.ts';

export const OFFICIAL_GUIDE = 'https://1966.gov.tw/LTC/cp-6533-70777-207.html';
export const RULE_VERSION = '2026-11-07.1';
export const GUIDANCE: Record<Guidance['id'], Guidance> = {
  R0: {
    id: 'R0', label: '先確認服務地區', title: '先和所在地的長照窗口聊聊',
    description: '這份單位名錄以臺北市特約資源為主。先確認家人實際需要服務的地區，再由官方窗口協助了解當地資源。',
    contact: '1966 長照專線', tasks: ['確認家人實際需要服務的縣市與行政區', '聯絡 1966，詢問所在地的長照窗口', '確認可使用的服務與後續申請方式'],
  },
  R1: {
    id: 'R1', label: '先釐清照顧方式', title: '先找出適合家人的照顧方式',
    description: '除了到府協助，喘息服務還有其他照顧方式。可以先向 1966 說明需求，由官方窗口協助了解選項。',
    contact: '1966 長照專線', tasks: ['整理希望獲得協助的時間與照顧方式', '聯絡 1966，詢問適合的喘息服務', '確認服務安排與需要準備的資訊'],
  },
  R2: {
    id: 'R2', label: '已有長照服務', title: '先聯絡熟悉你們的個管員',
    description: '把希望有人到府協助的需求告訴既有個管員，討論照顧計畫與喘息安排。下方名錄也可以作為討論時的參考。',
    contact: '你的長照個管員', tasks: ['將聯絡摘要提供給既有個管員', '確認照顧計畫與喘息服務安排方式', '詢問服務時段與需要準備的資訊'],
  },
  R3: {
    id: 'R3', label: '第一次接觸長照', title: '第一步，從 1966 開始',
    description: '先透過 1966 或官方線上入口提出需求，後續由照管專員評估，再與個管員討論照顧計畫及服務安排。',
    contact: '1966 長照專線', tasks: ['聯絡 1966，說明家人的到府照顧需求', '詢問申請及評估流程、需要準備的資訊', '確認後續聯絡窗口與照顧計畫安排'],
  },
  R4: {
    id: 'R4', label: '先確認目前進度', title: '不確定也沒關係，先確認現況',
    description: '可以向 1966 說明目前不清楚長照使用狀態，或找不到個管員聯絡方式，請官方窗口協助確認下一步。',
    contact: '1966 長照專線', tasks: ['整理目前知道的長照申請或服務狀態', '聯絡 1966，確認目前狀態與聯絡窗口', '詢問喘息需求接下來應如何安排'],
  },
};

export function isDistrict(value: string): value is Answers['district'] & typeof DISTRICTS[number] {
  return (DISTRICTS as readonly string[]).includes(value);
}

export function canShowProviders(answers: Answers): boolean {
  return isDistrict(answers.district) && answers.need === 'home';
}

export function evaluateGuidance(answers: Answers): Guidance {
  if (!answers.district || !answers.need || !answers.hasCare || (answers.hasCare === 'yes' && !answers.hasManager)) {
    throw new Error('請先完成必要問題。');
  }
  if (!isDistrict(answers.district)) return GUIDANCE.R0;
  if (answers.need !== 'home') return GUIDANCE.R1;
  if (answers.hasCare === 'yes' && answers.hasManager === 'yes') return GUIDANCE.R2;
  if (answers.hasCare === 'no') return GUIDANCE.R3;
  return GUIDANCE.R4;
}

export function filterProviders(providers: Provider[], district: string): Provider[] {
  if (!isDistrict(district)) return [];
  return providers.filter(p => !needsProviderConfirmation(p) && p.districts.includes(district));
}

export function hasServiceNotice(provider: Provider): boolean {
  // Retain historical notices too: an old suspension end date is not proof of resumed service.
  return /停業|暫停|停約/.test(provider.name);
}

export function needsProviderConfirmation(provider: Provider): boolean {
  return provider.scopeStatus !== 'explicit' || hasServiceNotice(provider);
}

export function buildSummary(answers: Answers, provider?: Provider | null): string {
  const area = isDistrict(answers.district) ? `臺北市${answers.district}` : answers.district === 'other' ? '臺北市以外地區' : '尚待確認的地區';
  const need = answers.need === 'home' ? '居家喘息服務，希望有人到家中協助照顧家人' : '喘息服務，想先了解適合的照顧方式';
  const state = answers.hasCare === 'no' ? '目前尚未使用政府長照服務' : answers.hasCare === 'yes' ? '目前已使用政府長照服務' : '目前不清楚長照申請或使用狀態';
  return [`我想詢問在${area}的${need}。`, answers.preferredTime.trim() ? `希望使用的時段是${answers.preferredTime.trim()}，實際安排仍需確認。` : '', `${state}。`, provider ? `想進一步了解「${provider.name}」的服務範圍與安排方式。` : '', '請問應先聯絡哪個窗口、完成哪些步驟，以及準備什麼資訊？'].filter(Boolean).join('\n');
}

export function createPlan(answers: Answers, dataVersion: string, provider: Provider | null = null): Plan {
  const guidance = evaluateGuidance(answers);
  const safeProvider = canShowProviders(answers) ? provider : null;
  return {
    schemaVersion: 1, ruleVersion: RULE_VERSION, dataVersion, answers: { ...answers }, ruleId: guidance.id,
    provider: safeProvider ? { id: safeProvider.id, name: safeProvider.name, phone: safeProvider.phone, extension: safeProvider.extension } : null,
    summary: buildSummary(answers, safeProvider),
    tasks: [...guidance.tasks, '記錄回覆，確認下一次聯絡時間'].map((title, index) => ({ id: `task-${index}`, title, status: 'todo' })),
    updatedAt: new Date().toISOString(),
  };
}
