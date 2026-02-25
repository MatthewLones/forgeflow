import { useState, useCallback, type KeyboardEvent } from 'react';
import { useSkill } from '../../context/SkillContext';

interface FileGroup {
  label: string;
  prefix: string;
  canAdd: boolean;
}

const FILE_GROUPS: FileGroup[] = [
  { label: 'References', prefix: 'references/', canAdd: true },
  { label: 'Scripts', prefix: 'scripts/', canAdd: true },
];

export function FileTree() {
  const { state, selectFile, addFile, deleteFile } = useSkill();
  const { files, selectedFilePath } = state;
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newFileName, setNewFileName] = useState('');

  const skillMd = files.find((f) => f.path === 'SKILL.md');

  const getFilesForGroup = (prefix: string) =>
    files
      .filter((f) => f.path.startsWith(prefix))
      .sort((a, b) => a.path.localeCompare(b.path));

  const handleAddStart = useCallback((prefix: string) => {
    setAddingTo(prefix);
    setNewFileName('');
  }, []);

  const handleAddConfirm = useCallback(() => {
    if (!addingTo || !newFileName.trim()) {
      setAddingTo(null);
      return;
    }
    const fileName = newFileName.trim();
    const path = `${addingTo}${fileName}`;
    addFile(path);
    setAddingTo(null);
    setNewFileName('');
  }, [addingTo, newFileName, addFile]);

  const handleAddKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddConfirm();
      }
      if (e.key === 'Escape') {
        setAddingTo(null);
      }
    },
    [handleAddConfirm],
  );

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-[var(--color-border)]">
        <div className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
          Files
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {/* SKILL.md — always at top */}
        {skillMd && (
          <FileItem
            path="SKILL.md"
            label="SKILL.md"
            selected={selectedFilePath === 'SKILL.md'}
            icon="doc"
            onClick={() => selectFile('SKILL.md')}
          />
        )}

        {/* File groups */}
        {FILE_GROUPS.map((group) => {
          const groupFiles = getFilesForGroup(group.prefix);
          return (
            <div key={group.prefix} className="mt-3">
              <div className="flex items-center justify-between px-2 py-1">
                <span className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                  {group.label}
                </span>
                {group.canAdd && (
                  <button
                    type="button"
                    onClick={() => handleAddStart(group.prefix)}
                    className="text-[var(--color-text-muted)] hover:text-[var(--color-node-agent)] text-sm leading-none px-1"
                    title={`Add ${group.label.toLowerCase().slice(0, -1)}`}
                  >
                    +
                  </button>
                )}
              </div>

              {groupFiles.map((file) => (
                <FileItem
                  key={file.path}
                  path={file.path}
                  label={file.path.replace(group.prefix, '')}
                  selected={selectedFilePath === file.path}
                  icon={file.path.endsWith('.md') ? 'md' : 'code'}
                  onClick={() => selectFile(file.path)}
                  onDelete={() => deleteFile(file.path)}
                />
              ))}

              {groupFiles.length === 0 && addingTo !== group.prefix && (
                <div className="px-2 py-1.5 text-[10px] text-[var(--color-text-muted)] italic">
                  No files yet
                </div>
              )}

              {/* Inline new file input */}
              {addingTo === group.prefix && (
                <div className="px-2 py-1">
                  <input
                    type="text"
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    onKeyDown={handleAddKeyDown}
                    onBlur={handleAddConfirm}
                    placeholder={group.prefix === 'references/' ? 'topic.md' : 'script.py'}
                    className="w-full text-xs px-2 py-1 border border-[var(--color-node-agent)] rounded bg-white outline-none"
                    autoFocus
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FileItem({
  path,
  label,
  selected,
  icon,
  onClick,
  onDelete,
}: {
  path: string;
  label: string;
  selected: boolean;
  icon: 'doc' | 'md' | 'code';
  onClick: () => void;
  onDelete?: () => void;
}) {
  const iconColors: Record<string, string> = {
    doc: 'text-[var(--color-node-agent)]',
    md: 'text-[var(--color-node-merge)]',
    code: 'text-[var(--color-node-checkpoint)]',
  };

  const iconSymbols: Record<string, string> = {
    doc: 'M',
    md: '#',
    code: '>',
  };

  return (
    <div
      className={`group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-xs transition-colors ${
        selected
          ? 'bg-[var(--color-node-agent)]/10 text-[var(--color-node-agent)] font-medium'
          : 'text-[var(--color-text-primary)] hover:bg-[var(--color-canvas-bg)]'
      }`}
      onClick={onClick}
    >
      <span className={`font-mono text-[10px] w-3.5 text-center shrink-0 ${iconColors[icon]}`}>
        {iconSymbols[icon]}
      </span>
      <span className="truncate flex-1">{label}</span>
      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="hidden group-hover:block text-[var(--color-text-muted)] hover:text-red-500 text-[10px] leading-none px-0.5"
          title="Delete file"
        >
          x
        </button>
      )}
    </div>
  );
}
