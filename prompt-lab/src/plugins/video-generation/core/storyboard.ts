import type { VideoGenerationRequest } from '../types';

export const MIN_STORYBOARD_SEGMENTS = 3;

export interface VideoStoryboardSegment {
  id: string;
  title: string;
  prompt: string;
  endState: string;
}

export interface VideoStoryboardOptions {
  globalPrompt: string;
  continuityBible: string;
  segments: VideoStoryboardSegment[];
}

export function createStoryboardSegment(index: number): VideoStoryboardSegment {
  return { id: `segment-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 7)}`, title: `第 ${index + 1} 段`, prompt: '', endState: '' };
}

export function validateStoryboard(options: VideoStoryboardOptions): string | null {
  if (options.segments.length < MIN_STORYBOARD_SEGMENTS) return `多段视频至少需要 ${MIN_STORYBOARD_SEGMENTS} 段`;
  if (!options.globalPrompt.trim()) return '请填写完整视频的全局描述';
  const emptyIndex = options.segments.findIndex((segment) => !segment.prompt.trim());
  return emptyIndex >= 0 ? `请填写第 ${emptyIndex + 1} 段的视频描述` : null;
}

export function buildStoryboardRequests(base: Omit<VideoGenerationRequest, 'prompt'>, options: VideoStoryboardOptions): VideoGenerationRequest[] {
  const total = options.segments.length;
  return options.segments.map((segment, index) => {
    const previous = options.segments[index - 1];
    const handoff = previous?.endState.trim()
      ? `承接状态：${previous.endState.trim()}。从这个状态自然继续，禁止人物、服装、场景、光线和运动方向跳变。`
      : '这是开场镜头，清晰建立主体、场景和运动方向。';
    const ending = segment.endState.trim()
      ? `本段结束状态：${segment.endState.trim()}。结尾动作和构图必须稳定停留，供下一段承接。`
      : index === total - 1 ? '这是最终段，完整收束动作和叙事，不留下未完成事件。' : '结尾保留连续动作和稳定构图，便于下一段自然承接。';
    return { ...base, prompt: [
      `完整视频：${options.globalPrompt.trim()}`,
      options.continuityBible.trim() ? `全局连续性设定：${options.continuityBible.trim()}。所有分段必须严格保持一致。` : '',
      `当前为第 ${index + 1}/${total} 段（${segment.title.trim() || `第 ${index + 1} 段`}）。`, handoff,
      `本段内容：${segment.prompt.trim()}`, ending,
    ].filter(Boolean).join('\n') };
  });
}
