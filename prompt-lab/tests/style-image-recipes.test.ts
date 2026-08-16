import { describe, expect, it } from 'vitest';
import { buildStylePrompt, STYLE_FAMILIES, STYLE_RECIPES } from '../src/plugins/style-image/style-recipes';

describe('style image recipes', () => {
  it('offers 25 recipes in 8 families', () => {
    expect(STYLE_FAMILIES).toHaveLength(8);
    expect(STYLE_RECIPES).toHaveLength(25);
    expect(new Set(STYLE_RECIPES.map((item) => item.id)).size).toBe(25);
  });

  it('preserves the subject and applies fixed visual guardrails', () => {
    const result = buildStylePrompt('一只白猫躺在黑狗身上', 'ice-blue-minimal');
    expect(result).toContain('一只白猫躺在黑狗身上');
    expect(result).toContain('ice-blue minimalist illustration');
    expect(result).toContain('Preserve the requested subject');
  });

  it('leaves custom styles untouched', () => {
    expect(buildStylePrompt('  simple subject  ', 'custom')).toBe('simple subject');
  });
});
