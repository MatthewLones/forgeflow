import type { FlowGraph, FlowDiagnostic } from '@forgeflow/types';
import { createDiagnostic, findClosestMatch } from '../diagnostics.js';

/**
 * Check that every input file traces to a source:
 * - User upload (provided in userUploadFiles), OR
 * - Output of a prior node (by topological order)
 *
 * For children: inputs must come from the parent's inputs (children run in parallel).
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

    // Check top-level node inputs
    for (const inputFile of sym.declaredInputs) {
      if (!availableFiles.has(inputFile)) {
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

    // Check children inputs — children can only read from parent's inputs
    if (sym.childIds.length > 0) {
      const parentAvailable = new Set([
        ...availableFiles,
        ...sym.declaredInputs,
      ]);

      for (const childId of sym.childIds) {
        const childSym = graph.symbols.get(childId)!;
        for (const inputFile of childSym.declaredInputs) {
          if (!parentAvailable.has(inputFile)) {
            // Check if it's a sibling's output (not allowed — children run in parallel)
            const isSiblingOutput = sym.childIds.some((siblingId) => {
              if (siblingId === childId) return false;
              const siblingSym = graph.symbols.get(siblingId);
              return siblingSym ? siblingSym.declaredOutputs.includes(inputFile) : false;
            });

            if (isSiblingOutput) {
              diagnostics.push(
                createDiagnostic(
                  'CHILD_DEPENDS_ON_SIBLING',
                  'error',
                  `Child node "${childId}" depends on "${inputFile}" which is output by a sibling. Children run in parallel and cannot depend on each other's outputs.`,
                  { nodeId: childId, field: 'config.inputs' },
                  'Move this dependency to the parent node, or restructure the flow so this input comes from a prior phase.',
                ),
              );
            } else {
              const closest = findClosestMatch(inputFile, [...parentAvailable]);
              diagnostics.push(
                createDiagnostic(
                  'UNRESOLVED_INPUT',
                  'error',
                  `Child node "${childId}" declares input "${inputFile}" which is not available from the parent node's inputs or prior phases.`,
                  { nodeId: childId, field: 'config.inputs' },
                  closest
                    ? `Did you mean "${closest}"?`
                    : 'Ensure this file is available as a parent input or from a prior phase.',
                ),
              );
            }
          }
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
