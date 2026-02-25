import { useMemo } from 'react';
import { marked } from 'marked';

interface MarkdownPreviewProps {
  content: string;
  fileName: string;
}

/** Strip YAML frontmatter (---...\n---) from markdown content */
function stripFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---')) {
    return { frontmatter: {}, body: content };
  }

  const endIndex = trimmed.indexOf('---', 3);
  if (endIndex === -1) {
    return { frontmatter: {}, body: content };
  }

  const yamlBlock = trimmed.slice(3, endIndex).trim();
  const body = trimmed.slice(endIndex + 3).trim();

  // Simple key: value parsing (no full YAML parser needed for preview)
  const frontmatter: Record<string, string> = {};
  for (const line of yamlBlock.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
      frontmatter[key] = value;
    }
  }

  return { frontmatter, body };
}

export function MarkdownPreview({ content, fileName }: MarkdownPreviewProps) {
  const { frontmatter, body } = useMemo(() => stripFrontmatter(content), [content]);
  const html = useMemo(() => marked.parse(body, { async: false }) as string, [body]);

  const hasFrontmatter = Object.keys(frontmatter).length > 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 border-b border-[var(--color-border)]">
        <div className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
          Preview
        </div>
        <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{fileName}</div>
      </div>

      <div className="p-5">
        {/* Frontmatter badge */}
        {hasFrontmatter && (
          <div className="mb-4 p-3 rounded-lg bg-[var(--color-canvas-bg)] border border-[var(--color-border)]">
            {Object.entries(frontmatter).map(([key, value]) => (
              <div key={key} className="flex gap-2 text-xs py-0.5">
                <span className="font-medium text-[var(--color-text-secondary)] min-w-[80px]">
                  {key}
                </span>
                <span className="text-[var(--color-text-primary)]">{value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Rendered markdown */}
        <div
          className="prose-skill"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}
