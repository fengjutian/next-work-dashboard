const bytesPrototype = Uint8Array.prototype as Uint8Array & { toHex?: () => string };

if (typeof bytesPrototype.toHex !== 'function') {
  Object.defineProperty(bytesPrototype, 'toHex', {
    configurable: true,
    writable: true,
    value(this: Uint8Array): string {
      let result = '';
      for (const byte of this) result += byte.toString(16).padStart(2, '0');
      return result;
    },
  });
}

await import('pdfjs-dist/build/pdf.worker.min.mjs');
