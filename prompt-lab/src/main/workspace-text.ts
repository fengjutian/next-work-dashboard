import iconv from 'iconv-lite';

export type WorkspaceEncoding = 'utf8' | 'utf8bom' | 'utf16le' | 'utf16be' | 'gbk';

export interface DecodedWorkspaceText {
  content: string;
  encoding: WorkspaceEncoding;
  lineEnding: 'LF' | 'CRLF';
}

export function decodeWorkspaceText(buffer: Buffer): DecodedWorkspaceText {
  const hasUtf8Bom = buffer.length >= 3
    && buffer[0] === 0xef
    && buffer[1] === 0xbb
    && buffer[2] === 0xbf;
  const hasUtf16LeBom = buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe;
  const hasUtf16BeBom = buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff;
  if (hasUtf16LeBom || hasUtf16BeBom) {
    const encoding = hasUtf16LeBom ? 'utf16le' : 'utf16be';
    const content = iconv.decode(buffer.subarray(2), encoding);
    return {
      content,
      encoding,
      lineEnding: content.includes('\r\n') ? 'CRLF' : 'LF',
    };
  }
  if (buffer.includes(0)) throw new Error('BINARY_FILE');
  const bytes = hasUtf8Bom ? buffer.subarray(3) : buffer;
  let content: string;
  let encoding: WorkspaceEncoding = hasUtf8Bom ? 'utf8bom' : 'utf8';
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    content = iconv.decode(buffer, 'gbk');
    encoding = 'gbk';
  }
  return {
    content,
    encoding,
    lineEnding: content.includes('\r\n') ? 'CRLF' : 'LF',
  };
}

export function encodeWorkspaceText(
  content: string,
  options: { encoding?: WorkspaceEncoding; lineEnding?: 'LF' | 'CRLF' } = {},
): Buffer {
  const normalized = content.replace(/\r\n|\r|\n/g, '\n');
  const withLineEndings = options.lineEnding === 'CRLF'
    ? normalized.replace(/\n/g, '\r\n')
    : normalized;
  if (options.encoding === 'utf16le') {
    return Buffer.concat([Buffer.from([0xff, 0xfe]), iconv.encode(withLineEndings, 'utf16le')]);
  }
  if (options.encoding === 'utf16be') {
    return Buffer.concat([Buffer.from([0xfe, 0xff]), iconv.encode(withLineEndings, 'utf16be')]);
  }
  if (options.encoding === 'gbk') return iconv.encode(withLineEndings, 'gbk');
  const body = Buffer.from(withLineEndings, 'utf-8');
  return options.encoding === 'utf8bom'
    ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body])
    : body;
}
