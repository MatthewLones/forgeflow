import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import {
  formatShortcut,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  isBrowserReserved,
  eventToKeys,
  saveRemap,
  clearRemap,
  loadRemaps,
  clearAllRemaps,
  isMac,
  type ShortcutBinding,
  type ShortcutKeys,
} from '../../lib/keyboard-shortcuts';
import { isElectron } from '../../lib/electron';

type Tab = 'shortcuts' | 'guide';

interface SettingsOverlayProps {
  bindings: ShortcutBinding[];
  onClose: () => void;
  /** Called when a shortcut is remapped so the parent can re-apply bindings */
  onRemapChange?: () => void;
}

/* ── Guide section data ────────────────────────────────── */

const GUIDE_SECTIONS = [
  { id: 'how-it-works', title: 'How It Works', icon: '\u2699' },
  { id: 'composable-nodes', title: 'Composable Nodes', icon: '\u29BF' },
  { id: 'top-level-design', title: 'Node Design', icon: '\u25C7' },
  { id: 'docker-sandbox', title: 'Sandbox', icon: '\u2338' },
  { id: 'human-in-the-loop', title: 'Interrupts', icon: '\u23F8' },
  { id: 'artifact-management', title: 'Artifacts', icon: '\u2B22' },
  { id: 'reference-management', title: 'References', icon: '\u2759' },
] as const;

/* ── Main component ────────────────────────────────────── */

export function SettingsOverlay({ bindings, onClose, onRemapChange }: SettingsOverlayProps) {
  const [activeTab, setActiveTab] = useState<Tab>('shortcuts');

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-3xl w-full mx-4 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-0">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
            Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] border border-[var(--color-border)] rounded px-1.5 py-0.5"
          >
            Esc
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex gap-0 px-6 mt-3 border-b border-[var(--color-border)]">
          <TabButton active={activeTab === 'shortcuts'} onClick={() => setActiveTab('shortcuts')}>
            Keyboard Shortcuts
          </TabButton>
          <TabButton active={activeTab === 'guide'} onClick={() => setActiveTab('guide')}>
            Guide
          </TabButton>
        </div>

        {/* Content */}
        {activeTab === 'shortcuts' ? (
          <div className="flex-1 overflow-y-auto p-6">
            <ShortcutsTab bindings={bindings} onRemapChange={onRemapChange} />
          </div>
        ) : (
          <GuideTab />
        )}
      </div>
    </div>
  );
}

