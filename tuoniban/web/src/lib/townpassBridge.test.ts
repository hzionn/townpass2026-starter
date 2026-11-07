import { afterEach, describe, expect, it } from 'vitest';
import { isInTownPass, scanWithBridge } from './townpassBridge';

function fakeBridge(options: { eventTarget: boolean }) {
  const listeners = new Set<FlutterMessageListener>();
  const sent: string[] = [];
  const bridge: FlutterObject = { postMessage: (message) => sent.push(message) };
  if (options.eventTarget) {
    bridge.addEventListener = (_type, listener) => listeners.add(listener);
    bridge.removeEventListener = (_type, listener) => listeners.delete(listener);
  }
  window.flutterObject = bridge;
  return {
    bridge,
    sent,
    listeners,
    reply(data: unknown) {
      for (const listener of [...listeners]) listener({ data });
      bridge.onmessage?.({ data });
    },
  };
}

/** Lets pending promise callbacks run, then reports whether the scan has settled. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  void promise.then(
    () => (done = true),
    () => (done = true),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  return done;
}

afterEach(() => {
  delete window.flutterObject;
});

describe('TownPass QR bridge', () => {
  it('detects the app by the injected flutterObject', () => {
    expect(isInTownPass()).toBe(false);
    fakeBridge({ eventTarget: true });
    expect(isInTownPass()).toBe(true);
  });

  it('sends the qr_code_scan request as a JSON string', () => {
    const fake = fakeBridge({ eventTarget: true });
    void scanWithBridge().result;
    expect(fake.sent).toEqual(['{"name":"qr_code_scan","data":null}']);
  });

  it('resolves with the scanned text and removes its listener', async () => {
    const fake = fakeBridge({ eventTarget: true });
    const scan = scanWithBridge();
    expect(fake.listeners.size).toBe(1);
    fake.reply(JSON.stringify({ name: 'qr_code_scan', data: 'https://example.test/assist#token=abc' }));
    await expect(scan.result).resolves.toBe('https://example.test/assist#token=abc');
    expect(fake.listeners.size).toBe(0);
  });

  it('treats a cancel (data: null) and an empty read as no result', async () => {
    const fake = fakeBridge({ eventTarget: true });
    const cancelled = scanWithBridge();
    fake.reply(JSON.stringify({ name: 'qr_code_scan', data: null }));
    await expect(cancelled.result).resolves.toBeNull();

    const empty = scanWithBridge();
    fake.reply(JSON.stringify({ name: 'qr_code_scan', data: '' }));
    await expect(empty.result).resolves.toBeNull();
  });

  it('ignores malformed and unrelated messages and keeps waiting', async () => {
    const fake = fakeBridge({ eventTarget: true });
    const scan = scanWithBridge();
    for (const junk of ['not json', 42, null, undefined, '[1,2]', '"text"', '{}', { name: 'qr_code_scan', data: 'x' }]) {
      fake.reply(junk);
    }
    fake.reply(JSON.stringify({ name: 'location', data: { latitude: 25 } }));
    expect(await settled(scan.result)).toBe(false);
    expect(fake.listeners.size).toBe(1);

    fake.reply(JSON.stringify({ name: 'qr_code_scan', data: 'later' }));
    await expect(scan.result).resolves.toBe('later');
  });

  it('settles once, so a second reply cannot redeem twice', async () => {
    const fake = fakeBridge({ eventTarget: true });
    const scan = scanWithBridge();
    fake.reply(JSON.stringify({ name: 'qr_code_scan', data: 'first' }));
    fake.reply(JSON.stringify({ name: 'qr_code_scan', data: 'second' }));
    await expect(scan.result).resolves.toBe('first');
    expect(fake.listeners.size).toBe(0);
  });

  it('falls back to onmessage and restores the previous handler afterwards', async () => {
    const fake = fakeBridge({ eventTarget: false });
    const previous: FlutterMessageListener = () => {};
    fake.bridge.onmessage = previous;

    const scan = scanWithBridge();
    expect(fake.bridge.onmessage).not.toBe(previous);
    fake.reply(JSON.stringify({ name: 'qr_code_scan', data: 'via onmessage' }));
    await expect(scan.result).resolves.toBe('via onmessage');
    expect(fake.bridge.onmessage).toBe(previous);
  });

  it('can be cancelled when leaving the page, and then ignores a late reply', async () => {
    const fake = fakeBridge({ eventTarget: true });
    const scan = scanWithBridge();
    scan.cancel();
    await expect(scan.result).resolves.toBeNull();
    expect(fake.listeners.size).toBe(0);
  });

  it('rejects and cleans up if the app refuses the message', async () => {
    const fake = fakeBridge({ eventTarget: true });
    fake.bridge.postMessage = () => {
      throw new Error('channel closed');
    };
    await expect(scanWithBridge().result).rejects.toThrow('channel closed');
    expect(fake.listeners.size).toBe(0);
  });
});
