/**
 * 文本 chunker — 滑动窗口
 *
 * 目标：
 *  - 适合 Embedding 模型（Xenova/all-MiniLM-L6-v2 推荐 ≤ 256 tokens ≈ 1000 字符）
 *  - 段落优先（按 \n\n 切分），不切碎句子
 *  - 跨段 overlap 保持上下文
 */
export interface ChunkOptions {
  /** 单 chunk 最大字符数（含 overlap） */
  maxChars?: number;
  /** 跨 chunk 重复字符数 */
  overlapChars?: number;
}

export interface TextChunk {
  index: number;
  text: string;
  startOffset: number;
  endOffset: number;
  tokenEstimate: number;
}

export const DEFAULT_CHUNK_OPTIONS: Required<ChunkOptions> = {
  maxChars: 800,
  overlapChars: 80,
};

/** 估算 token 数（粗略：英文 4 字符/token，中文 1.5 字符/token） */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const other = text.length - cjk;
  return Math.ceil(cjk / 1.5) + Math.ceil(other / 4);
}

export function chunkText(text: string, options: ChunkOptions = {}): TextChunk[] {
  const { maxChars, overlapChars } = { ...DEFAULT_CHUNK_OPTIONS, ...options };
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (!clean) return [];

  const chunks: TextChunk[] = [];
  // 先按段落切，再合并/切到合适长度
  const paragraphs = clean.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  let buffer = '';
  let bufferStart = 0;
  let charOffset = 0;

  for (const para of paragraphs) {
    const candidate = buffer ? `${buffer}\n\n${para}` : para;
    if (candidate.length <= maxChars) {
      if (!buffer) bufferStart = charOffset;
      buffer = candidate;
    } else {
      // 当前 buffer 已经够大 → 推入
      if (buffer) {
        chunks.push(makeChunk(buffer, chunks.length, bufferStart, bufferStart + buffer.length));
        // 下一 chunk 从 overlap 处开始
        const overlapStart = Math.max(0, buffer.length - overlapChars);
        buffer = buffer.slice(overlapStart);
        bufferStart += overlapStart;
      }
      // 如果单段比 maxChars 还长 → 按句切
      if (para.length > maxChars) {
        const sentences = para.split(/(?<=[.!?。！？])\s+/);
        let sub = '';
        let subStart = charOffset;
        for (const s of sentences) {
          const cand = sub ? `${sub} ${s}` : s;
          if (cand.length <= maxChars) {
            if (!sub) subStart = charOffset;
            sub = cand;
          } else {
            if (sub) {
              chunks.push(makeChunk(sub, chunks.length, subStart, subStart + sub.length));
              const oStart = Math.max(0, sub.length - overlapChars);
              sub = sub.slice(oStart);
              subStart += oStart;
            }
            if (s.length > maxChars) {
              // 单句还长 → 硬切
              for (let i = 0; i < s.length; i += maxChars - overlapChars) {
                const piece = s.slice(i, i + maxChars);
                chunks.push(makeChunk(piece, chunks.length, charOffset + i, charOffset + i + piece.length));
              }
              sub = '';
            } else {
              sub = s;
              subStart = charOffset;
            }
          }
        }
        if (sub) chunks.push(makeChunk(sub, chunks.length, subStart, subStart + sub.length));
        buffer = '';
        charOffset += para.length;
        continue;
      } else {
        buffer = para;
        bufferStart = charOffset;
      }
    }
    charOffset += para.length + 2; // \n\n
  }
  if (buffer) {
    chunks.push(makeChunk(buffer, chunks.length, bufferStart, bufferStart + buffer.length));
  }
  return chunks;
}

function makeChunk(text: string, index: number, start: number, end: number): TextChunk {
  return {
    index,
    text: text.trim(),
    startOffset: start,
    endOffset: end,
    tokenEstimate: estimateTokens(text),
  };
}
