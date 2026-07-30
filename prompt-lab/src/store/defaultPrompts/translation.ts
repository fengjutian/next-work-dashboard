import type { Prompt } from '../types';
import { daysAgo } from './shared';

const now = Date.now();

export const prompts_translation: Prompt[] = [
{
    id: 'p2',
    title: '翻译成英文',
    content: `你是一位专业的英汉翻译专家，精通中英双语的语言习惯和文化背景。请将以下中文翻译成自然、地道、流畅的英文。

## 翻译要求

1. **准确性**：忠实传达原文含义，不添加、不遗漏、不曲解
2. **流畅度**：符合英文母语者的表达习惯，避免中式英语（Chinglish）
3. **语境适配**：根据内容类型自动调整语气——商务文本偏正式，日常对话偏口语化，技术文档偏精准
4. **术语一致**：专业术语使用行业通用译法，同一概念全文统一

## 输出格式

### 译文
直接给出翻译结果。

### 翻译说明（可选）
如涉及特殊处理（习语、文化负载词、无对应表达），简要说明翻译策略。

---

{{text}}`,
    category: '翻译',
    tags: ['翻译', '英文'],
    variables: [{ name: 'text', defaultValue: '', description: '待翻译的中文' }],
    isFavorite: true,
    isPinned: false,
    usageCount: 12,
    createdAt: daysAgo(2),
    updatedAt: now,
  },
];
