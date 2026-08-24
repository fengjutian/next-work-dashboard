import type { ProductSpecContext, ProductSpecSource } from './types';

const MAX_SOURCE_CHARS = 28_000;
const MAX_TOTAL_CHARS = 90_000;

export function truncateSource(text: string, limit = MAX_SOURCE_CHARS): string {
  if (text.length <= limit) return text;
  const head = Math.floor(limit * 0.72);
  const tail = limit - head;
  return `${text.slice(0, head)}\n\n[...内容因上下文容量限制已截断...]\n\n${text.slice(-tail)}`;
}

export function buildTextEvidence(sources: ProductSpecSource[]): string {
  let remaining = MAX_TOTAL_CHARS;
  const blocks: string[] = [];
  for (const source of sources.filter((item) => item.kind !== 'image' && item.text?.trim())) {
    if (remaining <= 0) break;
    const text = truncateSource(source.text!.trim(), Math.min(MAX_SOURCE_CHARS, remaining));
    blocks.push(`## 来源：${source.name}（${source.kind === 'code' ? '代码' : '文档'}）\n${text}`);
    remaining -= text.length;
  }
  return blocks.join('\n\n---\n\n');
}

export function buildSystemPrompt(context: ProductSpecContext): string {
  const { options } = context;
  return `你是一名资深产品经理、解决方案架构师和技术负责人。请综合用户提供的界面图片、需求文档和代码证据，生成一份可直接用于评审和研发交付的中文产品说明文档。

严格规则：
1. 只把材料明确支持的内容写成事实；合理推断必须标注“推断”，缺失信息列入“待确认问题”。
2. 图片用于识别页面结构、交互、文案、状态与视觉关系；不得臆造图片中不可见的行为。
3. 代码用于识别现状架构、数据模型、接口、依赖和约束；引用关键文件名或模块名以便追溯。
4. 发现材料冲突时单列“证据冲突”，不要自行选择一个版本。
5. 输出完整 Markdown，不要用代码围栏包住全文。

文档必须包含：
# ${options.productName.trim() || '产品说明文档'}
文档信息、执行摘要、产品背景与目标、目标用户与使用场景、范围（包含/不包含）、信息架构、功能清单、逐功能详细说明、关键用户流程、页面与交互说明、业务规则、数据模型、接口与集成、权限与安全、非功能需求、异常与边界、埋点与指标、兼容性与迁移、风险与依赖、待确认问题、证据索引${options.includeDevelopmentPlan ? '、详细开发实施过程（阶段、任务、代码落点、依赖、测试、发布与回滚）' : ''}${options.includeAcceptanceCriteria ? '、可验证的验收标准（Given/When/Then 或检查表）' : ''}。

目标读者：${options.audience.trim() || '产品、设计、研发和测试团队'}。`;
}

export function buildUserPrompt(context: ProductSpecContext): string {
  const evidence = buildTextEvidence(context.sources);
  return `请分析以下材料并生成产品说明文档。

## 用户补充要求
${context.options.additionalRequirements.trim() || '无'}

## 材料清单
${context.sources.map((item, index) => `${index + 1}. ${item.name}（${item.kind}，${item.size} bytes）`).join('\n')}

## 文档与代码证据
${evidence || '无文本材料；请主要依据随消息提供的图片，并明确材料不足。'}`;
}

export function downloadProductSpec(filename: string, markdown: string): void {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.replace(/[\\/:*?"<>|]/g, '-');
  anchor.click();
  URL.revokeObjectURL(url);
}
