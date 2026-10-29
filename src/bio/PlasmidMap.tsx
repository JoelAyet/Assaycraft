import { useMemo } from 'react';
import { featureColor, spanLength, type SeqFeature, type SeqRecord } from './types';

interface Props {
  record: SeqRecord;
  highlight: number | null;
  onHover: (index: number | null) => void;
  onSelect?: (index: number) => void;
}

const TAU = Math.PI * 2;

function niceStep(length: number, target = 8): number {
  const raw = length / target;
  const pow = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
}

function fmtBp(n: number): string {
  if (n >= 10000) return `${Math.round(n / 1000)} kb`;
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)} kb`;
  return `${n}`;
}

/** Assign features to lanes so overlapping features do not collide. */
function assignLanes(features: SeqFeature[], length: number, circular: boolean): number[] {
  const order = features.map((f, i) => ({ i, len: spanLength(f.start, f.end, length) })).sort((a, b) => b.len - a.len);
  const lanes: [number, number][][] = [];
  const result = new Array<number>(features.length).fill(0);
  const intervals = (f: SeqFeature): [number, number][] =>
    f.end > f.start || !circular
      ? [[f.start, Math.max(f.end, f.start + 1)]]
      : [
          [f.start, length],
          [0, f.end],
        ];
  for (const { i } of order) {
    const iv = intervals(features[i]);
    let lane = 0;
    for (; lane < lanes.length; lane++) {
      const taken = lanes[lane];
      if (!iv.some(([a, b]) => taken.some(([c, d]) => a < d && c < b))) break;
    }
    lanes[lane] ??= [];
    lanes[lane].push(...iv);
    result[i] = lane;
  }
  return result;
}

function polar(r: number, a: number): [number, number] {
  return [200 + r * Math.cos(a), 200 + r * Math.sin(a)];
}

/** Annular sector from angle a1 to a2 (clockwise), optionally with an arrow tip. */
function sector(a1: number, a2: number, rIn: number, rOut: number, strand: number, arrow: boolean): string {
  const span = a2 - a1;
  if (span >= TAU - 1e-6) {
    // full circle: two halves
    return sector(a1, a1 + Math.PI, rIn, rOut, 0, false) + ' ' + sector(a1 + Math.PI, a1 + TAU - 1e-4, rIn, rOut, arrow ? strand : 0, arrow);
  }
  const mid = (rIn + rOut) / 2;
  const tip = arrow && strand !== 0 ? Math.min(span * 0.45, 9 / mid) : 0;
  const large = (x: number) => (x > Math.PI ? 1 : 0);
  const p = (r: number, a: number) =>
    polar(r, a)
      .map((v) => v.toFixed(2))
      .join(' ');
  if (strand === 1 && tip) {
    const b = a2 - tip;
    return `M ${p(rOut, a1)} A ${rOut} ${rOut} 0 ${large(b - a1)} 1 ${p(rOut, b)} L ${p(mid, a2)} L ${p(rIn, b)} A ${rIn} ${rIn} 0 ${large(b - a1)} 0 ${p(rIn, a1)} Z`;
  }
  if (strand === -1 && tip) {
    const b = a1 + tip;
    return `M ${p(mid, a1)} L ${p(rOut, b)} A ${rOut} ${rOut} 0 ${large(a2 - b)} 1 ${p(rOut, a2)} L ${p(rIn, a2)} A ${rIn} ${rIn} 0 ${large(a2 - b)} 0 ${p(rIn, b)} Z`;
  }
  return `M ${p(rOut, a1)} A ${rOut} ${rOut} 0 ${large(span)} 1 ${p(rOut, a2)} L ${p(rIn, a2)} A ${rIn} ${rIn} 0 ${large(span)} 0 ${p(rIn, a1)} Z`;
}

function CircularMap({ record, highlight, onHover, onSelect }: Props) {
  const { length, features } = record;
  const R = 128;
  const W = 14;
  const GAP = 4;
  const lanes = useMemo(() => assignLanes(features, length, true), [features, length]);
  const maxLane = Math.max(0, ...lanes);
  const laneR = (l: number) => R - l * (W + GAP);
  const ang = (bp: number) => (bp / length) * TAU - Math.PI / 2;
  const step = niceStep(length);

  const labels = useMemo(() => {
    const raw = features.map((f, i) => {
      const s = f.start;
      const len = spanLength(f.start, f.end, length);
      const a = ang(s + len / 2);
      return { i, a, name: f.name, len };
    });
    // Skip labels for features smaller than a sliver when there are many features
    const shown = raw
      .filter((l) => raw.length < 25 || l.len / length > 0.004)
      .sort((x, y) => y.len - x.len)
      .slice(0, 28);
    const placed: { i: number; a: number; name: string; x: number; y: number; ax: number; ay: number; right: boolean }[] = [];
    for (const side of [true, false]) {
      const items = shown
        .filter((l) => Math.cos(l.a) >= 0 === side)
        .map((l) => {
          const [ax, ay] = polar(R + 4, l.a);
          const [x, y] = polar(R + 34, l.a);
          return { ...l, x, y, ax, ay, right: side };
        })
        .sort((p, q) => p.y - q.y);
      const minGap = 12.5;
      for (let k = 1; k < items.length; k++) if (items[k].y - items[k - 1].y < minGap) items[k].y = items[k - 1].y + minGap;
      for (let k = items.length - 2; k >= 0; k--)
        if (items[k + 1].y > 392 && items[k + 1].y - items[k].y < minGap) items[k].y = items[k + 1].y - minGap;
      for (const it of items) {
        it.y = Math.max(10, Math.min(392, it.y));
        it.x = side ? Math.max(it.x, 200 + 40) : Math.min(it.x, 200 - 40);
        placed.push(it);
      }
    }
    return placed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [features, length]);

  const ticks: number[] = [];
  for (let t = 0; t < length; t += step) ticks.push(t);

  return (
    <svg viewBox="-40 -6 480 412" className="gc-map" role="img" aria-label={`Map of ${record.name}`}>
      <circle cx={200} cy={200} r={R + W / 2 + 2} fill="none" stroke="var(--map-backbone)" strokeWidth={1.4} />
      <circle cx={200} cy={200} r={R + W / 2 + 5} fill="none" stroke="var(--map-backbone)" strokeWidth={1.4} />
      {ticks.map((t) => {
        const a = ang(t);
        const [x1, y1] = polar(R + W / 2 + 5, a);
        const [x2, y2] = polar(R + W / 2 + 10, a);
        const [tx, ty] = polar(R - (maxLane + 1) * (W + GAP) - 6, a);
        return (
          <g key={t}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--map-backbone)" strokeWidth={1} />
            {(maxLane + 1) * (W + GAP) < R - 40 && (
              <text x={tx} y={ty} className="gc-map-tick" textAnchor="middle" dominantBaseline="middle">
                {t === 0 ? '' : fmtBp(t)}
              </text>
            )}
          </g>
        );
      })}
      {features.map((f, i) => {
        const r = laneR(lanes[i]);
        const color = featureColor(f);
        const segs = f.segments.length ? f.segments : [{ start: f.start, end: f.end }];
        const paths = segs.map((sg, k) => {
          const a1 = ang(sg.start);
          let a2 = ang(sg.end);
          if (sg.end <= sg.start) a2 += TAU;
          if (a2 - a1 < 0.004) a2 = a1 + 0.004;
          const isLast = f.strand === -1 ? k === 0 : k === segs.length - 1;
          return sector(a1, a2, r - W / 2, r + W / 2, f.strand, isLast);
        });
        return (
          <g
            key={i}
            className={`gc-map-feature ${highlight === i ? 'is-hl' : ''}`}
            onMouseEnter={() => onHover(i)}
            onMouseLeave={() => onHover(null)}
            onClick={() => onSelect?.(i)}
          >
            <title>{`${f.name} (${f.type}) ${f.start + 1}..${f.end}`}</title>
            <path d={paths.join(' ')} fill={color} stroke="var(--map-stroke)" strokeWidth={0.8} />
          </g>
        );
      })}
      {labels.map((l) => (
        <g
          key={l.i}
          className={`gc-map-label ${highlight === l.i ? 'is-hl' : ''}`}
          onMouseEnter={() => onHover(l.i)}
          onMouseLeave={() => onHover(null)}
        >
          <polyline points={`${l.ax},${l.ay} ${l.x + (l.right ? -4 : 4)},${l.y}`} fill="none" stroke="var(--map-leader)" strokeWidth={0.8} />
          <text x={l.x} y={l.y} textAnchor={l.right ? 'start' : 'end'} dominantBaseline="middle">
            {l.name.length > 22 ? l.name.slice(0, 21) + '…' : l.name}
          </text>
        </g>
      ))}
      <text x={200} y={192} textAnchor="middle" className="gc-map-title">
        {record.name.length > 22 ? record.name.slice(0, 21) + '…' : record.name}
      </text>
      <text x={200} y={212} textAnchor="middle" className="gc-map-sub">
        {length.toLocaleString('en-US')} bp
      </text>
    </svg>
  );
}

function LinearMap({ record, highlight, onHover, onSelect }: Props) {
  const { length, features } = record;
  const lanes = useMemo(() => assignLanes(features, length, false), [features, length]);
  const maxLane = Math.max(0, ...lanes);
  const Wd = 760;
  const x0 = 16;
  const x1 = Wd - 16;
  const scale = (bp: number) => x0 + (bp / Math.max(1, length)) * (x1 - x0);
  const laneH = 26;
  const top = 34;
  const height = top + 18 + (maxLane + 1) * laneH + 10;
  const step = niceStep(length, 10);
  const ticks: number[] = [];
  for (let t = 0; t <= length; t += step) ticks.push(t);
  return (
    <svg viewBox={`0 0 ${Wd} ${height}`} className="gc-map gc-map-linear" role="img" aria-label={`Map of ${record.name}`}>
      <line x1={x0} y1={top} x2={x1} y2={top} stroke="var(--map-backbone)" strokeWidth={2} />
      {ticks.map((t) => (
        <g key={t}>
          <line x1={scale(t)} y1={top - 4} x2={scale(t)} y2={top + 4} stroke="var(--map-backbone)" />
          <text x={scale(t)} y={top - 9} textAnchor="middle" className="gc-map-tick">
            {fmtBp(t)}
          </text>
        </g>
      ))}
      {features.map((f, i) => {
        const y = top + 14 + lanes[i] * laneH;
        const xa = scale(Math.min(f.start, f.end));
        const xb = Math.max(xa + 2, scale(Math.max(f.start, f.end)));
        const h = 12;
        const tip = f.strand !== 0 ? Math.min(8, (xb - xa) * 0.4) : 0;
        const d =
          f.strand === 1
            ? `M ${xa} ${y} L ${xb - tip} ${y} L ${xb} ${y + h / 2} L ${xb - tip} ${y + h} L ${xa} ${y + h} Z`
            : f.strand === -1
              ? `M ${xa} ${y + h / 2} L ${xa + tip} ${y} L ${xb} ${y} L ${xb} ${y + h} L ${xa + tip} ${y + h} Z`
              : `M ${xa} ${y} L ${xb} ${y} L ${xb} ${y + h} L ${xa} ${y + h} Z`;
        const label = f.name.length * 6 < xb - xa + 40 ? f.name : '';
        return (
          <g
            key={i}
            className={`gc-map-feature ${highlight === i ? 'is-hl' : ''}`}
            onMouseEnter={() => onHover(i)}
            onMouseLeave={() => onHover(null)}
            onClick={() => onSelect?.(i)}
          >
            <title>{`${f.name} (${f.type}) ${f.start + 1}..${f.end}`}</title>
            <path d={d} fill={featureColor(f)} stroke="var(--map-stroke)" strokeWidth={0.8} />
            {label && (
              <text x={(xa + xb) / 2} y={y + h + 10} textAnchor="middle" className="gc-map-flabel">
                {label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function PlasmidMap(props: Props) {
  return props.record.circular ? <CircularMap {...props} /> : <LinearMap {...props} />;
}
