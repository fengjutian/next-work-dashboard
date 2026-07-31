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
    description: '搜索网页（通过 Bing）',
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
        const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-cn`;
        let html: string;
        if (api?.fetchUrl) {
          const res = await api.fetchUrl(url);
          if (!res.ok) return `搜索失败: HTTP ${res.status}`;
          html = res.text;
        } else {
          const resp = await fetch(url);
          if (!resp.ok) return `搜索失败: HTTP ${resp.status}`;
          html = await resp.text();
        }

        // 从 Bing HTML 提取搜索结果
        const results: { title: string; url: string; snippet: string }[] = [];
        // Bing 结果在 <li class="b_algo"> 中
        const blockRe = /<li class="b_algo"[^>]*>([\s\S]*?)<\/li>/gi;
        let block;
        while ((block = blockRe.exec(html)) !== null) {
          const blockHtml = block[1];
          // 提取标题
          const titleM = blockHtml.match(/<h2[^>]*><a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
          // 提取摘要
          const snippetM = blockHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
          if (titleM) {
            results.push({
              title: titleM[2].replace(/<[^>]+>/g, '').trim(),
              url: titleM[1],
              snippet: snippetM ? snippetM[1].replace(/<[^>]+>/g, '').trim() : '',
            });
          }
          if (results.length >= 5) break;
        }

        if (results.length > 0) {
          return results.map((r, i) =>
            `${i + 1}. **${r.title}**\n   ${r.snippet}\n   ${r.url}`
          ).join('\n\n');
        }
        return '未找到搜索结果';
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
        let isHtml = false;
        if (api?.fetchUrl) {
          const res = await api.fetchUrl(url);
          if (!res.ok) return `HTTP ${res.status} ${res.error || ''}`;
          text = res.text;
          isHtml = res.contentType.includes('text/html');
          if (res.contentType.includes('application/json')) {
            text = JSON.stringify(JSON.parse(text), null, 2).slice(0, 3000);
          }
        } else {
          const resp = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; next-work-dashboard/1.0)' },
          });
          if (!resp.ok) return `HTTP ${resp.status} ${resp.statusText}`;
          const contentType = resp.headers.get('content-type') || '';
          isHtml = contentType.includes('text/html');
          if (contentType.includes('application/json')) {
            const json = await resp.json();
            return JSON.stringify(json, null, 2).slice(0, 3000);
          }
          text = await resp.text();
        }

        // 如果是 HTML，提取纯文本
        if (isHtml) {
          text = text
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#\d+;/g, '')
            .replace(/\s{2,}/g, '\n')
            .trim();
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
