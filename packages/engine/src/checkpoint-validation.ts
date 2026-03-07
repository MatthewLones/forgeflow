import type { ArtifactSchema } from '@forgeflow/types';

export interface CheckpointValidationResult {
  fileName: string;
  valid: boolean;
  errors: string[];
}

/**
 * Validate checkpoint content against an artifact schema.
 *
 * - JSON with fields: parse, check required fields, validate types
 * - JSON without fields: check valid JSON syntax
 * - Other formats: check non-empty
 */
export function validateCheckpointContent(
  fileName: string,
  content: Buffer,
  schema?: ArtifactSchema,
): CheckpointValidationResult {
  const text = content.toString('utf-8').trim();
  const errors: string[] = [];

  if (!text) {
    return { fileName, valid: false, errors: ['Content is empty'] };
  }

  if (!schema) {
    return { fileName, valid: true, errors: [] };
  }

  if (schema.format === 'json') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { fileName, valid: false, errors: ['Invalid JSON syntax'] };
    }

    if (schema.fields?.length && typeof parsed === 'object' && parsed !== null) {
      const obj = parsed as Record<string, unknown>;
      for (const field of schema.fields) {
        const isRequired = field.required !== false;
        const value = obj[field.key];

        if (value === undefined || value === null) {
          if (isRequired) {
            errors.push(`Missing required field: "${field.key}"`);
          }
          continue;
        }

        // Type check
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        if (actualType !== field.type) {
          errors.push(`Field "${field.key}": expected ${field.type}, got ${actualType}`);
        }
      }
    }
  }

  return { fileName, valid: errors.length === 0, errors };
}
