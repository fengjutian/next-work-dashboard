import { describe, it, expect } from 'vitest';
import { extractVariables, fillVariables } from './VariableFillDialog';

// ── extractVariables ──

describe('extractVariables', () => {
  it('从模板中提取单个变量', () => {
    expect(extractVariables('你好 {{name}}！')).toEqual(['name']);
  });

  it('提取多个不同的变量', () => {
    const result = extractVariables('{{greeting}}，我是 {{role}}，擅长 {{skill}}');
    expect(result.sort()).toEqual(['greeting', 'role', 'skill'].sort());
  });

  it('重复的变量只返回一次（去重）', () => {
    expect(extractVariables('{{x}} + {{x}} = {{y}}').sort()).toEqual(['x', 'y'].sort());
  });

  it('没有变量时返回空数组', () => {
    expect(extractVariables('普通文本没有任何模板变量')).toEqual([]);
  });

  it('空字符串返回空数组', () => {
    expect(extractVariables('')).toEqual([]);
  });

  it('变量名仅匹配 \\w 字符（中文不在变量名中）', () => {
    // {{中文}} 不会匹配，因为 \w 只匹配 [a-zA-Z0-9_]
    expect(extractVariables('{{var1}} 和 {{中文}}').sort())
      .toEqual(['var1'].sort());
  });

  it('处理大括号不配对的情况', () => {
    expect(extractVariables('{{open 但没有关闭')).toEqual([]);
    expect(extractVariables('没有打开但 close}}')).toEqual([]);
  });
});

// ── fillVariables ──

describe('fillVariables', () => {
  it('替换所有匹配的变量', () => {
    const tpl = '你好 {{name}}，欢迎来到 {{city}}！';
    const result = fillVariables(tpl, { name: '张三', city: '北京' });
    expect(result).toBe('你好 张三，欢迎来到 北京！');
  });

  it('未提供值的变量保持原样', () => {
    const tpl = '{{a}} + {{b}}';
    expect(fillVariables(tpl, { a: '1' })).toBe('1 + {{b}}');
  });

  it('多出的值不影响结果', () => {
    const tpl = '{{x}}';
    expect(fillVariables(tpl, { x: 'ok', y: 'ignored' })).toBe('ok');
  });

  it('空模板返回空字符串', () => {
    expect(fillVariables('', { anything: 'value' })).toBe('');
  });

  it('没有变量的模板原样返回', () => {
    expect(fillVariables('纯文本', { foo: 'bar' })).toBe('纯文本');
  });

  it('部分替换 + 部分保留', () => {
    expect(
      fillVariables('{{name}} 负责 {{task}}，{{name}} 也参与评审', {
        name: '李四',
      })
    ).toBe('李四 负责 {{task}}，李四 也参与评审');
  });
});
