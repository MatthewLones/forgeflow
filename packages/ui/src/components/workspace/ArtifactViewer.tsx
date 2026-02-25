import { useCallback, useMemo } from 'react';
import type { FlowNode, ArtifactField, ArtifactFormat } from '@forgeflow/types';
import { artifactName } from '@forgeflow/types';
import { useFlow } from '../../context/FlowContext';
import { FieldsEditor } from '../shared/FieldsEditor';

interface ArtifactEditorProps {
  artifactName: string;
}

const FORMAT_OPTIONS: { value: ArtifactFormat; label: string }[] = [
  { value: 'json', label: 'Structured (JSON)' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'text', label: 'Text' },
  { value: 'csv', label: 'CSV' },
  { value: 'pdf', label: 'PDF' },
  { value: 'image', label: 'Image' },
  { value: 'binary', label: 'Binary' },
];

const FORMAT_COLORS: Record<string, { bg: string; text: string }> = {
  json: { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700' },
  markdown: { bg: 'bg-blue-50 border-blue-200', text: 'text-blue-700' },
  text: { bg: 'bg-gray-50 border-gray-200', text: 'text-gray-600' },
  csv: { bg: 'bg-green-50 border-green-200', text: 'text-green-700' },
  pdf: { bg: 'bg-red-50 border-red-200', text: 'text-red-700' },
  image: { bg: 'bg-purple-50 border-purple-200', text: 'text-purple-700' },
  binary: { bg: 'bg-gray-50 border-gray-200', text: 'text-gray-600' },
};

interface Lineage {
  producers: string[];
  consumers: string[];
}

function computeLineage(nodes: FlowNode[], targetName: string): Lineage {
  const producers: string[] = [];
  const consumers: string[] = [];

  function walk(nodeList: FlowNode[]) {
    for (const node of nodeList) {
      for (const output of node.config.outputs) {
        if (artifactName(output) === targetName) {
          producers.push(node.id);
        }
      }
      for (const input of node.config.inputs) {
        if (artifactName(input) === targetName) {
          consumers.push(node.id);
        }
      }
      walk(node.children);
    }
  }

  walk(nodes);
  return { producers, consumers };
}

export function ArtifactEditor({ artifactName: name }: ArtifactEditorProps) {
  const { state, updateArtifact } = useFlow();

  const artifact = state.flow.artifacts?.[name];
  const lineage = useMemo(() => computeLineage(state.flow.nodes, name), [state.flow.nodes, name]);
  const formatColor = FORMAT_COLORS[artifact?.format ?? 'json'] ?? FORMAT_COLORS.json;

  const handleFormatChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      updateArtifact(name, { format: e.target.value as ArtifactFormat });
    },
    [name, updateArtifact],
  );

  const handleDescriptionChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      updateArtifact(name, { description: e.target.value });
    },
    [name, updateArtifact],
  );

  const handleFieldsChange = useCallback(
    (fields: ArtifactField[]) => {
      updateArtifact(name, { fields });
    },
    [name, updateArtifact],
  );

  if (!artifact) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-muted)]">
        Artifact not found: {name}
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-white">
      <div className="max-w-lg mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-start gap-3 mb-6">
          <div className={`w-10 h-10 rounded-lg ${formatColor.bg} border flex items-center justify-center shrink-0`}>
            <span className={`text-sm font-bold ${formatColor.text}`}>
              {artifact.format.slice(0, 2).toUpperCase()}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)] font-mono">
              {artifact.name}
            </h2>
            <div className="mt-1">
              <select
                value={artifact.format}
                onChange={handleFormatChange}
                className="text-[10px] font-medium px-1.5 py-0.5 rounded border bg-white outline-none cursor-pointer"
              >
                {FORMAT_OPTIONS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Description */}
        <section className="mb-6">
          <h3 className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
            Description
          </h3>
          <textarea
            value={artifact.description}
            onChange={handleDescriptionChange}
            placeholder="Describe what this artifact contains and how it should be structured..."
            className="w-full text-sm text-[var(--color-text-secondary)] leading-relaxed px-3 py-2 border border-[var(--color-border)] rounded-lg bg-white outline-none focus:border-[var(--color-node-agent)] resize-none"
            rows={3}
          />
        </section>

        {/* Fields (JSON only) */}
        {artifact.format === 'json' && (
          <section className="mb-6">
            <FieldsEditor
              fields={artifact.fields ?? []}
              onChange={handleFieldsChange}
            />
          </section>
        )}

        {/* Lineage */}
        <section className="mb-6">
          <h3 className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
            Lineage
          </h3>
          <div className="space-y-2">
            <div className="flex items-start gap-2 text-xs">
              <span className="text-[var(--color-node-merge)] shrink-0 mt-0.5">Produced by</span>
              <span className="text-[var(--color-text-secondary)]">
                {lineage.producers.length > 0
                  ? lineage.producers.map((id) => (
                      <span key={id} className="inline-block font-mono bg-[var(--color-canvas-bg)] px-1.5 py-0.5 rounded mr-1">
                        {id}
                      </span>
                    ))
                  : <span className="italic text-[var(--color-text-muted)]">user upload</span>
                }
              </span>
            </div>
            <div className="flex items-start gap-2 text-xs">
              <span className="text-[var(--color-node-agent)] shrink-0 mt-0.5">Consumed by</span>
              <span className="text-[var(--color-text-secondary)]">
                {lineage.consumers.length > 0
                  ? lineage.consumers.map((id) => (
                      <span key={id} className="inline-block font-mono bg-[var(--color-canvas-bg)] px-1.5 py-0.5 rounded mr-1">
                        {id}
                      </span>
                    ))
                  : <span className="italic text-[var(--color-text-muted)]">not referenced yet</span>
                }
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
