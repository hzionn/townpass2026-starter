import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callPhone, cleanPhone, isDialablePhone, openOfficial } from '../src/adapters/bridge.ts';

test('撥號只傳送正規化電話，透過 bridge 回覆辨識是否可啟動', async () => {
  const sent: string[] = [];
  let listener: ((event: { data: string }) => void) | null = null;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { flutterObject: { postMessage(value: string) { sent.push(value); listener?.({ data: JSON.stringify({ name: 'phone_call', data: true }) }); }, addEventListener(_name: string, callback: typeof listener) { listener = callback; }, removeEventListener() { listener = null; } } } });
  assert.equal(await callPhone('(02) 1234-5678'), true);
  assert.deepEqual(JSON.parse(sent[0]), { name: 'phone_call', data: '0212345678' });
  assert.equal(listener, null);
  assert.equal(cleanPhone('1966'), '1966');
});

test('沒有 bridge 時走 tel；格式無效不嘗試開啟', async () => {
  const location = { href: '' };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location } });
  assert.equal(await callPhone('1966'), true);
  assert.equal(location.href, 'tel:1966');
  location.href = '';
  assert.equal(await callPhone(''), false);
  assert.equal(location.href, '');
});

test('官方連結在 App 透過另一個 WebView 開啟，保留 CarePass 狀態', () => {
  let sent = ''; let prevented = false;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { flutterObject: { postMessage(value: string) { sent = value; } } } });
  openOfficial({ preventDefault() { prevented = true; } }, 'https://1966.gov.tw/');
  assert.equal(prevented, true);
  assert.deepEqual(JSON.parse(sent), { name: 'open_link', data: 'https://1966.gov.tw/' });
});

test('來源疑似缺少前導零時不補造號碼，也不直接撥號', async () => {
  assert.equal(isDialablePhone('986899395'), false);
  assert.equal(isDialablePhone('0986899395'), true);
  assert.equal(isDialablePhone('+886986899395'), true);
  assert.equal(await callPhone('986899395'), false);
});
