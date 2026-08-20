import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { toGray, type GrayImage } from '../core/match';
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
 * the bitmap is rendered coarser and CSS-scaled up instead. 16M keeps us
 * under Safari's ~16.7M canvas-area ceiling — the strictest mainstream limit.
 */
const MAX_RENDER_PIXELS = 16_000_000;

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

export interface GrayRender {
  gray: GrayImage;
  /** Multiply page-space coordinates by this to get image pixels. */
  scale: number;
}

const MAX_MATCH_DIM = 4096;
/**
 * At MAX_MATCH_DIM a sheet's gray raster is ~40 MB of Float32Array, so the
 * cache is a small LRU rather than unbounded: 3 pages covers the common
 * "match, flip to the adjacent sheet, come back" pattern.
 */
const GRAY_CACHE_PAGES = 3;
const grayCache = new WeakMap<PDFDocumentProxy, Map<number, GrayRender>>();

/**
 * Rasterize a page to grayscale for symbol matching. Cached per document
 * (LRU of GRAY_CACHE_PAGES) — matching may run several times per sheet.
 */
export async function renderPageGray(
  doc: PDFDocumentProxy,
  pageNum: number,
): Promise<GrayRender> {
  let pages = grayCache.get(doc);
  if (!pages) {
    pages = new Map();
    grayCache.set(doc, pages);
  }
  const cached = pages.get(pageNum);
  if (cached) {
    // Refresh recency (Map preserves insertion order).
    pages.delete(pageNum);
    pages.set(pageNum, cached);
    return cached;
  }

  const page = await doc.getPage(pageNum);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2, MAX_MATCH_DIM / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const result: GrayRender = {
    gray: toGray(imageData.data, canvas.width, canvas.height),
    scale,
  };
  pages.set(pageNum, result);
  while (pages.size > GRAY_CACHE_PAGES) {
    pages.delete(pages.keys().next().value!); // evict least recently used
  }
  return result;
}

/**
 * Rasterize one page-space rectangle at high resolution straight from the
 * PDF vectors (no cache — OCR crops are small and each render is cheap on
 * memory because only the region's pixels are kept). Text comes out crisp,
 * unlike upscaling the page-wide gray raster.
 */
export async function renderRegionGray(
  doc: PDFDocumentProxy,
  pageNum: number,
  x: number,
  y: number,
  w: number,
  h: number,
  scale: number,
): Promise<GrayImage> {
  const page = await doc.getPage(pageNum);
  const viewport = page.getViewport({ scale, offsetX: -x * scale, offsetY: -y * scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(w * scale));
  canvas.height = Math.max(1, Math.ceil(h * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return toGray(imageData.data, canvas.width, canvas.height);
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
    const [a, b, c, d, tx, ty] = item.transform;
    // Center of the item's box in PDF user space (y-up), then into page
    // space. width runs along the baseline direction (a,b) and height along
    // (c,d) — advancing along raw axes instead would misplace rotated text
    // (titleblocks and rotated schedule tables are common on drawings).
    const wLen = Math.hypot(a, b) || 1;
    const hLen = Math.hypot(c, d) || 1;
    const cx = tx + ((a / wLen) * item.width + (c / hLen) * item.height) / 2;
    const cy = ty + ((b / wLen) * item.width + (d / hLen) * item.height) / 2;
    const [x, y] = viewport.convertToViewportPoint(cx, cy);
    items.push({ str: item.str, center: { x, y } });
  }
  return items;
}

/** Page size in page-space units (rotation applied), for layout-aware heuristics. */
export async function getPageDims(
  doc: PDFDocumentProxy,
  pageNum: number,
): Promise<{ width: number; height: number }> {
  const page = await doc.getPage(pageNum);
  const vp = page.getViewport({ scale: 1 });
  return { width: vp.width, height: vp.height };
}
