import type { FlowDefinition } from '@forgeflow/types';
import { FlowProvider } from '../context/FlowContext';
import { WorkspaceProvider, useWorkspace } from '../context/WorkspaceContext';
import { AgentExplorer } from '../components/workspace/AgentExplorer';
import { WorkspaceToolbar } from '../components/workspace/WorkspaceToolbar';
import { DagMiniView } from '../components/workspace/DagMiniView';
import { EditorLayout } from '../components/workspace/EditorLayout';
import { autoLayout } from '../lib/flow-to-reactflow';

// Hardcoded contract-review example — loaded from server in 5.5
const exampleFlow: FlowDefinition = {
  id: 'contract_review',
  name: 'Legal Contract Review',
  version: '1.0',
  description: 'Reviews a contract, flags risks, and generates a redlined version with negotiation memo',
  skills: ['contract-law-basics'],
  budget: { maxTurns: 400, maxBudgetUsd: 40.0, timeoutMs: 1200000 },
  nodes: [
    {
      id: 'parse_contract',
      type: 'agent',
      name: 'Parse Contract',
      instructions: 'Read the contract PDF. Extract every clause as a structured object.',
      config: {
        inputs: ['contract.pdf'],
        outputs: ['clauses_parsed.json'],
        skills: [],
        budget: { maxTurns: 25, maxBudgetUsd: 3.0 },
        estimatedDuration: '45s',
      },
      children: [],
    },
    {
      id: 'risk_analysis',
      type: 'agent',
      name: 'Risk Analysis',
      instructions: 'Coordinate 3 parallel research subagents analyzing different aspects of the contract.',
      config: {
        inputs: ['clauses_parsed.json'],
        outputs: ['liability_findings.json', 'ip_findings.json', 'termination_findings.json'],
        skills: ['contract-law-basics'],
        budget: { maxTurns: 120, maxBudgetUsd: 15.0 },
        estimatedDuration: '2min',
      },
      children: [
        {
          id: 'analyze_liability',
          type: 'agent',
          name: 'Liability Analyst',
          instructions: 'Review all indemnification and liability clauses.',
          config: {
            inputs: ['clauses_parsed.json'],
            outputs: ['liability_findings.json'],
            skills: ['contract-law-basics'],
            budget: { maxTurns: 35, maxBudgetUsd: 4.0 },
          },
          children: [],
        },
        {
          id: 'analyze_ip',
          type: 'agent',
          name: 'IP & Confidentiality Analyst',
          instructions: 'Review all IP, confidentiality, and non-compete clauses.',
          config: {
            inputs: ['clauses_parsed.json'],
            outputs: ['ip_findings.json'],
            skills: ['contract-law-basics'],
            budget: { maxTurns: 35, maxBudgetUsd: 4.0 },
          },
          children: [],
        },
        {
          id: 'analyze_termination',
          type: 'agent',
          name: 'Termination Analyst',
          instructions: 'Review termination, governance, and dispute resolution clauses.',
          config: {
            inputs: ['clauses_parsed.json'],
            outputs: ['termination_findings.json'],
            skills: ['contract-law-basics'],
            budget: { maxTurns: 35, maxBudgetUsd: 4.0 },
          },
          children: [],
        },
      ],
    },
    {
      id: 'review_checkpoint',
      type: 'checkpoint',
      name: 'Attorney Review',
      instructions: 'Present the risk analysis to the reviewing attorney.',
      config: {
        inputs: ['risk_matrix.json'],
        outputs: ['attorney_decisions.json'],
        skills: [],
        presentation: {
          title: 'Contract Risk Analysis Complete',
          sections: ['high_risk', 'medium_risk', 'low_risk', 'clean_clauses'],
        },
      },
      children: [],
    },
    {
      id: 'generate_output',
      type: 'agent',
      name: 'Generate Deliverables',
      instructions: 'Generate redlined contract, negotiation memo, and risk summary.',
      config: {
        inputs: ['clauses_parsed.json', 'risk_matrix.json', 'attorney_decisions.json'],
        outputs: ['redline_changes.md', 'negotiation_memo.md', 'risk_summary.json'],
        skills: ['contract-law-basics'],
        budget: { maxTurns: 100, maxBudgetUsd: 12.0 },
        estimatedDuration: '2min',
      },
      children: [],
    },
  ],
  edges: [
    { from: 'parse_contract', to: 'risk_analysis' },
    { from: 'risk_analysis', to: 'review_checkpoint' },
    { from: 'review_checkpoint', to: 'generate_output' },
  ],
};

const examplePositions = autoLayout(exampleFlow.nodes, exampleFlow.edges);

function WorkspaceContent() {
  const { dagCollapsed } = useWorkspace();

  return (
    <div className="h-screen flex flex-col">
      <WorkspaceToolbar />

      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar — Agent Explorer */}
        <div className="w-56 border-r border-[var(--color-border)] shrink-0 overflow-hidden bg-[var(--color-sidebar-bg)]">
          <AgentExplorer />
        </div>

        {/* Main area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* DAG mini-view (collapsible) */}
          {!dagCollapsed && <DagMiniView />}
          {dagCollapsed && (
            <div className="h-0 border-b border-[var(--color-border)]" />
          )}

          {/* Editor panel(s) — supports split panes */}
          <div className="flex-1 overflow-hidden bg-white">
            <EditorLayout />
          </div>
        </div>
      </div>
    </div>
  );
}

export function WorkspacePage() {
  return (
    <FlowProvider flow={exampleFlow} positions={examplePositions}>
      <WorkspaceProvider>
        <WorkspaceContent />
      </WorkspaceProvider>
    </FlowProvider>
  );
}
