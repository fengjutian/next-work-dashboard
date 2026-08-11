/**
 * useImagePicker — 通过 Electron 文件选择对话框选择图片插入。
 *
 * 行为：
 *  - 调用 window.electronAPI.pickFile({ accept: 'image/*' })
 *  - 拿到 file.path 后用 readFileBuffer 读 base64
 *  - 复用 useImageDrop 的落盘 / 嵌入逻辑
 */

import { useCallback, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { isImageFile, pickAssetPath, shouldStoreOnDisk } from '../editor/image-paths';

export interface UseImagePickerOptions {
  editor: Editor | null;
  rootPath: string | null;
  documentRelativePath: string | null;
  onStatus?: (status: 'uploading' | 'success' | 'error', detail: string) => void;
}

export interface UseImagePickerReturn {
  open: () => Promise<void>;
  isPicking: boolean;
}

export function useImagePicker({ editor, rootPath, documentRelativePath, onStatus }: UseImagePickerOptions): UseImagePickerReturn {
  const [isPicking, setIsPicking] = useState(false);

  const open = useCallback(async () => {
    if (!editor) return;
    setIsPicking(true);
    try {
      const result = await window.electronAPI.pickFile({ accept: 'image/*' });
      if (!result) {
        setIsPicking(false);
        return;
      }
      const file = Array.isArray(result) ? result[0] : result;
      if (!file) {
        setIsPicking(false);
        return;
      }
      // 解析文件名、构造虚拟 File 对象
      const fileName = file.name;
      if (!isImageFile({ name: fileName, type: file.mimeType })) {
        onStatus?.('error', `${fileName} 不是图片文件`);
        setIsPicking(false);
        return;
      }
      onStatus?.('uploading', `正在插入 ${fileName}…`);
      // 读 base64
      const buffer = await window.electronAPI.readFileBuffer(file.path);
      if (!buffer.success || !buffer.data) {
        onStatus?.('error', `读取 ${fileName} 失败：${buffer.error ?? '未知错误'}`);
        setIsPicking(false);
        return;
      }
      const base64 = buffer.data;
      const fileSize = buffer.size ?? Math.floor((base64.length * 3) / 4);
      if (!shouldStoreOnDisk(fileSize, rootPath !== null)) {
        // 直接 base64 嵌入
        const dataUrl = `data:${file.mimeType || 'image/png'};base64,${base64}`;
        editor.chain().focus().setImage({ src: dataUrl, alt: fileName }).run();
        onStatus?.('success', `已插入 ${fileName}`);
        setIsPicking(false);
        return;
      }
      // 写到工作区 assets
      const relPath = pickAssetPath(documentRelativePath, fileName);
      const writeResult = await window.electronAPI.workspace.writeBinaryFile(rootPath!, relPath, base64, { force: false });
      if (writeResult.success || writeResult.error === 'ALREADY_EXISTS') {
        if (writeResult.error === 'ALREADY_EXISTS') {
          await window.electronAPI.workspace.writeBinaryFile(rootPath!, relPath, base64, { force: true });
        }
        editor.chain().focus().setImage({ src: relPath, alt: fileName }).run();
        onStatus?.('success', `已插入 ${fileName}`);
      } else {
        // 兜底
        const dataUrl = `data:${file.mimeType || 'image/png'};base64,${base64}`;
        editor.chain().focus().setImage({ src: dataUrl, alt: fileName }).run();
        onStatus?.('error', `${fileName} 落盘失败：${writeResult.error ?? '未知错误'}`);
      }
    } catch (err) {
      onStatus?.('error', err instanceof Error ? err.message : String(err));
    } finally {
      setIsPicking(false);
    }
  }, [editor, rootPath, documentRelativePath, onStatus]);

  return { open, isPicking };
}