/* ── Tab button ────────────────────────────────────────── */

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-xs font-medium transition-colors -mb-px ${
        active
          ? 'text-[var(--color-node-agent)] border-b-2 border-[var(--color-node-agent)]'
          : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] border-b-2 border-transparent'
      }`}
    >
      {children}
    </button>
  );
}

/* ── Shortcuts tab ─────────────────────────────────────── */

function ShortcutsTab({ bindings, onRemapChange }: { bindings: ShortcutBinding[]; onRemapChange?: () => void }) {
  const [capturingId, setCapturingId] = useState<string | null>(null);
  const [remapVersion, setRemapVersion] = useState(0);

  const remaps = useMemo(() => loadRemaps(), [remapVersion]);
  const hasAnyRemaps = Object.keys(remaps).length > 0;

  const grouped = useMemo(() => {
    const groups = new Map<string, ShortcutBinding[]>();
    for (const b of bindings) {
      if (b.id.startsWith('group.') && b.id !== 'group.1') continue;
      if (b.id === 'escape') continue;
      const list = groups.get(b.category) ?? [];
      list.push(b);
      groups.set(b.category, list);
    }
    return groups;
  }, [bindings]);

  // Key capture listener
  useEffect(() => {
    if (!capturingId) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Escape cancels capture
      if (e.key === 'Escape') {
        setCapturingId(null);
        return;
      }

      const keys = eventToKeys(e);
      if (!keys) return; // bare modifier press

      saveRemap(capturingId, keys);
      setCapturingId(null);
      setRemapVersion((v) => v + 1);
      onRemapChange?.();
    };
    // Use capture phase so we intercept before other handlers
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [capturingId, onRemapChange]);

  const handleResetOne = useCallback((id: string) => {
    clearRemap(id);
    setRemapVersion((v) => v + 1);
    onRemapChange?.();
  }, [onRemapChange]);

  const handleResetAll = useCallback(() => {
    clearAllRemaps();
    setRemapVersion((v) => v + 1);
    onRemapChange?.();
  }, [onRemapChange]);

  return (
    <div>
      {/* Reset all button */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-[11px] text-[var(--color-text-muted)]">
          Click a shortcut to remap it. Press <kbd className="text-[10px] bg-[var(--color-canvas-bg)] border border-[var(--color-border)] rounded px-1 py-0.5">Esc</kbd> to cancel.
        </p>
        {hasAnyRemaps && (
          <button
            type="button"
            onClick={handleResetAll}
            className="text-[10px] text-[var(--color-text-muted)] hover:text-red-500 transition-colors"
          >
            Reset all to defaults
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-10 gap-y-5">
        {CATEGORY_ORDER.map((category) => {
          const items = grouped.get(category);
          if (!items || items.length === 0) return null;
          return (
            <div key={category}>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">
                {CATEGORY_LABELS[category] ?? category}
              </div>
              <div className="space-y-1.5">
                {items.map((item) => {
                  // Non-remappable shortcuts
                  if (item.id === 'group.1') {
                    return (
                      <div key={item.id} className="flex items-center justify-between">
                        <span className="text-xs text-[var(--color-text-secondary)]">Focus group 1-9</span>
                        <kbd
                          className="text-[11px] bg-[var(--color-canvas-bg)] border border-[var(--color-border)] rounded px-1.5 py-0.5 text-[var(--color-text-primary)] min-w-[24px] text-center whitespace-nowrap"
                          style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif' }}
                        >
                          {formatShortcut({ ...item, label: '', key: '1' })}-9
                        </kbd>
                      </div>
                    );
                  }

                  const isCapturing = capturingId === item.id;
                  const remap = remaps[item.id];
                  const displayBinding = remap ? { ...item, ...remap } : item;
                  const isRemapped = !!remap;
                  const browserWarning = !isElectron() && isBrowserReserved(displayBinding);

                  return (
                    <ShortcutRow
                      key={item.id}
                      item={item}
                      displayBinding={displayBinding}
                      isCapturing={isCapturing}
                      isRemapped={isRemapped}
                      browserWarning={browserWarning}
                      onStartCapture={() => setCapturingId(item.id)}
                      onReset={() => handleResetOne(item.id)}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Shortcut row (remappable) ─────────────────────────── */

function ShortcutRow({
  item,
  displayBinding,
  isCapturing,
  isRemapped,
  browserWarning,
  onStartCapture,
  onReset,
}: {
  item: ShortcutBinding;
  displayBinding: ShortcutBinding;
  isCapturing: boolean;
  isRemapped: boolean;
  browserWarning: boolean;
  onStartCapture: () => void;
  onReset: () => void;
}) {
  return (
    <div className="flex items-center justify-between group">
      <span className="text-xs text-[var(--color-text-secondary)]">
        {item.label}
      </span>
      <div className="flex items-center gap-1.5">
        {browserWarning && (
          <span
            className="text-[9px] text-amber-500"
            data-tooltip="This shortcut is reserved by the browser and may not work. It will work in the desktop app."
          >
            browser reserved
          </span>
        )}
        {isRemapped && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onReset(); }}
            className="text-[9px] text-[var(--color-text-muted)] hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
            data-tooltip="Reset to default"
          >
            reset
          </button>
        )}
        <button
          type="button"
          onClick={onStartCapture}
          className={`text-[11px] rounded px-1.5 py-0.5 min-w-[24px] text-center whitespace-nowrap transition-all ${
            isCapturing
              ? 'bg-[var(--color-node-agent)]/10 border-2 border-[var(--color-node-agent)] text-[var(--color-node-agent)] animate-pulse'
              : isRemapped
                ? 'bg-[var(--color-node-agent)]/5 border border-[var(--color-node-agent)]/30 text-[var(--color-text-primary)] hover:border-[var(--color-node-agent)]/60 cursor-pointer'
                : 'bg-[var(--color-canvas-bg)] border border-[var(--color-border)] text-[var(--color-text-primary)] hover:border-[var(--color-node-agent)]/40 cursor-pointer'
          }`}
          style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif' }}
          data-tooltip={isCapturing ? undefined : 'Click to remap'}
        >
          {isCapturing ? `Press keys\u2026` : formatShortcut(displayBinding)}
        </button>
      </div>
    </div>
  );
}

/* ── Guide tab — sidebar + scrolling content ───────────── */

function GuideTab() {
  const [activeSection, setActiveSection] = useState<string>(GUIDE_SECTIONS[0].id);
  const contentRef = useRef<HTMLDivElement>(null);

  const scrollToSection = useCallback((id: string) => {
    const el = contentRef.current?.querySelector(`#guide-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  // Track which section is in view via IntersectionObserver
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = entry.target.id.replace('guide-', '');
            setActiveSection(id);
          }
        }
      },
      { root: container, rootMargin: '-10% 0px -80% 0px', threshold: 0 },
    );

    for (const s of GUIDE_SECTIONS) {
      const el = container.querySelector(`#guide-${s.id}`);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex flex-1 overflow-hidden min-h-0">
      {/* Left nav */}
      <nav className="w-44 shrink-0 border-r border-[var(--color-border)] py-3 overflow-y-auto">
        {GUIDE_SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => scrollToSection(s.id)}
            className={`w-full text-left px-4 py-1.5 text-[11px] flex items-center gap-2 transition-colors ${
              activeSection === s.id
                ? 'text-[var(--color-node-agent)] bg-[var(--color-node-agent)]/5 font-medium'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-canvas-bg)]'
            }`}
          >
            <span className="text-[10px] w-3.5 text-center opacity-60">{s.icon}</span>
            {s.title}
          </button>
        ))}
      </nav>

      {/* Right content */}
      <div ref={contentRef} className="flex-1 overflow-y-auto px-6 py-4">

        <section id="guide-how-it-works" className="mb-10">
          <h3 className="text-[13px] font-semibold text-[var(--color-text-primary)] mb-3">How ForgeFlow Works</h3>
          <div className="text-xs leading-relaxed text-[var(--color-text-secondary)] space-y-2.5">
            <p>
              ForgeFlow orchestrates AI agents through three primitives:
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 ml-1">
              <dt className="font-semibold text-[var(--color-text-primary)]">Skills</dt>
              <dd>Reusable knowledge bundles — a SKILL.md prompt, reference files, and scripts.</dd>
              <dt className="font-semibold text-[var(--color-text-primary)]">Nodes</dt>
              <dd>Units of work. Each node is one agent task with inputs, outputs, and instructions.</dd>
              <dt className="font-semibold text-[var(--color-text-primary)]">Flows</dt>
              <dd>DAGs that wire nodes together. Edges are implicit from artifact I/O declarations.</dd>
            </dl>
            <p>
              Execution proceeds phase-by-phase in topological order. Each node runs in an isolated Docker
              sandbox. Inputs arrive as files in <Code>input/</Code>, the agent writes to <Code>output/</Code>,
              and state is serialized between phases.
            </p>
            <Callout>
              Each node is self-contained: it receives files, does work, produces files. The DAG determines
              ordering and data flow.
            </Callout>
          </div>
        </section>

        <section id="guide-composable-nodes" className="mb-10">
          <h3 className="text-[13px] font-semibold text-[var(--color-text-primary)] mb-3">Composable Nodes</h3>
          <div className="text-xs leading-relaxed text-[var(--color-text-secondary)] space-y-2.5">
            <p>
              Nodes can have <strong>children</strong> — sub-agents that decompose complex work into
              parallel or sequential steps. The parent declares children's outputs and can consume their results.
            </p>
            <p>
              Children are auto-grouped into <strong>waves</strong> from their I/O dependencies:
            </p>
            <ul className="space-y-1 ml-4 list-disc list-outside">
              <li><strong>Wave 0</strong> — no sibling dependencies, run concurrently</li>
              <li><strong>Wave 1</strong> — depends on wave 0 outputs</li>
              <li><strong>Wave N</strong> — depends on wave N-1, and so on</li>
            </ul>
            <p>
              Waves are fully computed — no manual annotation needed. Just declare inputs and outputs.
            </p>
            <Callout>
              Use children when work decomposes into independent sub-tasks (e.g., research topics in parallel,
              then synthesize). Use separate top-level nodes when tasks need different skills or run at
              different pipeline stages.
            </Callout>
          </div>
        </section>

        <section id="guide-top-level-design" className="mb-10">
          <h3 className="text-[13px] font-semibold text-[var(--color-text-primary)] mb-3">Top-Level Node Design</h3>
          <div className="text-xs leading-relaxed text-[var(--color-text-secondary)] space-y-2.5">
            <p>
              Each top-level node is a pipeline phase — it gets its own sandbox, budget, and runs
              sequentially in DAG order. Too many creates overhead and fragility.
            </p>
            <p>
              <strong>Aim for 3-5 top-level nodes</strong> for most flows. If you have more, consider
              combining related work or restructuring as parent-child.
            </p>
            <Callout>
              If two nodes always run sequentially with a simple handoff, make them parent and child.
              Reserve top-level nodes for genuinely distinct stages with different skill requirements or
              checkpoint boundaries.
            </Callout>
          </div>
        </section>

        <section id="guide-docker-sandbox" className="mb-10">
          <h3 className="text-[13px] font-semibold text-[var(--color-text-primary)] mb-3">Docker Sandbox</h3>
          <div className="text-xs leading-relaxed text-[var(--color-text-secondary)] space-y-2.5">
            <p>
              Each phase runs inside a Docker container. The agent communicates through a <strong>mounted
              filesystem</strong> shared between container and host.
            </p>
            <div className="bg-[var(--color-canvas-bg)] rounded-lg px-3 py-2.5 font-mono text-[11px] space-y-0.5">
              <div className="text-[var(--color-text-muted)]">workspace/</div>
              <div className="ml-3"><Code>input/</Code> <span className="text-[var(--color-text-muted)]">— files from previous phases or user uploads</span></div>
              <div className="ml-3"><Code>output/</Code> <span className="text-[var(--color-text-muted)]">— agent writes deliverables here</span></div>
              <div className="ml-3"><Code>skills/</Code> <span className="text-[var(--color-text-muted)]">— resolved skill bundles</span></div>
              <div className="ml-3"><Code>prompts/</Code> <span className="text-[var(--color-text-muted)]">— child prompt files</span></div>
            </div>
            <Callout>
              Signal files (<Code>__INTERRUPT__</Code>, <Code>__CHILD_START__</Code>, etc.) handle
              orchestrator communication automatically — you don't manage them.
            </Callout>
          </div>
        </section>

        <section id="guide-human-in-the-loop" className="mb-10">
          <h3 className="text-[13px] font-semibold text-[var(--color-text-primary)] mb-3">Interrupts &amp; Human-in-the-Loop</h3>
          <div className="text-xs leading-relaxed text-[var(--color-text-secondary)] space-y-2.5">
            <p>Five interrupt types pause execution for human input:</p>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 ml-1 items-center">
              <InterruptChip tooltip="yes/no decision gate">/interrupt:approval</InterruptChip>
              <dd>Yes/no decision gate</dd>
              <InterruptChip tooltip="structured questions">/interrupt:qa</InterruptChip>
              <dd>Structured questions</dd>
              <InterruptChip tooltip="pick from a list">/interrupt:selection</InterruptChip>
              <dd>Pick from a list</dd>
              <InterruptChip tooltip="human reviews a draft">/interrupt:review</InterruptChip>
              <dd>Human reviews a draft</dd>
              <InterruptChip tooltip="flag a risk">/interrupt:escalation</InterruptChip>
              <dd>Flag a risk</dd>
            </div>
            <p>
              <strong>Checkpoint nodes</strong> are dedicated pause points between pipeline stages.
              Inline interrupts (declared via <InterruptChip>/interrupt:type</InterruptChip> in
              instructions) happen mid-execution and auto-escalate if unanswered within the timeout.
            </p>
            <Callout>
              Design for fewer interrupts. Front-load decisions with good instructions and references.
              Use <InterruptChip>/interrupt:approval</InterruptChip> only for high-stakes outputs.
            </Callout>
          </div>
        </section>

        <section id="guide-artifact-management" className="mb-10">
          <h3 className="text-[13px] font-semibold text-[var(--color-text-primary)] mb-3">Artifacts</h3>
          <div className="text-xs leading-relaxed text-[var(--color-text-secondary)] space-y-2.5">
            <p>
              Artifacts are the files that flow between nodes:
            </p>
            <div className="flex gap-4 ml-1">
              <div className="flex items-center gap-1.5">
                <ArtifactChip output tooltip="output artifact declaration">\name</ArtifactChip>
                <span>= produce (output)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <ArtifactChip tooltip="input artifact reference">@name</ArtifactChip>
                <span>= consume (input)</span>
              </div>
            </div>
            <p>
              Organize with <strong>folders</strong> using <Code>/</Code> in names
              (e.g., <Code>reports/risk_matrix</Code>). Referencing a folder
              (<ArtifactChip output tooltip="produces all artifacts in reports/">\reports</ArtifactChip> or{' '}
              <ArtifactChip tooltip="consumes all artifacts in reports/">@reports</ArtifactChip>)
              automatically expands to all artifacts inside.
            </p>
            <p>
              Add <strong>schemas</strong> (format, description, fields) to help agents understand what
              to produce and enable output validation.
            </p>
            <Callout>
              Name descriptively: <ArtifactChip output>\risk_assessment</ArtifactChip> not <Code>output1</Code>. Define schemas
              for structured formats — agents produce better output when they know the expected structure.
            </Callout>
          </div>
        </section>

        <section id="guide-reference-management" className="mb-10">
          <h3 className="text-[13px] font-semibold text-[var(--color-text-primary)] mb-3">References</h3>
          <div className="text-xs leading-relaxed text-[var(--color-text-secondary)] space-y-2.5">
            <p>
              References are static files bundled with skills — templates, examples, regulatory docs.
              Copied to <Code>skills/name/references/</Code> in the workspace. Attach them with{' '}
              <SkillChip tooltip="attaches a skill's references to the agent">/skill:name</SkillChip> in agent instructions.
            </p>
            <p><strong>Keep sets focused.</strong> Every file adds context cost. A skill with 20 references is doing too much.</p>
            <p>
              <strong>Break large files apart.</strong> Extract the specific tables, clauses, or sections
              the agent needs. Pre-process into structured formats (JSON, markdown) when possible.
            </p>
            <Callout>
              Aim for 3-5 focused reference files per skill. If a reference exceeds ~10 pages, extract
              the relevant portions. Use <Code>SKILL.md</Code> to explain what each reference contains.
            </Callout>
          </div>
        </section>

      </div>
    </div>
  );
}

