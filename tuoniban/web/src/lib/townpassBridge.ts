/**
 * The TownPass app's QR scanner, reached through window.flutterObject (spec §8.1).
 *
 * In the app we always use this bridge: TPWebView sets no onPermissionRequest, so the page
 * itself is unlikely to get camera access there.
 *
 * Request: postMessage(JSON.stringify({ name: 'qr_code_scan', data: null }))
 * Reply:   a `message` event whose event.data is the JSON string { name, data }, where data
 *          is the scanned string, or null when the user cancelled.
 */
const SCAN_MESSAGE = 'qr_code_scan';

export function isInTownPass(): boolean {
  return Boolean(window.flutterObject);
}

/** Returns the scanned text, or null for a cancel or an empty read. */
function readScanReply(raw: unknown): { value: string | null } | null {
  if (typeof raw !== 'string') return null;
  let reply: unknown;
  try {
    reply = JSON.parse(raw);
  } catch {
    return null;
  }
  if (reply === null || typeof reply !== 'object') return null;
  const { name, data } = reply as { name?: unknown; data?: unknown };
  if (name !== SCAN_MESSAGE) return null;
  return { value: typeof data === 'string' && data !== '' ? data : null };
}

/** Some environments only offer onmessage. Returns a function that removes the listener. */
function subscribe(bridge: FlutterObject, listener: FlutterMessageListener): () => void {
  if (typeof bridge.addEventListener === 'function') {
    bridge.addEventListener('message', listener);
    return () => bridge.removeEventListener?.('message', listener);
  }
  const previous = bridge.onmessage ?? null;
  bridge.onmessage = listener;
  return () => {
    bridge.onmessage = previous;
  };
}

export interface BridgeScan {
  /** Resolves once: the scanned text, or null if cancelled. */
  result: Promise<string | null>;
  /** For leaving the page while the scanner is open: a late reply is then ignored. */
  cancel(): void;
}

export function scanWithBridge(): BridgeScan {
  const bridge = window.flutterObject;
  if (!bridge) throw new Error('Not running inside TownPass');

  let finish: (value: string | null) => void = () => {};
  let unsubscribe = () => {};
  const result = new Promise<string | null>((resolve, reject) => {
    // The listener goes away after the first reply, so one scan can never redeem twice.
    finish = (value) => {
      unsubscribe();
      resolve(value);
    };
    unsubscribe = subscribe(bridge, (event) => {
      const reply = readScanReply(event.data);
      if (reply) finish(reply.value);
    });
    try {
      bridge.postMessage(JSON.stringify({ name: SCAN_MESSAGE, data: null }));
    } catch (error) {
      unsubscribe();
      reject(error);
    }
  });

  return { result, cancel: () => finish(null) };
}
