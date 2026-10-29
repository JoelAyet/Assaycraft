/**
 * Notes drawn on an image (a gel's lanes, a band, a colony): lines, arrows, boxes and text, kept
 * beside the image in the page (<!-- gc:image {"marks":[…]} -->) so the photo itself is never changed.
 * Positions are fractions of the image's width and height, so they fit at any size.
 */
import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowUpRight, Check, Minus, MousePointer2, Square, Trash2, Type, Undo2 } from 'lucide-react';
import { ANNOTATION_COLORS, type Annotation, type AnnotationColor, type AnnotationKind } from './annotations';

export { normalizeAnnotations, type Annotation } from './annotations';

const HEX: Record<AnnotationColor, string> = {
  red: '#e5484d',
  yellow: '#ffd43b',
  green: '#2fb36b',
  blue: '#2f74f0',
  white: '#ffffff',
  black: '#111111',
};
/** A halo of the opposite tone keeps text readable on dark gels and light blots alike. */
const HALO: Record<AnnotationColor, string> = {
  red: '#ffffff',
  yellow: '#111111',
  green: '#111111',
  blue: '#ffffff',
  white: '#111111',
  black: '#ffffff',
};

const W = 1000;
const STROKE = 5;
const FONT = 34;
const round = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000;

function Mark({ m, h, arrowId, selected, onPick }: { m: Annotation; h: number; arrowId: string; selected?: boolean; onPick?: () => void }) {
  const p = m.a.map((v, i) => v * (i % 2 ? h : W));
  const common = {
    className: `gc-ann-mark ${selected ? 'is-selected' : ''} ${onPick ? 'is-pickable' : ''}`,
    onPointerDown: onPick
      ? (e: ReactPointerEvent) => {
          e.preventDefault();
          e.stopPropagation();
          onPick();
        }
      : undefined,
  };
  if (m.t === 'text')
    return (
      <text
        {...common}
        x={p[0]}
        y={p[1]}
        fill={HEX[m.c]}
        stroke={HALO[m.c]}
        strokeWidth={6}
        paintOrder="stroke"
        fontSize={FONT}
        fontWeight={650}
        fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
      >
        {m.s}
      </text>
    );
  if (m.t === 'box')
    return (
      <rect
        {...common}
        x={Math.min(p[0], p[2])}
        y={Math.min(p[1], p[3])}
        width={Math.abs(p[2] - p[0])}
        height={Math.abs(p[3] - p[1])}
        fill="none"
        stroke={HEX[m.c]}
        strokeWidth={STROKE}
      />
    );
  return (
    <line
      {...common}
      x1={p[0]}
      y1={p[1]}
      x2={p[2]}
      y2={p[3]}
      stroke={HEX[m.c]}
      strokeWidth={STROKE}
      strokeLinecap="round"
      markerEnd={m.t === 'arrow' ? `url(#${arrowId}-${m.c})` : undefined}
    />
  );
}

