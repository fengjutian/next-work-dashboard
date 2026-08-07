const DIMENSIONS = 512;

function tokens(text: string): string[] {
  const normalized = text.toLocaleLowerCase().normalize('NFKC');
  const result = normalized.match(/[a-z0-9_.-]{2,}/g) ?? [];
  const chinese = normalized.replace(/[^\u3400-\u9fff]/g, '');
  for (let index = 0; index < chinese.length - 1; index += 1) {
    result.push(chinese.slice(index, index + 2));
  }
  return result;
}

function hash(value: string, seed: number): number {
  let output = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    output ^= value.charCodeAt(index);
    output = Math.imul(output, 16777619);
  }
  return output >>> 0;
}

/** Dependency-free local vectors used when the app is configured for local retrieval. */
export function createHashEmbeddings(inputs: string[]): number[][] {
  return inputs.map((input) => {
    const vector = new Array<number>(DIMENSIONS).fill(0);
    for (const token of tokens(input)) {
      const index = hash(token, 2166136261) % DIMENSIONS;
      const sign = (hash(token, 3339675911) & 1) === 0 ? 1 : -1;
      vector[index] += sign;
    }
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    return norm ? vector.map((value) => value / norm) : vector;
  });
}
