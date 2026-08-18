import { useRef } from 'react';
import { usePageState, useStore, type Tool } from '../state/store';

const TOOLS: { id: Tool; label: string; title: string }[] = [
  { id: 'pan', label: 'Pan', title: 'Drag to pan, Ctrl+scroll to zoom' },
  { id: 'calibrate', label: 'Calibrate', title: 'Set scale from a known dimension' },
  { id: 'area', label: 'Draw Area', title: 'Outline a space corner by corner' },
  { id: 'rect', label: 'Rectangle', title: 'Drag a rectangular area' },
  { id: 'match', label: 'Match Symbol', title: 'Box one fixture symbol; find all identical ones' },
  { id: 'add', label: 'Add Fixture', title: 'Click to add a missed fixture' },
  { id: 'erase', label: 'Erase', title: 'Click a marker to remove it' },
  {
    id: 'schedule-ocr',
    label: 'Read Schedule',
    title:
      'Drag a box around a scanned fixture-schedule table to read it with on-device OCR',
  },
];

export default function Toolbar({ onOpenFile }: { onOpenFile: (f: File) => void }) {
  const fileName = useStore((s) => s.fileName);
  const numPages = useStore((s) => s.numPages);
  const pageLabels = useStore((s) => s.pageLabels);
  const currentPage = useStore((s) => s.currentPage);
  const tool = useStore((s) => s.tool);
  const zoom = useStore((s) => s.zoom);
  const activeTag = useStore((s) => s.activeTag);
  const setPage = useStore((s) => s.setPage);
  const setTool = useStore((s) => s.setTool);
  const setZoom = useStore((s) => s.setZoom);
  const setActiveTag = useStore((s) => s.setActiveTag);
  const page = usePageState();
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="toolbar">
      <span className="brand">Lighting Takeoff</span>
      <button onClick={() => inputRef.current?.click()} title="Open a different PDF">
        Open…
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onOpenFile(f);
          e.target.value = '';
        }}
      />
      <span className="file-name" title={fileName ?? ''}>
        {fileName}
      </span>

      <div className="group">
        <button disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
          ◀
        </button>
        <select value={currentPage} onChange={(e) => setPage(Number(e.target.value))}>
          {pageLabels.map((label, i) => (
            <option key={i} value={i + 1}>
              {label}
            </option>
          ))}
        </select>
        <button disabled={currentPage >= numPages} onClick={() => setPage(currentPage + 1)}>
          ▶
        </button>
      </div>

      <div className="group">
        <button onClick={() => setZoom(zoom / 1.25)} title="Zoom out">
          −
        </button>
        <button onClick={() => setZoom(1)} title="Reset zoom" style={{ minWidth: 56 }}>
          {Math.round(zoom * 100)}%
        </button>
        <button onClick={() => setZoom(zoom * 1.25)} title="Zoom in">
          +
        </button>
      </div>

      <span className="spacer" />

      {tool === 'add' && (
        <select
          value={activeTag ?? ''}
          onChange={(e) => setActiveTag(e.target.value || null)}
          title="Fixture type to place"
        >
          <option value="">— type —</option>
          {page.enabledTags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      )}

      <div className="group">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={tool === t.id ? 'active' : ''}
            title={t.title}
            onClick={() => setTool(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
