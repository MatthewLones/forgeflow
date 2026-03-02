import { useState, useEffect, useRef, useCallback } from 'react';

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

/* ── Dot cycle duration ───────────────────────────────── */

const DOT_INTERVAL = 500; // ms per dot step
const DOTS_PER_CYCLE = 3; // 1 dot, 2 dots, 3 dots = 1 cycle
const CYCLE_DURATION = DOT_INTERVAL * DOTS_PER_CYCLE; // 1500ms per full cycle
const MIN_VERB_CYCLES = 2; // at least 2 full dot cycles per verb = 3s minimum

/* ── Component ────────────────────────────────────────── */

export function ActivityIndicator({ phase }: { phase?: string }) {
  const [verb, setVerb] = useState(() => pickVerb());
  const [dots, setDots] = useState(1);
  const prevVerbRef = useRef(verb);
  const dotCycleCountRef = useRef(0);
  const verbChangeRequestedRef = useRef(false);

  // Track completed dot cycles and change verb only at cycle boundaries
  const onDotTick = useCallback(() => {
    setDots((d) => {
      const next = (d % DOTS_PER_CYCLE) + 1;
      // At the end of a full cycle (going from 3 back to 1)
      if (next === 1) {
        dotCycleCountRef.current++;
        // Change verb if enough cycles have passed
        if (dotCycleCountRef.current >= MIN_VERB_CYCLES) {
          // Random chance to change (50%), or force after 4 cycles
          if (dotCycleCountRef.current >= 4 || Math.random() > 0.5) {
            dotCycleCountRef.current = 0;
            const nextVerb = pickVerb(prevVerbRef.current);
            prevVerbRef.current = nextVerb;
            setVerb(nextVerb);
          }
        }
      }
      return next;
    });
  }, []);

  // Animate dots
  useEffect(() => {
    const interval = setInterval(onDotTick, DOT_INTERVAL);
    return () => clearInterval(interval);
  }, [onDotTick]);

  const dotStr = '.'.repeat(dots);

  return (
    <div className="flex items-center gap-1.5 py-0.5">
      <span className="activity-pulse-dot" />
      <span className="text-[10px] font-medium text-blue-500">
        {verb}{dotStr}
      </span>
      {phase && (
        <span className="text-[9px] text-[var(--color-text-muted)] font-mono">
          {phase}
        </span>
      )}
    </div>
  );
}
