import { useCallback, useEffect, useState } from 'react';
import { findTagCandidates } from '../core/detect';
import { detectScales } from '../core/scaleDetect';
import { crop } from '../core/match';
import type { MatchWorkRequest, MatchWorkResponse } from '../workers/matchWorker';
import { looksLikeSchedulePage, parseSchedule } from '../core/schedule';
import { detectSheetNumber } from '../core/sheetLabel';
import {
  extractTextItems,
  getPageDims,
  getPageLabels,
  loadPdf,
  renderPageGray,
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
          } catch {
            /* skip unparseable pages */
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
  }
  return <div className="hint-bar">{hint}</div>;
}
