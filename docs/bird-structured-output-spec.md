# Bird Structured Output Spec

Date: 2026-03-17

## Goal

Replace Bird's free-form markdown output with a JSON-only contract. This eliminates code grader failures caused by format/wording variations and establishes the pattern for all agents to communicate via structured output.

## JSON Schema

```json
{
  "domain_analysis": {
    "business_context": "string",
    "bounded_context": "string",
    "ubiquitous_language": [
      { "term": "string", "definition": "string" }
    ]
  },

  "business_rules": [
    {
      "id": "BR-1",
      "rule": "string",
      "invariant": true,
      "invariant_justification": "string",
      "testable_assertion": "string"
    }
  ],

  "acceptance_criteria": [
    {
      "id": "AC-1",
      "given": "string",
      "when": "string",
      "then": "string"
    }
  ],

  "edge_cases": [
    { "scenario": "string", "expected_behavior": "string" }
  ],

  "business_impact": {
    "financial": "string",
    "operational": "string",
    "user": "string",
    "risk": "string",
    "stakeholders_affected": [
      { "group": "string", "impact": "string" }
    ]
  },

  "confidence": {
    "level": 75,
    "reasoning": "string",
    "high_confidence_areas": ["string"],
    "low_confidence_areas": ["string"],
    "assumptions": ["string"]
  },

  "escalations": [
    {
      "type": "contradiction | ambiguity | missing_context | out_of_scope",
      "description": "string",
      "affected_stakeholders": ["string"],
      "options": ["string"],
      "recommendation": "string"
    }
  ],

  "rejection_reasons": [
    { "violation": "string", "business_rule_broken": "string" }
  ]
}
```

## Rules

### Output format
- JSON only. No markdown prose. No fenced code blocks. Raw JSON.

### Stop conditions
- When `escalations` contains any item with type `contradiction`:
  - `confidence.level` must be <= 50
  - `acceptance_criteria` must be empty `[]`
- When `escalations` contains any item with type `out_of_scope`:
  - `business_rules` must be empty `[]`
  - `acceptance_criteria` must be empty `[]`
- When `escalations` contains any item with type `ambiguity` or `missing_context`:
  - `confidence.level` must be <= 55

### Invariant classification heuristic
- `invariant: true` = state integrity, data consistency, physical constraints — if violated, the system is corrupt
- `invariant: false` = business policies, thresholds, time windows, notification preferences — a VP could change this with a policy update

### Confidence calibration
- `confidence.level` reflects SPEC QUALITY, not analysis quality
- Contradictions in spec -> <= 50
- Legal/regulatory without legal review -> <= 60
- Vague/incomplete spec -> <= 55
- Multiple unresolved stakeholder conflicts -> <= 50
- `confidence.reasoning` must justify the number

## Implementation plan

1. Update `agents/bird.md` — replace Output Schema and Output Format sections with JSON-only contract + stop conditions
2. Add `json_field` grader type to `evals/src/graders.ts` — validates JSON fields by path, type, range, count
3. Rewrite Bird scenario graders to use `json_field`
4. Run Bird evals with 3 trials to validate: `bun evals/src/cli.ts --agent bird --trials 3`

## Validation protocol

Every agent spec change MUST be validated via evals with `--trials 3` before shipping:

```bash
bun evals/src/cli.ts --agent <name> --trials 3
```

### Why 3 trials
LLMs are non-deterministic. A single passing trial can be luck. 3 trials reveals whether the change is reliable (pass@1) vs merely capable (pass@3). A scenario that passes 1/3 times means the spec needs tightening.

### Ship criteria
- **pass@1 >= 80%** and **flaky count = 0** → ship
- **pass@3 >= 80%** but **pass@1 < 80%** → fix flaky scenarios first
- **pass@3 < 80%** → blocked, root cause needed

## Grader examples

```yaml
graders:
  - type: json_valid
  - type: json_field
    path: "confidence.level"
    max: 50
  - type: json_field
    path: "escalations"
    min_items: 1
  - type: json_field
    path: "acceptance_criteria"
    max_items: 0
  - type: json_field
    path: "business_rules[*].invariant"
    type_check: "boolean"
```

## json_field grader implementation requirements

### YAML parser must handle all value types
The bare value parser must try: int -> float -> boolean -> string fallback.
`equals: true` must become Python `True` (not string "true").
`equals: 0.5` must become Python `0.5` (not string "0.5").

### Wildcard type_check must handle Python's bool-is-int subclass
In Python, `isinstance(True, int)` is `True`. When checking `type_check: "number"` on wildcard paths:
- Explicitly exclude booleans: `isinstance(v, bool) or not isinstance(v, (int, float))`
- For `type_check: "boolean"`: check `isinstance(v, bool)` specifically
This must be applied to BOTH the wildcard branch AND the non-wildcard branch.

### Escalation scenarios must enforce stop conditions via cross-field graders
Each escalation scenario must include BOTH:
1. `escalations[*].type equals: "<expected_type>"` — to verify the escalation type
2. Confidence max matching the spec's stop condition for that type:
   - contradiction -> max: 50
   - ambiguity -> max: 55
   - missing_context -> max: 55
   - out_of_scope -> no confidence constraint, but business_rules and acceptance_criteria must be empty
