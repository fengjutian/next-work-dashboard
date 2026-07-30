/**
 * PPT 转换模块 — 纯函数，无 React 依赖
 *
 * 预览：使用 JSZip 解析 .pptx 文件（OOXML 格式本质是 ZIP 包）
 * 生成：使用 PptxGenJS 生成并触发下载
 */

import pptxgen from 'pptxgenjs';
import type { PptPreviewState, SlideContent, SlideDraft } from './types';

/**
 * 解析 .pptx 文件，提取幻灯片文本内容
 * PPTX 文件结构（ZIP 内）：
 *   ppt/slides/slide1.xml, slide2.xml, ...
 *   ppt/presentation.xml（可获取幻灯片数量）
 */
export async function parsePptxFile(file: File): Promise<PptPreviewState> {
  // 动态导入 JSZip（仅预览时需要）
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();

  try {
    const zipData = await zip.loadAsync(file);
    const slides: SlideContent[] = [];

    // 遍历 ppt/slides/ 目录获取所有幻灯片
    const slideFiles = Object.keys(zipData.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => {
        const na = parseInt(a.match(/slide(\d+)/)?.[1] ?? '0', 10);
        const nb = parseInt(b.match(/slide(\d+)/)?.[1] ?? '0', 10);
        return na - nb;
      });

    for (let i = 0; i < slideFiles.length; i++) {
      const xmlStr = await zipData.files[slideFiles[i]].async('text');
      slides.push(extractSlideContent(xmlStr, i));
    }

    if (slides.length === 0) {
      return {
        status: 'loaded',
        fileName: file.name,
        slideCount: 0,
        slides: [],
        error: null,
      };
    }

    return {
      status: 'loaded',
      fileName: file.name,
      slideCount: slides.length,
      slides,
      error: null,
    };
  } catch (err) {
    return {
      status: 'error',
      fileName: file.name,
      slideCount: null,
      slides: null,
      error: err instanceof Error ? err.message : '无法解析 PPT 文件',
    };
  }
}

/**
 * 从幻灯片 XML 中提取文本内容
 * OOXML 文本存储在 <a:t> 标签内
 */
function extractSlideContent(xml: string, index: number): SlideContent {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');

  // 提取所有文本运行 <a:t>
  const textNodes = doc.querySelectorAll('a\\:t, t');
  const allText = Array.from(textNodes)
    .map((n) => n.textContent?.trim() ?? '')
    .filter(Boolean);

  // 第一个文本框通常是标题
  const title = allText[0] ?? '';
  const body = allText.slice(1).join('\n');

  return { index: index + 1, title, body };
}

/**
 * 使用 PptxGenJS 生成 .pptx 并触发下载
 */
export function generatePptx(slides: SlideDraft[], fileName: string, author?: string): void {
  const pres = new pptxgen();
  pres.author = author || 'Next Work Dashboard';
  pres.title = fileName || '演示文稿';

  for (const slide of slides) {
    const s = pres.addSlide();

    if (slide.title) {
      s.addText(slide.title, {
        x: 0.5,
        y: 0.5,
        w: '90%',
        h: 0.8,
        fontSize: 28,
        bold: true,
        color: '2D3748',
      });
    }

    if (slide.content) {
      s.addText(slide.content, {
        x: 0.5,
        y: 1.6,
        w: '90%',
        h: 4.5,
        fontSize: 16,
        color: '4A5568',
        valign: 'top',
      });
    }
  }

  pres.writeFile({ fileName: `${fileName || 'presentation'}.pptx` });
}
