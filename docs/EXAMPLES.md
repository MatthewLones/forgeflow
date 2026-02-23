# Example Flows

Three example `FLOW.json` files demonstrating the format across different domains.

## Example 1: Legal Contract Review

A law firm uploads a contract PDF. The flow parses clauses, researches case law, flags risks, and generates a redlined draft + risk memo.

```json
{
  "id": "contract_review",
  "name": "Legal Contract Review",
  "version": "1.0",
  "description": "Reviews a contract, flags risks, and generates a redlined version with negotiation memo",
  "skills": ["contract-law-basics"],
  "budget": {
    "maxTurns": 400,
    "maxBudgetUsd": 40.00,
    "timeoutMs": 1200000
  },
  "nodes": [
    {
      "id": "parse_contract",
      "type": "agent",
      "name": "Parse Contract",
      "instructions": "Read the contract PDF. Extract every clause as a structured object with: clause number, title, full text, clause type (indemnification, limitation of liability, IP assignment, termination, non-compete, confidentiality, governing law, force majeure, other). Identify all defined terms. Write the parsed output.",
      "config": {
        "inputs": ["contract.pdf"],
        "outputs": ["clauses_parsed.json"],
        "skills": [],
        "budget": { "maxTurns": 25, "maxBudgetUsd": 3.00 },
        "estimatedDuration": "45s"
      },
      "children": []
    },
    {
      "id": "risk_analysis",
      "type": "agent",
      "name": "Risk Analysis",
      "instructions": "Coordinate 3 parallel research subagents analyzing different aspects of the contract. Each writes its own findings file.",
      "config": {
        "inputs": ["clauses_parsed.json"],
        "outputs": ["liability_findings.json", "ip_findings.json", "termination_findings.json"],
        "skills": ["contract-law-basics"],
        "budget": { "maxTurns": 120, "maxBudgetUsd": 15.00 },
        "estimatedDuration": "2min"
      },
      "children": [
        {
          "id": "analyze_liability",
          "type": "agent",
          "name": "Liability & Indemnification Analyst",
          "instructions": "Review all indemnification, limitation of liability, warranty, and insurance clauses. For each: assess if terms are one-sided, identify missing protections (mutual indemnification, liability caps, carve-outs), compare against standard market terms. Flag clauses rated HIGH risk (uncapped liability, broad indemnification without mutual terms).",
          "config": {
            "inputs": ["clauses_parsed.json"],
            "outputs": ["liability_findings.json"],
            "skills": ["contract-law-basics"],
            "budget": { "maxTurns": 35, "maxBudgetUsd": 4.00 }
          },
          "children": []
        },
        {
          "id": "analyze_ip",
          "type": "agent",
          "name": "IP & Confidentiality Analyst",
          "instructions": "Review all intellectual property, work-for-hire, assignment, confidentiality, and non-compete clauses. Check: Does IP assignment include pre-existing IP carve-out? Are confidentiality obligations mutual? Is the non-compete scope reasonable (geography, duration, scope)? Flag overly broad IP transfers or one-sided confidentiality.",
          "config": {
            "inputs": ["clauses_parsed.json"],
            "outputs": ["ip_findings.json"],
            "skills": ["contract-law-basics"],
            "budget": { "maxTurns": 35, "maxBudgetUsd": 4.00 }
          },
          "children": []
        },
        {
          "id": "analyze_termination",
          "type": "agent",
          "name": "Termination & Governance Analyst",
          "instructions": "Review termination, renewal, governing law, dispute resolution, force majeure, and assignment clauses. Check: Are termination rights balanced? Is there adequate notice period? Is the governing law favorable? Is arbitration vs litigation specified? Are assignment restrictions reasonable? Flag auto-renewal without notice or unfavorable dispute resolution.",
          "config": {
            "inputs": ["clauses_parsed.json"],
            "outputs": ["termination_findings.json"],
            "skills": ["contract-law-basics"],
            "budget": { "maxTurns": 35, "maxBudgetUsd": 4.00 }
          },
          "children": []
        }
      ]
    },
    {
      "id": "review_checkpoint",
      "type": "checkpoint",
      "name": "Attorney Review",
      "instructions": "Present the risk analysis to the reviewing attorney. Show HIGH and MEDIUM risk items with recommended changes. Ask for direction on each flagged clause: accept as-is, request specific change, or flag for partner review.",
      "config": {
        "inputs": ["risk_matrix.json"],
        "outputs": ["attorney_decisions.json"],
        "skills": [],
        "presentation": {
          "title": "Contract Risk Analysis Complete",
          "sections": ["high_risk", "medium_risk", "low_risk", "clean_clauses"]
        }
      },
      "children": []
    },
    {
      "id": "generate_output",
      "type": "agent",
      "name": "Generate Deliverables",
      "instructions": "Using the risk analysis and attorney decisions, generate three deliverables: (1) A redlined contract with tracked changes for each accepted modification, (2) A negotiation memo summarizing the position on each flagged clause with supporting rationale, (3) A risk summary table for the deal team.",
      "config": {
        "inputs": ["clauses_parsed.json", "risk_matrix.json", "attorney_decisions.json"],
        "outputs": ["redline_changes.md", "negotiation_memo.md", "risk_summary.json"],
        "skills": ["contract-law-basics"],
        "budget": { "maxTurns": 100, "maxBudgetUsd": 12.00 },
        "estimatedDuration": "2min"
      },
      "children": []
    }
  ],
  "edges": [
    { "from": "parse_contract", "to": "risk_analysis" },
    { "from": "risk_analysis", "to": "review_checkpoint" },
    { "from": "review_checkpoint", "to": "generate_output" }
  ]
}
```

