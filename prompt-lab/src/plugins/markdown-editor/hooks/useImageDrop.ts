/**
 * useImageDrop — 在编辑器容器上挂载拖放/粘贴事件。
 *
 * 行为：
 *  - 拖放：检测 File.type 以 image/ 开头 → 复制到工作区 assets → 插入图片节点
 *  - 粘贴：同上
 *  - 复制后插入的 src 是相对路径（相对于文档所在目录）
 *  - 不会越权：当文档不在工作区时直接 base64 嵌入
 */

import { useCallback, useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { isImageFile, pickAssetPath, shouldStoreOnDisk, IMAGE_INLINE_LIMIT_BYTES } from '../editor/image-paths';

export interface UseImageDropOptions {
  editor: Editor | null;
  /** 工作区根路径；null 时图片会作为 base64 直接嵌入。 */
  rootPath: string | null;
  /** 当前文档相对路径（用于计算图片相对路径）。 */
  documentRelativePath: string | null;
  /** 状态通知：上传中、成功、失败。 */
  onStatus?: (status: 'uploading' | 'success' | 'error', detail: string) => void;
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return typeof btoa === 'function' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
}

async function readSourceFileAsBase64(file: File): Promise<string> {
  // 优先用 Electron 的 webUtils.getPathForFile
  const utils = (window as unknown as { webUtils?: { getPathForFile: (f: File) => string } }).webUtils;
  if (utils?.getPathForFile) {
    const filePath = utils.getPathForFile(file);
    if (filePath) {
      const result = await window.electronAPI.readFileBuffer(filePath);
      if (result.success && result.data) {
        return result.data;
      }
    }
  }
  return fileToBase64(file);
}

export interface UseImageDropReturn {
  /** 当前是否处于文件拖入悬停状态。 */
  isDragging: boolean;
  /** 上一条状态消息（uploading/success/error）。null 表示无。 */
  status: { kind: 'uploading' | 'success' | 'error'; detail: string } | null;
  /** 当前拖入的图片预览：name -> dataUrl。 */
  previews: Array<{ name: string; dataUrl: string }>;
}

export function useImageDrop({ editor, rootPath, documentRelativePath, onStatus }: UseImageDropOptions): UseImageDropReturn {
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState<UseImageDropReturn['status']>(null);
  const [previews, setPreviews] = useState<Array<{ name: string; dataUrl: string }>>([]);

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (!editor) return;
      const images = files.filter((file) => isImageFile(file));
      if (images.length === 0) return;
      setStatus({ kind: 'uploading', detail: `正在处理 ${images.length} 张图片…` });
      onStatus?.('uploading', `正在处理 ${images.length} 张图片…`);
      for (const file of images) {
        try {
          const base64 = await readSourceFileAsBase64(file);
          if (!shouldStoreOnDisk(file.size, rootPath !== null)) {
            // 没在工作区 或 文件过大：直接 base64 嵌入
            const dataUrl = `data:${file.type || 'image/png'};base64,${base64}`;
            editor.chain().focus().setImage({ src: dataUrl, alt: file.name }).run();
            continue;
          }
          // 写到工作区 assets
          const relPath = pickAssetPath(documentRelativePath, file.name);
          const result = await window.electronAPI.workspace.writeBinaryFile(rootPath!, relPath, base64, { force: false });
          if (result.success) {
            editor.chain().focus().setImage({ src: relPath, alt: file.name }).run();
          } else if (result.error === 'ALREADY_EXISTS') {
            // 覆盖
            const retried = await window.electronAPI.workspace.writeBinaryFile(rootPath!, relPath, base64, { force: true });
            if (retried.success) {
              editor.chain().focus().setImage({ src: relPath, alt: file.name }).run();
            } else {
              // 兜底：data URL
              const dataUrl = `data:${file.type || 'image/png'};base64,${base64}`;
              editor.chain().focus().setImage({ src: dataUrl, alt: file.name }).run();
            }
          } else {
            // 错误兜底
            const dataUrl = `data:${file.type || 'image/png'};base64,${base64}`;
            editor.chain().focus().setImage({ src: dataUrl, alt: file.name }).run();
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setStatus({ kind: 'error', detail: `${file.name}：${message}` });
          onStatus?.('error', message);
          continue;
        }
      }
      setStatus({ kind: 'success', detail: `已插入 ${images.length} 张图片` });
      onStatus?.('success', `已插入 ${images.length} 张图片`);
      setTimeout(() => setStatus(null), 2500);
    },
    [editor, rootPath, documentRelativePath, onStatus],
  );

  useEffect(() => {
    if (!editor) return;
    const view = editor.view;
    const dom = view.dom as HTMLElement;
    const parent = dom.parentElement;
    if (!parent) return;

    const onDrop = (event: DragEvent) => {
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      setIsDragging(false);
      setPreviews([]);
      void handleFiles(files);
    };
    const onDragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) {
        event.preventDefault();
        setIsDragging(true);
        // 异步读取图片预览
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length > 0) {
          void loadPreviews(files).then((items) => {
            if (items.length > 0) setPreviews(items);
          });
        }
      }
    };
    const onDragLeave = (event: DragEvent) => {
      const related = event.relatedTarget as Node | null;
      if (!related || !parent.contains(related)) {
        setIsDragging(false);
        setPreviews([]);
      }
    };
    const onPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (item.kind === 'file') {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length === 0) return;
      event.preventDefault();
      void handleFiles(files);
    };
    parent.addEventListener('drop', onDrop);
    parent.addEventListener('dragover', onDragOver);
    parent.addEventListener('dragleave', onDragLeave);
    parent.addEventListener('paste', onPaste);
    return () => {
      parent.removeEventListener('drop', onDrop);
      parent.removeEventListener('dragover', onDragOver);
      parent.removeEventListener('dragleave', onDragLeave);
      parent.removeEventListener('paste', onPaste);
    };
  }, [editor, handleFiles]);

  return { isDragging, status, previews };
}

/** 读取拖入的图片文件，生成 dataUrl 用于预览。最大 8 张，每张最大 200KB。 */
async function loadPreviews(files: File[]): Promise<Array<{ name: string; dataUrl: string }>> {
  const images = files.filter(isImageFile).slice(0, 8);
  const out: Array<{ name: string; dataUrl: string }> = [];
  for (const file of images) {
    try {
      const utils = (window as unknown as { webUtils?: { getPathForFile: (f: File) => string } }).webUtils;
      let base64: string;
      if (utils?.getPathForFile) {
        const filePath = utils.getPathForFile(file);
        if (filePath) {
          const result = await window.electronAPI.readFileBuffer(filePath);
          if (result.success && result.data) {
            base64 = result.data;
          } else {
            base64 = await readAsBase64(file);
          }
        } else {
          base64 = await readAsBase64(file);
        }
      } else {
        base64 = await readAsBase64(file);
      }
      const dataUrl = `data:${file.type || 'image/png'};base64,${base64}`;
      out.push({ name: file.name, dataUrl });
    } catch {
      // 忽略单个文件预览失败
    }
  }
  return out;
}

async function readAsBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return typeof btoa === 'function' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
}

export { IMAGE_INLINE_LIMIT_BYTES };
