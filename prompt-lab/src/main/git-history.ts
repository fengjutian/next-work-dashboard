export interface ParsedGitCommit {
  hash: string;
  shortHash: string;
  parents: string[];
  refs: string[];
  author: string;
  authorEmail: string;
  date: string;
  signatureStatus: string;
  signer: string;
  subject: string;
}

export function parseGitLog(output: string): ParsedGitCommit[] {
  return output.split('\x1e').map((record) => record.trim()).filter(Boolean).map((record) => {
    const [hash = '', shortHash = '', parents = '', refs = '', author = '', authorEmail = '', date = '', signatureStatus = 'N', signer = '', ...subjectParts] = record.split('\x1f');
    return {
      hash,
      shortHash,
      parents: parents ? parents.split(/\s+/).filter(Boolean) : [],
      refs: refs ? refs.split(',').map((ref) => ref.trim()).filter(Boolean) : [],
      author,
      authorEmail,
      date,
      signatureStatus: signatureStatus || 'N',
      signer,
      subject: subjectParts.join('\x1f'),
    };
  });
}
