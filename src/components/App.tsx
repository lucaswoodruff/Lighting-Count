import { useCallback, useEffect, useState } from 'react';
import { findTagCandidates } from '../core/detect';
import { detectScales } from '../core/scaleDetect';
import { crop } from '../core/match';
import type { MatchWorkRequest, MatchWorkResponse } from '../workers/matchWorker';
import { looksLikeSchedulePage, parseSchedule, type ScheduleEntry } from '../core/schedule';
import { detectSheetNumber } from '../core/sheetLabel';
import {
  extractTextItems,
  getPageDims,
  getPageLabels,
  loadPdf,
  renderPageGray,
  renderRegion,
  type PDFDocumentProxy,
} from '../pdf/pdfService';
import { clearSession, loadSession, sessionKey, startAutosave } from '../state/persist';
import { useStore } from '../state/store';
import { startUndoTracking, undo } from '../state/undo';
import Landing from './Landing';
import PdfViewer from './PdfViewer';
import SidePanel from './SidePanel';
import Toolbar from './Toolbar';

export default function App() {
  const fileName = useStore((s) => s.fileName);
  const currentPage = useStore((s) => s.currentPage);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openFile = useCallback(async (file: File) => {
    try {
      setError(null);
      const buf = await file.arrayBuffer();
      const d = await loadPdf(buf);
      const labels = await getPageLabels(d);
      setDoc(d);
      if (new URLSearchParams(window.location.search).has('e2e')) {
        (window as unknown as Record<string, unknown>).__takeoffDoc = d;
      }
      useStore.getState().setDocument(file.name, d.numPages, labels);

      // Reattach a previous session for this document, if one was autosaved.
      const key = sessionKey(file.name, file.size);
      try {
        const saved = await loadSession(key);
        if (saved && Object.keys(saved.pages).length > 0) {
          const when = new Date(saved.savedAt).toLocaleString();
          if (window.confirm(`Restore your saved takeoff for this drawing (from ${when})?`)) {
            useStore.getState().restoreSession(saved.pages, saved.tagColors);
          } else {
            void clearSession(key);
          }
        }
      } catch {
        /* IndexedDB unavailable (private mode etc.) — run without persistence */
      }
      startAutosave(key);

      // Find the fixture schedule (types, engineer's counts, watts) in the
      // background. First clean parse wins; schedule text stays on-device.
      void (async () => {
        let unreadablePage: number | null = null;
        for (let p = 1; p <= d.numPages; p++) {
          const st = useStore.getState();
          if (st.fileName !== file.name) return;
          if (st.schedule.length > 0) return;
          try {
            const items = await extractTextItems(d, p);
            if (!looksLikeSchedulePage(items)) continue;
            const entries = parseSchedule(items);
            if (entries.length > 0) {
              const s2 = useStore.getState();
              s2.setSchedule(entries, s2.pageLabels[p - 1] ?? `Page ${p}`);
              return;
            }
            // The sheet SAYS "fixture schedule" but its table didn't parse —
            // outlined/scanned text. Remember it so the user learns why the
            // schedule features are absent instead of failing silently.
            unreadablePage ??= p;
          } catch {
            /* skip unparseable pages */
          }
        }
        if (unreadablePage !== null) {
          const s2 = useStore.getState();
          if (s2.fileName === file.name && s2.schedule.length === 0) {
            s2.setScheduleUnreadable(
              s2.pageLabels[unreadablePage - 1] ?? `Page ${unreadablePage}`,
              unreadablePage,
            );
          }
        }
      })();

      // No embedded labels ("Page N" fallback): resolve sheet numbers from
      // each sheet's titleblock text in the background. The dropdown fills
      // in as pages resolve; failures keep the fallback.
      const isFallback = labels.every((l, i) => l === `Page ${i + 1}`);
      if (isFallback) {
        void (async () => {
          for (let p = 1; p <= d.numPages; p++) {
            const st = useStore.getState();
            if (st.fileName !== file.name) return; // a different doc was opened
            try {
              const [items, dims] = await Promise.all([
                extractTextItems(d, p),
                getPageDims(d, p),
              ]);
              const sheet = detectSheetNumber(items, dims.width, dims.height);
              if (sheet) useStore.getState().setPageLabel(p, sheet);
            } catch {
              /* keep "Page N" for this page */
            }
          }
        })();
      }
    } catch (e) {
      setError(`Could not open "${file.name}": ${e instanceof Error ? e.message : e}`);
    }
  }, []);

  // Undo: record page-state changes for the session; Ctrl/Cmd+Z reverts.
  useEffect(() => {
    const unsub = startUndoTracking();
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      unsub();
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Run tag + scale-notation detection once per visited page.
  useEffect(() => {
    if (!doc) return;
    const st = useStore.getState();
    if ((st.pages[currentPage]?.candidates.length ?? 0) > 0) return;
    let cancelled = false;
    extractTextItems(doc, currentPage)
      .then((items) => {
        if (!cancelled) {
          const s = useStore.getState();
          s.setCandidates(currentPage, findTagCandidates(items));
          s.setDetectedScales(currentPage, detectScales(items));
        }
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [doc, currentPage]);

  // OCR a tag-name suggestion from the first boxed match example. The crop is
  // padded well beyond the (snug) symbol box so the adjacent tag text is
  // included. Runs once per example set; the result is a suggestion the user
  // confirms in the side panel — never auto-applied (candidates, not answers).
  const pendingMatchBoxes = useStore((s) => s.pendingMatchBoxes);
  useEffect(() => {
    if (!doc || pendingMatchBoxes.length === 0) return;
    const st = useStore.getState();
    if (st.tagSuggestion) return; // already read (or reading) for this set
    const pageNum = st.currentPage;
    const box = pendingMatchBoxes[0];
    st.setTagSuggestion({ status: 'reading' });
    let cancelled = false;
    (async () => {
      const x = Math.min(box.a.x, box.b.x);
      const y = Math.min(box.a.y, box.b.y);
      const w = Math.abs(box.b.x - box.a.x);
      const h = Math.abs(box.b.y - box.a.y);
      // Tag text sits beside the (snugly boxed) symbol, often a full symbol
      // width away — pad generously so the label lands inside the crop.
      const pad = Math.max(w, h) * 1.6;
      const { canvas, scale: rScale } = await renderRegion(
        doc,
        pageNum,
        { x: x - pad, y: y - pad, w: w + 2 * pad, h: h + 2 * pad },
        480,
      );
      if (cancelled) return;
      // The boxed symbol itself OCRs as letters (a circle reads as C/O) and
      // glues onto the adjacent tag text — white it out so only the label
      // remains. The box is snug, so a small margin covers its full extent.
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const m = Math.max(w, h) * 0.08;
        ctx.fillStyle = '#fff';
        ctx.fillRect(
          (pad - m) * rScale,
          (pad - m) * rScale,
          (w + 2 * m) * rScale,
          (h + 2 * m) * rScale,
        );
      }
      const { recognizeTagCrop } = await import('../core/ocr');
      const result = await recognizeTagCrop(canvas);
      if (cancelled) return;
      const s2 = useStore.getState();
      // Only publish if this example set is still the pending one.
      if (s2.currentPage !== pageNum || s2.pendingMatchBoxes.length === 0) return;
      s2.setTagSuggestion(
        result
          ? {
              status: 'done',
              text: result.text,
              confidence: result.confidence,
              isTagShaped: result.isTagShaped,
            }
          : null,
      );
    })().catch(() => {
      if (!cancelled) useStore.getState().setTagSuggestion(null);
    });
    return () => {
      cancelled = true;
    };
  }, [doc, pendingMatchBoxes]);

  // Execute schedule-region OCR requests (drag box on a scanned schedule).
  // OCR words carry positions, so the result flows through the same
  // column-driven parseSchedule as machine-readable schedules do.
  const scheduleOcrRequest = useStore((s) => s.scheduleOcrRequest);
  useEffect(() => {
    if (!scheduleOcrRequest || !doc) return;
    const { page: pageNum, box } = scheduleOcrRequest;
    const st = useStore.getState();
    const pageLabel = st.pageLabels[pageNum - 1] ?? `Page ${pageNum}`;
    st.setScheduleOcr({ status: 'reading', pageLabel });
    let cancelled = false;
    (async () => {
      const rect = {
        x: Math.min(box.a.x, box.b.x),
        y: Math.min(box.a.y, box.b.y),
        w: Math.abs(box.b.x - box.a.x),
        h: Math.abs(box.b.y - box.a.y),
      };
      const { canvas, scale } = await renderRegion(doc, pageNum, rect, 1600);
      if (cancelled) return;
      const { recognizeScheduleRegion } = await import('../core/ocr');
      const candidates = await recognizeScheduleRegion(canvas);
      if (cancelled) return;
      // Parse each preprocessing variant (word centers: region canvas px →
      // page space, then the normal column parser) and keep the best table.
      let best: { entries: ScheduleEntry[]; text: string } | null = null;
      for (const cand of candidates) {
        const items = cand.words.map((wd) => ({
          str: wd.text,
          center: { x: rect.x + wd.center.x / scale, y: rect.y + wd.center.y / scale },
        }));
        const entries = parseSchedule(items);
        if (!best || entries.length > best.entries.length) {
          best = { entries, text: cand.text };
        }
      }
      const rawText = candidates.find((c) => c.text)?.text ?? '';
      const s2 = useStore.getState();
      s2.clearScheduleOcrRequest();
      if (best && best.entries.length > 0) {
        s2.setScheduleOcr({ status: 'review', pageLabel, entries: best.entries, text: best.text });
      } else {
        s2.setScheduleOcr({
          status: 'failed',
          pageLabel,
          text: rawText,
          message:
            rawText.length === 0
              ? 'No text could be read in that box.'
              : "Text was read but a schedule table couldn't be parsed from it.",
        });
      }
    })().catch((e) => {
      if (cancelled) return;
      const s2 = useStore.getState();
      s2.clearScheduleOcrRequest();
      s2.setScheduleOcr({
        status: 'failed',
        pageLabel,
        text: '',
        message: `OCR failed: ${e instanceof Error ? e.message : e}`,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [scheduleOcrRequest, doc]);

  // Execute symbol-match requests (this component owns the pdf document).
  const matchRequest = useStore((s) => s.matchRequest);
  useEffect(() => {
    if (!matchRequest || !doc) return;
    const { tag, boxes, threshold } = matchRequest;
    const st = useStore.getState();
    const pageNum = st.currentPage;
    st.setMatchStatus(
      `Searching for "${tag}" using ${boxes.length} example${boxes.length > 1 ? 's' : ''}…`,
    );
    let cancelled = false;
    let worker: Worker | null = null;
    (async () => {
      const { gray, scale } = await renderPageGray(doc, pageNum);
      if (cancelled) return;
      const templates = boxes.map((box) =>
        crop(
          gray,
          Math.min(box.a.x, box.b.x) * scale,
          Math.min(box.a.y, box.b.y) * scale,
          Math.abs(box.b.x - box.a.x) * scale,
          Math.abs(box.b.y - box.a.y) * scale,
        ),
      );
      // Correlation runs off the main thread; each template is also matched
      // at 90-degree rotations, so rotated placements come back in one run.
      worker = new Worker(new URL('../workers/matchWorker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = (ev: MessageEvent<MatchWorkResponse>) => {
        const msg = ev.data;
        const s2 = useStore.getState();
        if (msg.type === 'progress') {
          s2.setMatchStatus(`Searching for "${tag}"… ${msg.done}/${msg.total}`);
          return;
        }
        if (msg.type === 'error') {
          s2.setMatchStatus(`Match failed: ${msg.message}`);
          s2.clearMatchRequest();
          return;
        }
        const points = msg.matches.map((m) => ({
          x: m.center.x / scale,
          y: m.center.y / scale,
        }));
        // Points closer together than ~60% of the smallest example are the
        // same fixture — in page units for the store-level merge.
        const dedupeRadius = (msg.minTplDim * 0.6) / scale;
        const before =
          s2.pages[pageNum]?.candidates.find((c) => c.tag === tag)?.points.length ?? 0;
        s2.mergeMatchedPoints(pageNum, tag, points, dedupeRadius);
        const after =
          useStore.getState().pages[pageNum]?.candidates.find((c) => c.tag === tag)?.points
            .length ?? 0;
        s2.setMatchStatus(
          before > 0
            ? `Found ${points.length} match(es); ${after - before} new — now ${after} × ${tag}.`
            : `Found ${after} × ${tag}. Box a missed one and run again to top up, or erase extras.`,
        );
        s2.clearMatchRequest();
      };
      worker.postMessage({ image: gray, templates, threshold } satisfies MatchWorkRequest);
    })().catch((e) => {
      const s2 = useStore.getState();
      s2.setMatchStatus(`Match failed: ${e instanceof Error ? e.message : e}`);
      s2.clearMatchRequest();
    });
    return () => {
      cancelled = true;
      worker?.terminate(); // page switch / new request / unmount cancels the run
    };
  }, [matchRequest, doc]);

  if (!doc || !fileName) {
    return <Landing onFile={openFile} error={error} />;
  }

  return (
    <div className="app">
      <Toolbar onOpenFile={openFile} />
      <HintBar />
      <div className="main">
        <SidePanel />
        <PdfViewer doc={doc} />
      </div>
    </div>
  );
}

function HintBar() {
  const tool = useStore((s) => s.tool);
  const activeTag = useStore((s) => s.activeTag);
  const pending = useStore((s) => s.pendingCalibration);
  const pendingCount = useStore((s) => s.pendingMatchBoxes.length);

  let hint = '';
  switch (tool) {
    case 'pan':
      hint = 'Pan: drag to move around the sheet. Ctrl + scroll to zoom.';
      break;
    case 'calibrate':
      hint = pending
        ? 'Enter the real length of the drawn line in the Scale panel on the left.'
        : 'Calibrate: click the two ends of a feature with a known length (a dimension string or scale bar).';
      break;
    case 'area':
      hint =
        'Draw area: click each corner of the space. Double-click or press Enter to close. Esc cancels.';
      break;
    case 'rect':
      hint = 'Rectangle: press the mouse at one corner, drag, and release at the opposite corner.';
      break;
    case 'match':
      hint =
        pendingCount > 0
          ? `${pendingCount} example${pendingCount > 1 ? 's' : ''} boxed — box more if the symbol varies, then name the type in the left panel and click "Find matches".`
          : 'Match symbol: drag a snug box around an example fixture symbol (zoom in first for accuracy). Box several examples if they vary slightly. Rotated copies are not matched.';
      break;
    case 'add':
      hint = activeTag
        ? `Add fixture: each click places one "${activeTag}" marker. Choose a different type in the toolbar.`
        : 'Add fixture: first pick a fixture type in the toolbar dropdown (confirm types in the left panel).';
      break;
    case 'erase':
      hint = 'Erase: click a fixture marker to remove it from the count.';
      break;
    case 'schedule-ocr':
      hint =
        'Read schedule: drag a box around the whole fixture schedule table, including its header row. Esc cancels.';
      break;
  }
  return <div className="hint-bar">{hint}</div>;
}
