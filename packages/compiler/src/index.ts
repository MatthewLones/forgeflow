// Legacy API (still works, uses IR internally)
export { compilePhasePrompt, compileChildPromptFiles, createCompileContext, FORGEFLOW_PHASE_SYSTEM_PROMPT } from './compiler.js';
export type { CompileContext } from './compiler.js';

// New FlowGraph-based API
export { compilePhase, compileChildPrompts } from './compiler.js';

// IR types and functions (for advanced usage)
export { resolvePhaseIR, resolveChildPromptIRs } from './resolve.js';
export { generateMarkdown } from './generate.js';
