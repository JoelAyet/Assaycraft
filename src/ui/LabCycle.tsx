import { useEffect, useRef } from 'react';
import logoGif from '../assets/lab-cycle-logo.gif';

/**
 * The welcome page's picture: the lab cycle, drawn like the Krebs cycle. Six steps (idea, protocol,
 * experiment, document, analysis, result) are its intermediates, each drawn as a molecule a lab knows
 * (unexplained, on purpose); the app's tools are the enzymes on the arrows, and Assaycraft itself, the
 * animated logo, is the one that turns an experiment into a document. A molecule travels round; the
 * drawing leans toward the pointer and can be turned by dragging, springing back when let go.
 */
export function LabCycle() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => (ref.current ? mountCycle(ref.current) : undefined), []);
  return (
    <div
      ref={ref}
      className="gc-cycle"
      role="img"
      aria-label="The lab cycle, drawn like the Krebs cycle: idea, protocol, experiment, document, analysis and result, with Assaycraft as the enzyme that turns an experiment into a document."
    >
      <div className="gc-cycle-tilt">
        <svg className="gc-cycle-svg" viewBox="0 0 480 450" aria-hidden="true" />
        <div className="gc-cycle-center" aria-hidden="true">
          <div className="gc-cycle-center-text">
            <b>The lab cycle</b>
          </div>
        </div>
      </div>
    </div>
  );
}

type Atom = [x: number, y: number, label?: string, anchor?: 's' | 'e' | 'm'];
type Bond = [from: number, to: number, order?: number, ringX?: number, ringY?: number];

// Skeletal formulas, bond length 1, y down. A label's anchor says where its heteroatom is: 's' first
// (OH), 'e' last (HO), 'm' alone (O, N). A ring's centre puts a double bond's second line inside it.
const C = Math.cos(Math.PI / 6);
// prettier-ignore
const MOLECULES: Record<string, { atoms: Atom[]; bonds: Bond[] }> = {
  caffeine: {
    atoms: [
      [0, -1], [C, -0.5], [C, 0.5], [0, 1, 'N', 'm'], [-C, 0.5], [-C, -0.5, 'N', 'm'], [0, -2, 'O', 'm'], [-2 * C, 1, 'O', 'm'],
      [-2 * C, -1], [0, 2], [1.817, -0.809, 'N', 'm'], [2.405, 0], [1.817, 0.809, 'N', 'm'], [2.126, -1.76],
    ],
    bonds: [
      [0, 1], [1, 2, 2, 1.554, 0], [2, 3], [3, 4], [4, 5], [5, 0], [0, 6, 2], [4, 7, 2], [5, 8], [3, 9], [1, 10], [10, 11],
      [11, 12, 2, 1.554, 0], [12, 2], [10, 13],
    ],
  },
  tris: {
    atoms: [[0, 0], [0, -1, 'NH₂', 's'], [1, 0], [1.5, 0.866, 'OH', 's'], [0, 1], [-0.866, 1.5, 'HO', 'e'], [-1, 0], [-1.5, -0.866, 'HO', 'e']],
    bonds: [[0, 1], [0, 2], [2, 3], [0, 4], [4, 5], [0, 6], [6, 7]],
  },
  mercaptoethanol: {
    atoms: [[0, 0, 'HS', 'e'], [C, -0.5], [2 * C, 0], [3 * C, -0.5, 'OH', 's']],
    bonds: [[0, 1], [1, 2], [2, 3]],
  },
  glucose: {
    atoms: [
      [C, -0.5, 'O', 'm'], [C, 0.5], [0, 1], [-C, 0.5], [-C, -0.5], [0, -1], [2 * C, 1, 'OH', 's'], [0, 2, 'OH', 'm'],
      [-2 * C, 1, 'HO', 'e'], [-2 * C, -1, 'HO', 'e'], [0, -2], [C, -2.5, 'OH', 's'],
    ],
    bonds: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [1, 6], [2, 7], [3, 8], [4, 9], [5, 10], [10, 11]],
  },
  acrylamide: {
    atoms: [[0, 0], [C, -0.5], [2 * C, 0], [2 * C, 1, 'O', 'm'], [3 * C, -0.5, 'NH₂', 's']],
    bonds: [[0, 1, 2], [1, 2], [2, 3, 2], [2, 4]],
  },
  glycerol: {
    atoms: [[0, 0, 'HO', 'e'], [C, -0.5], [2 * C, 0], [2 * C, 1, 'OH', 'm'], [3 * C, -0.5], [4 * C, 0, 'OH', 's']],
    bonds: [[0, 1], [1, 2], [2, 3], [2, 4], [4, 5]],
  },
};

