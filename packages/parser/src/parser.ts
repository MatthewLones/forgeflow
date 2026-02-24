import { readFile } from 'node:fs/promises';
import { flowDefinitionSchema } from './schema.js';
import type { FlowDefinition, FlowDiagnostic } from '@flowforge/types';

export interface ParseResult {
  success: boolean;
  flow: FlowDefinition | null;
  errors: FlowDiagnostic[];
}

/** Parse a FLOW.json file from disk */
export async function parseFlowFile(filePath: string): Promise<ParseResult> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (e) {
    return {
      success: false,
      flow: null,
      errors: [
        {
          code: 'FILE_NOT_FOUND',
          severity: 'error',
          message: `Cannot read file: ${(e as Error).message}`,
          location: {},
        },
      ],
    };
  }
  return parseFlowJSON(raw);
}

/** Parse a FLOW.json string */
export function parseFlowJSON(jsonString: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (e) {
    return {
      success: false,
      flow: null,
      errors: [
        {
          code: 'INVALID_JSON',
          severity: 'error',
          message: `Invalid JSON: ${(e as Error).message}`,
          location: {},
        },
      ],
    };
  }
  return parseFlowObject(parsed);
}

/** Parse an already-parsed object */
export function parseFlowObject(obj: unknown): ParseResult {
  const result = flowDefinitionSchema.safeParse(obj);
  if (result.success) {
    return { success: true, flow: result.data as FlowDefinition, errors: [] };
  }

  const errors: FlowDiagnostic[] = result.error.issues.map((issue) => ({
    code: 'SCHEMA_ERROR',
    severity: 'error' as const,
    message: issue.message,
    location: { field: issue.path.join('.') },
  }));

  return { success: false, flow: null, errors };
}
