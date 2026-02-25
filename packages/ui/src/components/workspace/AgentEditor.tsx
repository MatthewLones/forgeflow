import { useCallback, useMemo, useRef } from 'react';
import type { FlowNode, NodeType, ArtifactSchema } from '@forgeflow/types';
import { useFlow } from '../../context/FlowContext';
import { useProjectStore } from '../../context/ProjectStore';
import { useLayout } from '../../context/LayoutContext';
import { extractConfigFromInstructions } from '../../lib/sync-blocks-to-config';
import { SlashCommandEditor } from './slash-commands/SlashCommandEditor';
import { ConfigBottomPanel } from './ConfigBottomPanel';

interface AgentEditorProps {
  nodeId: string;
}

const TYPE_COLORS: Record<NodeType, string> = {
  agent: 'bg-[var(--color-node-agent)]',
  checkpoint: 'bg-[var(--color-node-checkpoint)]',
  merge: 'bg-[var(--color-node-merge)]',
};

const TYPE_LABELS: Record<NodeType, string> = {
  agent: 'Agent',
  checkpoint: 'Checkpoint',
  merge: 'Merge',
};

/** Find a node by ID in a recursive tree */
function findNode(nodes: FlowNode[], id: string): FlowNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNode(n.children, id);
    if (found) return found;
  }
  return null;
}

/** Collect all agent IDs from a node tree */
function collectAgentNames(nodes: FlowNode[]): string[] {
  const names: string[] = [];
  function walk(list: FlowNode[]) {
    for (const node of list) {
      names.push(node.id);
      walk(node.children);
    }
  }
  walk(nodes);
  return names;
}

/** Collect all artifact names (output file names) from node configs across the flow */
function collectArtifactNames(nodes: FlowNode[]): string[] {
  const names = new Set<string>();
  function walk(list: FlowNode[]) {
    for (const node of list) {
      for (const out of node.config.outputs ?? []) {
        const name = typeof out === 'string' ? out : (out as ArtifactSchema).name;
        if (name) names.add(name);
      }
      walk(node.children);
    }
  }
  walk(nodes);
  return [...names];
}

export function AgentEditor({ nodeId }: AgentEditorProps) {
  const { state, updateNode, updateNodeConfig, removeNode, createAgentByName } = useFlow();
  const { skills: availableSkills } = useProjectStore();
  const { updateTabLabel } = useLayout();
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const node = useMemo(
    () => findNode(state.flow.nodes, nodeId),
    [state.flow.nodes, nodeId],
  );

  const skillNames = useMemo(
    () => availableSkills.map((s) => s.name),
    [availableSkills],
  );

  const agentNames = useMemo(
    () => collectAgentNames(state.flow.nodes).filter((id) => id !== nodeId),
    [state.flow.nodes, nodeId],
  );

  const artifactNames = useMemo(
    () => collectArtifactNames(state.flow.nodes),
    [state.flow.nodes],
  );

  const handleCreateAgent = useCallback(
    (name: string) => {
      createAgentByName(name, nodeId);
    },
    [createAgentByName, nodeId],
  );

  const handleInstructionsChange = useCallback(
    (text: string) => {
      updateNode(nodeId, { instructions: text });
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = setTimeout(() => {
        const configUpdate = extractConfigFromInstructions(text);
        if (configUpdate) updateNodeConfig(nodeId, configUpdate);
      }, 500);
    },
    [nodeId, updateNode, updateNodeConfig],
  );

  const handleNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const name = e.target.value;
      updateNode(nodeId, { name });
      updateTabLabel(nodeId, name);
    },
    [nodeId, updateNode, updateTabLabel],
  );

  const handleDelete = useCallback(() => {
    if (window.confirm(`Delete "${node?.name}"?`)) {
      removeNode(nodeId);
    }
  }, [nodeId, node?.name, removeNode]);

  if (!node || node.id !== nodeId) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-muted)]">
        Node not found
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Compact header */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-[var(--color-border)] bg-white">
        <input
          type="text"
          value={node.name}
          onChange={handleNameChange}
          className="text-sm font-semibold text-[var(--color-text-primary)] bg-transparent border-none outline-none flex-1 min-w-0 placeholder:text-[var(--color-text-muted)]"
          placeholder="Agent name"
        />

        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`w-2 h-2 rounded-full ${TYPE_COLORS[node.type]}`} />
          <span className="text-[11px] text-[var(--color-text-muted)]">
            {TYPE_LABELS[node.type]}
          </span>
        </div>

        <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">
          {node.id}
        </span>

        <button
          type="button"
          onClick={handleDelete}
          title="Delete node"
          className="text-[var(--color-text-muted)] hover:text-red-500 transition-colors shrink-0 text-xs"
        >
          Delete
        </button>
      </div>

      {/* Instructions editor — fills all remaining space */}
      <div className="flex-1 overflow-hidden">
        <SlashCommandEditor
          key={nodeId}
          content={node.instructions}
          onChange={handleInstructionsChange}
          skills={skillNames}
          agents={agentNames}
          artifacts={artifactNames}
          onCreateAgent={handleCreateAgent}
        />
      </div>

      {/* Config bottom panel */}
      <ConfigBottomPanel node={node} />
    </div>
  );
}
