import type { FlowGraph, FlowDiagnostic } from '@forgeflow/types';
import { createDiagnostic } from '../diagnostics.js';

/**
 * Check schema compatibility between producers and consumers.
 *
 * When both a producer (output) and consumer (input) have ArtifactSchemas
 * for the same artifact name, verify:
 * 1. Format matches
 * 2. For JSON artifacts: consumer's required fields exist in producer's field list
 *
 * All diagnostics are warnings — they don't block execution.
 */
export function checkSchemaCompat(graph: FlowGraph): FlowDiagnostic[] {
  const diagnostics: FlowDiagnostic[] = [];

  // Walk all symbols looking for consumers with input schemas
  for (const [consumerNodeId, sym] of graph.symbols) {
    for (const [artifactFile, consumerSchema] of sym.inputSchemas) {
      // Find the producer's schema for this artifact
      const artifact = graph.artifacts.get(artifactFile);
      if (!artifact?.schema) continue; // No schema'd producer — skip

      const producerSchema = artifact.schema;
      const producerNodeId = artifact.producerId;

      // Check format compatibility
      if (producerSchema.format !== consumerSchema.format) {
        diagnostics.push(
          createDiagnostic(
            'SCHEMA_FORMAT_MISMATCH',
            'warning',
            `Artifact "${artifactFile}": producer "${producerNodeId}" outputs format "${producerSchema.format}" but consumer "${consumerNodeId}" expects "${consumerSchema.format}".`,
            { nodeId: consumerNodeId, field: 'config.inputs' },
            `Update the format to match — either change the producer to "${consumerSchema.format}" or the consumer to "${producerSchema.format}".`,
            [producerNodeId],
          ),
        );
      }

      // Check field coverage (JSON only)
      if (
        producerSchema.format === 'json' &&
        consumerSchema.format === 'json' &&
        consumerSchema.fields &&
        consumerSchema.fields.length > 0
      ) {
        const producerKeys = new Set(
          (producerSchema.fields ?? []).map((f) => f.key),
        );

        for (const field of consumerSchema.fields) {
          const isRequired = field.required !== false; // default true
          if (isRequired && !producerKeys.has(field.key)) {
            diagnostics.push(
              createDiagnostic(
                'SCHEMA_MISSING_FIELD',
                'warning',
                `Artifact "${artifactFile}": consumer "${consumerNodeId}" expects field "${field.key}" but producer "${producerNodeId}" does not declare it.`,
                { nodeId: consumerNodeId, field: 'config.inputs' },
                `Add field "${field.key}" to the producer's output schema, or mark it as optional in the consumer.`,
                [producerNodeId],
              ),
            );
          }
        }
      }
    }
  }

  return diagnostics;
}
