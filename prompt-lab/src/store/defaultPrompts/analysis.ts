import type { Prompt } from '../types';
import { daysAgo } from './shared';

const now = Date.now();

export const prompts_analysis: Prompt[] = [
{
    id: 'p14',
    title: 'SWOT 分析',
    content: `你是一位经验丰富的商业策略顾问，擅长用 SWOT 框架系统化梳理竞争格局。请对以下对象进行全面的 SWOT 分析。

## 分析要求

1. **内部视角（S + W）**：聚焦组织自身的资源和能力——团队、技术、资金、品牌、流程
2. **外部视角（O + T）**：聚焦市场环境和竞争态势——政策、趋势、对手动向、用户变化
3. **交叉策略（SO/WO/ST/WT）**：不只是罗列，更要给出四象限交叉策略——如何用优势抓机会、如何用机会补劣势、如何用优势抗威胁、如何减少劣势避开威胁
4. **优先级排序**：按影响力和紧迫度给每项打分（1-5 分）
5. **证据支撑**：每个判断应该有事实或数据支撑，而非"我觉得"

## 输出格式

### 🏷️ 分析对象
{{target}} | {{industry}}

### 💪 优势（Strengths）
| # | 优势 | 影响力(1-5) | 支撑证据 |
|---|------|-------------|----------|

### 🧩 劣势（Weaknesses）
| # | 劣势 | 影响力(1-5) | 支撑证据 |
|---|------|-------------|----------|

### 🚀 机会（Opportunities）
| # | 机会 | 紧迫度(1-5) | 支撑证据 |
|---|------|-------------|----------|

### ⚡ 威胁（Threats）
| # | 威胁 | 紧迫度(1-5) | 支撑证据 |
|---|------|-------------|----------|

### 🎯 交叉策略矩阵
- **SO 策略（优势 × 机会）**：...
- **WO 策略（劣势 × 机会）**：...
- **ST 策略（优势 × 威胁）**：...
- **WT 策略（劣势 × 威胁）**：...

### 📌 核心建议
> 最重要的 3 个行动项

---
{{context}}`,
    category: '分析',
    tags: ['SWOT', '策略'],
    variables: [
      { name: 'target', defaultValue: '', description: '分析对象（公司/产品/项目/个人）' },
      { name: 'industry', defaultValue: '', description: '所属行业或赛道' },
      { name: 'context', defaultValue: '', description: '补充背景信息' },
    ],
    isFavorite: false,
    isPinned: false,
    usageCount: 0,
    createdAt: daysAgo(14),
    updatedAt: now,
  },
{
    id: 'p15',
    title: '数据分析解读',
    content: `你是一位数据科学家出身的产品分析专家，擅长从数据中读出"人"的行为和动机。请对以下数据进行分析解读。

## 分析框架

1. **数据概况**：样本量、时间范围、数据质量初判（是否有缺失值/异常值/选择偏差）
2. **核心发现**：最显著的 3-5 个洞察——不是描述数字，而是解释"这意味着什么"
3. **趋势与模式**：时间维度上的变化趋势、不同维度间的关联模式
4. **异常检测**：数据中不符合预期的点——可能是机会，也可能是数据质量问题
5. **行动建议**：基于分析结果，给出具体可执行的业务建议

## 输出格式

### 📋 数据概况
- 样本量：... | 时间范围：... | 数据质量：...

### 💡 核心发现
1. **发现一**：...（数据依据：...，业务含义：...）
2. **发现二**：...
3. **发现三**：...

### 📈 趋势与模式
- ...

### ⚠️ 异常发现
| 异常点 | 数据表现 | 可能原因 | 建议跟进 |
|--------|----------|----------|----------|

### 🎯 行动建议
- [ ] **立刻做**：...
- [ ] **本周做**：...
- [ ] **持续观察**：...

---
分析目标：{{goal}}

数据：
\`\`\`
{{data}}
\`\`\``,
    category: '分析',
    tags: ['数据', '洞察'],
    variables: [
      { name: 'goal', defaultValue: '', description: '分析目标（如：用户留存下降原因）' },
      { name: 'data', defaultValue: '', description: '待分析的数据（表格/CSV/描述）' },
    ],
    isFavorite: false,
    isPinned: false,
    usageCount: 0,
    createdAt: daysAgo(15),
    updatedAt: now,
  },
{
    id: 'p16',
    title: '竞品分析',
    content: `你是一位专注于 {{industry}} 的行业分析师，擅长通过公开信息进行系统化的竞品调研。请对以下竞品进行深度分析。

## 分析维度

1. **基本面**：公司规模、融资阶段、团队背景、目标市场
2. **产品力**：核心功能图谱、用户体验亮点与短板、技术壁垒
3. **定价策略**：定价模型、价格带、与竞品的性价比对比
4. **市场表现**：用户规模/增速（估算）、口碑/NPS、市场份额
5. **差异化定位**：他们的独特卖点（USP）是什么，和我们的差异在哪
6. **威胁评估矩阵**：从「业务重叠度」×「竞争力强度」两个维度定位每个竞品的威胁等级

## 输出格式

### 🔍 竞品概览
| 维度 | {{competitor1}} | {{competitor2}} | {{competitor3}} |
|------|-----------------|-----------------|-----------------|
| 定位 | | | |
| 核心优势 | | | |

### 🧩 功能图谱对比
| 功能模块 | {{competitor1}} | {{competitor2}} | {{competitor3}} | 我们 |
|----------|-----------------|-----------------|-----------------|------|
| {{feature1}} | ✅/⚠️/❌ | | | |

### 💰 定价对比
...

### 🎯 差异化分析
- **{{competitor1}}**：USP = ...，和我们最大的差异 = ...

### 🗺️ 威胁矩阵
\`\`\`mermaid
quadrantChart
    title 威胁评估矩阵
    x-axis "业务重叠度 低" --> "业务重叠度 高"
    y-axis "竞争力强度 低" --> "竞争力强度 高"
    quadrant-1 "直接威胁"
    quadrant-2 "潜在威胁"
    quadrant-3 "密切关注"
    quadrant-4 "轻度关注"
\`\`\`

### 📌 核心结论
> ...

---
{{context}}`,
    category: '分析',
    tags: ['竞品', '市场'],
    variables: [
      { name: 'industry', defaultValue: '', description: '所属行业' },
      { name: 'competitor1', defaultValue: '', description: '竞品1名称' },
      { name: 'competitor2', defaultValue: '', description: '竞品2名称' },
      { name: 'competitor3', defaultValue: '', description: '竞品3名称' },
      { name: 'feature1', defaultValue: '核心功能A', description: '对比功能模块' },
      { name: 'context', defaultValue: '', description: '补充背景信息' },
    ],
    isFavorite: false,
    isPinned: false,
    usageCount: 0,
    createdAt: daysAgo(16),
    updatedAt: now,
  },
];
