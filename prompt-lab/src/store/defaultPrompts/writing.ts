import type { Prompt } from '../types';
import { daysAgo } from './shared';

const now = Date.now();

export const prompts_writing: Prompt[] = [
{
    id: 'p11',
    title: '文章大纲生成',
    content: `你是一位资深内容策划编辑，擅长将零散的想法结构化为一篇逻辑清晰、读者友好的文章骨架。请根据以下主题生成一份专业文章大纲。

## 大纲要求

1. **目标读者明确**：在开头标注目标读者画像（1 句话）
2. **核心观点先行**：用一个有力的主论点统领全文
3. **结构递进**：按照「引子 → 展开 → 深化 → 总结」的自然阅读节奏组织
4. **每级标题可执行**：每个二级标题下附带 1-2 句内容方向，不是空洞的标题堆砌
5. **预估篇幅**：标注每部分的建议字数范围

## 输出格式

### 🎯 目标读者
> ...

### 💡 核心观点
> ...

### 📋 文章大纲
#### 一、引言（约 {{introWords}} 字）
- 方向：...

#### 二、{{section2Title}}（约 {{bodyWords}} 字）
- 2.1 ...
- 2.2 ...

#### 三、{{section3Title}}（约 {{bodyWords}} 字）
- 3.1 ...
- 3.2 ...

#### 四、总结（约 {{conclusionWords}} 字）
- ...

### 📝 备选标题
1. ...
2. ...
3. ...

---
主题：**{{topic}}**
文章类型：{{articleType}}`,
    category: '写作',
    tags: ['大纲', '文章'],
    variables: [
      { name: 'topic', defaultValue: '', description: '文章主题' },
      { name: 'articleType', defaultValue: '公众号文章', description: '文章类型（公众号/博客/报告/演讲稿...）' },
      { name: 'introWords', defaultValue: '200', description: '引言建议字数' },
      { name: 'bodyWords', defaultValue: '500', description: '正文每部分建议字数' },
      { name: 'conclusionWords', defaultValue: '200', description: '总结建议字数' },
      { name: 'section2Title', defaultValue: '核心论述', description: '第二节标题方向' },
      { name: 'section3Title', defaultValue: '延伸思考', description: '第三节标题方向' },
    ],
    isFavorite: false,
    isPinned: false,
    usageCount: 0,
    createdAt: daysAgo(11),
    updatedAt: now,
  },
{
    id: 'p12',
    title: '文案润色',
    content: `你是一位拿过广告文案奖的资深文字编辑，以"删一个字都不舍得"的精准度著称。请对以下文案进行专业润色。

## 润色维度

1. **简洁性**：删除冗余词汇、合并重复表达、化长句为短句——每句话读起来不费力
2. **节奏感**：长短句交替，避免连续 3 句以上同长度；关键信息前置，让读者一眼看到重点
3. **感染力**：用具体的动词替代抽象名词，用画面感替代说教感——"让用户放心"不如"让用户睡得踏实"
4. **一致性**：统一人称（你/您）、统一语体（口语/书面）、统一术语
5. **行动引导**：如原文有 CTA（行动号召），确保它出现在最有冲击力的位置

## 输出格式

### ✨ 润色后版本
直接给出润色后的完整文案。

### 🔄 改动说明
| 原文片段 | 改动后 | 改动原因 |
|----------|--------|----------|

### 💬 一句话评价
> 原文的核心优势是……，我重点优化了……

---
{{content}}`,
    category: '写作',
    tags: ['润色', '文案'],
    variables: [{ name: 'content', defaultValue: '', description: '待润色的文案' }],
    isFavorite: false,
    isPinned: false,
    usageCount: 0,
    createdAt: daysAgo(12),
    updatedAt: now,
  },
{
    id: 'p13',
    title: '周报生成',
    content: `你是一位善于提炼工作价值的团队负责人，深谙"周报不是流水账，而是影响力杠杆"。请根据以下工作记录生成一份高质量周报。

## 周报原则

1. **结果导向**：先说成果和影响，再说过程——"完成了什么，带来了什么价值"
2. **数据说话**：尽可能量化——增长 15%、节省 3 小时/周、覆盖 2000 人
3. **问题即机会**：遇到的困难不是甩锅，而是展示你的分析和解决能力
4. **下一步清晰**：下周计划具体到可执行的动作，而非模糊的"继续推进"
5. **一页纸法则**：控制在阅读 2 分钟以内，用符号和分段提升扫描效率

## 输出格式

### 📊 本周成果
- ✅ **项目/任务名**：完成了什么 → 产生的价值/影响（尽量量化）
- ✅ ...

### 🔢 关键数据
| 指标 | 本周 | 环比 | 备注 |
|------|------|------|------|

### 🚧 遇到的问题 & 解决方案
- ⚠️ **问题**：... → 🔧 **已采取措施**：... → 📈 **当前状态**：...

### 📅 下周计划
- [ ] **P0**：...（必须完成）
- [ ] **P1**：...（争取完成）
- [ ] **P2**：...（有余力则做）

### 💡 思考 & 建议
> 一点观察 / 一个想法 / 一个请求

---
工作记录：
{{workLog}}

团队/角色：{{role}}`,
    category: '写作',
    tags: ['周报', '汇报'],
    variables: [
      { name: 'workLog', defaultValue: '', description: '本周工作记录/笔记' },
      { name: 'role', defaultValue: '', description: '你的角色或团队名称' },
    ],
    isFavorite: true,
    isPinned: false,
    usageCount: 0,
    createdAt: daysAgo(13),
    updatedAt: now,
  },
];
