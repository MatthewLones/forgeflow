import type { FlowDiagnostic, DiagnosticSeverity, DiagnosticLocation } from '@forgeflow/types';

export function createDiagnostic(
  code: string,
  severity: DiagnosticSeverity,
  message: string,
  location: DiagnosticLocation,
  suggestion?: string,
  related?: string[],
): FlowDiagnostic {
  const d: FlowDiagnostic = { code, severity, message, location };
  if (suggestion) d.suggestion = suggestion;
  if (related) d.related = related;
  return d;
}

/**
 * Compute Levenshtein distance between two strings.
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  // Optimize for empty strings
  if (m === 0) return n;
  if (n === 0) return m;

  // Use single-row optimization
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

/**
 * Find the closest match for a target string among candidates.
 * Returns null if no match is close enough (threshold: 5 characters).
 */
export function findClosestMatch(
  target: string,
  candidates: string[],
  maxDistance = 5,
): string | null {
  let best: string | null = null;
  let bestDist = maxDistance + 1;

  for (const candidate of candidates) {
    const dist = levenshteinDistance(target, candidate);
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }

  return best;
}

/**
 * Format a single diagnostic for terminal output.
 */
export function formatDiagnostic(d: FlowDiagnostic): string {
  const prefix = d.severity.toUpperCase();
  const loc = d.location.nodeId ? ` at node "${d.location.nodeId}"` : '';
  const field = d.location.field ? `, field "${d.location.field}"` : '';

  let output = `${prefix} [${d.code}]${loc}${field}:\n  ${d.message}`;
  if (d.suggestion) {
    output += `\n  Suggestion: ${d.suggestion}`;
  }
  if (d.related && d.related.length > 0) {
    output += `\n  Related: ${d.related.join(', ')}`;
  }
  return output;
}

/**
 * Format a complete validation result for terminal output.
 */
export function formatValidationSummary(
  errors: FlowDiagnostic[],
  warnings: FlowDiagnostic[],
  suggestions: FlowDiagnostic[],
): string {
  const parts: string[] = [];

  for (const d of errors) parts.push(formatDiagnostic(d));
  for (const d of warnings) parts.push(formatDiagnostic(d));
  for (const d of suggestions) parts.push(formatDiagnostic(d));

  const counts = [
    errors.length > 0 ? `${errors.length} error${errors.length > 1 ? 's' : ''}` : null,
    warnings.length > 0 ? `${warnings.length} warning${warnings.length > 1 ? 's' : ''}` : null,
    suggestions.length > 0
      ? `${suggestions.length} suggestion${suggestions.length > 1 ? 's' : ''}`
      : null,
  ]
    .filter(Boolean)
    .join(', ');

  if (parts.length > 0) {
    parts.push('');
    parts.push(`Result: ${counts}`);
    parts.push(errors.length > 0 ? 'Validation FAILED.' : 'Validation passed with warnings.');
  }

  return parts.join('\n');
}
