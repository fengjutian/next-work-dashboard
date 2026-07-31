export interface DecodedWorkspaceText {
  content: string;
  encoding: 'utf8' | 'utf8bom';
  lineEnding: 'LF' | 'CRLF';
}

export function decodeWorkspaceText(buffer: Buffer): DecodedWorkspaceText {
  if (buffer.includes(0)) throw new Error('BINARY_FILE');
  const hasBom = buffer.length >= 3
    && buffer[0] === 0xef
    && buffer[1] === 0xbb
    && buffer[2] === 0xbf;
  const bytes = hasBom ? buffer.subarray(3) : buffer;
  let content: string;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('UNSUPPORTED_ENCODING');
  }
  return {
    content,
    encoding: hasBom ? 'utf8bom' : 'utf8',
    lineEnding: content.includes('\r\n') ? 'CRLF' : 'LF',
  };
}

export function encodeWorkspaceText(
  content: string,
  options: { encoding?: 'utf8' | 'utf8bom'; lineEnding?: 'LF' | 'CRLF' } = {},
): Buffer {
  const normalized = content.replace(/\r\n|\r|\n/g, '\n');
  const withLineEndings = options.lineEnding === 'CRLF'
    ? normalized.replace(/\n/g, '\r\n')
    : normalized;
  const body = Buffer.from(withLineEndings, 'utf-8');
  return options.encoding === 'utf8bom'
    ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body])
    : body;
}
