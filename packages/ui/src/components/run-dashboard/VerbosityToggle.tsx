export type VerbosityLevel = 'compact' | 'standard' | 'verbose';

const LEVELS: { value: VerbosityLevel; label: string }[] = [
  { value: 'compact', label: 'Compact' },
  { value: 'standard', label: 'Standard' },
  { value: 'verbose', label: 'Verbose' },
];

export function VerbosityToggle({
  value,
  onChange,
}: {
  value: VerbosityLevel;
  onChange: (v: VerbosityLevel) => void;
}) {
  return (
    <div className="flex rounded border border-[var(--color-border)] overflow-hidden text-[10px]">
      {LEVELS.map((l) => (
        <button
          key={l.value}
          type="button"
          onClick={() => onChange(l.value)}
          className={`px-2 py-0.5 transition-colors ${
            value === l.value
              ? 'bg-[var(--color-node-agent)] text-white'
              : 'bg-white text-[var(--color-text-secondary)] hover:bg-gray-50'
          }`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