const STEPS = [
  { name: 'Idea', at: -120, about: 'Questions and hunches, kept in Notes.', molecule: 'caffeine' },
  { name: 'Protocol', at: -60, about: 'Protocols and templates, ready to use again.', molecule: 'tris' },
  { name: 'Experiment', at: 0, about: 'At the bench: plate layouts, buffers, your phone.', molecule: 'mercaptoethanol' },
  { name: 'Document', at: 60, about: 'Every step written down, as plain Markdown files.', molecule: 'glucose' },
  { name: 'Analysis', at: 120, about: 'Tables with formulas, right in the entry.', molecule: 'acrylamide' },
  { name: 'Result', at: 180, about: 'Figures, papers, and the next question.', molecule: 'glycerol' },
];
// On the arrow from step i to the next: an enzyme (one of the app's tools), and what goes in or out, as NAD⁺ does.
const ARROWS: { enzyme?: string; badge?: boolean; side?: { out: boolean; label: string[] } }[] = [
  { enzyme: 'Templates', side: { out: false, label: ['literature'] } },
  { enzyme: 'Plates · buffers', side: { out: false, label: ['samples,', 'reagents'] } },
  { badge: true },
  { enzyme: 'Tables' },
  { side: { out: true, label: ['figures'] } },
  { enzyme: 'Notes', side: { out: true, label: ['paper'] } },
];
const ENZYME = { name: 'Assaycraft', about: 'The enzyme that turns an experiment into a document.' };

const NS = 'http://www.w3.org/2000/svg';
const CX = 236,
  CY = 222,
  R = 140;
const BOND = 11;
const HALF = 3.4; // half a heteroatom's width at the atom label size
const LAP = 14; // seconds for the travelling molecule to go round
let instances = 0;

const rad = (d: number) => (d * Math.PI) / 180;
const f = (n: number) => n.toFixed(1);
/** An angle, in degrees, brought into -180…180. */
const norm = (d: number) => (((d % 360) + 540) % 360) - 180;
const P = (deg: number, r = R) => ({ x: CX + Math.cos(rad(deg)) * r, y: CY + Math.sin(rad(deg)) * r });
const anchorFor = (deg: number) => {
  const c = Math.cos(rad(deg));
  return c > 0.35 ? 'start' : c < -0.35 ? 'end' : 'middle';
};
const arcPath = (a: number, b: number, r = R) => {
  const p = P(a, r),
    q = P(b, r);
  return `M${f(p.x)} ${f(p.y)} A${r} ${r} 0 0 1 ${f(q.x)} ${f(q.y)}`;
};

