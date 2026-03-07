import { marked } from 'marked';

/**
 * Renders a markdown string as inline HTML.
 * Uses marked.parse for block-level content (paragraphs, lists, etc.)
 * or marked.parseInline for single-line labels.
 */
export function Md({ text, inline, className }: { text: string; inline?: boolean; className?: string }) {
  const html = inline
    ? (marked.parseInline(text) as string)
    : (marked.parse(text, { async: false }) as string);

  return (
    <span
      className={`prose-skill ${className ?? ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
