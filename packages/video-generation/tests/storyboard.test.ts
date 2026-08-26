import { describe, expect, it } from 'vitest';
import { buildStoryboardRequests, validateStoryboard, type VideoStoryboardOptions } from '../src/core/storyboard';

const storyboard: VideoStoryboardOptions = {
  globalPrompt: '一名宇航员穿越荒原并抵达基地', continuityBible: '白色宇航服，夕阳始终在画面左侧，电影写实风格',
  segments: [
    { id: '1', title: '出发', prompt: '宇航员走下飞船', endState: '站在红色路标右侧，面向基地' },
    { id: '2', title: '跋涉', prompt: '沿峡谷继续前进', endState: '右手扶住基地舱门' },
    { id: '3', title: '抵达', prompt: '打开舱门进入基地', endState: '' },
  ],
};

describe('video generation storyboard', () => {
  it('requires at least three complete segments', () => {
    expect(validateStoryboard(storyboard)).toBeNull();
    expect(validateStoryboard({ ...storyboard, segments: storyboard.segments.slice(0, 2) })).toContain('至少需要 3 段');
    expect(validateStoryboard({ ...storyboard, segments: storyboard.segments.map((item, index) => index === 1 ? { ...item, prompt: '' } : item) })).toContain('第 2 段');
  });
  it('hands the previous ending state to the next segment', () => {
    const requests = buildStoryboardRequests({ apiKey: 'sk', duration: 6, resolution: '768P', ratio: '16:9', mode: 'text-to-video' }, storyboard);
    expect(requests).toHaveLength(3);
    expect(requests[1].prompt).toContain('承接状态：站在红色路标右侧，面向基地');
    expect(requests[2].prompt).toContain('完整收束动作和叙事');
    expect(requests.every((request) => request.prompt.includes(storyboard.continuityBible))).toBe(true);
  });
});
