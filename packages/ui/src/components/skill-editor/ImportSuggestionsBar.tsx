import { useState, useMemo, useCallback } from 'react';
import { detectConvertibleSections } from '../../lib/detect-skill-blocks';

interface ImportSuggestionsBarProps {
  content: string;
  onConvert: (convertedContent: string) => void;
}

/**
 * Shows a yellow info bar when a SKILL.md file has sections that can be
 * auto-converted to forgeflow structured blocks. The user can choose to
 * convert all detected sections or dismiss the suggestion.
 */
export function ImportSuggestionsBar({ content, onConvert }: ImportSuggestionsBarProps) {
  const [dismissed, setDismissed] = useState(false);

  const suggestions = useMemo(() => detectConvertibleSections(content), [content]);

  const handleConvertAll = useCallback(() => {
    // Apply replacements from bottom to top to preserve offsets
    let result = content;
    const sorted = [...suggestions].sort((a, b) => b.from - a.from);
    for (const s of sorted) {
      result = result.slice(0, s.from) + s.replacement + result.slice(s.to);
    }
    onConvert(result);
    setDismissed(true);
  }, [content, suggestions, onConvert]);

  if (dismissed || suggestions.length === 0) return null;

  const typeLabels = suggestions.map((s) => s.type);
  const uniqueTypes = [...new Set(typeLabels)];
  const typeSummary = uniqueTypes.map((t) => {
    const count = typeLabels.filter((l) => l === t).length;
    return `${count} ${t}${count > 1 ? 's' : ''}`;
  }).join(', ');

  return (
    <div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-amber-50 border-b border-amber-200 text-xs">
      <span className="text-amber-600 font-medium">
        {suggestions.length} convertible section{suggestions.length > 1 ? 's' : ''} detected
      </span>
      <span className="text-amber-500">
        ({typeSummary})
      </span>
      <div className="flex-1" />
      <button
        type="button"
        onClick={handleConvertAll}
        className="px-2.5 py-1 bg-amber-500 text-white rounded font-medium hover:bg-amber-600 transition-colors"
      >
        Convert All
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="px-2 py-1 text-amber-500 hover:text-amber-700 transition-colors"
      >
        Dismiss
      </button>
    </div>
  );
}
