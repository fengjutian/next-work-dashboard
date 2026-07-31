// ── 内置工具 ──

import type { ToolDefinition } from './types';

export const builtInTools: ToolDefinition[] = [
  {
    name: 'get_current_time',
    description: '获取当前日期和时间',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    execute: () => new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
  },
  {
    name: 'calculator',
    description: '执行数学计算，支持 + - * / ( ) 和小数',
    parameters: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: '数学表达式，例如 "2 + 3 * 4"' },
      },
      required: ['expression'],
    },
    execute: (args) => {
      const expr = String(args.expression);
      // 安全：只允许数字、运算符、空格、括号、小数点
      if (!/^[\d+\-*/().%\s]+$/.test(expr)) {
        return `错误：表达式包含不安全字符。只允许数字和 + - * / ( ) . %`;
      }
      try {
        const result = Function(`"use strict"; return (${expr})`)();
        return String(result);
      } catch (e: any) {
        return `计算错误: ${e.message}`;
      }
    },
  },
  {
    name: 'web_search',
    description: '搜索网页（通过 DuckDuckGo）',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
      },
      required: ['query'],
    },
    execute: async (args) => {
      const query = String(args.query);
      try {
        const api = (window as any).electronAPI;
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        let html: string;
        if (api?.fetchUrl) {
          const res = await api.fetchUrl(url);
          html = res.ok ? res.text : '';
        } else {
          const resp = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          });
          html = await resp.text();
        }
        const snippets: string[] = [];
        const re = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
        let m; let count = 0;
        while ((m = re.exec(html)) !== null && count < 5) {
          snippets.push(m[1].replace(/<[^>]+>/g, '').trim());
          count++;
        }
        return snippets.length > 0
          ? snippets.map((s, i) => `${i + 1}. ${s}`).join('\n')
          : '未找到搜索结果';
      } catch (e: any) {
        return `搜索失败: ${e.message}`;
      }
    },
  },
  {
    name: 'read_file',
    description: '读取本地文件内容',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件绝对路径' },
      },
      required: ['path'],
    },
    execute: async (args) => {
      const path = String(args.path);
      try {
        // 通过 Electron IPC 读取文件
        const api = (window as any).electronAPI;
        if (!api?.readFile) {
          // fallback：浏览器环境尝试 fetch
          const resp = await fetch(`file://${path}`);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          return await resp.text();
        }
        return await api.readFile(path);
      } catch (e: any) {
        return `读取文件失败: ${e.message}`;
      }
    },
  },
  {
    name: 'clipboard_read',
    description: '读取剪贴板内容',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    execute: async () => {
      try {
        return await navigator.clipboard.readText() || '(剪贴板为空)';
      } catch {
        return '(无法读取剪贴板 — 可能需要用户授权)';
      }
    },
  },
  {
    name: 'fetch_url',
    description: '获取网页或 API 的内容（HTTP GET），返回文本或 JSON',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '要请求的 URL，必须以 http:// 或 https:// 开头' },
      },
      required: ['url'],
    },
    execute: async (args) => {
      const url = String(args.url);
      if (!/^https?:\/\//.test(url)) return '错误：URL 必须以 http:// 或 https:// 开头';
      try {
        const api = (window as any).electronAPI;
        let text: string;
        if (api?.fetchUrl) {
          const res = await api.fetchUrl(url);
          if (!res.ok) return `HTTP ${res.status} ${res.error || ''}`;
          text = res.text;
          if (res.contentType.includes('application/json')) {
            text = JSON.stringify(JSON.parse(text), null, 2).slice(0, 3000);
          }
        } else {
          const resp = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; next-work-dashboard/1.0)' },
          });
          if (!resp.ok) return `HTTP ${resp.status} ${resp.statusText}`;
          const contentType = resp.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            const json = await resp.json();
            return JSON.stringify(json, null, 2).slice(0, 3000);
          }
          text = await resp.text();
        }
        return text.length > 5000 ? text.slice(0, 5000) + '\n...(truncated)' : text;
      } catch (e: any) {
        return `请求失败: ${e.message}`;
      }
    },
  },
  {
    name: 'write_file',
    description: '将内容写入文件（通过 Electron 保存对话框选择路径）',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '要写入的文件内容' },
        filename: { type: 'string', description: '建议的文件名，如 output.md' },
      },
      required: ['content'],
    },
    execute: async (args) => {
      const content = String(args.content);
      const filename = args.filename ? String(args.filename) : 'output.txt';
      try {
        const api = (window as any).electronAPI;
        if (!api?.saveFile) {
          // 浏览器 fallback：触发下载
          const blob = new Blob([content], { type: 'text/plain' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = filename;
          a.click();
          return `已触发下载: ${filename}`;
        }
        const result = await api.saveFile({ content, defaultName: filename });
        return result?.success ? `文件已保存: ${result.path || filename}` : `保存失败: ${result?.error || '未知错误'}`;
      } catch (e: any) {
        return `写入文件失败: ${e.message}`;
      }
    },
  },
  {
    name: 'list_files',
    description: '列出目录中的文件（通过 Electron 打开目录对话框）',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目录路径（可选，不填则弹出选择对话框）' },
      },
      required: [],
    },
    execute: async () => {
      try {
        const api = (window as any).electronAPI;
        if (!api?.pickDirectory) {
          return '(需要 Electron 环境才能浏览目录)';
        }
        const result = await api.pickDirectory();
        if (!result) return '(未选择目录)';
        return result.files
          ? result.files.slice(0, 50).map((f: any) => `${f.isDir ? '📁' : '📄'} ${f.name}  ${f.size ? `(${f.size} bytes)` : ''}`).join('\n')
          : `目录: ${result.path}`;
      } catch (e: any) {
        return `列出文件失败: ${e.message}`;
      }
    },
  },
];