---

## Example 2: Insurance Claim Analysis

An adjuster uploads a claim file (incident report, photos, policy document). The flow parses the claim, checks policy coverage, researches comparable claims, and generates a recommendation.

```json
{
  "id": "claim_analysis",
  "name": "Insurance Claim Analysis",
  "version": "1.0",
  "description": "Analyzes an insurance claim against policy terms and generates a coverage recommendation",
  "skills": ["property-insurance-basics", "claims-precedents"],
  "budget": {
    "maxTurns": 350,
    "maxBudgetUsd": 35.00,
    "timeoutMs": 900000
  },
  "nodes": [
    {
      "id": "parse_claim",
      "type": "agent",
      "name": "Parse Claim Documents",
      "instructions": "Read the claim file (incident report, photos, and policy document). Extract: date of loss, type of loss (fire, water, wind, theft, liability), description of damage, claimant info, property details, reported dollar amount. For photos: describe visible damage, assess severity. Write structured claim summary.",
      "config": {
        "inputs": ["incident_report.pdf", "photos.zip", "policy.pdf"],
        "outputs": ["claim_parsed.json", "damage_assessment.json"],
        "skills": [],
        "budget": { "maxTurns": 30, "maxBudgetUsd": 4.00 },
        "estimatedDuration": "1min"
      },
      "children": []
    },
    {
      "id": "coverage_check",
      "type": "agent",
      "name": "Coverage & Precedent Research",
      "instructions": "Coordinate 2 parallel research tracks: policy coverage analysis and comparable claims research.",
      "config": {
        "inputs": ["claim_parsed.json", "damage_assessment.json", "policy.pdf"],
        "outputs": ["coverage_analysis.json", "comparable_claims.json"],
        "skills": ["property-insurance-basics", "claims-precedents"],
        "budget": { "maxTurns": 80, "maxBudgetUsd": 10.00 },
        "estimatedDuration": "90s"
      },
      "children": [
        {
          "id": "analyze_coverage",
          "type": "agent",
          "name": "Policy Coverage Analyst",
          "instructions": "Read the policy document. For each claimed damage item: (1) Identify the applicable coverage section, (2) Check for exclusions, (3) Identify deductible amount, (4) Check sublimits, (5) Determine if the loss type triggers any endorsements. Flag any coverage gaps or potential denial grounds.",
          "config": {
            "inputs": ["claim_parsed.json", "policy.pdf"],
            "outputs": ["coverage_analysis.json"],
            "skills": ["property-insurance-basics"],
            "budget": { "maxTurns": 35, "maxBudgetUsd": 4.00 }
          },
          "children": []
        },
        {
          "id": "research_comparable",
          "type": "agent",
          "name": "Comparable Claims Researcher",
          "instructions": "Using the claims-precedents skill references, find 3-5 comparable claims by loss type, dollar range, and property type. For each: outcome (paid, denied, partial), amount paid, key factors in decision. Focus on claims in the same state/jurisdiction if possible.",
          "config": {
            "inputs": ["claim_parsed.json"],
            "outputs": ["comparable_claims.json"],
            "skills": ["claims-precedents"],
            "budget": { "maxTurns": 30, "maxBudgetUsd": 3.00 }
          },
          "children": []
        }
      ]
    },
    {
      "id": "adjuster_review",
      "type": "checkpoint",
      "name": "Adjuster Review",
      "instructions": "Present coverage analysis and comparable claims to the adjuster. For items with coverage questions, ask: (1) Has the insured provided additional documentation? (2) Should we request an independent inspection? (3) Any mitigating circumstances not in the file?",
      "config": {
        "inputs": ["coverage_analysis.json", "comparable_claims.json"],
        "outputs": ["adjuster_input.json"],
        "skills": [],
        "presentation": {
          "title": "Claim Analysis Complete",
          "sections": ["coverage_summary", "coverage_questions", "comparable_claims"]
        }
      },
      "children": []
    },
    {
      "id": "generate_recommendation",
      "type": "agent",
      "name": "Generate Recommendation",
      "instructions": "Using all analysis artifacts and adjuster input, generate: (1) Coverage determination letter (approve, deny, partial with explanation), (2) Reserve recommendation with line-item breakdown, (3) If partial/deny: specific policy language citations supporting the decision.",
      "config": {
        "inputs": ["claim_parsed.json", "coverage_analysis.json", "comparable_claims.json", "adjuster_input.json"],
        "outputs": ["determination_letter.md", "reserve_recommendation.json", "decision_rationale.md"],
        "skills": ["property-insurance-basics"],
        "budget": { "maxTurns": 80, "maxBudgetUsd": 10.00 },
        "estimatedDuration": "2min"
      },
      "children": []
    }
  ],
  "edges": [
    { "from": "parse_claim", "to": "coverage_check" },
    { "from": "coverage_check", "to": "adjuster_review" },
    { "from": "adjuster_review", "to": "generate_recommendation" }
  ]
}
```

