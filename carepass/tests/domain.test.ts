import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSummary, createPlan, evaluateGuidance, filterProviders, needsProviderConfirmation } from '../src/domain/guidance.ts';
import { EMPTY_ANSWERS, type Answers, type Provider } from '../src/domain/models.ts';
import { clearPlan, isPlan, PLAN_KEY, restorePlan, savePlan } from '../src/adapters/storage.ts';
import { convertCsv, parseArea } from '../scripts/import-data.mjs';

const answers: Answers = { district: '文山區', need: 'home', hasCare: 'no', hasManager: '', preferredTime: '' };
const snapshot = JSON.parse(readFileSync(new URL('../src/data/providers.json', import.meta.url), 'utf8'));
const providers = snapshot.providers as Provider[];
const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
};

test('各種長照狀態走向對應的官方聯絡路徑', () => {
  assert.equal(evaluateGuidance(answers).id, 'R3');
  assert.equal(evaluateGuidance({ ...answers, hasCare: 'yes', hasManager: 'yes' }).id, 'R2');
  assert.equal(evaluateGuidance({ ...answers, hasCare: 'yes', hasManager: 'no' }).id, 'R4');
  assert.equal(evaluateGuidance({ ...answers, hasCare: 'unknown' }).id, 'R4');
  assert.equal(evaluateGuidance({ ...answers, need: 'other' }).id, 'R1');
  assert.equal(evaluateGuidance({ ...answers, district: 'other' }).id, 'R0');
  assert.equal(evaluateGuidance({ ...answers, district: 'unknown' }).id, 'R0');
});

test('未完成必要問題不產生看似完整的結果', () => {
  assert.throws(() => evaluateGuidance({ ...EMPTY_ANSWERS }), /必要問題/);
  assert.throws(() => evaluateGuidance({ ...answers, hasCare: 'yes' }), /必要問題/);
});

test('服務區別可處理頓號、逗號與「及」，未知範圍不自動擴大', () => {
  assert.deepEqual(parseArea('文山區、松山區及中正區').districts.sort(), ['文山區', '松山區', '中正區'].sort());
  assert.equal(parseArea('松山區,、文山區').scopeStatus, 'explicit');
  assert.equal(parseArea('全區').scopeStatus, 'needs-confirmation');
  assert.equal(parseArea('文山區及其他區').scopeStatus, 'needs-confirmation');
  assert.equal(parseArea('').scopeStatus, 'needs-confirmation');
});

test('單位依服務區域篩選，能包含機構位於其他區的單位', () => {
  const example: Provider = { ...providers[0], address: '臺北市大同區寧夏路', districts: ['文山區'], scopeStatus: 'explicit' };
  const pending: Provider = { ...example, id: 'pending', serviceAreaRaw: '全區', districts: [], scopeStatus: 'needs-confirmation' };
  assert.deepEqual(filterProviders([example, pending], '文山區'), [example]);
  assert.deepEqual(filterProviders([example], 'other'), []);
  assert.deepEqual(filterProviders([example], ''), []);
});

test('希望時段只進入聯絡摘要，不增加服務可用性推論', () => {
  const withTime = { ...answers, preferredTime: '下週三下午三小時' };
  assert.match(buildSummary(withTime), /下週三下午三小時/);
  assert.match(buildSummary(withTime), /實際安排仍需確認/);
  assert.equal(evaluateGuidance(withTime).id, evaluateGuidance(answers).id);
  assert.equal(buildSummary(answers).includes('希望使用的時段'), false);
});

test('停業或暫停派案註記另列待確認，不宣稱已恢復或確定符合', () => {
  const normal: Provider = { ...providers[0], name: '測試單位', districts: ['文山區'], scopeStatus: 'explicit' };
  const suspended = { ...normal, id: 'suspended', name: '測試單位<115年6月至116年6月停業>' };
  const historical = { ...normal, id: 'historical', name: '測試單位<114年暫停派案>' };
  assert.equal(needsProviderConfirmation(suspended), true);
  assert.equal(needsProviderConfirmation(historical), true);
  assert.deepEqual(filterProviders([normal, suspended, historical], '文山區'), [normal]);
});

test('不選單位仍能建立完整清單，外縣市不夾帶臺北單位', () => {
  const plan = createPlan(answers, snapshot.source.version);
  assert.equal(plan.provider, null);
  assert.equal(plan.tasks.length, 4);
  assert.ok(plan.tasks.every(t => t.status === 'todo'));
  assert.equal(createPlan({ ...answers, district: 'other' }, 'test', providers[0]).provider, null);
});

test('保存、恢復待辦狀態及清除可以往返', () => {
  const storage = memory();
  const plan = createPlan(answers, 'test', providers[0]);
  plan.tasks[0].status = 'waiting';
  assert.equal(savePlan(storage, plan), true);
  assert.deepEqual(restorePlan(storage), { plan, issue: null });
  assert.equal(clearPlan(storage), true);
  assert.deepEqual(restorePlan(storage), { plan: null, issue: null });
});

test('儲存不可用時回報失敗，不假裝已保存或清除', () => {
  const storage = { getItem() { throw new Error('disabled'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('disabled'); } };
  assert.equal(savePlan(storage, createPlan(answers, 'test')), false);
  assert.equal(clearPlan(storage), false);
  assert.equal(restorePlan(storage).issue, 'unavailable');
});

test('損壞、舊 schema 或錯誤分流紀錄不被當成有效清單', () => {
  const storage = memory();
  storage.setItem(PLAN_KEY, '{bad');
  assert.equal(restorePlan(storage).issue, 'invalid');
  const plan = createPlan(answers, 'test');
  assert.equal(isPlan({ ...plan, schemaVersion: 0 }), false);
  assert.equal(isPlan({ ...plan, tasks: null }), false);
  assert.equal(isPlan({ ...plan, ruleId: 'R2' }), false);
  assert.equal(isPlan({ ...plan, answers: { ...plan.answers, hasCare: '' } }), false);
  assert.equal(isPlan(plan), true);
});

test('官方 Big5 快照可重現，識別碼唯一、確定範圍不包含「全區」', () => {
  const bytes = readFileSync(new URL('../data/home.csv', import.meta.url));
  const converted = convertCsv(bytes);
  assert.equal(converted.providers.length, snapshot.source.outputCount);
  assert.deepEqual(converted.providers, providers);
  assert.equal(new Set(providers.map(p => p.id)).size, providers.length);
  assert.ok(providers.some(p => p.scopeStatus === 'explicit'));
  assert.ok(providers.some(p => p.serviceAreaRaw === '全區' && p.scopeStatus === 'needs-confirmation'));
});

test('空檔及必要欄位異動會阻止資料更新', () => {
  assert.throws(() => convertCsv(Buffer.from('')), /沒有資料/);
  assert.throws(() => convertCsv(Buffer.from('a,b\n1,2')), /必要欄位/);
});
