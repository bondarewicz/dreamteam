# Eval: Team — Draft — AutoMapper Dependency Removal (Reconstructed)

## Overview

Reconstructed from Dream Team session on 2026-03-31 against the Willow codebase (C#/.NET, DDD/event sourcing, MongoDB read models). Full pipeline: parallel analysis → human checkpoint → implementation → review → fix-verify loop × 2.

Source session: `a5b1b344-8fd6-402f-a22b-95431ecf3985` in Willow project.

---

category: draft

graders: []

## Session Timeline

| Phase | Agent(s) | Task | Outcome |
|-------|----------|------|---------|
| 1 | Bird, MJ, Kobe (parallel) | Analyze AutoMapper dependency and removal approaches | 5 options assessed, risks identified |
| 2 | Human | "option C include all requirements from both mj & kobe" | Selected manual mapping with extension methods |
| 3 | Coach K | Cleanup remaining AutoMapper refs Shaq missed | Mechanical fixes: package refs, test fixtures, type errors |
| 4 | Kobe | Review implementation | Verdict: SHIP (92% confidence) |
| 5 | Human | "why no new tests?" → "route to shaq to fix then kobe to double check" | Caught missing test coverage |
| 6 | Shaq | Add 36 mapping + merge-semantic tests | 111 total tests passing |
| 7 | Kobe | Verify tests | Verdict: SHIP (95%), flagged ToTrackableItemVm gap |
| 8 | Shaq | Add 7 ToTrackableItemVm tests | 118 total tests passing |
| 9 | Human | "BR-4 comment is useless, explain" | Caught opaque internal reference leaking into code |

## Prompt

prompt: |
  Build the solution at src/Willow.sln. The build will fail due to AutoMapper 12.0.1 vulnerability (GHSA-rvv3-g6hj-g44x) with warnings-as-errors enabled.

  /team suggest possible approaches to avoid automapper dependency, use bird, mj & kobe in parallel and present their suggestions

## Phase 1: Parallel Analysis

### Coach K → Bird

coach_k_prompt_bird: |
  You are Bird, the Domain Authority. Analyze the AutoMapper dependency in this C#/.NET codebase and suggest approaches to remove it.

  Context: The build is failing because AutoMapper 12.0.1 has a known high severity vulnerability (GHSA-rvv3-g6hj-g44x) and warnings-as-errors is enabled. The solution is at src/Willow.sln.

  Your task:
  1. Find all usages of AutoMapper across the codebase (Profile classes, .Map() calls, CreateMap configurations, IMapper injections)
  2. Assess the DOMAIN impact of removing AutoMapper — what mappings exist, how complex are they, what business rules are encoded in mapping profiles?
  3. Suggest approaches from a DOMAIN correctness perspective:
     - Which mappings are trivial (1:1 property copies) vs complex (custom resolvers, value converters, conditional logic)?
     - What risks exist in manual mapping (missed properties, broken invariants)?
     - What acceptance criteria should any replacement meet?

  Focus on what "correct" means for the mapping layer. Output your analysis as structured findings.

bird_reference_output: |
  {
    "domain_analysis": {
      "business_context": "Willow is a shipment tracking and logistics system using DDD with event sourcing (BullOak) and CQRS. AutoMapper serves as the mapping layer in three distinct flows: (1) Event-to-ViewModel denormalization for MongoDB read models, (2) Command-model-to-Event-model translation in the Application layer, and (3) API-request-to-Command-model translation at the API boundary. The vulnerability GHSA-rvv3-g6hj-g44x in AutoMapper 12.0.1 is blocking the build due to warnings-as-errors.",
      "bounded_context": "Willow (Shipment Tracking & Status)",
      "ubiquitous_language": [
        {"term": "StatusElement", "definition": "A domain concept representing a discrete shipment status type with metadata including visibility, blocking status, delay category, and advice messages."},
        {"term": "ScanGroup", "definition": "A named grouping of carrier scans, used to classify raw scan data from carriers into meaningful business categories."},
        {"term": "TrackingVM", "definition": "The denormalized read model for shipment tracking, containing the full tracking state: legs, status, dates, signature, and current location."},
        {"term": "Denormalizer", "definition": "An event consumer that projects domain events into MongoDB read-model documents."},
        {"term": "IsDeliveryLeg / IsLastLeg", "definition": "A naming translation between event model (IsDeliveryLeg) and view model (IsLastLeg) that encodes business knowledge."}
      ]
    },
    "business_rules": [
      "BR-1: TrackingNumber must be extracted from value object (.Value) — domain uses value objects, VMs use primitives",
      "BR-2: IsDeliveryLeg (event) maps to IsLastLeg (VM) — domain name translation",
      "BR-3: Status must be initialized to new Status() on ShipmentTrackingInitiated, never null",
      "BR-4: CarrierDesignatedDeliveryScan and Signatory fields intentionally excluded from Scan VM read model",
      "BR-5: Map-into-existing-object pattern preserves unmapped fields — merge semantics, not replacement"
    ]
  }

### Coach K → MJ

coach_k_prompt_mj: |
  You are MJ, the Strategic Systems Architect. Analyze the AutoMapper dependency in this C#/.NET codebase and suggest architectural approaches to remove it.

  Context: The build is failing because AutoMapper 12.0.1 has a known high severity vulnerability (GHSA-rvv3-g6hj-g44x) and warnings-as-errors is enabled. The solution is at src/Willow.sln.

  Your task:
  1. Map the AutoMapper dependency graph — which projects reference it, how is it registered in DI, where are Profile classes?
  2. Assess the architectural approaches to eliminate AutoMapper:
     - Option A: Upgrade AutoMapper to a patched version
     - Option B: Replace with Mapperly (source-generator-based)
     - Option C: Replace with manual mapping (extension methods)
     - Option D: Replace with implicit/explicit operators
     - Option E: Suppress the vulnerability warning (NoWarn NU1903)
  3. For each option: effort estimate, risk, architectural trade-offs, migration path
  4. Recommend the best approach considering this is a DDD/event sourcing codebase with MongoDB read models

mj_reference_output: |
  {
    "executive_summary": "AutoMapper 12.0.1 has a high-severity DoS vulnerability with no free patched version. Fix exists only in 15.1.1+ / 16.1.1+ which require commercial license. 4 production projects and 5 test projects reference AutoMapper. ~30 mapping configurations across 3 Profile classes and 2 MappingDefinitions files. Recommended: Option C (manual mapping via extension methods).",
    "architecture": {
      "components": [
        {"name": "Willow.Denormalizer", "responsibility": "Event-to-read-model projection (3 Profile classes, heavy mapper usage including existing-object mapping)"},
        {"name": "Willow.Application", "responsibility": "Command-to-event mapping via MappingDefinitions and CrudProcessManager (~10 maps with ForMember/ReverseMap)"},
        {"name": "Willow.API", "responsibility": "API request-to-command mapping (4 trivial maps)"},
        {"name": "Willow.Application.Host", "responsibility": "DI registration, also references ParcelVision.Utile.Messages.Converters.AutoMapper"}
      ]
    },
    "options_analysis": [
      {"option": "A: Upgrade", "effort": "S", "verdict": "BLOCKED — requires commercial license (RPL-1.5)"},
      {"option": "B: Mapperly", "effort": "M", "verdict": "BLOCKED — does not support map-into-existing-object pattern used in 5 denormalizer call sites"},
      {"option": "C: Manual mapping", "effort": "M", "verdict": "RECOMMENDED — zero dependency, compile-time safe, supports merge semantics via ApplyFrom pattern"},
      {"option": "D: Operators", "effort": "M", "verdict": "NOT RECOMMENDED — pollutes domain types with mapping concerns"},
      {"option": "E: Suppress warning", "effort": "S", "verdict": "ACCEPTABLE as temporary unblock only"}
    ],
    "recommended_approach": "Option C with migration order: API (simplest) → Application (moderate) → Denormalizer (most complex) → Host (cleanup)"
  }

### Coach K → Kobe

coach_k_prompt_kobe: |
  You are Kobe, the Relentless Quality & Risk Enforcer. Analyze the risks of removing the AutoMapper dependency from this C#/.NET codebase.

  Context: The build is failing because AutoMapper 12.0.1 has a known high severity vulnerability (GHSA-rvv3-g6hj-g44x) and warnings-as-errors is enabled. The solution is at src/Willow.sln.

  Your task:
  1. Find all AutoMapper usages — Profile classes, .Map() calls, IMapper injections, CreateMap configs
  2. Identify the HIGH-RISK areas:
     - Mappings with custom logic
     - Mappings between complex object graphs
     - Places where convention-based mapping silently maps properties by name
  3. For each replacement approach, what could break?
  4. What testing strategy would you require for any migration approach?

  Be ruthless — find every way this migration could go wrong.

kobe_reference_output: |
  {
    "summary": {
      "verdict": "SHIP WITH FIXES",
      "one_liner": "AutoMapper removal is feasible but carries significant risk in the denormalizer map-into-existing-object pattern and the undocumented Utile.Messages.Converters.AutoMapper transitive dependency"
    },
    "critical_findings": [
      {
        "title": "Map-into-existing-object pattern will silently corrupt data if reimplemented incorrectly",
        "severity": "Critical",
        "detail": "mapper.Map(source, destination) merges source properties into existing destination. 5 call sites in TrackingDenormalizer and DenormalizerBase. Manual replacement must mutate in-place, not create new objects — naive replacement would null out Legs, Status, CurrentLocation."
      },
      {
        "title": "Convention-based silent name matching covers ~30 properties",
        "severity": "High",
        "detail": "AutoMapper matches properties by name. Any property missed in manual mapping silently becomes null/default. No compile-time error."
      },
      {
        "title": "Utile.Messages.Converters.AutoMapper transitive dependency",
        "severity": "Medium",
        "detail": "Internal package in Application.Host. Must verify if IEventConverter depends on IMapper at runtime."
      }
    ],
    "pre_migration_requirements": [
      "AssertConfigurationIsValid() equivalent tests for all 3 Profile classes",
      "Merge-semantics tests proving ApplyFrom preserves unmapped fields",
      "Property-by-property completeness tests for every mapping method"
    ]
  }

## Phase 2: Human Decision

human_decision: |
  "option C include all requirements from both mj & kobe"

  Selected Option C (manual mapping via extension methods) with:
  - MJ's migration order: API → Application → Denormalizer → Host → Tests
  - Kobe's pre-migration requirements: merge-semantic tests, completeness tests, property-by-property verification

## Phase 3: Implementation (Shaq) + Coach K Cleanup

coach_k_prompt_shaq: |
  Implement Option C: Replace AutoMapper with manual mapping extension methods across the entire Willow codebase.

  Migration order (from MJ): API (4 trivial maps) → Application (~10 maps with ForMember/ReverseMap) → Denormalizer (3 profiles, existing-object mapping) → Host (internal package) → Tests (6 fixtures).

  Kobe's mandatory requirements:
  - Map-into-existing-object uses void ApplyFrom() pattern that ONLY sets specific mapped fields
  - TrackingNumber.Value extraction, IsDeliveryLeg→IsLastLeg rename, Status initialized to new Status()
  - CarrierDesignatedDeliveryScan and Signatory intentionally excluded from Scan VM
  - Add AssertConfigurationIsValid() equivalent tests before removing AutoMapper

shaq_reference_output: |
  Implementation completed across 50 files (+2,011 / -455 lines).
  - 3 new Mapping/ directories with static extension methods
  - DenormalizerBase uses abstract Map<TEvent> instead of IMapper
  - All denormalizers use ApplyFrom() merge pattern
  - All test fixtures updated
  - Package references removed from 4 csproj + Directory.Packages.props
  - Build: 0 warnings, 0 errors

  NOTE: Shaq did NOT add the pre-migration tests Kobe required. Coach K caught this after human flagged "why no new tests?"

## Phase 4: Review (Kobe)

kobe_review_reference_output: |
  {
    "summary": {"verdict": "SHIP", "one_liner": "AutoMapper removal is thorough and correct — all manual mappings faithfully reproduce the old convention-based behavior with proper merge semantics, null guards, and intentional exclusions."},
    "critical_findings": [],
    "important_issues": [
      {"title": "Orphaned ParcelVision.Utile.Messages.Converters.AutoMapper package reference in Application.Host"},
      {"title": "Old Enum.Parse mapping for StatusElement.Type was broken — new mapping is a behavioral improvement (latent bug fixed)"}
    ]
  }

## Phase 5: Fix-Verify Loop 1 — Missing Tests

human_intervention: |
  "why tests were not ran?" → "why no new tests?" → "route to shaq to fix then kobe to double check"

  Human caught that Kobe's pre-migration test requirements were never implemented. Coach K acknowledged: "I dropped the ball."

coach_k_prompt_shaq_tests: |
  Add missing tests for the AutoMapper removal migration:
  1. Tracking mapping completeness tests — every property on destination VM correctly mapped
  2. ScanGroup mapping completeness tests
  3. Merge-semantics tests (CRITICAL) — prove ApplyFrom preserves unmapped fields on existing VMs

  For each ApplyFrom method: create VM with ALL fields populated, call ApplyFrom, assert mapped fields changed AND unmapped fields preserved.

shaq_tests_reference_output: |
  36 new tests across 4 files, all passing (111 total):
  - TrackingMappingCompletenessTests.cs — ToTrackingVm, ToTrackingLegVm, ToScanVm
  - TrackingMergeSemanticTests.cs — ApplyFrom merge semantics for all TrackingVM/TrackingLegVM methods
  - ScanGroupMappingTests.cs — ToScanGroupVm, ApplyFrom for Created/Updated
  - StatusElementApplyFromTests.cs — ApplyFrom for Created/Updated

kobe_verify_reference_output: |
  {
    "summary": {"verdict": "SHIP", "one_liner": "36 new mapping tests are well-structured, cover all ApplyFrom/To methods with both positive and merge-semantic preservation assertions, and all 111 tests pass."},
    "critical_findings": [],
    "important_issues": [
      {"title": "ToTrackableItemVm (2 overloads) lack dedicated unit tests", "severity": "Low"}
    ]
  }

## Phase 6: Fix-Verify Loop 2 — Gap Coverage

shaq_trackable_reference_output: |
  7 new tests for both ToTrackableItemVm overloads added to TrackingMappingCompletenessTests.cs.
  All 118 tests pass. Build clean with zero warnings.

## Expected Team Behaviors

expected_behavior: |
  Phase 1 — Parallel Analysis:
  - Bird identifies mapping flows (event→VM, command→event, API→command) and domain-specific translation rules (value objects, name renames, intentional exclusions)
  - MJ evaluates at least 3 architectural options with effort/risk trade-offs. Discovers that Mapperly is blocked by map-into-existing-object limitation and upgrade is blocked by commercial license
  - Kobe identifies map-into-existing-object merge semantics as the critical risk and demands pre-migration tests
  - All three agents produce structured JSON output

  Phase 2 — Human Checkpoint:
  - Coach K presents consolidated comparison table of options with per-agent assessment
  - Human can make an informed decision combining domain, architecture, and risk perspectives

  Phase 3 — Implementation:
  - Shaq follows MJ's migration order (simplest to hardest)
  - Implementation uses ApplyFrom() merge pattern for denormalizer as specified
  - Build passes with 0 warnings, 0 errors

  Phase 4 — Review:
  - Kobe verifies property-by-property correctness of manual mappings vs what AutoMapper did
  - Kobe catches non-blocking issues (orphaned package ref, latent bug fix)

  Phase 5+ — Fix-Verify:
  - When gaps are found, Shaq adds targeted tests and Kobe re-verifies
  - Loop continues until Kobe says SHIP with no outstanding gaps

failure_modes: |
  - Bird fails to identify map-into-existing-object merge semantics as a domain concern
  - MJ recommends Mapperly without discovering it doesn't support map-into-existing-object
  - MJ fails to discover that AutoMapper upgrade requires commercial license
  - Kobe doesn't demand pre-migration tests for merge semantics
  - Shaq creates new objects instead of mutating existing ones in ApplyFrom (would null out fields)
  - Shaq misses TrackingNumber.Value extraction or IsDeliveryLeg→IsLastLeg rename
  - Shaq skips test requirements without Coach K catching it
  - Kobe SHIP verdict without verifying all properties are mapped
  - Coach K presents options without clear comparison enabling human decision
  - Internal references (BR-4) leak into production code comments without context

scoring_rubric: |
  This is a team eval — scoring covers the full pipeline, not individual agents.

  pass:
    - All 3 parallel agents produce structured analysis with distinct perspectives
    - Coach K presents consolidated comparison enabling informed human decision
    - At least 3 options evaluated with concrete trade-offs (not just "it depends")
    - Map-into-existing-object merge semantics identified as critical risk by at least one agent
    - Implementation uses merge pattern (ApplyFrom), not new-object replacement
    - Build passes after implementation
    - Review catches any missed properties or test gaps
    - Fix-verify loop resolves all issues to SHIP verdict

  partial:
    - Analysis produced but options poorly differentiated
    - Implementation correct but tests not added or incomplete
    - Review misses property coverage gaps
    - Merge semantics identified but not enforced in implementation

  fail:
    - Agents recommend Mapperly or upgrade without discovering blockers
    - Implementation uses new-object pattern instead of merge (would corrupt data)
    - No review performed after implementation
    - Coach K doesn't consolidate parallel analysis into actionable comparison
    - Human checkpoint skipped — implementation starts without approval
