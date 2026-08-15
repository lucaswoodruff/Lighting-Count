import { useMemo, useState } from 'react';
import { downloadXlsx } from '../core/exportXlsx';
import {
  COMMON_SCALES,
  impliedFeetPerPaperInch,
  parseFeetInches,
  scaleFromCalibration,
  scaleFromRatio,
} from '../core/scale';
import { computeResults, usePageState, useStore } from '../state/store';

export default function SidePanel() {
  return (
    <div className="sidebar">
      <ScaleSection />
      <TagSection />
      <ResultsSection />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ScaleSection() {
  const page = usePageState();
  const pending = useStore((s) => s.pendingCalibration);
  const setScale = useStore((s) => s.setScale);
  const setTool = useStore((s) => s.setTool);
  const setPendingCalibration = useStore((s) => s.setPendingCalibration);
  const [calLength, setCalLength] = useState('');
  const [calError, setCalError] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);
  const [customIn, setCustomIn] = useState('1');
  const [customFt, setCustomFt] = useState('20');

  function applyRatio(paperInches: number, realFeet: number, label?: string) {
    try {
      setScale(scaleFromRatio(paperInches, realFeet, label));
    } catch {
      /* invalid custom input — ignored until corrected */
    }
  }

  function applyCalibration() {
    if (!pending) return;
    const feet = parseFeetInches(calLength);
    if (feet === null || feet <= 0) {
      setCalError('Enter a length like 24.5 or 24\'-6"');
      return;
    }
    setCalError(null);
    setScale(scaleFromCalibration(pending.a, pending.b, feet));
    setPendingCalibration(null);
    setCalLength('');
    setTool('pan');
  }

  return (
    <section>
      <h3>1 · Scale</h3>
      {page.scale ? (
        <div className="scale-current">
          {page.scale.label}
          {page.scale.source === 'calibration' && (
            <div className="note">
              ≈ {impliedFeetPerPaperInch(page.scale).toFixed(1)} ft per plotted inch
            </div>
          )}
        </div>
      ) : (
        <div className="warn">No scale set for this sheet — areas can't be computed yet.</div>
      )}

      {!page.scale && page.detectedScales.length > 0 && (
        <div className="note">
          Found on this sheet:
          {page.detectedScales.slice(0, 3).map((d) => (
            <div key={d.label} className="row">
              <span>
                {d.label}
                {d.occurrences > 1 ? ` ×${d.occurrences}` : ''}
              </span>
              <button onClick={() => applyRatio(d.paperInches, d.realFeet, d.label)}>
                Use
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="row">
        <select
          value=""
          onChange={(e) => {
            if (e.target.value === 'custom') {
              setCustom(true);
              return;
            }
            const s = COMMON_SCALES[Number(e.target.value)];
            if (s) applyRatio(s.paperInches, s.realFeet, s.label);
          }}
        >
          <option value="">Set from plotted scale…</option>
          {COMMON_SCALES.map((s, i) => (
            <option key={s.label} value={i}>
              {s.label}
            </option>
          ))}
          <option value="custom">Custom ratio…</option>
        </select>
        <button onClick={() => setTool('calibrate')}>Calibrate on drawing</button>
      </div>

      {custom && (
        <div className="row">
          <input
            type="number"
            style={{ width: 60 }}
            value={customIn}
            min={0.01}
            step={0.01}
            onChange={(e) => setCustomIn(e.target.value)}
          />
          <span>in =</span>
          <input
            type="number"
            style={{ width: 60 }}
            value={customFt}
            min={0.01}
            step={0.01}
            onChange={(e) => setCustomFt(e.target.value)}
          />
          <span>ft</span>
          <button onClick={() => applyRatio(Number(customIn), Number(customFt))}>Apply</button>
        </div>
      )}

      {pending && (
        <div className="row">
          <span>Line length:</span>
          <input
            type="text"
            style={{ width: 90 }}
            placeholder={'24\'-6"'}
            value={calLength}
            autoFocus
            onChange={(e) => setCalLength(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyCalibration()}
          />
          <button className="primary" onClick={applyCalibration}>
            Apply
          </button>
        </div>
      )}
      {calError && <div className="warn">{calError}</div>}
      <p className="note">
        Ratio entry trusts that the PDF was plotted at its stated sheet size. When in doubt,
        calibrate against a printed dimension.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function TagSection() {
  const page = usePageState();
  const tagColors = useStore((s) => s.tagColors);
  const toggleTag = useStore((s) => s.toggleTag);
  const addCustomTag = useStore((s) => s.addCustomTag);
  const removeTag = useStore((s) => s.removeTag);
  const [showAll, setShowAll] = useState(false);
  const [newTag, setNewTag] = useState('');

  const shown = showAll ? page.candidates : page.candidates.slice(0, 25);

  return (
    <section>
      <h3>2 · Fixture types</h3>
      <p className="note">
        Candidate tags found on this sheet. Check the ones that are fixture types — grid
        bubbles, panel names, and keynotes often match too, so leave those unchecked.
      </p>
      {page.candidates.length === 0 && (
        <div className="warn">
          No candidate tags found on this sheet. If the drawing's text isn't real text
          (outlined CAD text or a scan), use the Match Symbol tool: box one example fixture
          and the app finds all identical symbols.
        </div>
      )}
      <MatchControls />
      <div className="tag-list">
        {shown.map((c) => {
          const enabled = page.enabledTags.includes(c.tag);
          return (
            <label key={c.tag} className="tag-row">
              <input type="checkbox" checked={enabled} onChange={() => toggleTag(c.tag)} />
              <span
                className="dot"
                style={{ background: enabled ? tagColors[c.tag] : '#d7dbe3' }}
              />
              <span className="tag">{c.tag}</span>
              <span className="count">×{c.points.length}</span>
              <button
                className="del"
                title={`Remove type ${c.tag} and all its markers`}
                onClick={(e) => {
                  e.preventDefault();
                  removeTag(c.tag);
                }}
              >
                ×
              </button>
            </label>
          );
        })}
      </div>
      {page.candidates.length > 25 && (
        <button onClick={() => setShowAll(!showAll)} style={{ marginTop: 4 }}>
          {showAll ? 'Show fewer' : `Show all ${page.candidates.length}`}
        </button>
      )}
      <div className="row">
        <input
          type="text"
          style={{ width: 100 }}
          placeholder="Add type…"
          value={newTag}
          onChange={(e) => setNewTag(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newTag.trim()) {
              addCustomTag(newTag.trim());
              setNewTag('');
            }
          }}
        />
        <button
          disabled={!newTag.trim()}
          onClick={() => {
            addCustomTag(newTag.trim());
            setNewTag('');
          }}
        >
          Add
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

/** Name-and-run controls for drawn symbol-match example boxes, plus status. */
function MatchControls() {
  const boxCount = useStore((s) => s.pendingMatchBoxes.length);
  const matchRequest = useStore((s) => s.matchRequest);
  const matchStatus = useStore((s) => s.matchStatus);
  const requestMatch = useStore((s) => s.requestMatch);
  const clearPendingMatchBoxes = useStore((s) => s.clearPendingMatchBoxes);
  const [matchTag, setMatchTag] = useState('');
  const [threshold, setThreshold] = useState(0.8);

  function run() {
    const tag = matchTag.trim().toUpperCase();
    if (!tag) return;
    requestMatch(tag, threshold);
    setMatchTag('');
  }

  if (boxCount === 0 && !matchStatus && !matchRequest) return null;
  return (
    <div style={{ margin: '6px 0' }}>
      {boxCount > 0 && (
        <>
          <div className="note">
            {boxCount} example{boxCount > 1 ? 's' : ''} boxed — box more on the plan, or name
            the type and search:
          </div>
          <div className="row">
            <input
              type="text"
              style={{ width: 90 }}
              placeholder="Type (e.g. F1)"
              value={matchTag}
              autoFocus
              onChange={(e) => setMatchTag(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && run()}
            />
            <select
              value={threshold}
              title="Match strictness — loosen for faint scans, tighten if it over-matches"
              onChange={(e) => setThreshold(Number(e.target.value))}
            >
              <option value={0.7}>Loose</option>
              <option value={0.8}>Normal</option>
              <option value={0.9}>Strict</option>
            </select>
            <button className="primary" disabled={!matchTag.trim()} onClick={run}>
              Find matches
            </button>
            <button
              onClick={() => {
                clearPendingMatchBoxes();
                setMatchTag('');
              }}
            >
              Cancel
            </button>
          </div>
        </>
      )}
      {matchStatus && <div className="note">{matchStatus}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ResultsSection() {
  const page = usePageState();
  const fileName = useStore((s) => s.fileName);
  const pageLabels = useStore((s) => s.pageLabels);
  const currentPage = useStore((s) => s.currentPage);
  const renameArea = useStore((s) => s.renameArea);
  const deleteArea = useStore((s) => s.deleteArea);

  const results = useMemo(() => computeResults(page), [page]);
  const tags = page.enabledTags;

  const canExport = results.length > 0 && page.scale !== null;

  return (
    <section>
      <h3>3 · Areas &amp; counts</h3>
      {results.length === 0 ? (
        <p className="note">Use the Draw Area tool to outline a space on the plan.</p>
      ) : (
        <table className="results-table">
          <thead>
            <tr>
              <th>Area</th>
              <th>SF</th>
              {tags.map((t) => (
                <th key={t}>{t}</th>
              ))}
              <th>Σ</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.areaId}>
                <td>
                  <input
                    value={r.name}
                    onChange={(e) => renameArea(r.areaId, e.target.value)}
                  />
                </td>
                <td>{Number.isNaN(r.squareFeet) ? '—' : Math.round(r.squareFeet).toLocaleString()}</td>
                {tags.map((t) => (
                  <td key={t}>{r.counts[t] ?? 0}</td>
                ))}
                <td>{r.totalFixtures}</td>
                <td>
                  <button
                    className="del"
                    title="Delete area"
                    onClick={() => deleteArea(r.areaId)}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          {results.length > 1 && (
            <tfoot>
              <tr>
                <td>Total</td>
                <td>
                  {Math.round(
                    results.reduce((s, r) => s + (Number.isNaN(r.squareFeet) ? 0 : r.squareFeet), 0),
                  ).toLocaleString()}
                </td>
                {tags.map((t) => (
                  <td key={t}>{results.reduce((s, r) => s + (r.counts[t] ?? 0), 0)}</td>
                ))}
                <td>{results.reduce((s, r) => s + r.totalFixtures, 0)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <button
          className="primary"
          disabled={!canExport}
          title={canExport ? 'Download .xlsx' : 'Draw at least one area and set the scale first'}
          onClick={() =>
            downloadXlsx(results, tags, {
              fileName: fileName ?? 'drawing.pdf',
              pageLabel: pageLabels[currentPage - 1] ?? `Page ${currentPage}`,
              scaleLabel: page.scale?.label ?? 'not set',
              exportedAt: new Date(),
            })
          }
        >
          Export to Excel
        </button>
      </div>
    </section>
  );
}
