import type { FlowGraph, FlowDiagnostic } from '@forgeflow/types';
import { createDiagnostic, findClosestMatch } from '../diagnostics.js';

/**
 * Check that every input file traces to a source:
 * - User upload (provided in userUploadFiles), OR
 * - Output of a prior node (by topological order)
 *
 * For children: inputs must come from the parent's available files
 * or from a sibling in an earlier wave (topological order among siblings).
 */
export function checkDependencies(
  graph: FlowGraph,
  userUploadFiles: string[],
): FlowDiagnostic[] {
  const diagnostics: FlowDiagnostic[] = [];
  const allOutputFiles = [...graph.artifacts.keys()];

  // Track which files are available at each point in the topological order
  const availableFiles = new Set<string>(userUploadFiles);

  for (const nodeId of graph.topoOrder) {
    const sym = graph.symbols.get(nodeId)!;

    // Collect outputs produced by this node's own descendants.
    // A parent can declare inputs that its children produce — children execute
    // within the parent's phase, so their outputs are available for aggregation.
    const descendantOutputs = new Set<string>();
    for (const descId of sym.descendantIds) {
      const descSym = graph.symbols.get(descId);
      if (descSym) {
        for (const output of descSym.declaredOutputs) {
          descendantOutputs.add(output);
        }
      }
    }

    // Check top-level node inputs
    for (const inputFile of sym.declaredInputs) {
      if (!availableFiles.has(inputFile) && !descendantOutputs.has(inputFile)) {
        const closest = findClosestMatch(inputFile, allOutputFiles);
        const closestProducer = closest ? graph.artifacts.get(closest)?.producerId : undefined;
        const suggestion = closest && closestProducer
          ? `Did you mean "${closest}" (from node "${closestProducer}")?`
          : 'Add this file to the outputs of a prior node, or include it as a user upload.';

        diagnostics.push(
          createDiagnostic(
            'UNRESOLVED_INPUT',
            'error',
            `Node "${nodeId}" declares input "${inputFile}" but no prior node produces this file.`,
            { nodeId, field: 'config.inputs' },
            suggestion,
            closest && closestProducer ? [closestProducer] : undefined,
          ),
        );
      }
    }

    // Check children inputs using wave-aware ordering.
    // Children are topologically sorted by sibling I/O dependencies.
    // A child can read from: parent's available files, OR earlier-wave sibling outputs.
    if (sym.childIds.length > 0) {
      // Detect cycles among children
      if (sym.childCycle) {
        diagnostics.push(
          createDiagnostic(
            'CHILD_CYCLE',
            'error',
            `Children of node "${nodeId}" have circular dependencies among each other.`,
            { nodeId, field: 'children' },
            'Restructure child dependencies to avoid cycles.',
          ),
        );
      }

      // Walk children in topo order — each child's outputs become available to later children
      const childAvailable = new Set([
        ...availableFiles,
        ...sym.declaredInputs,
      ]);

      for (const childId of sym.childTopoOrder) {
        const childSym = graph.symbols.get(childId)!;
        for (const inputFile of childSym.declaredInputs) {
          if (!childAvailable.has(inputFile)) {
            const closest = findClosestMatch(inputFile, [...childAvailable]);
            diagnostics.push(
              createDiagnostic(
                'UNRESOLVED_INPUT',
                'error',
                `Child node "${childId}" declares input "${inputFile}" which is not available from the parent node's inputs, prior phases, or earlier-wave siblings.`,
                { nodeId: childId, field: 'config.inputs' },
                closest
                  ? `Did you mean "${closest}"?`
                  : 'Ensure this file is available as a parent input, from a prior phase, or from an earlier-wave sibling.',
              ),
            );
          }
        }

        // This child's outputs become available to later children in topo order
        for (const output of childSym.declaredOutputs) {
          childAvailable.add(output);
        }
      }
    }

    // After this node completes, its outputs become available
    for (const output of sym.declaredOutputs) {
      availableFiles.add(output);
    }
  }

  return diagnostics;
}
