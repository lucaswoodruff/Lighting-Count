import { useCallback, useEffect, useState } from 'react';
import { findTagCandidates } from '../core/detect';
import { crop, matchTemplate } from '../core/match';
import {
  extractTextItems,
  getPageLabels,
  loadPdf,
  renderPageGray,
  type PDFDocumentProxy,
} from '../pdf/pdfService';
import { useStore } from '../state/store';
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
    } catch (e) {
      setError(`Could not open "${file.name}": ${e instanceof Error ? e.message : e}`);
    }
  }, []);

  // Run tag detection once per visited page.
  useEffect(() => {
    if (!doc) return;
    const st = useStore.getState();
    if ((st.pages[currentPage]?.candidates.length ?? 0) > 0) return;
    let cancelled = false;
    extractTextItems(doc, currentPage)
      .then((items) => {
        if (!cancelled) {
          useStore.getState().setCandidates(currentPage, findTagCandidates(items));
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
    const { tag, box } = matchRequest;
    const st = useStore.getState();
    const pageNum = st.currentPage;
    st.setMatchStatus(`Searching for "${tag}"…`);
    let cancelled = false;
    (async () => {
      // Let the status line paint before the heavy correlation loop.
      await new Promise((r) => setTimeout(r, 30));
      const { gray, scale } = await renderPageGray(doc, pageNum);
      const x = Math.min(box.a.x, box.b.x) * scale;
      const y = Math.min(box.a.y, box.b.y) * scale;
      const w = Math.abs(box.b.x - box.a.x) * scale;
      const h = Math.abs(box.b.y - box.a.y) * scale;
      const tpl = crop(gray, x, y, w, h);
      const matches = matchTemplate(gray, tpl, 0.8);
      if (cancelled) return;
      const points = matches.map((m) => ({ x: m.center.x / scale, y: m.center.y / scale }));
      const s2 = useStore.getState();
      s2.setMatchedPoints(pageNum, tag, points);
      s2.setMatchStatus(`Found ${points.length} × ${tag}. Erase or add markers to correct.`);
      s2.clearMatchRequest();
    })().catch((e) => {
      const s2 = useStore.getState();
      s2.setMatchStatus(`Match failed: ${e instanceof Error ? e.message : e}`);
      s2.clearMatchRequest();
    });
    return () => {
      cancelled = true;
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
  const pendingMatch = useStore((s) => s.pendingMatch);

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
      hint = pendingMatch
        ? 'Now name the fixture type in the left panel and click "Find matches".'
        : 'Match symbol: drag a snug box around ONE example fixture symbol (zoom in first for accuracy). Finds identical symbols — rotated copies are not matched.';
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
