import { describe, expect, it } from 'vitest';
import { tableCategoryId, tableDisplayName } from '../src/plugins/database/tableCatalog';

describe('database table catalog', () => {
  it('groups product tables by business domain', () => {
    expect(tableCategoryId('agent_tasks')).toBe('agents');
    expect(tableCategoryId('chat_messages')).toBe('conversations');
    expect(tableCategoryId('llm_response_cache')).toBe('ai');
    expect(tableCategoryId('document_knowledge_records')).toBe('documents');
    expect(tableCategoryId('weread_notes')).toBe('weread');
    expect(tableCategoryId('hanyu_jinjie_executions')).toBe('hanyu');
    expect(tableCategoryId('skill_files')).toBe('prompts');
    expect(tableCategoryId('schema_version')).toBe('system');
    expect(tableCategoryId('future_feature_data')).toBe('other');
  });

  it('provides Chinese display names while preserving unknown names', () => {
    expect(tableDisplayName('hanyu_jinjie_executions')).toBe('汉语新解执行记录');
    expect(tableDisplayName('future_feature_data')).toBe('future_feature_data');
  });
});
