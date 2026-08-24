var _a;
import { parentPort } from "node:worker_threads";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as ts from "typescript";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
promisify(execFile);
function fingerprint(scannerId, ruleId, file, excerpt) {
  return crypto.createHash("sha256").update([scannerId, ruleId, file.replace(/\\/g, "/"), excerpt.trim()].join("\0")).digest("hex");
}
function findingId(fingerprintValue) {
  return `finding-${fingerprintValue.slice(0, 20)}`;
}
function redactSecrets(value) {
  return value.replace(/(api[_-]?key|token|secret|password)(\s*[:=]\s*)["']?[^\s"']+/gi, "$1$2[REDACTED]").replace(/\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]");
}
const codeFile = /\.[cm]?[jt]sx?$/i;
const astCache = /* @__PURE__ */ new Map();
function cachedSource(file, content) {
  const hash = crypto.createHash("sha256").update(content).digest("hex");
  const cached = astCache.get(file);
  if ((cached == null ? void 0 : cached.hash) === hash) return cached.source;
  const kind = /\.tsx$/i.test(file) ? ts.ScriptKind.TSX : /\.jsx$/i.test(file) ? ts.ScriptKind.JSX : /\.js$/i.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, kind);
  astCache.set(file, { hash, source });
  if (astCache.size > 2e3) astCache.delete(astCache.keys().next().value);
  return source;
}
const textOf = (node) => node.getText().replace(/\s+/g, " ").slice(0, 300);
const locationOf = (source, node) => {
  const point = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { file: source.fileName.replace(/\\/g, "/"), line: point.line + 1, column: point.character + 1 };
};
const propertyPath = (node) => {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return `${propertyPath(node.expression)}.${node.name.text}`;
  if (ts.isElementAccessExpression(node)) return `${propertyPath(node.expression)}[]`;
  return "";
};
const sourceLabel = (node) => {
  const value = propertyPath(node);
  if (/^(?:req|request)\.(?:body|query|params|headers|cookies)(?:\.|\[\]|$)/i.test(value)) return `HTTP input: ${value}`;
  if (/^(?:location\.(?:search|hash)|document\.URL|window\.name)$/i.test(value)) return `Browser input: ${value}`;
  if (/^(?:event|ipcEvent)\.senderFrame(?:\.|$)/i.test(value)) return `Electron IPC input: ${value}`;
  if (ts.isCallExpression(node) && /^(?:process\.env|searchParams\.get|URLSearchParams)$/.test(propertyPath(node.expression))) return `External input: ${textOf(node)}`;
  return void 0;
};
const isSanitized = (node) => ts.isCallExpression(node) && /^(?:DOMPurify\.sanitize|sanitizeHtml|validator\.escape|encodeURIComponent|path\.basename|[A-Za-z_$][\w$]*Schema\.(?:parse|safeParse))$/.test(propertyPath(node.expression));
const sinks = [
  { id: "taint.command-injection", category: "sast", severity: "P0", title: "Untrusted input reaches command execution", cwe: "CWE-78", recommendation: "Use a fixed executable and validated argument array; never compose shell commands from request or IPC data.", match: (call) => /^(?:exec|execSync|child_process\.exec)$/.test(propertyPath(call.expression)) ? call.arguments[0] : void 0 },
  { id: "taint.ssrf", category: "sast", severity: "P1", title: "Untrusted input controls an outbound request", cwe: "CWE-918", recommendation: "Parse the URL and enforce an HTTPS host allowlist; reject loopback, private and link-local destinations.", match: (call) => /^(?:fetch|axios(?:\.get|\.post|\.request)?|got|request)$/.test(propertyPath(call.expression)) ? call.arguments[0] : void 0 },
  { id: "taint.path-traversal", category: "sast", severity: "P1", title: "Untrusted input reaches a filesystem path", cwe: "CWE-22", recommendation: "Resolve the path under an allowed root and verify the resulting relative path cannot escape it.", match: (call) => /^(?:fs\.)?(?:readFile|readFileSync|writeFile|writeFileSync|createReadStream|createWriteStream|unlink|rm|open)$/.test(propertyPath(call.expression)) ? call.arguments[0] : void 0 },
  { id: "taint.sql-injection", category: "sast", severity: "P0", title: "Untrusted input reaches a database query", cwe: "CWE-89", recommendation: "Use parameterized queries or ORM bindings for every value.", match: (call) => /(?:^|\.)(?:query|execute|raw|exec)$/.test(propertyPath(call.expression)) ? call.arguments[0] : void 0 },
  { id: "taint.xss", category: "sast", severity: "P1", title: "Untrusted input reaches an HTML rendering sink", cwe: "CWE-79", recommendation: "Render as text or sanitize with a context-aware HTML sanitizer.", match: (call) => /^(?:document\.write|insertAdjacentHTML)$/.test(propertyPath(call.expression)) ? call.arguments.at(-1) : void 0 },
  { id: "taint.open-redirect", category: "sast", severity: "P2", title: "Untrusted input controls a redirect target", cwe: "CWE-601", recommendation: "Use relative destinations or enforce an exact origin and path allowlist.", match: (call) => /(?:^|\.)redirect$/.test(propertyPath(call.expression)) ? call.arguments[0] : void 0 },
  { id: "taint.unsafe-deserialization", category: "sast", severity: "P0", title: "Untrusted input reaches an unsafe deserializer", cwe: "CWE-502", recommendation: "Use JSON with schema validation and remove executable object deserialization.", match: (call) => /(?:^|\.)(?:deserialize|unserialize|load)$/.test(propertyPath(call.expression)) ? call.arguments[0] : void 0 },
  { id: "taint.log-injection", category: "sast", severity: "P2", title: "Untrusted input is written to logs", cwe: "CWE-117", recommendation: "Use structured logging and escape line breaks and control characters.", match: (call) => /^(?:console|logger|log)\.(?:log|info|warn|error)$/.test(propertyPath(call.expression)) ? call.arguments.find((argument) => Boolean(sourceLabel(argument)) || ts.isIdentifier(argument)) : void 0 }
];
function frameworkNames(files) {
  const joined = files.map((item) => item.content).join("\n");
  return [["Express", /from\s+['"]express['"]|require\(['"]express['"]\)/], ["React", /from\s+['"]react['"]|\.tsx?$/], ["Electron IPC", /ipcMain\.|ipcRenderer\.|contextBridge\./], ["Next.js", /from\s+['"]next\//]].filter(([, pattern]) => pattern.test(joined)).map(([name]) => name);
}
function makeFinding(rule, sourceFile, sink, flow, confidence) {
  const location = locationOf(sourceFile, sink);
  const excerpt = redactSecrets(textOf(sink));
  const key = fingerprint("semantic-analysis", rule.id, location.file, `${location.line}:${excerpt}`);
  const now = Date.now();
  return { id: findingId(key), fingerprint: key, scannerId: "semantic-analysis", ruleId: rule.id, category: rule.category, severity: rule.severity, confidence, confidenceRationale: confidence === "high" ? "AST-confirmed source and sink with a direct or interprocedural data-flow path." : "AST-confirmed sensitive operation with a heuristic authorization or propagation assessment.", status: "open", title: rule.title, description: `${flow.sourceLabel} flows into a security-sensitive operation.`, location, evidence: [{ kind: "code", excerpt, location }], trace: [...flow.path, { kind: "sink", label: textOf(sink), location }], recommendation: rule.recommendation, cwe: rule.cwe, firstSeenAt: now, lastSeenAt: now };
}
function analyzeTypeScriptProject(context) {
  const files = context.files.filter((file) => codeFile.test(file)).map((file) => {
    const content = fs.readFileSync(path.join(context.projectDir, file), "utf8");
    const normalized = file.replace(/\\/g, "/");
    return { content, source: cachedSource(normalized, content) };
  });
  const functions = /* @__PURE__ */ new Map();
  for (const { source } of files) {
    const visit = (node) => {
      if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, { name: node.name.text, file: source.fileName, node, source, calls: [] });
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) functions.set(node.name.text, { name: node.name.text, file: source.fileName, node: node.initializer, source, calls: [] });
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  for (const info of functions.values()) {
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const name = propertyPath(node.expression).split(".").at(-1);
        if (name && functions.has(name)) info.calls.push(name);
      }
      ts.forEachChild(node, visit);
    };
    visit(info.node);
  }
  const functionSinks = /* @__PURE__ */ new Map();
  for (const info of functions.values()) {
    const parameters = info.node.parameters.map((parameter) => ts.isIdentifier(parameter.name) ? parameter.name.text : "");
    const summaries = [];
    const visit = (node) => {
      if (ts.isCallExpression(node)) for (const rule of sinks) {
        const argument = rule.match(node);
        if (!argument) continue;
        const names = [];
        const collect = (child) => {
          if (ts.isIdentifier(child)) names.push(child.text);
          ts.forEachChild(child, collect);
        };
        collect(argument);
        const parameterIndex = parameters.findIndex((name) => names.includes(name));
        if (parameterIndex >= 0) summaries.push({ parameterIndex, rule, sink: node, source: info.source });
      }
      ts.forEachChild(node, visit);
    };
    visit(info.node);
    if (summaries.length) functionSinks.set(info.name, summaries);
  }
  const findings = [];
  for (const { source } of files) {
    const visit = (node, currentFunction, tainted) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        if (isSanitized(node.initializer)) {
          tainted.delete(node.name.text);
        } else {
          const direct = sourceLabel(node.initializer);
          const inherited = ts.isIdentifier(node.initializer) ? tainted.get(node.initializer.text) : void 0;
          if (direct) tainted.set(node.name.text, { expression: node.initializer, source: node.initializer, sourceLabel: direct, path: [{ kind: "source", label: direct, location: locationOf(source, node.initializer) }, { kind: "propagation", label: node.name.text, location: locationOf(source, node) }] });
          else if (inherited) tainted.set(node.name.text, { ...inherited, expression: node.initializer, path: [...inherited.path, { kind: "propagation", label: node.name.text, location: locationOf(source, node) }] });
        }
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) {
        const direct = sourceLabel(node.right);
        const inherited = ts.isIdentifier(node.right) ? tainted.get(node.right.text) : void 0;
        if (direct) tainted.set(node.left.text, { expression: node.right, source: node.right, sourceLabel: direct, path: [{ kind: "source", label: direct, location: locationOf(source, node.right) }] });
        else if (inherited) tainted.set(node.left.text, inherited);
      }
      if (ts.isCallExpression(node)) for (const rule of sinks) {
        const argument = rule.match(node);
        if (!argument || isSanitized(argument)) continue;
        const direct = sourceLabel(argument);
        const identifiers = [];
        const collect = (child) => {
          if (ts.isIdentifier(child)) identifiers.push(child.text);
          ts.forEachChild(child, collect);
        };
        collect(argument);
        const inherited = identifiers.map((name) => tainted.get(name)).find(Boolean);
        const flow = direct ? { sourceLabel: direct, path: [{ kind: "source", label: direct, location: locationOf(source, argument) }] } : inherited;
        if (flow) {
          if (currentFunction) flow.path.push({ kind: "call", label: currentFunction, location: locationOf(source, node) });
          findings.push(makeFinding(rule, source, node, flow, direct ? "high" : "medium"));
        }
      }
      if (ts.isCallExpression(node)) {
        const callee = propertyPath(node.expression).split(".").at(-1);
        const summaries = callee ? functionSinks.get(callee) : void 0;
        for (const summary of summaries ?? []) {
          const argument = node.arguments[summary.parameterIndex];
          if (!argument) continue;
          const direct = sourceLabel(argument);
          const identifiers = [];
          const collect = (child) => {
            if (ts.isIdentifier(child)) identifiers.push(child.text);
            ts.forEachChild(child, collect);
          };
          collect(argument);
          const inherited = identifiers.map((name) => tainted.get(name)).find(Boolean);
          const flow = direct ? { expression: argument, source: argument, sourceLabel: direct, path: [{ kind: "source", label: direct, location: locationOf(source, argument) }] } : inherited;
          if (flow) {
            const callStep = { kind: "call", label: `${callee}()`, location: locationOf(source, node) };
            findings.push(makeFinding(summary.rule, summary.source, summary.sink, { ...flow, path: [...flow.path, callStep] }, "high"));
          }
        }
      }
      if (ts.isCallExpression(node) && /^(?:app|router)\.(?:get|post|put|patch|delete)$/.test(propertyPath(node.expression))) {
        const route = node.arguments[0];
        const handler = node.arguments.at(-1);
        const body = (handler == null ? void 0 : handler.getText()) ?? "";
        const middleware = node.arguments.slice(1, -1).map(textOf).join(" ");
        if (route && handler && /\b(?:req|request)\.params\b/.test(body) && /\.(?:findOne|findById|findUnique|query|execute)\s*\(/.test(body) && !/(?:auth|session|permission|authorize|owner|userId)/i.test(`${middleware} ${body}`)) {
          const rule = { id: "framework.express-idor", category: "sast", severity: "P1", title: "Express object lookup lacks an authorization check", cwe: "CWE-639", recommendation: "Authorize the current principal against the requested object, preferably in a shared route policy middleware." };
          const label = `Route parameter: ${textOf(route)}`;
          findings.push(makeFinding(rule, source, handler, { sourceLabel: label, path: [{ kind: "source", label, location: locationOf(source, route) }] }, "medium"));
        }
      }
      if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === "dangerouslySetInnerHTML" && node.initializer) {
        const names = [];
        const collect = (child) => {
          if (ts.isIdentifier(child)) names.push(child.text);
          ts.forEachChild(child, collect);
        };
        collect(node.initializer);
        const flow = names.map((name) => tainted.get(name)).find(Boolean);
        if (flow) {
          const rule = { id: "framework.react-xss", category: "sast", severity: "P1", title: "Untrusted input reaches dangerouslySetInnerHTML", cwe: "CWE-79", recommendation: "Avoid raw HTML or sanitize it with a maintained HTML sanitizer before rendering." };
          findings.push(makeFinding(rule, source, node, flow, "high"));
        }
      }
      let nextFunction = currentFunction;
      let childScope = tainted;
      if (ts.isFunctionDeclaration(node) && node.name) {
        nextFunction = node.name.text;
        childScope = /* @__PURE__ */ new Map();
      } else if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node)) childScope = /* @__PURE__ */ new Map();
      ts.forEachChild(node, (child) => visit(child, nextFunction, childScope));
    };
    visit(source, void 0, /* @__PURE__ */ new Map());
  }
  return { findings, frameworks: frameworkNames(files) };
}
(_a = parentPort) == null ? void 0 : _a.on("message", (request) => {
  var _a2, _b;
  try {
    const result = analyzeTypeScriptProject({ projectDir: request.projectDir, files: request.files, networkPolicy: request.networkPolicy, signal: new AbortController().signal, emit: () => void 0 });
    (_a2 = parentPort) == null ? void 0 : _a2.postMessage({ id: request.id, findings: result.findings });
  } catch (error) {
    (_b = parentPort) == null ? void 0 : _b.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) });
  }
});
