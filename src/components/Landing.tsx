import { useRef, useState, type DragEvent } from 'react';

interface Props {
  onFile: (f: File) => void;
  error: string | null;
}

export default function Landing({ onFile, error }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.toLowerCase().endsWith('.pdf')) onFile(file);
  }

  return (
    <div className="landing">
      <div
        className={`drop-zone${drag ? ' drag' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
      >
        <h1>Lighting Takeoff</h1>
        <p>
          Count lighting fixtures per area on electrical drawings. Drop a PDF drawing set
          here, or
        </p>
        <button className="primary" onClick={() => inputRef.current?.click()}>
          Choose a PDF…
        </button>
        <p className="note" style={{ color: '#7a8399', fontSize: 12, marginTop: 16 }}>
          Everything runs in your browser — the drawing is never uploaded anywhere.
        </p>
        {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
