import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, buildTextEvidence, buildUserPrompt, truncateSource } from '../src/plugins/product-spec/generator';
import type { ProductSpecContext } from '../src/plugins/product-spec/types';

const context: ProductSpecContext = { sources: [{ id: '1', name: 'requirements.pdf', kind: 'document', size: 10, text: '用户可以创建订单' }, { id: '2', name: 'order.ts', kind: 'code', size: 20, text: 'interface Order { id: string }' }, { id: '3', name: 'screen.png', kind: 'image', size: 30, dataUrl: 'data:image/png;base64,x' }], options: { productName: '订单台', audience: '研发与测试', additionalRequirements: '关注权限', includeDevelopmentPlan: true, includeAcceptanceCriteria: true } };

describe('product spec generator', () => {
  it('builds traceable text evidence without embedding image data', () => { const value = buildTextEvidence(context.sources); expect(value).toContain('requirements.pdf'); expect(value).toContain('order.ts'); expect(value).not.toContain('base64'); });
  it('requests complete, evidence-aware sections', () => { expect(buildSystemPrompt(context)).toContain('# 订单台'); expect(buildSystemPrompt(context)).toContain('详细开发实施过程'); expect(buildSystemPrompt(context)).toContain('可验证的验收标准'); expect(buildUserPrompt(context)).toContain('关注权限'); });
  it('keeps both ends when truncating large sources', () => { const value = truncateSource(`START${'x'.repeat(200)}END`, 80); expect(value).toContain('START'); expect(value).toContain('END'); expect(value).toContain('已截断'); });
});
