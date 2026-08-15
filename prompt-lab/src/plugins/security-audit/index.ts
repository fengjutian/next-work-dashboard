/**
 * Security Audit 插件 entry — re-export 主面板 + constants。
 *
 * 注册到 src/plugins/built-in/index.ts 的 builtInPlugins[] 时按
 * `preloadable(() => import('../security-audit'))` 加载，default 是
 * SecurityAuditPanel 组件。
 */
export { SecurityAuditPanel } from './SecurityAuditPanel';
export {
  PLUGIN_ID,
  PLUGIN_NAME,
  COMMAND_EVENT,
  SETTINGS_KEYS,
  type CommandEventDetail,
  type Finding,
  type FindingLocation,
  type ScanPhase,
  type ScanProgress,
  type Severity,
  type SandboxMode,
} from './constants';
