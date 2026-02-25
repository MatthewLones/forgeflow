import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { FlowNode, NodeType, ArtifactSchema } from '@forgeflow/types';
import { useFlow } from '../../context/FlowContext';
import { useProjectStore } from '../../context/ProjectStore';
import { useLayout } from '../../context/LayoutContext';
import { extractConfigFromInstructions } from '../../lib/sync-blocks-to-config';
import { extractSkillOutputs } from '../../lib/skill-output-resolver';
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

export function AgentEditor({ nodeId }: AgentEditorProps) {
  const { state, updateNode, updateNodeConfig, removeNode, createAgentByName, addArtifact } = useFlow();
  const { skills: availableSkills, loadSkill, skillData, createSkill } = useProjectStore();
  const { updateTabLabel, selectSkill, selectAgent, selectArtifact } = useLayout();
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

  // Artifact names from flow-level registry
  const artifactNames = useMemo(
    () => Object.keys(state.flow.artifacts ?? {}),
    [state.flow.artifacts],
  );

  const handleCreateAgent = useCallback(
    (name: string) => {
      createAgentByName(name, nodeId);
    },
    [createAgentByName, nodeId],
  );

  const handleCreateArtifact = useCallback(
    (name: string) => {
      // Add to flow-level artifact registry if not already there
      if (!state.flow.artifacts?.[name]) {
        addArtifact({ name, format: 'json', description: '' });
      }
      // Add to node's config.outputs if not already there
      if (node) {
        const existing = node.config.outputs ?? [];
        if (!existing.includes(name)) {
          updateNodeConfig(nodeId, { outputs: [...existing, name] });
        }
      }
    },
    [state.flow.artifacts, node, nodeId, addArtifact, updateNodeConfig],
  );

  const handleCreateSkill = useCallback(
    (name: string) => {
      createSkill(state.flow.id, name);
    },
    [createSkill, state.flow.id],
  );

  // Chip click handlers
  const handleClickSkill = useCallback(
    (name: string) => selectSkill(name),
    [selectSkill],
  );

  const handleClickAgent = useCallback(
    (name: string) => selectAgent(name),
    [selectAgent],
  );

  const handleClickArtifact = useCallback(
    (name: string) => selectArtifact(name),
    [selectArtifact],
  );

  // Track which output names were inherited from skills (so we can replace them)
  const skillOutputsRef = useRef<ArtifactSchema[]>([]);
  const inheritedNamesRef = useRef<Set<string>>(new Set());

  // Resolve skill outputs when referenced skills change or skillData updates
  const nodeSkills = node?.config.skills;
  const nodeSkillsKey = nodeSkills?.join(',') ?? '';
  useEffect(() => {
    if (!nodeSkills?.length) {
      skillOutputsRef.current = [];
      inheritedNamesRef.current = new Set();
      return;
    }
    const projectId = state.flow.id;
    let cancelled = false;

    (async () => {
      const allSkillOutputs: ArtifactSchema[] = [];
      for (const skillName of nodeSkills) {
        let data = skillData[skillName];
        if (!data) {
          data = (await loadSkill(projectId, skillName)) as typeof data;
        }
        if (cancelled || !data) continue;

        const skillMd = data.files.find((f) => f.path === 'SKILL.md');
        if (!skillMd) continue;

        allSkillOutputs.push(...extractSkillOutputs(skillMd.content));
      }

      if (cancelled) return;

      const prevInherited = inheritedNamesRef.current;
      const newInheritedNames = new Set(allSkillOutputs.map((o) => o.name));
      skillOutputsRef.current = allSkillOutputs;
      inheritedNamesRef.current = newInheritedNames;

      // Register skill outputs in flow-level artifact registry
      for (const output of allSkillOutputs) {
        if (!state.flow.artifacts?.[output.name]) {
          addArtifact(output);
        }
      }

      // Replace: remove old inherited outputs, add new ones
      if (node) {
        const existing = node.config.outputs ?? [];
        // Keep outputs that were NOT previously inherited from skills
        const kept = existing.filter((o) => {
          const name = typeof o === 'string' ? o : (o as ArtifactSchema).name;
          return !prevInherited.has(name);
        });
        // Add the new skill outputs (replacing old ones)
        const keptNames = new Set(kept.map((o: string | ArtifactSchema) =>
          typeof o === 'string' ? o : (o as ArtifactSchema).name,
        ));
        const toAdd = allSkillOutputs.filter((o) => !keptNames.has(o.name));
        const merged = [...kept, ...toAdd.map((o) => o.name)];

        // Only dispatch if something actually changed
        const existingNames = existing.map((o: string | ArtifactSchema) =>
          typeof o === 'string' ? o : (o as ArtifactSchema).name,
        ).sort().join(',');
        const mergedNames = merged.map((o: string | ArtifactSchema) =>
          typeof o === 'string' ? o : (o as ArtifactSchema).name,
        ).sort().join(',');

        if (existingNames !== mergedNames) {
          updateNodeConfig(nodeId, { outputs: merged });
        }
      }
    })();

    return () => { cancelled = true; };
  }, [nodeSkillsKey, skillData]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleInstructionsChange = useCallback(
    (text: string) => {
      updateNode(nodeId, { instructions: text });
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = setTimeout(() => {
        const configUpdate = extractConfigFromInstructions(text);
        if (configUpdate) {
          // Merge skill-inherited outputs into the extracted config
          const extractedNames = new Set(
            ((configUpdate.outputs ?? []) as Array<string | ArtifactSchema>).map(
              (o) => (typeof o === 'string' ? o : o.name),
            ),
          );
          const inherited = skillOutputsRef.current.filter((o) => !extractedNames.has(o.name));
          if (inherited.length > 0) {
            configUpdate.outputs = [...(configUpdate.outputs ?? []), ...inherited.map((o) => o.name)];
          }
          updateNodeConfig(nodeId, configUpdate);
        }
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
          onCreateArtifact={handleCreateArtifact}
          onCreateSkill={handleCreateSkill}
          onClickSkill={handleClickSkill}
          onClickAgent={handleClickAgent}
          onClickArtifact={handleClickArtifact}
          onClickArtifactOutput={handleClickArtifact}
        />
      </div>

      {/* Config bottom panel */}
      <ConfigBottomPanel node={node} />
    </div>
  );
}
