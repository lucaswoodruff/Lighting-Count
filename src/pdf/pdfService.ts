import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PageTextItem } from '../types';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy };

export async function loadPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  return pdfjsLib.getDocument({ data }).promise;
}

/** Sheet labels if the PDF has them (E2.1 etc.), else "Page N". */
export async function getPageLabels(doc: PDFDocumentProxy): Promise<string[]> {
  const labels = await doc.getPageLabels();
  if (labels && labels.length === doc.numPages) return labels;
  return Array.from({ length: doc.numPages }, (_, i) => `Page ${i + 1}`);
}

export interface RenderResult {
  /** CSS pixel size of the rendered page at the requested zoom. */
  cssWidth: number;
  cssHeight: number;
  /** Page size in page-space units (PDF points, rotation applied). */
  pageWidth: number;
  pageHeight: number;
}

/**
 * Render a page into `canvas` at `zoom` (1 = 100%), sharp on hi-DPI screens.
 * Returns sizes; the caller sizes the annotation overlay to match.
 */
/**
 * Cap on rendered bitmap pixels. Large sheets at deep zoom would otherwise
 * exceed browser canvas limits and fail to render (blank page); past the cap
 * the bitmap is rendered coarser and CSS-scaled up instead.
 */
const MAX_RENDER_PIXELS = 32_000_000;

export async function renderPage(
  doc: PDFDocumentProxy,
  pageNum: number,
  zoom: number,
  canvas: HTMLCanvasElement,
): Promise<RenderResult> {
  const page = await doc.getPage(pageNum);
  const base = page.getViewport({ scale: 1 });
  const dpr = window.devicePixelRatio || 1;
  let scale = zoom * dpr;
  const maxScale = Math.sqrt(MAX_RENDER_PIXELS / (base.width * base.height));
  if (scale > maxScale) scale = maxScale;
  const viewport = page.getViewport({ scale });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  // CSS size is owned by the component (set synchronously from zoom), so the
  // page rescales instantly while this bitmap catches up.
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return {
    cssWidth: Math.floor((base.width * zoom)),
    cssHeight: Math.floor((base.height * zoom)),
    pageWidth: base.width,
    pageHeight: base.height,
  };
}

/**
 * All text strings on a page with bounding-box centers in page space
 * (top-left origin, PDF points). Feeds tag detection and marker placement.
 */
export async function extractTextItems(
  doc: PDFDocumentProxy,
  pageNum: number,
): Promise<PageTextItem[]> {
  const page = await doc.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const items: PageTextItem[] = [];
  for (const item of content.items) {
    if (!('str' in item) || item.str.trim().length === 0) continue;
    const tx = item.transform[4];
    const ty = item.transform[5];
    // Center of the item's box in PDF user space (y-up), then into page space.
    const [x, y] = viewport.convertToViewportPoint(
      tx + item.width / 2,
      ty + item.height / 2,
    );
    items.push({ str: item.str, center: { x, y } });
  }
  return items;
}
