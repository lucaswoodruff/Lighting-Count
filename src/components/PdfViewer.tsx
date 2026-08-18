import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Circle, Layer, Line, Stage, Text } from 'react-konva';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { renderPage, type PDFDocumentProxy } from '../pdf/pdfService';
import { effectiveMarkers, usePageState, useStore } from '../state/store';
import { areaSquareFeet } from '../core/scale';
import type { Pt } from '../types';

export default function PdfViewer({ doc }: { doc: PDFDocumentProxy }) {
  const currentPage = useStore((s) => s.currentPage);
  const zoom = useStore((s) => s.zoom);
  const tool = useStore((s) => s.tool);
  const activeTag = useStore((s) => s.activeTag);
  const tagColors = useStore((s) => s.tagColors);
  const pendingCalibration = useStore((s) => s.pendingCalibration);
  const pendingMatchBoxes = useStore((s) => s.pendingMatchBoxes);
  const page = usePageState();

  const viewerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const renderChain = useRef<Promise<void>>(Promise.resolve());
  const syncPending = useRef(false);

  const [pageDims, setPageDims] = useState<{ w: number; h: number } | null>(null);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const [draftPts, setDraftPts] = useState<Pt[]>([]);
  const [calStart, setCalStart] = useState<Pt | null>(null);
  const [rectStart, setRectStart] = useState<Pt | null>(null);
  const [cursor, setCursor] = useState<Pt | null>(null);

  // Page size in page-space units, known before the bitmap finishes rendering
  // so layout and scroll anchoring stay stable.
  useEffect(() => {
    let cancelled = false;
    doc.getPage(currentPage).then((p) => {
      const vp = p.getViewport({ scale: 1 });
      if (!cancelled) setPageDims({ w: vp.width, h: vp.height });
    });
    return () => {
      cancelled = true;
    };
  }, [doc, currentPage]);

  // Render the PDF bitmap. Debounced so rapid zooming doesn't queue a full
  // re-render per wheel tick (the canvas CSS-scales instantly in the
  // meantime), chained so renders never overlap, and stale renders skipped.
  // pageDims is a dependency because the canvas only mounts once it resolves —
  // without it the first run sees no canvas and the sheet stays blank.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      renderChain.current = renderChain.current
        .then(async () => {
          const st = useStore.getState();
          if (cancelled || st.currentPage !== currentPage || st.zoom !== zoom) return;
          await renderPage(doc, currentPage, zoom, canvas);
        })
        .catch((e) => console.error('PDF render failed:', e));
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [doc, currentPage, zoom, pageDims]);

  // Reset in-progress drawings when the page or tool changes.
  useEffect(() => {
    setDraftPts([]);
    setCalStart(null);
    setRectStart(null);
  }, [currentPage, tool]);

  // The annotation stage is only as large as the visible viewport (a
  // full-sheet stage at high zoom would need gigabytes of canvas buffer).
  // It slides along with the scroll position; shapes stay in page space.
  useEffect(() => {
    const v = viewerRef.current;
    if (!v) return;
    const measure = () => setViewport({ w: v.clientWidth, h: v.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(v);
    return () => ro.disconnect();
  }, []);

  function syncOverlay() {
    syncPending.current = false;
    const v = viewerRef.current;
    const o = overlayRef.current;
    const stage = stageRef.current;
    if (!v || !o || !stage) return;
    const sl = v.scrollLeft;
    const st = v.scrollTop;
    o.style.transform = `translate(${sl}px, ${st}px)`;
    stage.position({ x: -sl, y: -st });
    stage.batchDraw();
  }

  function onScroll() {
    if (!syncPending.current) {
      syncPending.current = true;
      requestAnimationFrame(syncOverlay);
    }
  }

  useLayoutEffect(syncOverlay);

  // Ctrl+wheel zoom anchored at the cursor (needs a non-passive listener).
  const anchorRef = useRef<{ ox: number; oy: number; oldZoom: number } | null>(null);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const st = useStore.getState();
      const rect = viewer.getBoundingClientRect();
      anchorRef.current = {
        ox: e.clientX - rect.left,
        oy: e.clientY - rect.top,
        oldZoom: st.zoom,
      };
      // Exponential factor: smooth for trackpad pinches (small deltas) and
      // roughly a 1.2x step per mouse-wheel notch.
      st.setZoom(st.zoom * Math.exp(-e.deltaY * 0.0018));
    };
    viewer.addEventListener('wheel', onWheel, { passive: false });
    return () => viewer.removeEventListener('wheel', onWheel);
  }, []);

  useLayoutEffect(() => {
    const viewer = viewerRef.current;
    const anchor = anchorRef.current;
    if (!viewer || !anchor || anchor.oldZoom === zoom) return;
    const k = zoom / anchor.oldZoom;
    viewer.scrollLeft = (viewer.scrollLeft + anchor.ox) * k - anchor.ox;
    viewer.scrollTop = (viewer.scrollTop + anchor.oy) * k - anchor.oy;
    anchorRef.current = null;
  }, [zoom]);

  // Keyboard: Enter closes an area draft, Escape cancels drafts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDraftPts([]);
        setCalStart(null);
        setRectStart(null);
        const st = useStore.getState();
        st.setPendingCalibration(null);
        st.clearPendingMatchBoxes();
        // The hint promises "Esc cancels" for schedule OCR — leave the mode
        // too, or the next drag silently starts another OCR read.
        if (st.tool === 'schedule-ocr') st.setTool('pan');
      } else if (e.key === 'Enter' && draftPts.length >= 3) {
        useStore.getState().addArea(dedupe(draftPts));
        setDraftPts([]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draftPts]);

  // Drag-to-pan.
  const panRef = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  function onPanMouseDown(e: React.MouseEvent) {
    if (tool !== 'pan' || e.button !== 0) return;
    const v = viewerRef.current!;
    panRef.current = { x: e.clientX, y: e.clientY, sl: v.scrollLeft, st: v.scrollTop };
  }
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const p = panRef.current;
      const v = viewerRef.current;
      if (!p || !v) return;
      v.scrollLeft = p.sl - (e.clientX - p.x);
      v.scrollTop = p.st - (e.clientY - p.y);
    };
    const up = () => {
      panRef.current = null;
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, []);

  function pointerPagePos(): Pt | null {
    // Relative position inverts the stage's scroll offset and zoom scale,
    // yielding page-space coordinates directly.
    return stageRef.current?.getRelativePointerPosition() ?? null;
  }

  function onStageClick() {
    const pt = pointerPagePos();
    if (!pt) return;
    const st = useStore.getState();
    switch (tool) {
      case 'area':
        setDraftPts((d) => [...d, pt]);
        break;
      case 'calibrate':
        if (!calStart) {
          st.setPendingCalibration(null);
          setCalStart(pt);
        } else {
          st.setPendingCalibration({ a: calStart, b: pt });
          setCalStart(null);
        }
        break;
      case 'add':
        if (activeTag) st.addManualMarker(activeTag, pt);
        break;
      default:
        break;
    }
  }

  function onStageDblClick() {
    if (tool !== 'area') return;
    // Konva fires dblclick for any two clicks within 400ms, however far
    // apart. Only close the polygon when the last two clicks were at the
    // same spot (a genuine double-click), so rapid vertex clicking never
    // clears or prematurely closes the draft.
    const n = draftPts.length;
    if (n >= 2) {
      const a = draftPts[n - 1];
      const b = draftPts[n - 2];
      if (Math.hypot(a.x - b.x, a.y - b.y) > 4 / zoom) return;
    }
    const pts = dedupe(draftPts);
    if (pts.length >= 3) {
      useStore.getState().addArea(pts);
      setDraftPts([]);
    }
  }

  const isDragBoxTool = tool === 'rect' || tool === 'match' || tool === 'schedule-ocr';

  function onStageMouseMove() {
    if (tool === 'area' || tool === 'calibrate' || isDragBoxTool) {
      setCursor(pointerPagePos());
    }
  }

  function onStageMouseDown() {
    if (!isDragBoxTool) return;
    setRectStart(pointerPagePos());
  }

  function onStageMouseUp() {
    if (!isDragBoxTool || !rectStart) return;
    const b = pointerPagePos();
    setRectStart(null);
    if (!b) return;
    // Ignore accidental clicks — require a real drag in both directions.
    if (Math.abs(b.x - rectStart.x) < 4 / zoom || Math.abs(b.y - rectStart.y) < 4 / zoom) return;
    if (tool === 'rect') {
      useStore.getState().addArea(rectCorners(rectStart, b));
    } else if (tool === 'match') {
      useStore.getState().addPendingMatchBox({ a: rectStart, b });
    } else {
      useStore.getState().requestScheduleOcr({ a: rectStart, b });
    }
  }

  function onMarkerClick(e: KonvaEventObject<MouseEvent>, id: string) {
    if (tool !== 'erase') return;
    e.cancelBubble = true;
    useStore.getState().eraseMarker(id);
  }

  if (!pageDims) return <div className="viewer" ref={viewerRef} />;

  const w = pageDims.w * zoom;
  const h = pageDims.h * zoom;
  const markers = effectiveMarkers(page);
  const px = (n: number) => n / zoom; // constant-screen-size helper

  const cursorStyle =
    tool === 'pan' ? (panRef.current ? 'grabbing' : 'grab') : 'crosshair';

  const vpW = Math.min(viewport.w, w);
  const vpH = Math.min(viewport.h, h);

  return (
    <div className="viewer" ref={viewerRef} onMouseDown={onPanMouseDown} onScroll={onScroll}>
      <div className="page-wrap" style={{ width: w, height: h }}>
        <canvas ref={canvasRef} className="pdf-canvas" style={{ width: w, height: h }} />
        <div
          className="overlay"
          ref={overlayRef}
          style={{ cursor: cursorStyle, width: vpW, height: vpH }}
        >
          <Stage
            ref={stageRef}
            width={vpW}
            height={vpH}
            scaleX={zoom}
            scaleY={zoom}
            onClick={onStageClick}
            onDblClick={onStageDblClick}
            onMouseMove={onStageMouseMove}
            onMouseDown={onStageMouseDown}
            onMouseUp={onStageMouseUp}
          >
            {/* Completed areas */}
            <Layer listening={false}>
              {page.areas.map((a) => {
                const c = centroid(a.pts);
                const sf = page.scale ? areaSquareFeet(a.pts, page.scale) : null;
                return (
                  <AreaShapeView
                    key={a.id}
                    pts={a.pts}
                    label={`${a.name}${sf !== null ? ` — ${Math.round(sf).toLocaleString()} sf` : ''}`}
                    centroid={c}
                    zoom={zoom}
                  />
                );
              })}
              {/* Draft area */}
              {draftPts.length > 0 && (
                <>
                  <Line
                    points={flat(cursor && tool === 'area' ? [...draftPts, cursor] : draftPts)}
                    stroke="#1d4ed8"
                    strokeWidth={px(1.5)}
                    dash={[px(6), px(4)]}
                  />
                  {draftPts.map((p, i) => (
                    <Circle key={i} x={p.x} y={p.y} radius={px(3.5)} fill="#1d4ed8" />
                  ))}
                </>
              )}
              {/* Draft rectangle (area, match template, or schedule OCR region) */}
              {isDragBoxTool && rectStart && cursor && (
                <Line
                  points={flat(rectCorners(rectStart, cursor))}
                  closed
                  stroke={
                    tool === 'rect' ? '#1d4ed8' : tool === 'match' ? '#ea580c' : '#7c3aed'
                  }
                  strokeWidth={px(1.5)}
                  dash={[px(6), px(4)]}
                  fill={
                    tool === 'rect'
                      ? 'rgba(37, 99, 235, 0.08)'
                      : tool === 'match'
                        ? 'rgba(234, 88, 12, 0.08)'
                        : 'rgba(124, 58, 237, 0.08)'
                  }
                />
              )}
              {/* Pending match example boxes awaiting a type name */}
              {pendingMatchBoxes.map((b, i) => (
                <Line
                  key={i}
                  points={flat(rectCorners(b.a, b.b))}
                  closed
                  stroke="#ea580c"
                  strokeWidth={px(2)}
                />
              ))}
              {/* Calibration line */}
              {tool === 'calibrate' && calStart && cursor && (
                <Line
                  points={[calStart.x, calStart.y, cursor.x, cursor.y]}
                  stroke="#dc2626"
                  strokeWidth={px(2)}
                  dash={[px(8), px(5)]}
                />
              )}
              {pendingCalibration && (
                <Line
                  points={[
                    pendingCalibration.a.x,
                    pendingCalibration.a.y,
                    pendingCalibration.b.x,
                    pendingCalibration.b.y,
                  ]}
                  stroke="#dc2626"
                  strokeWidth={px(2.5)}
                />
              )}
            </Layer>

            {/* Fixture markers — clickable only while erasing */}
            <Layer listening={tool === 'erase'}>
              {markers.map((m) => (
                <Circle
                  key={m.id}
                  x={m.pt.x}
                  y={m.pt.y}
                  radius={px(6)}
                  fill={tagColors[m.tag] ?? '#e6194b'}
                  opacity={0.85}
                  stroke="#fff"
                  strokeWidth={px(1.5)}
                  hitStrokeWidth={px(8)}
                  onClick={(e) => onMarkerClick(e, m.id)}
                />
              ))}
            </Layer>
          </Stage>
        </div>
      </div>
    </div>
  );
}

