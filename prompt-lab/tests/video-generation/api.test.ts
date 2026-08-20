import { describe, expect, it } from 'vitest';
import {
  buildCancelRequest,
  buildCreateRequest,
  buildFileRetrieveRequest,
  buildQueryRequest,
  DEFAULT_BASE_URL,
  DEFAULT_DURATION,
  DEFAULT_MODEL,
  DEFAULT_RATIO,
  DEFAULT_RESOLUTION,
  normalizeRequest,
  formatMiniMaxHttpError,
  parseFileRetrieveResponse,
  parseSubmitResponse,
  parseTaskResponse,
  POLL_INTERVAL_MS,
  POLL_MAX_ATTEMPTS,
} from '../../src/plugins/video-generation/core/api';
import type { VideoGenerationRequest } from '../../src/plugins/video-generation/types';

describe('video-generation / core / api', () => {
  describe('normalizeRequest', () => {
    it('returns the default MiniMax base url and model when caller leaves them blank', () => {
      const result = normalizeRequest({ apiKey: 'sk-test', prompt: 'hello' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.baseUrl).toBe(DEFAULT_BASE_URL);
      expect(result.value.model).toBe(DEFAULT_MODEL);
      expect(result.value.duration).toBe(DEFAULT_DURATION);
      expect(result.value.resolution).toBe(DEFAULT_RESOLUTION);
      expect(result.value.ratio).toBe(DEFAULT_RATIO);
      expect(result.value.content).toEqual([{ type: 'text', text: 'hello' }]);
    });

    it('rejects when API key contains non-ASCII characters', () => {
      const result = normalizeRequest({ apiKey: '中文 key', prompt: 'hello' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/API Key/);
    });

    it('rejects empty prompt and overlong prompt', () => {
      expect(normalizeRequest({ apiKey: 'sk', prompt: '   ' }).ok).toBe(false);
      const long = 'a'.repeat(7001);
      expect(normalizeRequest({ apiKey: 'sk', prompt: long }).ok).toBe(false);
    });

    it('clamps duration into [4, 15] and falls back to default on garbage', () => {
      const ok = normalizeRequest({ apiKey: 'sk', prompt: 'p', duration: 9, model: 'MiniMax-H3' });
      expect(ok.ok).toBe(true);
      if (ok.ok) expect(ok.value.duration).toBe(9);

      const low = normalizeRequest({ apiKey: 'sk', prompt: 'p', duration: 1 });
      expect(low.ok).toBe(true);
      if (low.ok) expect(low.value.duration).toBe(DEFAULT_DURATION);

      const high = normalizeRequest({ apiKey: 'sk', prompt: 'p', duration: 99 });
      expect(high.ok).toBe(true);
      if (high.ok) expect(high.value.duration).toBe(DEFAULT_DURATION);
    });

    it('falls back to a fixed ratio when caller picks an unknown one', () => {
      const result = normalizeRequest({ apiKey: 'sk', prompt: 'p', ratio: '5:5' as never });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.ratio).toBe(DEFAULT_RATIO);
    });

    it('forces a non-adaptive ratio for pure text-to-video to satisfy MiniMax t2va rules', () => {
      const result = normalizeRequest({ apiKey: 'sk', prompt: 'p', ratio: 'adaptive', mode: 'text-to-video' });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.ratio).not.toBe('adaptive');
    });

    it('attaches first/last/reference content items when URLs are provided', () => {
      const result = normalizeRequest({
        apiKey: 'sk',
        prompt: 'p',
        model: 'MiniMax-H3',
        mode: 'reference-to-video',
        firstFrameUrl: 'https://x/a.png',
        lastFrameUrl: 'https://x/b.png',
        referenceImageUrls: ['https://x/r1.png', 'https://x/r2.png'],
        referenceVideoUrls: ['https://x/ref.mp4'],
        referenceAudioUrls: ['https://x/audio.wav'],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.content).toHaveLength(1 + 2 + 2 + 1 + 1);
      const roles = result.value.content.map((item) => ('role' in item ? item.role : 'text'));
      expect(roles).toContain('first_frame');
      expect(roles).toContain('last_frame');
      expect(roles.filter((role) => role === 'reference_image')).toHaveLength(2);
    });

    it('strips trailing slashes from the base url', () => {
      const result = normalizeRequest({ apiKey: 'sk', prompt: 'p', baseUrl: 'https://api.minimaxi.com////' });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.baseUrl).toBe('https://api.minimaxi.com');
    });
  });

  describe('buildCreateRequest', () => {
    it('targets Hailuo /v1/video_generation by default', () => {
      const normalized = normalizeRequest({ apiKey: 'sk-test', prompt: 'hello' });
      if (!normalized.ok) throw new Error(normalized.error);
      const { endpoint, init } = buildCreateRequest(normalized.value);
      expect(endpoint).toBe('https://api.minimaxi.com/v1/video_generation');
      expect(init.method).toBe('POST');
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer sk-test');
      expect(headers['Content-Type']).toBe('application/json');
      const body = JSON.parse(String(init.body));
      expect(body).toEqual({ model: 'MiniMax-Hailuo-2.3', prompt: 'hello', duration: 6, resolution: '768P' });
    });

    it('keeps the H3 /v2 content protocol when H3 is selected', () => {
      const normalized = normalizeRequest({ apiKey: 'sk-test', prompt: 'hello', model: 'MiniMax-H3' });
      if (!normalized.ok) throw new Error(normalized.error);
      const { endpoint, init } = buildCreateRequest(normalized.value);
      expect(endpoint).toBe('https://api.minimaxi.com/v2/video_generation');
      const body = JSON.parse(String(init.body));
      expect(body).toMatchObject({ model: 'MiniMax-H3', duration: 6, resolution: '768P', ratio: '16:9' });
      expect(body.content[0]).toEqual({ type: 'text', text: 'hello' });
    });
  });

  describe('buildQueryRequest', () => {
    it('targets /v2/query/video_generation/{taskId} with bearer auth', () => {
      const { endpoint, init } = buildQueryRequest('https://api.minimaxi.com/', 'sk-test', 'task-1', 'MiniMax-H3');
      expect(endpoint).toBe('https://api.minimaxi.com/v2/query/video_generation/task-1');
      expect(init.method).toBe('GET');
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer sk-test');
    });

    it('encodes taskId in case it contains unsafe characters', () => {
      const { endpoint } = buildQueryRequest('https://api.minimaxi.com', 'sk', 'a/b c', 'MiniMax-H3');
      expect(endpoint).toBe('https://api.minimaxi.com/v2/query/video_generation/a%2Fb%20c');
    });

    it('uses the Hailuo v1 query and file retrieval endpoints', () => {
      expect(buildQueryRequest('https://api.minimaxi.com/', 'sk', 'a/b c', 'MiniMax-Hailuo-2.3').endpoint)
        .toBe('https://api.minimaxi.com/v1/query/video_generation?task_id=a%2Fb%20c');
      expect(buildFileRetrieveRequest('https://api.minimaxi.com/', 'sk', 'file/1').endpoint)
        .toBe('https://api.minimaxi.com/v1/files/retrieve?file_id=file%2F1');
    });
  });

  describe('buildCancelRequest', () => {
    it('targets /v2/video_generation/{taskId} with DELETE and bearer auth', () => {
      const { endpoint, init } = buildCancelRequest('https://api.minimaxi.com/', 'sk-test', 'task-1');
      expect(endpoint).toBe('https://api.minimaxi.com/v2/video_generation/task-1');
      expect(init.method).toBe('DELETE');
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer sk-test');
    });

    it('encodes taskId and strips trailing slashes', () => {
      const { endpoint } = buildCancelRequest('https://api.minimaxi.com////', 'sk', 'a/b c');
      expect(endpoint).toBe('https://api.minimaxi.com/v2/video_generation/a%2Fb%20c');
    });
  });

  describe('parseSubmitResponse', () => {
    it('returns the task_id when base_resp is clean', () => {
      const result = parseSubmitResponse({ task_id: 'task-1', base_resp: { status_code: 0, status_msg: 'success' } });
      expect(result.success).toBe(true);
      expect(result.taskId).toBe('task-1');
    });

    it('surfaces status_msg as error when base_resp.status_code is non-zero', () => {
      const result = parseSubmitResponse({ base_resp: { status_code: 1001, status_msg: '余额不足' } });
      expect(result.success).toBe(false);
      expect(result.error).toBe('余额不足');
    });

    it('fails loudly when task_id is missing', () => {
      const result = parseSubmitResponse({ base_resp: { status_code: 0, status_msg: 'success' } });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/task_id/);
    });
  });

  describe('parseTaskResponse', () => {
    it('maps upstream status strings to our status enum', () => {
      expect(parseTaskResponse({ task: { status: 'Processing' } }, 't').status).toBe('processing');
      expect(parseTaskResponse({ task: { status: 'queueing' } }, 't').status).toBe('queued');
      expect(parseTaskResponse({ task: { status: 'succeed' } }, 't').status).toBe('succeeded');
      expect(parseTaskResponse({ task: { status: 'fail' } }, 't').status).toBe('failed');
      expect(parseTaskResponse({ task: { status: 'cancelled' } }, 't').status).toBe('cancelled');
      expect(parseTaskResponse({ task: { status: 'weird-state' } }, 't').status).toBe('unknown');
    });

    it('extracts videoUrl on success and the upstream error text on failure', () => {
      const ok = parseTaskResponse({ task: { status: 'succeeded', content: { url: 'https://cdn/x.mp4' } } }, 't');
      expect(ok.status).toBe('succeeded');
      expect(ok.videoUrl).toBe('https://cdn/x.mp4');

      const fail = parseTaskResponse({ task: { status: 'failed', error: { message: 'safety filter' } } }, 't');
      expect(fail.status).toBe('failed');
      expect(fail.error).toBe('safety filter');
    });

    it('extracts a Hailuo v1 file_id and its download URL', () => {
      const task = parseTaskResponse({ status: 'Success', file_id: 'file-1', base_resp: { status_code: 0 } }, 't');
      expect(task.status).toBe('succeeded');
      expect(task.fileId).toBe('file-1');
      expect(parseFileRetrieveResponse({ file: { download_url: 'https://cdn/x.mp4' }, base_resp: { status_code: 0 } }).videoUrl)
        .toBe('https://cdn/x.mp4');
    });

    it('returns unknown status when payload is not an object', () => {
      expect(parseTaskResponse(null, 't').status).toBe('unknown');
      expect(parseTaskResponse('string', 't').status).toBe('unknown');
    });
  });

  describe('account errors', () => {
    it('turns H3 TokenPlan error 2013 into an actionable model hint', () => {
      const error = formatMiniMaxHttpError(400, { error: { message: 'TokenPlan 或 Credit 暂不支持 MiniMax-H3 系列模型 (2013)' } }, '');
      expect(error).toMatch(/Hailuo 2\.3/);
      expect(error).toMatch(/不支持 H3/);
    });
  });

  describe('poll cadence constants', () => {
    it('uses 10s interval and at least 30 attempts (≈5 minutes of polling)', () => {
      expect(POLL_INTERVAL_MS).toBe(10_000);
      expect(POLL_MAX_ATTEMPTS).toBeGreaterThanOrEqual(30);
    });
  });

  describe('request shape', () => {
    it('VideoGenerationRequest accepts all the documented optional URL fields', () => {
      const req: VideoGenerationRequest = {
        apiKey: 'sk',
        prompt: 'p',
        mode: 'reference-to-video',
        firstFrameUrl: 'https://x',
        lastFrameUrl: 'https://x',
        referenceImageUrls: ['https://x'],
        referenceVideoUrls: ['https://x'],
        referenceAudioUrls: ['https://x'],
      };
      expect(req.mode).toBe('reference-to-video');
    });
  });
});