/* ── Shared inline components ──────────────────────────── */

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="text-[11px] bg-[var(--color-canvas-bg)] px-1 py-0.5 rounded text-[var(--color-text-primary)]">
      {children}
    </code>
  );
}

/*
 * Chip styles — identical to the editor's cm-chip CSS.
 * Base: padding 1px 6px, border-radius 4px, font-size 12px, font-weight 500, monospace, cursor pointer
 * Uses data-tooltip for the global tooltip system.
 */
const CHIP_BASE: React.CSSProperties = {
  padding: '1px 6px',
  borderRadius: '4px',
  fontSize: '12px',
  fontWeight: 500,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  cursor: 'default',
  display: 'inline',
};

const CHIP_COLORS = {
  interrupt: { backgroundColor: 'rgba(239, 68, 68, 0.12)', color: '#dc2626' },
  artifact: { backgroundColor: 'rgba(139, 92, 246, 0.12)', color: '#7c3aed' },
  'artifact-output': { backgroundColor: 'rgba(139, 92, 246, 0.20)', color: '#6d28d9' },
  skill: { backgroundColor: 'rgba(16, 185, 129, 0.12)', color: '#059669' },
} as const;

function InterruptChip({ children, tooltip }: { children: React.ReactNode; tooltip?: string }) {
  return (
    <code style={{ ...CHIP_BASE, ...CHIP_COLORS.interrupt }} data-tooltip={tooltip}>
      {children}
    </code>
  );
}

function ArtifactChip({ children, tooltip, output }: { children: React.ReactNode; tooltip?: string; output?: boolean }) {
  const colors = output ? CHIP_COLORS['artifact-output'] : CHIP_COLORS.artifact;
  return (
    <code style={{ ...CHIP_BASE, ...colors }} data-tooltip={tooltip}>
      {children}
    </code>
  );
}

function SkillChip({ children, tooltip }: { children: React.ReactNode; tooltip?: string }) {
  return (
    <code style={{ ...CHIP_BASE, ...CHIP_COLORS.skill }} data-tooltip={tooltip}>
      {children}
    </code>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-[var(--color-node-agent)]/5 border-l-2 border-[var(--color-node-agent)]/40 px-3 py-2 text-[11px] rounded-r text-[var(--color-text-secondary)] leading-relaxed">
      {children}
    </div>
  );
}
