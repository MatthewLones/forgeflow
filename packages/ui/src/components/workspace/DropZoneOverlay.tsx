import { useDroppable } from '@dnd-kit/core';

interface DropZoneOverlayProps {
  groupId: string;
}

type Zone = 'center' | 'left' | 'right' | 'top' | 'bottom';

const ZONES: { zone: Zone; className: string; activeClassName: string }[] = [
  {
    zone: 'center',
    className: 'inset-[20%]',
    activeClassName: 'bg-[var(--color-node-agent)]/10 border-2 border-dashed border-[var(--color-node-agent)]/40 rounded',
  },
  {
    zone: 'left',
    className: 'top-0 left-0 bottom-0 w-[20%]',
    activeClassName: 'bg-[var(--color-node-agent)]/15 border-r-2 border-dashed border-[var(--color-node-agent)]/40',
  },
  {
    zone: 'right',
    className: 'top-0 right-0 bottom-0 w-[20%]',
    activeClassName: 'bg-[var(--color-node-agent)]/15 border-l-2 border-dashed border-[var(--color-node-agent)]/40',
  },
  {
    zone: 'top',
    className: 'top-0 left-[20%] right-[20%] h-[20%]',
    activeClassName: 'bg-[var(--color-node-agent)]/15 border-b-2 border-dashed border-[var(--color-node-agent)]/40',
  },
  {
    zone: 'bottom',
    className: 'bottom-0 left-[20%] right-[20%] h-[20%]',
    activeClassName: 'bg-[var(--color-node-agent)]/15 border-t-2 border-dashed border-[var(--color-node-agent)]/40',
  },
];

export function DropZoneOverlay({ groupId }: DropZoneOverlayProps) {
  return (
    <div className="absolute inset-0 z-40 pointer-events-auto">
      {ZONES.map(({ zone, className, activeClassName }) => (
        <DropZone
          key={zone}
          zone={zone}
          groupId={groupId}
          className={className}
          activeClassName={activeClassName}
        />
      ))}
    </div>
  );
}

function DropZone({
  zone,
  groupId,
  className,
  activeClassName,
}: {
  zone: Zone;
  groupId: string;
  className: string;
  activeClassName: string;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `dropzone-${groupId}-${zone}`,
    data: { type: 'dropzone', groupId, zone },
  });

  return (
    <div
      ref={setNodeRef}
      className={`absolute transition-colors ${className} ${isOver ? activeClassName : ''}`}
    />
  );
}
