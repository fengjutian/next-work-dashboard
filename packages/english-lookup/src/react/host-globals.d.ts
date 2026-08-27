/**
 * Host globals consumed by the English-lookup panel.
 *
 * The package uses `window.speechSynthesis` for TTS, `localStorage` via the
 * adapter for persistence, and an Electron-style `<webview>` element for
 * article extraction. Hosts running inside Electron get these for free.
 * Hosts running in a plain browser can polyfill or skip the article reader.
 */

export {};

declare global {
  interface Window {
    speechSynthesis?: SpeechSynthesis;
  }
}
