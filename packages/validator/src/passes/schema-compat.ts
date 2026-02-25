import type { FlowDefinition, FlowNode, FlowDiagnostic, ArtifactSchema } from '@forgeflow/types';
import { artifactName } from '@forgeflow/types';
import { createDiagnostic } from '../diagnostics.js';

/**
 * Build a map of artifact name → ArtifactSchema for all producers (outputs).
 * Only includes entries where the output is a full ArtifactSchema (not a plain string).
 * Walks all nodes including children recursively.
 */
function buildProducerSchemas(nodes: FlowNode[]): Map<string, { schema: ArtifactSchema; nodeId: string }> {
  const map = new Map<string, { schema: ArtifactSchema; nodeId: string }>();
  function walk(nodeList: FlowNode[]) {
    for (const node of nodeList) {
      for (const output of node.config.outputs) {
        if (typeof output !== 'string') {
          map.set(output.name, { schema: output, nodeId: node.id });
        }
      }
      walk(node.children);
    }
  }
  walk(nodes);
  return map;
}

/**
 * Collect all consumer (input) ArtifactSchemas with their node IDs.
 * Only includes entries where the input is a full ArtifactSchema (not a plain string).
 */
function collectConsumerSchemas(nodes: FlowNode[]): Array<{ schema: ArtifactSchema; nodeId: string }> {
  const result: Array<{ schema: ArtifactSchema; nodeId: string }> = [];
  function walk(nodeList: FlowNode[]) {
    for (const node of nodeList) {
      for (const input of node.config.inputs) {
        if (typeof input !== 'string') {
          result.push({ schema: input, nodeId: node.id });
        }
      }
      walk(node.children);
    }
  }
  walk(nodes);
  return result;
}

/**
 * Check schema compatibility between producers and consumers.
 *
 * When both a producer (output) and consumer (input) use full ArtifactSchema objects
 * for the same artifact name, verify:
 * 1. Format matches
 * 2. For JSON artifacts: consumer's required fields exist in producer's field list
 *
 * All diagnostics are warnings — they don't block execution.
 */
export function checkSchemaCompat(flow: FlowDefinition): FlowDiagnostic[] {
  const diagnostics: FlowDiagnostic[] = [];
  const producers = buildProducerSchemas(flow.nodes);
  const consumers = collectConsumerSchemas(flow.nodes);

  for (const { schema: consumer, nodeId: consumerNodeId } of consumers) {
    const producer = producers.get(consumer.name);
    if (!producer) continue; // No schema'd producer found — skip (handled by dependency pass)

    const { schema: producerSchema, nodeId: producerNodeId } = producer;

    // Check format compatibility
    if (producerSchema.format !== consumer.format) {
      diagnostics.push(
        createDiagnostic(
          'SCHEMA_FORMAT_MISMATCH',
          'warning',
          `Artifact "${consumer.name}": producer "${producerNodeId}" outputs format "${producerSchema.format}" but consumer "${consumerNodeId}" expects "${consumer.format}".`,
          { nodeId: consumerNodeId, field: 'config.inputs' },
          `Update the format to match — either change the producer to "${consumer.format}" or the consumer to "${producerSchema.format}".`,
          [producerNodeId],
        ),
      );
    }

    // Check field coverage (JSON only)
    if (
      producerSchema.format === 'json' &&
      consumer.format === 'json' &&
      consumer.fields &&
      consumer.fields.length > 0
    ) {
      const producerKeys = new Set(
        (producerSchema.fields ?? []).map((f) => f.key),
      );

      for (const field of consumer.fields) {
        const isRequired = field.required !== false; // default true
        if (isRequired && !producerKeys.has(field.key)) {
          diagnostics.push(
            createDiagnostic(
              'SCHEMA_MISSING_FIELD',
              'warning',
              `Artifact "${consumer.name}": consumer "${consumerNodeId}" expects field "${field.key}" but producer "${producerNodeId}" does not declare it.`,
              { nodeId: consumerNodeId, field: 'config.inputs' },
              `Add field "${field.key}" to the producer's output schema, or mark it as optional in the consumer.`,
              [producerNodeId],
            ),
          );
        }
      }
    }
  }

  return diagnostics;
}
