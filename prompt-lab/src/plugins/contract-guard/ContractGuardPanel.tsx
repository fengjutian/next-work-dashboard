import { ContractGuardPanel as ContractGuardPanelBase } from '@next-work-dashboard/contract-guard';
import '@next-work-dashboard/contract-guard/styles.css';
import { getPdfJs } from '@/lib/pdfjs';

async function parseContractFile(file: File): Promise<string> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'txt' || extension === 'md') return file.text();
  if (extension === 'docx') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return result.value;
  }
  if (extension === 'pdf') {
    const pdfjs = await getPdfJs();
    const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
    }
    const text = pages.join('\n\n');
    if (!text.trim()) throw new Error('扫描版 PDF 暂无文本层，请先 OCR 后重试。');
    return text;
  }
  throw new Error('仅支持 PDF、DOCX、TXT 和 Markdown 文件。');
}

export function ContractGuardPanel() {
  return <ContractGuardPanelBase parseContractFile={parseContractFile} />;
}
