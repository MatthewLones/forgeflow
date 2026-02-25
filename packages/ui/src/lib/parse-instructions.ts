export interface ParsedInstructions {
  skills: string[];
  agentRefs: string[];
  interrupts: string[];
  hasMerge: boolean;
}

const SKILL_PATTERN = /\/skill:([\w-]+)/g;
const AGENT_PATTERN = /\/\/agent:([\w-]+)/g;
const MERGE_PATTERN = /\/merge\b/g;
const INTERRUPT_PATTERN = /\/interrupt:(approval|qa|selection|review|escalation)\b/g;

export function parseInstructions(text: string): ParsedInstructions {
  const skills = [...new Set([...text.matchAll(SKILL_PATTERN)].map((m) => m[1]))];
  const agentRefs = [...new Set([...text.matchAll(AGENT_PATTERN)].map((m) => m[1]))];
  const interrupts = [...new Set([...text.matchAll(INTERRUPT_PATTERN)].map((m) => m[1]))];
  const hasMerge = MERGE_PATTERN.test(text);

  return { skills, agentRefs, interrupts, hasMerge };
}
