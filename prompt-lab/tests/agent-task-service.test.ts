import { describe, expect, it } from 'vitest';
import { AgentTaskService } from '../src/main/agent/task-service';
import type { LLMProvider } from '../src/core/llm';

function provider(response = 'updated'): LLMProvider {
  return {
    id: 'test',
    async *chat() { yield { delta: response }; },
    async listModels() { return []; },
    async validate() { return true; },
  };
}

const config = {
  sessionId: 'session-1', workspaceRoot: 'C:/repo', instruction: 'change it',
  modelConfig: { apiKey: 'secret', baseUrl: 'https://example.test', model: 'test' },
  multiFile: false, tokenBudget: 8_000,
};

async function waitForReview(service: AgentTaskService, taskId: string) {
  const deltas: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const unsubscribe = service.subscribe(taskId, (event) => {
      if (event.progress?.delta) deltas.push(event.progress.delta);
      if (event.state === 'review') { unsubscribe(); resolve(); }
      if (event.state === 'failed') { unsubscribe(); reject(new Error(event.error)); }
    });
  });
  return deltas;
}

describe('AgentTaskService', () => {
  it('executes supplied messages in the main-process queue and returns a review result', async () => {
    const service = new AgentTaskService(2, () => provider());
    const task = service.create({ ...config, messages: [{ role: 'user', content: 'full context' }] });
    const deltas = await waitForReview(service, task.taskId);
    expect(service.get(task.taskId)?.result?.rawResponse).toBe('updated');
    expect(service.get(task.taskId)?.messages?.[0].content).toBe('full context');
    expect(deltas.join('')).toContain('updated');
  });

  it('removes API keys from persistence snapshots', async () => {
    const service = new AgentTaskService(1, () => provider());
    const task = service.create(config);
    await waitForReview(service, task.taskId);
    expect(service.snapshot()[0].modelConfig.apiKey).toBe('');
    expect(service.get(task.taskId)?.modelConfig.apiKey).toBe('secret');
  });
});
