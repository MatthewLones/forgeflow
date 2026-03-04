import type { ChipType } from '../../lib/chip-styles';
import { CHIP_STYLES, CHIP_FONT_FAMILY } from '../../lib/chip-styles';

interface ChipProps {
  type: ChipType;
  name: string;
  label?: string;
  tooltip?: string;
  onClick?: () => void;
  className?: string;
}

export function Chip({ type, name, label, tooltip, onClick, className }: ChipProps) {
  const style = CHIP_STYLES[type];
  const displayLabel = label ?? style.label(name);

  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs transition-opacity hover:opacity-80 ${className ?? ''}`}
      style={{
        color: style.color,
        backgroundColor: style.bg,
        fontFamily: CHIP_FONT_FAMILY,
        fontWeight: 500,
        fontSize: '12px',
        cursor: onClick ? 'pointer' : 'default',
      }}
      onClick={onClick}
      data-tooltip={tooltip || undefined}
    >
      {displayLabel}
    </span>
  );
}
