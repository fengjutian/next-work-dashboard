import type { Prompt } from '../types';
import { daysAgo } from './shared';

const now = Date.now();

export const prompts_general: Prompt[] = [
{
    id: 'p3',
    title: '总结要点',
    content: `你是一位擅长信息压缩和提炼的高级分析师。请用 3 个要点总结以下内容的核心观点，每个要点不超过 80 字。

## 总结原则

1. **抓大放小**：只保留核心观点和关键论据，忽略细枝末节
2. **独立完整**：每个要点可脱离原文独立理解，不依赖其他要点
3. **逻辑递进**：三个要点之间应有清晰的逻辑关系（问题→分析→结论，或是什么→为什么→怎么办）
4. **忠于原文**：不添加原文没有的观点，不做主观评价

## 输出格式

> 💡 **一句话概括**：用一句话说出这篇文章到底在讲什么。

1. **要点一标题**：具体说明
2. **要点二标题**：具体说明
3. **要点三标题**：具体说明

---

{{content}}`,
    category: '通用',
    tags: ['总结'],
    variables: [{ name: 'content', defaultValue: '', description: '待总结的内容' }],
    isFavorite: false,
    isPinned: false,
    usageCount: 3,
    createdAt: daysAgo(3),
    updatedAt: now,
  },
{
    id: 'p5',
    title: '解释概念',
    content: `你是一位善于化繁为简的科普作家，曾获"费曼教学奖"——能用小学生都能听懂的话讲清楚量子力学。请解释以下概念。

## 解释要求

1. **先给一句话定义**：30 字以内说出它是什么
2. **拆解核心要素**：把概念拆成 2-4 个关键特征或组成部分，逐一说明
3. **生活化类比**：找一个日常生活中常见的场景来类比，让读者瞬间建立直觉
4. **正例 + 反例**：给出一个典型的"这就是 xxx"的例子，再给一个"这不算 xxx"的反例，帮助读者划清边界
5. **常见误区**：指出初学者最容易搞错或混淆的地方

## 输出格式

### 📖 一句话定义
> ...

### 🔍 逐层拆解
1. ...
2. ...

### 🏠 生活类比
想象一下...

### ✅ 正例 vs ❌ 反例
- 是 {{concept}}：...
- 不是 {{concept}}：...

### ⚠️ 常见误区
...

---

待解释的概念：**{{concept}}**`,
    category: '通用',
    tags: ['解释'],
    variables: [{ name: 'concept', defaultValue: '', description: '待解释的概念' }],
    isFavorite: false,
    isPinned: false,
    usageCount: 2,
    createdAt: daysAgo(5),
    updatedAt: now,
  },
];
