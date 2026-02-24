import type { FlowDefinition, FlowNode, FlowDiagnostic } from '@forgeflow/types';
import { topologicalSort } from '../graph.js';
import { createDiagnostic, findClosestMatch } from '../diagnostics.js';

/**
 * Build a map of output file -> producing node ID from top-level nodes.
 */
function buildOutputMap(nodes: FlowNode[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const node of nodes) {
    for (const file of node.config.outputs) {
      map.set(file, node.id);
    }
  }
  return map;
}

/**
 * Check that every input file traces to a source:
 * - User upload (provided in userUploadFiles), OR
 * - Output of a prior node (by topological order)
 *
 * For children: inputs must come from the parent's inputs (children run in parallel).
 */
export function checkDependencies(
  flow: FlowDefinition,
  userUploadFiles: string[],
): FlowDiagnostic[] {
  const diagnostics: FlowDiagnostic[] = [];
  const outputMap = buildOutputMap(flow.nodes);
  const allOutputFiles = [...outputMap.keys()];

  const { sorted } = topologicalSort(
    flow.nodes.map((n) => n.id),
    flow.edges,
  );

  const nodeMap = new Map(flow.nodes.map((n) => [n.id, n]));
  const userUploads = new Set(userUploadFiles);

  // Track which files are available at each point in the topological order
  const availableFiles = new Set<string>(userUploadFiles);

  for (const nodeId of sorted) {
    const node = nodeMap.get(nodeId)!;

    // Check top-level node inputs
    for (const inputFile of node.config.inputs) {
      if (!availableFiles.has(inputFile)) {
        const closest = findClosestMatch(inputFile, allOutputFiles);
        const suggestion = closest
          ? `Did you mean "${closest}" (from node "${outputMap.get(closest)}")?`
          : 'Add this file to the outputs of a prior node, or include it as a user upload.';

        diagnostics.push(
          createDiagnostic(
            'UNRESOLVED_INPUT',
            'error',
            `Node "${nodeId}" declares input "${inputFile}" but no prior node produces this file.`,
            { nodeId, field: 'config.inputs' },
            suggestion,
            closest ? [outputMap.get(closest)!] : undefined,
          ),
        );
      }
    }

    // Check children inputs — children can only read from parent's inputs
    if (node.children.length > 0) {
      const parentAvailable = new Set([...availableFiles, ...node.config.inputs]);

      for (const child of node.children) {
        for (const inputFile of child.config.inputs) {
          if (!parentAvailable.has(inputFile)) {
            // Check if it's a sibling's output (not allowed — children run in parallel)
            const isSiblingOutput = node.children.some(
              (sibling) =>
                sibling.id !== child.id && sibling.config.outputs.includes(inputFile),
            );

            if (isSiblingOutput) {
              diagnostics.push(
                createDiagnostic(
                  'CHILD_DEPENDS_ON_SIBLING',
                  'error',
                  `Child node "${child.id}" depends on "${inputFile}" which is output by a sibling. Children run in parallel and cannot depend on each other's outputs.`,
                  { nodeId: child.id, field: 'config.inputs' },
                  'Move this dependency to the parent node, or restructure the flow so this input comes from a prior phase.',
                ),
              );
            } else {
              const closest = findClosestMatch(inputFile, [...parentAvailable]);
              diagnostics.push(
                createDiagnostic(
                  'UNRESOLVED_INPUT',
                  'error',
                  `Child node "${child.id}" declares input "${inputFile}" which is not available from the parent node's inputs or prior phases.`,
                  { nodeId: child.id, field: 'config.inputs' },
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
    for (const outputFile of node.config.outputs) {
      availableFiles.add(outputFile);
    }
  }

  return diagnostics;
}
