/// <reference types="vite/client" />

/** The object TownPass injects into its WebView before the page loads. */
interface FlutterMessageEvent {
  data: unknown;
}

type FlutterMessageListener = (event: FlutterMessageEvent) => void;

interface FlutterObject {
  postMessage(message: string): void;
  addEventListener?(type: 'message', listener: FlutterMessageListener): void;
  removeEventListener?(type: 'message', listener: FlutterMessageListener): void;
  onmessage?: FlutterMessageListener | null;
}

interface Window {
  flutterObject?: FlutterObject;
}
