/**
 * Cleaner Inject — 注入 webview 的净化脚本字符串
 *
 * 由 main 端通过 work-browser:cleaner:payload IPC 返回，
 * 在 webview 加载完成后追加到 <head> 末尾。
 */
export const CLEANER_INJECT_PREFIX = '/* work-browser cleaner */';
