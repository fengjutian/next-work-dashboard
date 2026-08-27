// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { parsePptxFile, generatePptx, INITIAL_PREVIEW_STATE, INITIAL_GENERATE_STATE } from '../src/core';
import type { SlideDraft } from '../src/core';

/**
 * Build a minimal .pptx ZIP in memory with the given slide XMLs.
 * The function uses JSZip to mirror what a real PowerPoint file looks like.
 */
async function buildFakePptx(slides: string[]): Promise<File> {
  const zip = new JSZip();
  for (let i = 0; i < slides.length; i += 1) {
    zip.file(`ppt/slides/slide${i + 1}.xml`, slides[i]);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], 'test.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
}

/** Build a pptx with explicit file names (so we can test non-sequential
 *  ordering).  */
async function buildFakePptxWithNames(slides: Record<string, string>): Promise<File> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(slides)) {
    zip.file(`ppt/slides/${name}.xml`, content);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], 'sorted.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
}

describe('ppt-preview core/convert', () => {
  it('parses a .pptx and extracts slide text from <a:t> nodes', async () => {
    const file = await buildFakePptx([
      '<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:sp><p:txBody><a:p><a:r><a:t>Slide 1 Title</a:t></a:r><a:r><a:t>Body line</a:t></a:r></a:p></p:txBody></p:sp></p:sld>',
      '<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:sp><p:txBody><a:p><a:r><a:t>Second slide</a:t></a:r></a:p></p:txBody></p:sp></p:sld>',
    ]);
    const result = await parsePptxFile(file);
    expect(result.status).toBe('loaded');
    expect(result.fileName).toBe('test.pptx');
    expect(result.slideCount).toBe(2);
    expect(result.slides?.[0].title).toBe('Slide 1 Title');
    expect(result.slides?.[0].body).toBe('Body line');
    expect(result.slides?.[1].title).toBe('Second slide');
    expect(result.slides?.[1].body).toBe('');
  });

  it('handles files that match the zip layout but have no slide XML', async () => {
    const zip = new JSZip();
    zip.file('META-INF/manifest.xml', '<manifest/>');
    const blob = await zip.generateAsync({ type: 'blob' });
    const file = new File([blob], 'empty.pptx');
    const result = await parsePptxFile(file);
    expect(result.status).toBe('loaded');
    expect(result.slideCount).toBe(0);
    expect(result.slides).toEqual([]);
  });

  it('returns error status when given a non-zip file', async () => {
    const file = new File(['not a real pptx'], 'broken.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
    const result = await parsePptxFile(file);
    expect(result.status).toBe('error');
    expect(result.error).toBeTruthy();
  });

  it('sorts slide files by numeric suffix (not lexicographic)', async () => {
    // Add files in a non-sorted order. JSZip's `Object.keys(zipData.files)`
    // usually returns them in insertion order, so without the numeric sort
    // the output would be 10, 2, 1 (or whatever insertion gave us).
    const file = await buildFakePptxWithNames({
      slide10: '<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:sp><p:txBody><a:p><a:r><a:t>Slide 10</a:t></a:r></a:p></p:txBody></p:sp></p:sld>',
      slide2:  '<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:sp><p:txBody><a:p><a:r><a:t>Slide 2</a:t></a:r></a:p></p:txBody></p:sp></p:sld>',
      slide1:  '<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:sp><p:txBody><a:p><a:r><a:t>Slide 1</a:t></a:r></a:p></p:txBody></p:sp></p:sld>',
    });
    const result = await parsePptxFile(file);
    expect(result.slides?.map((s) => s.title)).toEqual(['Slide 1', 'Slide 2', 'Slide 10']);
  });

  it('skips non-slide XML files inside the zip', async () => {
    const zip = new JSZip();
    zip.file('ppt/slides/slide1.xml', '<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:sp><p:txBody><a:p><a:r><a:t>Real</a:t></a:r></a:p></p:txBody></p:sp></p:sld>');
    zip.file('ppt/notesSlides/notesSlide1.xml', '<note/>');
    zip.file('ppt/slideLayouts/slideLayout1.xml', '<layout/>');
    const blob = await zip.generateAsync({ type: 'blob' });
    const file = new File([blob], 'mixed.pptx');
    const result = await parsePptxFile(file);
    expect(result.slideCount).toBe(1);
    expect(result.slides?.[0].title).toBe('Real');
  });

  it('generatePptx is callable and does not throw with valid drafts', () => {
    // Stub document.createElement('a') so the underlying pptxgenjs writeFile
    // path doesn't blow up in jsdom-style environments.
    const originalCreate = document.createElement.bind(document);
    let clicked = 0;
    document.createElement = ((tag: string) => {
      const el = originalCreate(tag);
      if (tag === 'a') {
        (el as HTMLAnchorElement).click = () => { clicked += 1; };
      }
      return el;
    }) as typeof document.createElement;
    try {
      const slides: SlideDraft[] = [
        { id: '1', title: 'Hello', content: 'World' },
        { id: '2', title: 'Two', content: '' },
      ];
      expect(() => generatePptx(slides, 'demo', 'tester')).not.toThrow();
    } finally {
      document.createElement = originalCreate;
      // clicked is 0 or 1 depending on the pptxgenjs path; not asserting here.
      void clicked;
    }
  });

  it('exposes initial state constants', () => {
    expect(INITIAL_PREVIEW_STATE.status).toBe('idle');
    expect(INITIAL_PREVIEW_STATE.slides).toBeNull();
    expect(INITIAL_GENERATE_STATE.title).toBe('');
    expect(INITIAL_GENERATE_STATE.author).toBe('');
    expect(INITIAL_GENERATE_STATE.slides.length).toBeGreaterThan(0);
    expect(INITIAL_GENERATE_STATE.slides[0]).toMatchObject({ title: '', content: '' });
  });
});
