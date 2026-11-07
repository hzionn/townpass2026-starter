import { cleanPhone, isDialablePhone } from '../domain/phone.ts';
export { cleanPhone, isDialablePhone } from '../domain/phone.ts';

interface FlutterBridge {
  postMessage(message: string): void;
  addEventListener?: (name: string, listener: (event: MessageEvent) => void) => void;
  removeEventListener?: (name: string, listener: (event: MessageEvent) => void) => void;
  onmessage?: ((event: MessageEvent) => void) | null;
}
declare global { interface Window { flutterObject?: FlutterBridge } }

export function callPhone(phone: string): Promise<boolean> {
  const number = cleanPhone(phone);
  if (!isDialablePhone(phone)) return Promise.resolve(false);
  const bridge = window.flutterObject;
  if (!bridge) { window.location.href = `tel:${number}`; return Promise.resolve(true); }
  return new Promise(resolve => {
    const previous = bridge.onmessage;
    const finish = (success: boolean) => {
      clearTimeout(timer);
      if (bridge.removeEventListener) bridge.removeEventListener('message', listener);
      else if (bridge.onmessage === listener) bridge.onmessage = previous;
      resolve(success);
    };
    const listener = (event: MessageEvent) => {
      try { const reply = JSON.parse(event.data); if (reply.name === 'phone_call') finish(reply.data === true); } catch { /* Ignore unrelated messages. */ }
    };
    const timer = setTimeout(() => finish(false), 7000);
    if (bridge.addEventListener) bridge.addEventListener('message', listener);
    else bridge.onmessage = listener;
    try { bridge.postMessage(JSON.stringify({ name: 'phone_call', data: number })); } catch { finish(false); }
  });
}

export function openOfficial(event: { preventDefault(): void }, url: string): void {
  if (!window.flutterObject) return;
  try { window.flutterObject.postMessage(JSON.stringify({ name: 'open_link', data: url })); event.preventDefault(); } catch { /* Use the original link. */ }
}
