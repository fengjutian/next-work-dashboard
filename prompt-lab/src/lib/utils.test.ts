import { describe, it, expect } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('拼接多个类名', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('过滤假值', () => {
    expect(cn('a', false && 'skip', undefined, null, '', 'b')).toBe('a b');
  });

  it('条件类名模式', () => {
    const isActive = true;
    expect(cn('base', isActive && 'active')).toBe('base active');
  });

  it('tailwind-merge 去重冲突类名', () => {
    // twMerge 会把后面的同名 Tailwind 类覆盖前面的
    expect(cn('px-4', 'px-2')).toBe('px-2');
  });

  it('空参数返回空字符串', () => {
    expect(cn()).toBe('');
  });
});