function Arrowheads({ id }: { id: string }) {
  return (
    <defs>
      {ANNOTATION_COLORS.map((c) => (
        <marker key={c} id={`${id}-${c}`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill={HEX[c]} />
        </marker>
      ))}
    </defs>
  );
}

/** The marks over an image (read-only). `aspect` is the image's width / height. */
export function AnnotationLayer({ marks, aspect }: { marks: Annotation[]; aspect: number }) {
  const id = useId().replace(/:/g, '');
  if (!marks.length || !aspect) return null;
  const h = W / aspect;
  return (
    <svg className="gc-ann-layer" viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none" role="img" aria-label={describe(marks)}>
      <Arrowheads id={id} />
      {marks.map((m, i) => (
        <Mark key={i} m={m} h={h} arrowId={id} />
      ))}
    </svg>
  );
}

/** What a screen reader hears: the text notes on the image. */
function describe(marks: Annotation[]): string {
  const words = marks.filter((m) => m.t === 'text').map((m) => m.s);
  const shapes = marks.length - words.length;
  return ['Notes on the image', words.length ? `: ${words.join(', ')}` : '', shapes ? ` (${shapes} ${shapes === 1 ? 'mark' : 'marks'})` : ''].join(
    '',
  );
}

type Tool = 'select' | AnnotationKind;
const TOOLS: { id: Tool; label: string; icon: React.ReactNode }[] = [
  { id: 'select', label: 'Select (then Delete)', icon: <MousePointer2 /> },
  { id: 'line', label: 'Line', icon: <Minus /> },
  { id: 'arrow', label: 'Arrow', icon: <ArrowUpRight /> },
  { id: 'box', label: 'Box', icon: <Square /> },
  { id: 'text', label: 'Text', icon: <Type /> },
];

/** Drawing on an image: pick a tool and a color, drag on the image (or click, for text), Done to finish. */
export function AnnotationEditor({
  marks,
  aspect,
  onChange,
  onDone,
}: {
  marks: Annotation[];
  aspect: number;
  onChange: (marks: Annotation[]) => void;
  onDone: () => void;
}) {
  const id = useId().replace(/:/g, '');
  const svgRef = useRef<SVGSVGElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<Tool>('arrow');
  const [color, setColor] = useState<AnnotationColor>('red');
  const [draft, setDraft] = useState<Annotation | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [typing, setTyping] = useState<{ x: number; y: number; text: string } | null>(null);
  const [history, setHistory] = useState<Annotation[][]>([]);
  const h = W / (aspect || 1);

  const commit = (next: Annotation[]) => {
    setHistory((hs) => [...hs.slice(-30), marks]);
    onChange(next);
  };
  const removePicked = () => {
    if (picked === null) return;
    commit(marks.filter((_, i) => i !== picked));
    setPicked(null);
  };
  // The tools sit under the image: bring them into view with it.
  useEffect(() => toolsRef.current?.scrollIntoView({ block: 'nearest' }), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && picked !== null) {
        e.preventDefault();
        removePicked();
      }
      if (e.key === 'Escape') onDone();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const at = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: round((e.clientX - r.left) / r.width), y: round((e.clientY - r.top) / r.height) };
  };
  const down = (e: ReactPointerEvent<SVGSVGElement>) => {
    // Keep the editor from dragging the image block around.
    e.preventDefault();
    e.stopPropagation();
    const p = at(e);
    if (tool === 'select') return setPicked(null);
    if (tool === 'text') return setTyping({ x: p.x, y: p.y, text: '' });
    svgRef.current!.setPointerCapture(e.pointerId);
    setDraft({ t: tool, a: [p.x, p.y, p.x, p.y], c: color });
  };
  const move = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!draft) return;
    const p = at(e);
    setDraft({ ...draft, a: [draft.a[0], draft.a[1], p.x, p.y] });
  };
  const up = () => {
    if (!draft) return;
    const [x1, y1, x2, y2] = draft.a;
    // A click without a drag draws nothing.
    if (Math.hypot(x2 - x1, (y2 - y1) / (aspect || 1)) > 0.01) commit([...marks, draft]);
    setDraft(null);
  };
  const finishText = () => {
    if (typing?.text.trim()) commit([...marks, { t: 'text', a: [typing.x, typing.y], c: color, s: typing.text.trim() }]);
    setTyping(null);
  };

  return (
    <>
      <svg
        ref={svgRef}
        className={`gc-ann-layer is-editing tool-${tool}`}
        viewBox={`0 0 ${W} ${h}`}
        preserveAspectRatio="none"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Arrowheads id={id} />
        {marks.map((m, i) => (
          <Mark key={i} m={m} h={h} arrowId={id} selected={picked === i} onPick={tool === 'select' ? () => setPicked(i) : undefined} />
        ))}
        {draft && <Mark m={draft} h={h} arrowId={id} />}
      </svg>
      {typing && (
        <input
          className="gc-ann-text-input"
          style={{ left: `${typing.x * 100}%`, top: `${typing.y * 100}%` }}
          autoFocus
          aria-label="Text on the image"
          placeholder="Text, then Enter"
          value={typing.text}
          onChange={(e) => setTyping({ ...typing, text: e.target.value })}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') finishText();
            if (e.key === 'Escape') setTyping(null);
          }}
          onBlur={finishText}
          onMouseDown={(e) => e.stopPropagation()}
        />
      )}
      <div ref={toolsRef} className="gc-ann-tools" contentEditable={false} role="toolbar" aria-label="Draw on the image">
        <div className="gc-segmented gc-segmented-sm" role="group" aria-label="Tool">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className={tool === t.id ? 'active' : ''}
              aria-pressed={tool === t.id}
              aria-label={t.label}
              title={t.label}
              onClick={() => setTool(t.id)}
            >
              {t.icon}
            </button>
          ))}
        </div>
        <div className="gc-ann-colors" role="group" aria-label="Color">
          {ANNOTATION_COLORS.map((c) => (
            <button
              key={c}
              className={`gc-ann-color ${color === c ? 'active' : ''}`}
              style={{ background: HEX[c] }}
              aria-label={`Color ${c}`}
              aria-pressed={color === c}
              title={c}
              onClick={() => {
                setColor(c);
                // Recolor the selected mark too.
                if (picked !== null) commit(marks.map((m, i) => (i === picked ? { ...m, c } : m)));
              }}
            />
          ))}
        </div>
        <button
          className="icon-btn"
          title="Delete the selected mark"
          aria-label="Delete the selected mark"
          disabled={picked === null}
          onClick={removePicked}
        >
          <Trash2 />
        </button>
        <button
          className="icon-btn"
          title="Undo"
          aria-label="Undo"
          disabled={!history.length}
          onClick={() => {
            const prev = history[history.length - 1];
            setHistory((hs) => hs.slice(0, -1));
            setPicked(null);
            onChange(prev);
          }}
        >
          <Undo2 />
        </button>
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={onDone}>
          <Check /> Done
        </button>
      </div>
    </>
  );
}
