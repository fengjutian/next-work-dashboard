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
        // DuckDuckGo HTML search（无需 API key）
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const resp = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        });
        const html = await resp.text();
        // 提取搜索结果片段
        const snippets: string[] = [];
        const re = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
        let m;
        let count = 0;
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
];
