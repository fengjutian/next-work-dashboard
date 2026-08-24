import fs from 'node:fs';
import path from 'node:path';
import type { FindingCategory, ScanContext, SecurityFinding, SecurityScanner, SecuritySeverity } from './types';
import { findingId, fingerprint, redactSecrets } from './security';

interface Rule { id: string; title: string; pattern: RegExp; category: FindingCategory; severity: SecuritySeverity; description: string; recommendation: string; cwe?: string; files?: RegExp }

const RULES: Rule[] = [
  { id: 'secret.generic-api-key', title: '疑似硬编码密钥', pattern: /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["'][^"'\s]{12,}["']/i, category: 'secret', severity: 'P0', description: '源代码包含疑似长期凭据。', recommendation: '立即轮换凭据，并改用系统凭据存储或运行时环境变量。', cwe: 'CWE-798' },
  { id: 'secret.private-key', title: '私钥被提交到项目', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, category: 'secret', severity: 'P0', description: '项目文件中包含私钥材料。', recommendation: '撤销并轮换密钥，从版本历史清除后改用安全密钥存储。', cwe: 'CWE-321' },
  { id: 'sast.child-process-shell', title: '子进程启用了 shell', pattern: /(?:spawn|execFile)\([^\n]+shell\s*:\s*true/, category: 'sast', severity: 'P1', description: 'shell 模式会扩大命令注入攻击面。', recommendation: '使用固定可执行文件和参数数组，并关闭 shell。', cwe: 'CWE-78', files: /\.[cm]?[jt]sx?$/i },
  { id: 'sast.eval', title: '动态代码执行', pattern: /\b(?:eval|new\s+Function)\s*\(/, category: 'sast', severity: 'P1', description: '动态执行字符串可能导致任意代码执行。', recommendation: '使用显式解析器或白名单映射替代动态执行。', cwe: 'CWE-95', files: /\.[cm]?[jt]sx?$/i },
  { id: 'sast.sql-template', title: '疑似动态 SQL 拼接', pattern: /(?:SELECT|INSERT|UPDATE|DELETE)[^\n`]*\$\{|(?:query|execute)\s*\([^\n]*\+/, category: 'sast', severity: 'P1', description: 'SQL 查询可能包含未经参数化的输入。', recommendation: '改用 prepared statement 或 ORM 参数绑定。', cwe: 'CWE-89' },
  { id: 'electron.node-integration', title: 'Electron Node 集成已启用', pattern: /nodeIntegration\s*:\s*true/, category: 'config', severity: 'P0', description: '渲染进程具备 Node.js 权限，页面注入可能升级为本地代码执行。', recommendation: '关闭 nodeIntegration，并通过最小化 preload bridge 暴露能力。', cwe: 'CWE-250', files: /\.[cm]?[jt]sx?$/i },
  { id: 'electron.context-isolation', title: 'Electron 上下文隔离已关闭', pattern: /contextIsolation\s*:\s*false/, category: 'config', severity: 'P0', description: '关闭上下文隔离会削弱 preload 与页面之间的安全边界。', recommendation: '启用 contextIsolation，并使用 contextBridge。', cwe: 'CWE-693', files: /\.[cm]?[jt]sx?$/i },
  { id: 'iac.docker-root', title: '容器未声明非 root 用户', pattern: /\bFROM\s+[^\n]+(?![\s\S]*\bUSER\s+[^\s]+)/i, category: 'iac', severity: 'P2', description: '容器可能以 root 身份运行。', recommendation: '创建并切换到最小权限的非 root 用户。', cwe: 'CWE-250', files: /(^|\/)Dockerfile$/i },
];

function scanRules(context: ScanContext): SecurityFinding[] {
  const now = Date.now();
  const findings: SecurityFinding[] = [];
  for (const file of context.files) {
    if (context.signal.aborted) break;
    let content: string;
    try { content = fs.readFileSync(path.join(context.projectDir, file), 'utf8'); } catch { continue; }
    if (content.includes('\0')) continue;
    const lines = content.split(/\r?\n/);
    for (const rule of RULES) {
      // Docker USER is a file/stage-level property and is evaluated below.
      if (rule.id === 'iac.docker-root') continue;
      if (rule.files && !rule.files.test(file)) continue;
      lines.forEach((line, index) => {
        if (!rule.pattern.test(line)) return;
        const excerpt = redactSecrets(line.trim()).slice(0, 500);
        const key = fingerprint('builtin-rules', rule.id, file, excerpt);
        findings.push({ id: findingId(key), fingerprint: key, scannerId: 'builtin-rules', ruleId: rule.id, category: rule.category, severity: rule.severity, confidence: 'medium', status: 'open', title: rule.title, description: rule.description, location: { file, line: index + 1 }, evidence: [{ kind: 'code', excerpt, location: { file, line: index + 1 } }], recommendation: rule.recommendation, cwe: rule.cwe, firstSeenAt: now, lastSeenAt: now });
      });
    }
    if (/(^|\/)Dockerfile$/i.test(file)) {
      const stages = new Map<string, { user?: string }>();
      let finalStage: { line: number; from: string; user?: string } | undefined;
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index].trim();
        if (!line || line.startsWith('#')) continue;
        const from = /^FROM(?:\s+--platform=\S+)?\s+(\S+)(?:\s+AS\s+(\S+))?/i.exec(line);
        if (from) {
          finalStage = { line: index + 1, from: line, user: stages.get(from[1].toLowerCase())?.user };
          if (from[2]) stages.set(from[2].toLowerCase(), finalStage);
          continue;
        }
        const user = /^USER\s+([^\s#]+)/i.exec(line);
        if (user && finalStage) finalStage.user = user[1];
      }
      if (finalStage && (!finalStage.user || /^(?:root|0)(?::|$)/i.test(finalStage.user))) {
        const rule = RULES.find((item) => item.id === 'iac.docker-root');
        if (!rule) continue;
        const excerpt = finalStage.from.slice(0, 500);
        const key = fingerprint('builtin-rules', rule.id, file, excerpt);
        findings.push({ id: findingId(key), fingerprint: key, scannerId: 'builtin-rules', ruleId: rule.id, category: rule.category, severity: rule.severity, confidence: 'medium', status: 'open', title: rule.title, description: rule.description, location: { file, line: finalStage.line }, evidence: [{ kind: 'code', excerpt, location: { file, line: finalStage.line } }], recommendation: rule.recommendation, cwe: rule.cwe, firstSeenAt: now, lastSeenAt: now });
      }
    }
  }
  return findings;
}

export const builtinRuleScanner: SecurityScanner = {
  id: 'builtin-rules', name: 'Built-in Secret/SAST/Electron/IaC',
  async detect() { return true; },
  async scan(context) { return scanRules(context); },
};

export const dependencyManifestScanner: SecurityScanner = {
  id: 'dependency-manifest', name: 'Dependency Manifest Audit',
  async detect(context) { return context.files.some((file) => /(^|\/)(package\.json|Cargo\.toml|requirements\.txt|go\.mod)$/i.test(file)); },
  async scan(context) {
    const now = Date.now();
    const findings: SecurityFinding[] = [];
    for (const file of context.files.filter((item) => /(^|\/)package\.json$/i.test(item))) {
      let parsed: { scripts?: Record<string, string> };
      try { parsed = JSON.parse(fs.readFileSync(path.join(context.projectDir, file), 'utf8')) as typeof parsed; } catch { continue; }
      for (const [name, command] of Object.entries(parsed.scripts ?? {})) {
        if (!/^(preinstall|install|postinstall)$/.test(name) || !/(?:curl|wget|powershell|Invoke-WebRequest|\bnpx\b)/i.test(command)) continue;
        const excerpt = `${name}: ${redactSecrets(command)}`;
        const key = fingerprint('dependency-manifest', 'sca.install-script-network', file, excerpt);
        findings.push({ id: findingId(key), fingerprint: key, scannerId: 'dependency-manifest', ruleId: 'sca.install-script-network', category: 'sca', severity: 'P1', confidence: 'high', status: 'open', title: '依赖安装脚本执行网络命令', description: '安装生命周期脚本会下载或执行外部内容，存在供应链风险。', location: { file, line: 1 }, evidence: [{ kind: 'dependency', excerpt }], recommendation: '锁定并校验下载产物，避免在安装阶段执行远程脚本。', cwe: 'CWE-494', firstSeenAt: now, lastSeenAt: now });
      }
    }
    return findings;
  },
};

export const builtinScanners: SecurityScanner[] = [builtinRuleScanner, dependencyManifestScanner];