---

## Example 3: Simple Linear Flow (No Subagents, No Checkpoint)

Not every flow needs parallel subagents or checkpoints. Here's a simple 3-node linear flow for summarizing a research paper.

```json
{
  "id": "paper_summary",
  "name": "Research Paper Summary",
  "version": "1.0",
  "description": "Reads a research paper and generates a structured summary with methodology critique",
  "skills": ["research-methodology"],
  "budget": {
    "maxTurns": 100,
    "maxBudgetUsd": 10.00,
    "timeoutMs": 300000
  },
  "nodes": [
    {
      "id": "extract_structure",
      "type": "agent",
      "name": "Extract Paper Structure",
      "instructions": "Read the paper PDF. Extract: title, authors, abstract, research question, hypothesis, methodology (study design, sample size, data collection, analysis method), key findings (with specific numbers/p-values), limitations stated by authors, and references cited.",
      "config": {
        "inputs": ["paper.pdf"],
        "outputs": ["paper_structure.json"],
        "skills": [],
        "budget": { "maxTurns": 25, "maxBudgetUsd": 3.00 },
        "estimatedDuration": "30s"
      },
      "children": []
    },
    {
      "id": "critique_methodology",
      "type": "agent",
      "name": "Methodology Critique",
      "instructions": "Using the research-methodology skill, evaluate the study's methodology. Check: Is the sample size adequate for the claimed effect? Is the study design appropriate for the research question? Are there confounding variables not controlled for? Is the statistical analysis appropriate? Rate methodology as Strong, Adequate, or Weak with specific justifications.",
      "config": {
        "inputs": ["paper_structure.json"],
        "outputs": ["methodology_critique.json"],
        "skills": ["research-methodology"],
        "budget": { "maxTurns": 30, "maxBudgetUsd": 3.00 },
        "estimatedDuration": "45s"
      },
      "children": []
    },
    {
      "id": "generate_summary",
      "type": "agent",
      "name": "Generate Summary",
      "instructions": "Combine the paper structure and methodology critique into a 1-page summary suitable for a journal club presentation. Include: 1-paragraph overview, key findings table, methodology rating with justification, 3 discussion questions for the group.",
      "config": {
        "inputs": ["paper_structure.json", "methodology_critique.json"],
        "outputs": ["paper_summary.md"],
        "skills": [],
        "budget": { "maxTurns": 20, "maxBudgetUsd": 2.00 },
        "estimatedDuration": "30s"
      },
      "children": []
    }
  ],
  "edges": [
    { "from": "extract_structure", "to": "critique_methodology" },
    { "from": "critique_methodology", "to": "generate_summary" }
  ]
}
```

---

## Pattern Observations

Across all three examples, the same structure holds:

1. **Parse** → structured JSON from raw input
2. **Research/Analyze** → parallel domain-specific investigation (optional)
3. **Checkpoint** → human expert reviews + provides input (optional)
4. **Generate** → professional deliverables from all prior outputs

The format is domain-agnostic. The domain knowledge lives in the skills and the node instructions — not in the flow structure itself.

## How These Execute

The engine runs each top-level node as a separate phase in its own sandbox:

- **Example 1 (Contract Review)**: 4 phases. Phase 1 sandbox loads no skills (just parsing). Phase 2 sandbox loads `contract-law-basics` and spawns 3 subagents within the sandbox. Checkpoint pauses with zero cost. Phase 4 sandbox loads `contract-law-basics` again with all prior outputs.
- **Example 2 (Insurance Claim)**: 4 phases. Same pattern — skills loaded only where needed.
- **Example 3 (Paper Summary)**: 3 phases, no subagents, no checkpoint. The simplest case — 3 sequential sandbox runs with state serialized between each.

State is serialized to the state store between every phase. Each sandbox gets only the input files and skills it declares. See [ARCHITECTURE.md](ARCHITECTURE.md) for the full execution model.
