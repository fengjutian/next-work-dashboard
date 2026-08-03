import { describe, expect, it } from 'vitest';
import { mergeEnvironmentLayers, resolveSecretReferences } from '../src/plugins/terminal/backend/environment';

describe('terminal environment layers', () => {
  it('applies user, workspace and task layers in order', () => {
    expect(mergeEnvironmentLayers({ A: 'user', B: '1' }, { A: 'workspace' }, { A: 'task', B: undefined })).toEqual({ A: 'task' });
  });
  it('resolves encrypted secret references without exposing storage details', () => {
    expect(resolveSecretReferences({ TOKEN: 'Bearer ${secret:API_TOKEN}' }, (name) => name === 'API_TOKEN' ? 'value' : null)).toEqual({ TOKEN: 'Bearer value' });
  });
  it('fails closed for a missing secret', () => expect(() => resolveSecretReferences({ TOKEN: '${secret:MISSING}' }, () => null)).toThrow('TERMINAL_SECRET_NOT_FOUND:MISSING'));
});