function AreaShapeView({
  pts,
  label,
  centroid: c,
  zoom,
}: {
  pts: Pt[];
  label: string;
  centroid: Pt;
  zoom: number;
}) {
  const fontSize = 14 / zoom;
  return (
    <>
      <Line
        points={flat(pts)}
        closed
        stroke="#1d4ed8"
        strokeWidth={2 / zoom}
        fill="rgba(37, 99, 235, 0.10)"
      />
      <Text
        x={c.x}
        y={c.y}
        offsetX={(label.length * fontSize * 0.27)}
        text={label}
        fontSize={fontSize}
        fontStyle="bold"
        fill="#1e3a8a"
        shadowColor="#ffffff"
        shadowBlur={4 / zoom}
      />
    </>
  );
}

function flat(pts: Pt[]): number[] {
  return pts.flatMap((p) => [p.x, p.y]);
}

function rectCorners(a: Pt, b: Pt): Pt[] {
  return [
    { x: a.x, y: a.y },
    { x: b.x, y: a.y },
    { x: b.x, y: b.y },
    { x: a.x, y: b.y },
  ];
}

function centroid(pts: Pt[]): Pt {
  const n = pts.length || 1;
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / n,
    y: pts.reduce((s, p) => s + p.y, 0) / n,
  };
}

/** Drop consecutive near-duplicate vertices (double-click adds extra clicks). */
function dedupe(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.75) out.push(p);
  }
  return out;
}