/** Draws the cycle into the element's SVG and animates it; returns what stops it. */
function mountCycle(art: HTMLElement): () => void {
  const svg = art.querySelector('svg')!;
  const tilt = art.querySelector<HTMLElement>('.gc-cycle-tilt')!;
  const centerText = art.querySelector<HTMLElement>('.gc-cycle-center-text')!;
  const id = `gc-cycle-${++instances}`;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const el = (name: string, attrs: Record<string, string | number> = {}, parent: Element = svg) => {
    const e = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    parent.appendChild(e);
    return e;
  };

  /** A molecule centred on (0, 0) of a new group, and how far it reaches. */
  const molecule = (name: string, parent: Element) => {
    const m = MOLECULES[name];
    const pts = m.atoms.map(([x, y]) => [x * BOND, y * BOND]);
    const labelWidth = (s: string) => [...s].reduce((w, ch) => w + (ch === '₂' ? 4.2 : 6.6), 0);
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity;
    m.atoms.forEach(([, , label, anchor], i) => {
      const [x, y] = pts[i];
      let a = x,
        b = x;
      if (label) {
        const w = labelWidth(label);
        [a, b] = anchor === 's' ? [x - HALF, x - HALF + w] : anchor === 'e' ? [x + HALF - w, x + HALF] : [x - w / 2, x + w / 2];
      }
      x0 = Math.min(x0, a);
      x1 = Math.max(x1, b);
      y0 = Math.min(y0, y - (label ? 5.5 : 0));
      y1 = Math.max(y1, y + (label ? 5.5 : 0));
    });
    const g = el('g', { class: 'gc-cycle-molecule' }, parent);
    const inner = el('g', { transform: `translate(${f(-(x0 + x1) / 2)} ${f(-(y0 + y1) / 2)})` }, g);
    // Bonds stop short of a labelled atom.
    const trim = (i: number) => (m.atoms[i][2] ? (m.atoms[i][2]!.length > 1 ? 5.6 : 5.2) : 0);
    const line = (ax: number, ay: number, bx: number, by: number) =>
      el('line', { class: 'gc-cycle-bond', x1: f(ax), y1: f(ay), x2: f(bx), y2: f(by) }, inner);
    for (const [i, j, order = 1, rx, ry] of m.bonds) {
      let [ax, ay] = pts[i],
        [bx, by] = pts[j];
      const len = Math.hypot(bx - ax, by - ay),
        ux = (bx - ax) / len,
        uy = (by - ay) / len;
      ax += ux * trim(i);
      ay += uy * trim(i);
      bx -= ux * trim(j);
      by -= uy * trim(j);
      let nx = -uy,
        ny = ux;
      if (order === 1) line(ax, ay, bx, by);
      else if (rx === undefined || ry === undefined) {
        // A double bond off a chain: two lines side by side.
        line(ax + nx * 1.6, ay + ny * 1.6, bx + nx * 1.6, by + ny * 1.6);
        line(ax - nx * 1.6, ay - ny * 1.6, bx - nx * 1.6, by - ny * 1.6);
      } else {
        // In a ring: the second line inside it, a little shorter.
        if ((rx * BOND - (ax + bx) / 2) * nx + (ry * BOND - (ay + by) / 2) * ny < 0) [nx, ny] = [-nx, -ny];
        line(ax, ay, bx, by);
        const k = 0.2 * len;
        line(ax + ux * k + nx * 3.1, ay + uy * k + ny * 3.1, bx - ux * k + nx * 3.1, by - uy * k + ny * 3.1);
      }
    }
    m.atoms.forEach(([, , label, anchor], i) => {
      if (!label) return;
      const [x, y] = pts[i];
      const t = el(
        'text',
        {
          class: 'gc-cycle-atom',
          x: f(anchor === 's' ? x - HALF : anchor === 'e' ? x + HALF : x),
          y: f(y + 3.7),
          'text-anchor': anchor === 's' ? 'start' : anchor === 'e' ? 'end' : 'middle',
        },
        inner,
      );
      t.textContent = label;
    });
    return { g, r: Math.max(x1 - x0, y1 - y0) / 2 };
  };

  // ── The drawing ──
  const defs = el('defs');
  for (const [name, size] of [
    ['head', 7],
    ['head-small', 6],
  ] as const) {
    const marker = el(
      'marker',
      { id: `${id}-${name}`, viewBox: '0 0 10 10', refX: 7, refY: 5, markerWidth: size, markerHeight: size, orient: 'auto-start-reverse' },
      defs,
    );
    el('path', { d: 'M1 1 L8 5 L1 9 Z', class: 'gc-cycle-head' }, marker);
  }
  const arcs = ARROWS.map(() => ({
    base: el('path', { class: 'gc-cycle-arc', 'marker-end': `url(#${id}-head)` }),
    flux: el('path', { class: 'gc-cycle-flux' }),
  }));
  const sides = ARROWS.map(
    (a) =>
      a.side && {
        path: el('path', { class: 'gc-cycle-side', 'marker-end': `url(#${id}-head-small)` }),
        text: el('text', { class: 'gc-cycle-cofactor' }),
      },
  );
  // Enzyme names follow their arrow just inside the circle, so they never reach the middle.
  const enzymes = ARROWS.map((a, i) => {
    if (!a.enzyme) return null;
    const path = el('path', { id: `${id}-enzyme-${i}` }, defs);
    const text = el('text', { class: 'gc-cycle-enzyme' });
    el('textPath', { href: `#${id}-enzyme-${i}`, startOffset: '50%', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, text).textContent =
      a.enzyme;
    return path;
  });
  const nodes = STEPS.map((step) => {
    const g = el('g', { class: 'gc-cycle-node' });
    const mol = molecule(step.molecule, g);
    const label = el('text', { class: 'gc-cycle-label' });
    label.textContent = step.name;
    const hit = el('circle', { class: 'gc-cycle-hit', r: f(mol.r + 5) });
    return { g, mol, label, hit, step };
  });
  const token = el('g', { class: 'gc-cycle-token' });
  const trail = [0.25, 0.45, 0.7].map((o, i) => el('circle', { r: 2 + i * 0.7, opacity: o }, token));
  const tokenHead = el('circle', { r: 4.6 }, token);
  const badge = el('g', { class: 'gc-cycle-badge' });
  const badgeRing = el('circle', { class: 'gc-cycle-badge-ring', r: 33 }, badge);
  el('circle', { class: 'gc-cycle-badge-disc', r: 29 }, badge);
  const clip = el('clipPath', { id: `${id}-disc` }, defs);
  el('circle', { r: 28 }, clip);
  el('image', { href: logoGif, width: 46, height: 46, x: -23, y: -23, 'clip-path': `url(#${id}-disc)` }, badge);
  const badgeLabel = el('text', { class: 'gc-cycle-badge-label' });
  badgeLabel.textContent = ENZYME.name;
  const badgeHit = el('circle', { class: 'gc-cycle-hit', r: 34 });

  // ── State ──
  let turn = 0; // degrees the wheel is turned by a drag; it springs back to 0
  let spin = 0;
  let travel = -120; // where the travelling molecule is
  let hover: string | null = null;
  let drag: { last: number } | null = null;
  let lean = { x: 0, y: 0 };
  const aim = { x: 0, y: 0 };
  let pulse = 0;
  const gap = (r: number) => ((r + 6) / R) * (180 / Math.PI);

  function layout(t: number) {
    const still = reduced.matches;
    STEPS.forEach((step, i) => {
      const next = (i + 1) % STEPS.length;
      const a = step.at + turn,
        b = STEPS[next].at + turn + (next === 0 ? 360 : 0),
        mid = (a + b) / 2;
      const start = a + gap(nodes[i].mol.r),
        end = b - gap(nodes[next].mol.r) - 1.5;
      arcs[i].base.setAttribute('d', arcPath(start, end));
      arcs[i].flux.setAttribute('d', arcPath(start, end - 2));
      (arcs[i].flux as SVGElement).style.strokeDashoffset = still ? '0' : String(-(t * 18) % 13.1);
      const enzyme = enzymes[i];
      if (enzyme) {
        // Along the top, left to right; along the bottom, drawn the other way so it is not upside down.
        const r = R - 17,
          p = P(mid - 40, r),
          q = P(mid + 40, r);
        enzyme.setAttribute(
          'd',
          Math.sin(rad(mid)) > 0.05
            ? `M${f(q.x)} ${f(q.y)} A${r} ${r} 0 0 0 ${f(p.x)} ${f(p.y)}`
            : `M${f(p.x)} ${f(p.y)} A${r} ${r} 0 0 1 ${f(q.x)} ${f(q.y)}`,
        );
      }
      const side = sides[i],
        arrow = ARROWS[i];
      if (side && arrow.side) {
        const out = arrow.side.out;
        const far = P(mid + (out ? 9 : -9), R + 46),
          near = P(mid + (out ? -5 : 5), R + 3),
          ctl = P(mid, R + 34);
        const [from, to] = out ? [near, far] : [far, near];
        side.path.setAttribute('d', `M${f(from.x)} ${f(from.y)} Q${f(ctl.x)} ${f(ctl.y)} ${f(to.x)} ${f(to.y)}`);
        const at = mid + (out ? 13 : -13),
          lp = P(at, R + 56),
          lines = arrow.side.label;
        side.text.setAttribute('text-anchor', anchorFor(at));
        if (!side.text.childNodes.length) for (const text of lines) el('tspan', {}, side.text).textContent = text;
        side.text.childNodes.forEach((ts, k) => {
          (ts as Element).setAttribute('x', f(lp.x));
          (ts as Element).setAttribute('y', f(lp.y + 4 + k * 13 - (lines.length - 1) * 6.5));
        });
      }
      if (arrow.badge) {
        const bp = P(mid),
          glow = hover === 'enzyme' ? 1 : pulse;
        badge.setAttribute('transform', `translate(${f(bp.x)} ${f(bp.y)}) scale(${(1 + glow * 0.08).toFixed(3)})`);
        badgeRing.setAttribute('opacity', (glow * 0.6).toFixed(2));
        badgeRing.setAttribute('r', f(31 + glow * 5));
        const lp = P(mid, R + 42);
        badgeLabel.setAttribute('x', f(lp.x));
        badgeLabel.setAttribute('y', f(lp.y + 4 + Math.sin(rad(mid)) * 4));
        badgeLabel.setAttribute('text-anchor', anchorFor(mid));
        badgeHit.setAttribute('cx', f(bp.x));
        badgeHit.setAttribute('cy', f(bp.y));
      }
    });
    for (const n of nodes) {
      const a = n.step.at + turn,
        p = P(a),
        lp = P(a, R + n.mol.r + 9);
      n.mol.g.setAttribute('transform', `translate(${f(p.x)} ${f(p.y)})`);
      n.label.setAttribute('x', f(lp.x));
      n.label.setAttribute('y', f(lp.y + 5 + Math.sin(rad(a)) * 5));
      n.label.setAttribute('text-anchor', anchorFor(a));
      n.hit.setAttribute('cx', f(p.x));
      n.hit.setAttribute('cy', f(p.y));
      const lit = hover === n.step.name || (hover === null && !still && Math.abs(norm(travel - n.step.at)) < 9);
      n.g.classList.toggle('is-lit', lit);
      n.label.classList.toggle('is-lit', lit);
    }
    // The molecule going round, with a short tail.
    const tp = P(travel + turn);
    tokenHead.setAttribute('cx', f(tp.x));
    tokenHead.setAttribute('cy', f(tp.y));
    trail.forEach((dot, k) => {
      const q = P(travel + turn - (3 - k) * 3.2);
      dot.setAttribute('cx', f(q.x));
      dot.setAttribute('cy', f(q.y));
    });
    (token as SVGElement).style.display = still ? 'none' : '';
  }

  // ── Pointing at a step or the enzyme says what it is, in the middle ──
  let swap = 0;
  const show = (what: string | null) => {
    if (hover === what || drag) return;
    hover = what;
    const step = STEPS.find((s) => s.name === what);
    const [title, about] = what === 'enzyme' ? [ENZYME.name, ENZYME.about] : step ? [step.name, step.about] : ['The lab cycle', ''];
    centerText.style.opacity = '0';
    window.clearTimeout(swap);
    swap = window.setTimeout(() => {
      const b = document.createElement('b');
      b.textContent = title;
      const parts: Node[] = [b];
      if (about) {
        const span = document.createElement('span');
        span.textContent = about;
        parts.push(span);
      }
      centerText.replaceChildren(...parts);
      centerText.style.opacity = '1';
    }, 120);
  };
  const hoverable = (targets: Element[], what: string) => {
    for (const t of targets) {
      t.addEventListener('pointerenter', () => show(what));
      t.addEventListener('pointerleave', () => show(null));
    }
  };
  for (const n of nodes) hoverable([n.hit, n.label], n.step.name);
  hoverable([badgeHit, badgeLabel], 'enzyme');

  // ── Dragging turns the wheel; let go, it springs back ──
  const svgPoint = (e: PointerEvent) => {
    const r = svg.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 480, y: ((e.clientY - r.top) / r.height) * 450 };
  };
  const angleOf = (p: { x: number; y: number }) => (Math.atan2(p.y - CY, p.x - CX) * 180) / Math.PI;
  const onWheel = (p: { x: number; y: number }) => {
    const d = Math.hypot(p.x - CX, p.y - CY);
    return d > R - 56 && d < R + 60;
  };
  const onDown = (e: PointerEvent) => {
    const p = svgPoint(e);
    if (e.button !== 0 || !onWheel(p)) return;
    e.preventDefault();
    art.setPointerCapture(e.pointerId);
    show(null);
    drag = { last: angleOf(p) };
    art.classList.add('is-dragging');
  };
  const onMove = (e: PointerEvent) => {
    const p = svgPoint(e);
    if (drag) {
      const a = angleOf(p),
        da = norm(a - drag.last);
      drag.last = a;
      turn += da;
      spin = da * 60;
    } else art.classList.toggle('is-grabbable', onWheel(p));
  };
  const onUp = () => {
    drag = null;
    art.classList.remove('is-dragging');
  };
  art.addEventListener('pointerdown', onDown);
  art.addEventListener('pointermove', onMove);
  art.addEventListener('pointerup', onUp);
  art.addEventListener('pointercancel', onUp);
  // The drawing leans toward the pointer, anywhere on the page.
  const onPagePointer = (e: PointerEvent) => {
    const r = art.getBoundingClientRect();
    aim.x = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2)));
    aim.y = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2)));
  };
  window.addEventListener('pointermove', onPagePointer);

  // ── Animation, only while it can be seen ──
  let frame = 0,
    last = 0,
    visible = true;
  const tick = (now: number) => {
    frame = 0;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    const still = reduced.matches;
    if (!still) travel = ((travel + 120 + dt * (360 / LAP)) % 360) - 120;
    // Passing the enzyme, on the arrow from Experiment to Document, it glows.
    pulse = still ? 0 : Math.max(0, 1 - Math.abs(norm(travel - 30)) / 22);
    if (!drag) {
      // Back to its place, with a little overshoot (none when motion is reduced).
      spin += (-turn * 42 - spin * (still ? 13 : 5.2)) * dt;
      turn += spin * dt;
      if (Math.abs(turn) < 0.01 && Math.abs(spin) < 0.01) turn = spin = 0;
    }
    lean = { x: lean.x + (aim.x - lean.x) * 0.05, y: lean.y + (aim.y - lean.y) * 0.05 };
    tilt.style.transform = still ? '' : `perspective(1100px) rotateX(${(-lean.y * 6).toFixed(2)}deg) rotateY(${(lean.x * 8).toFixed(2)}deg)`;
    layout(now / 1000);
    if (visible) frame = requestAnimationFrame(tick);
  };
  const seen = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible && !frame) {
      last = 0;
      frame = requestAnimationFrame(tick);
    }
  });
  seen.observe(art);
  layout(0);
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    window.clearTimeout(swap);
    seen.disconnect();
    window.removeEventListener('pointermove', onPagePointer);
    art.removeEventListener('pointerdown', onDown);
    art.removeEventListener('pointermove', onMove);
    art.removeEventListener('pointerup', onUp);
    art.removeEventListener('pointercancel', onUp);
    svg.replaceChildren();
  };
}
