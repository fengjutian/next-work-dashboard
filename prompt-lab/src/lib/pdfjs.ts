import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

let configured = false;

/** Return PDF.js configured with the same-version worker bundled by Vite. */
export async function getPdfJs(): Promise<typeof import('pdfjs-dist')> {
  const pdfjs = await import('pdfjs-dist');
  if (!configured) {
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
    configured = true;
  }
  return pdfjs;
}
