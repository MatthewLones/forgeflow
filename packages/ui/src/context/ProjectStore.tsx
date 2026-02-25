import {
  createContext,
  useContext,
  useCallback,
  useState,
  type ReactNode,
} from 'react';
import type { SkillState } from './SkillContext';

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  version: string;
  nodeCount: number;
  skillCount: number;
  hasCheckpoints: boolean;
  updatedAt: string;
}

export interface SkillSummary {
  name: string;
  description: string;
  referenceCount: number;
}

interface ProjectStoreValue {
  projects: ProjectSummary[];
  skills: SkillSummary[];
  skillData: Record<string, SkillState>;
  createProject: (name: string, description: string) => string;
  deleteProject: (id: string) => void;
}

const ProjectStoreContext = createContext<ProjectStoreValue | null>(null);

// Mock data — replaced by API calls in 5.5
const MOCK_PROJECTS: ProjectSummary[] = [
  {
    id: 'contract_review',
    name: 'Legal Contract Review',
    description: 'Reviews a contract, flags risks, and generates a redlined version with negotiation memo',
    version: '1.0',
    nodeCount: 4,
    skillCount: 1,
    hasCheckpoints: true,
    updatedAt: '2026-02-24T10:30:00Z',
  },
  {
    id: 'research_paper',
    name: 'Research Paper Analysis',
    description: 'Analyzes academic papers, extracts key findings, and generates a literature review',
    version: '0.2',
    nodeCount: 3,
    skillCount: 2,
    hasCheckpoints: false,
    updatedAt: '2026-02-23T15:45:00Z',
  },
  {
    id: 'code_review',
    name: 'Automated Code Review',
    description: 'Reviews pull requests for security issues, performance, and best practices',
    version: '1.1',
    nodeCount: 5,
    skillCount: 3,
    hasCheckpoints: true,
    updatedAt: '2026-02-22T09:00:00Z',
  },
];

const MOCK_SKILLS: SkillSummary[] = [
  {
    name: 'contract-law-basics',
    description: 'California contract law fundamentals for reviewing agreements',
    referenceCount: 8,
  },
  {
    name: 'tax-deductions',
    description: 'Common tax deduction rules for US individual filers',
    referenceCount: 3,
  },
  {
    name: 'code-security',
    description: 'OWASP top 10 and common vulnerability patterns',
    referenceCount: 12,
  },
];

const MOCK_SKILL_DATA: Record<string, SkillState> = {
  'tax-deductions': {
    skillName: 'tax-deductions',
    selectedFilePath: 'SKILL.md',
    dirty: false,
    viewMode: 'edit',
    files: [
      {
        path: 'SKILL.md',
        content: `---
name: tax-deductions
description: "Common tax deduction rules for US individual filers."
version: "1.0.0"
source: "IRS Publications 587, 463, 502"
---

# Tax Deductions Guide

## Overview

Reference files for common US individual tax deductions. Covers home office (Publication 587), vehicle (Publication 463), and medical (Publication 502).

## Quick Reference

| Deduction | Standard Amount | Reference |
|-----------|----------------|-----------|
| Home office (simplified) | $5/sq ft, max 300 sq ft ($1,500) | \`home-office.md\` |
| Standard mileage rate | $0.67/mile (2024) | \`vehicle.md\` |
| Medical threshold | 7.5% of AGI | \`medical.md\` |
`,
      },
      {
        path: 'references/home-office.md',
        content: `---
title: "Home Office Deduction"
category: deductions
relevance: "Load when taxpayer works from home"
---

# Home Office Deduction

## Eligibility Requirements

The home office deduction is available to taxpayers who use a portion of their home **regularly and exclusively** for business purposes.

## Two Calculation Methods

### Simplified Method
- Rate: $5 per square foot
- Maximum area: 300 square feet
- Maximum deduction: $1,500

### Regular Method (Form 8829)
Calculate the **business percentage** of the home and apply to eligible expenses.
`,
      },
      {
        path: 'references/vehicle.md',
        content: `---
title: "Vehicle Expense Deduction"
category: deductions
relevance: "Load when taxpayer uses a vehicle for business"
---

# Vehicle Expense Deduction

## Standard Mileage Rates (2024)

| Purpose | Rate per Mile |
|---------|--------------|
| Business | $0.67 |
| Medical/Moving | $0.21 |
| Charity | $0.14 |
`,
      },
      {
        path: 'references/medical.md',
        content: `---
title: "Medical Expense Deduction"
category: deductions
relevance: "Load when taxpayer has significant medical expenses"
---

# Medical Expense Deduction

## AGI Floor

Medical expenses are deductible only to the extent they exceed **7.5% of AGI**.
`,
      },
    ],
  },
  'contract-law-basics': {
    skillName: 'contract-law-basics',
    selectedFilePath: 'SKILL.md',
    dirty: false,
    viewMode: 'edit',
    files: [
      {
        path: 'SKILL.md',
        content: `---
name: contract-law-basics
description: "California contract law fundamentals for reviewing agreements"
version: "1.0.0"
---

# Contract Law Basics

Fundamental contract law concepts for reviewing legal agreements. Covers formation, interpretation, breach, and remedies.
`,
      },
    ],
  },
  'code-security': {
    skillName: 'code-security',
    selectedFilePath: 'SKILL.md',
    dirty: false,
    viewMode: 'edit',
    files: [
      {
        path: 'SKILL.md',
        content: `---
name: code-security
description: "OWASP top 10 and common vulnerability patterns"
version: "1.0.0"
---

# Code Security

OWASP Top 10 vulnerability patterns and secure coding practices for code review.
`,
      },
    ],
  },
};

export function ProjectStoreProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<ProjectSummary[]>(MOCK_PROJECTS);

  const createProject = useCallback((name: string, description: string) => {
    const id = name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .replace(/^[^a-z]/, 'p');

    const project: ProjectSummary = {
      id,
      name,
      description,
      version: '0.1',
      nodeCount: 0,
      skillCount: 0,
      hasCheckpoints: false,
      updatedAt: new Date().toISOString(),
    };

    setProjects((prev) => [project, ...prev]);
    return id;
  }, []);

  const deleteProject = useCallback((id: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
  }, []);

  return (
    <ProjectStoreContext.Provider
      value={{ projects, skills: MOCK_SKILLS, skillData: MOCK_SKILL_DATA, createProject, deleteProject }}
    >
      {children}
    </ProjectStoreContext.Provider>
  );
}

export function useProjectStore(): ProjectStoreValue {
  const ctx = useContext(ProjectStoreContext);
  if (!ctx) throw new Error('useProjectStore must be used within ProjectStoreProvider');
  return ctx;
}
