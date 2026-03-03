import { useState, useEffect, useRef } from 'react';

/* ── Forge-themed activity verbs ──────────────────────── */

const ACTIVITY_VERBS = [
  'Forging',
  'Smelting',
  'Hammering',
  'Tempering',
  'Annealing',
  'Quenching',
  'Casting',
  'Welding',
  'Shaping',
  'Refining',
  'Alloying',
  'Galvanizing',
  'Kindling',
  'Stoking',
  'Bellowing',
  'Riveting',
  'Burnishing',
  'Polishing',
  'Grinding',
  'Chiseling',
  'Embossing',
  'Engraving',
  'Sculpting',
  'Molding',
  'Hardening',
  'Brazing',
  'Soldering',
  'Etching',
  'Folding',
  'Drawing',
];

function pickVerb(exclude?: string): string {
  const candidates = exclude ? ACTIVITY_VERBS.filter((v) => v !== exclude) : ACTIVITY_VERBS;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/* ── Timing ──────────────────────────────────────────── */

const DOT_INTERVAL = 500;   // ms per dot step
const DOTS_PER_CYCLE = 3;   // 1 dot → 2 dots → 3 dots = 1 cycle (1.5s)
const TICKS_PER_VERB = DOTS_PER_CYCLE * 2; // 2 full dot cycles (3s) before changing verb

/* ── Component ────────────────────────────────────────── */

export function ActivityIndicator({ phase }: { phase?: string }) {
  const [verb, setVerb] = useState(() => pickVerb());
  const [dots, setDots] = useState(1);
  const tickRef = useRef(0);
  const prevVerbRef = useRef(verb);

  useEffect(() => {
    const interval = setInterval(() => {
      tickRef.current++;
      const dotPhase = (tickRef.current % DOTS_PER_CYCLE) + 1; // 1, 2, 3, 1, 2, 3...
      setDots(dotPhase);

      // Change verb every TICKS_PER_VERB ticks, aligned to cycle boundary (when dots reset to 1)
      if (tickRef.current % TICKS_PER_VERB === 0) {
        const next = pickVerb(prevVerbRef.current);
        prevVerbRef.current = next;
        setVerb(next);
      }
    }, DOT_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-1.5 py-0.5">
      <span className="activity-pulse-dot" />
      <span className="text-[10px] font-medium text-blue-500">
        {verb}{'.'.repeat(dots)}
      </span>
      {phase && (
        <span className="text-[9px] text-[var(--color-text-muted)] font-mono">
          {phase}
        </span>
      )}
    </div>
  );
}
