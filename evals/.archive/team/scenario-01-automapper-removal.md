# Eval: Team — Scenario 01 — AutoMapper Dependency Removal (Regression)

## Overview

Tests the full Dream Team pipeline on the Willow AutoMapper removal scenario. Reconstructed from a real session (source: `a5b1b344-8fd6-402f-a22b-95431ecf3985`) against the Willow codebase (C#/.NET, DDD/event sourcing, MongoDB read models). Full pipeline: parallel analysis (Bird + MJ + Kobe) → human decision fixture → implementation (Shaq) → review (Kobe) → fix-verify loop (Shaq tests + Kobe verify).

This is a regression test for cross-agent information propagation: Bird must identify merge semantics, Kobe must demand tests, and Shaq must implement ApplyFrom pattern — not new-object creation. If Shaq ignores Kobe's pre-migration requirements, the team eval fails even if individual agent outputs are well-structured.

---

category: regression

graders:
  - type: json_valid
  - type: json_field
    path: "orchestration_decision.action"
    expected: "present_checkpoint"
  - type: json_field
    path: "checkpoint_analysis.agent_findings"
    min_items: 3

---

## Phase 1: Parallel Analysis — Bird + MJ + Kobe

phase_1_agent: bird

phase_1_prompt: |
  You are Bird, the Domain Authority. Analyze the AutoMapper dependency in this C#/.NET codebase and suggest approaches to remove it.

  IMPORTANT: All source code is provided inline below. Do NOT search the filesystem — the codebase is not available in this environment. Analyze the code snippets provided.

  Context: The build is failing because AutoMapper 12.0.1 has a known high severity vulnerability (GHSA-rvv3-g6hj-g44x) and warnings-as-errors is enabled (NU1903 audit warning). No free patched version exists — 15.1.1+ requires commercial license (RPL-1.5).

  ## Codebase Context (provided for eval — do NOT search the filesystem)

  ### Project Structure
  src/Willow.sln contains 4 production projects referencing AutoMapper:
  - Willow.API (4 trivial maps)
  - Willow.Application (10 maps with ForMember/ReverseMap)
  - Willow.Denormalizer (3 Profile classes, 5 map-into-existing-object call sites)
  - Willow.Application.Host (references ParcelVision.Utile.Messages.Converters.AutoMapper)

  ### Key Files

  #### src/Willow.Denormalizer/DenormalizerBase.cs
  ```csharp
  protected TDenormalizerVM Map<TEvent>(TEvent @event, TDenormalizerVM viewModel)
  {
      return _mapper.Map(@event, viewModel); // Map INTO existing object — merge semantics
  }
  ```

  #### src/Willow.Denormalizer/Tracking/TrackingDenormalizerProfile.cs
  ```csharp
  CreateMap<ShipmentTrackingInitiated, TrackingVM>()
      .ForMember(dest => dest.Status, opt => opt.MapFrom(src => new Status()))
      .ForMember(dest => dest.TrackingNumber, opt => opt.MapFrom(src => src.TrackingNumber.Value));

  CreateMap<ShipmentLegAppended, TrackingLegVM>()
      .ForMember(dest => dest.IsLastLeg, opt => opt.MapFrom(src => src.IsDeliveryLeg));

  CreateMap<ScanHistory.Models.Scan, ScanVM>()
      .ForMember(dest => dest.CarrierDesignatedDeliveryScan, opt => opt.Ignore())
      .ForMember(dest => dest.Signatory, opt => opt.Ignore());
  ```

  #### src/Willow.Application/MappingDefinitions.cs
  ```csharp
  // 6 ReverseMap() calls, StatusElement command→event with Enum.Parse
  CreateMap<Commands.V1.Models.StatusElement, Events.V1.Models.StatusElement>()
      .ForMember(dest => dest.Type, opt => opt.MapFrom(src =>
          (StatusElementType)Enum.Parse(typeof(StatusElementType), src.Type)))
      .ForMember(dest => dest.StatusElementId, opt => opt.Ignore());
  ```

  #### AutoMapper Vulnerability
  AutoMapper 12.0.1 has CVE GHSA-rvv3-g6hj-g44x (high severity DoS).
  No free patched version — 15.1.1+ requires commercial license (RPL-1.5).
  Build fails with warnings-as-errors enabled (NU1903 audit warning).

  Your task:
  1. Assess the DOMAIN impact of removing AutoMapper — what mappings exist, how complex are they, what business rules are encoded in mapping profiles?
  2. Suggest approaches from a DOMAIN correctness perspective:
     - Which mappings are trivial (1:1 property copies) vs complex (custom resolvers, value converters, conditional logic)?
     - What risks exist in manual mapping (missed properties, broken invariants)?
     - What acceptance criteria should any replacement meet?

  Focus on what "correct" means for the mapping layer. Output your analysis as structured findings.
  CRITICAL: Respond with raw JSON only. First character { last character }. No markdown fences.

phase_1_expected_behavior: |
  Bird must identify the three distinct mapping flows in the Willow codebase:
  - Event-to-ViewModel denormalization for MongoDB read models
  - Command-model-to-Event-model translation in the Application layer
  - API-request-to-Command-model translation at the API boundary

  Bird must identify domain-specific translation rules:
  - TrackingNumber.Value extraction (domain value object → VM primitive)
  - IsDeliveryLeg → IsLastLeg rename (domain name translation)
  - Status initialized to new Status() on ShipmentTrackingInitiated (never null)
  - CarrierDesignatedDeliveryScan and Signatory intentionally excluded from Scan VM
  - Map-into-existing-object pattern preserves unmapped fields (merge semantics, not replacement)

  Bird must produce structured JSON output with domain_analysis, business_rules, acceptance_criteria, and confidence fields.

phase_1_graders:
  - type: json_valid
  - type: json_field
    path: "business_rules"
    min_items: 3
  - type: json_field
    path: "acceptance_criteria"
    min_items: 2
  - type: contains
    field: "business_rules"
    value: "merge"
    description: "Bird must identify merge semantics / map-into-existing-object pattern"

phase_1_reference_output: |
  {
    "domain_analysis": {
      "business_context": "Willow is a shipment tracking and logistics system using DDD with event sourcing (BullOak) and CQRS. AutoMapper serves as the mapping layer in three distinct flows: (1) Event-to-ViewModel denormalization for MongoDB read models, (2) Command-model-to-Event-model translation in the Application layer, and (3) API-request-to-Command-model translation at the API boundary. The vulnerability GHSA-rvv3-g6hj-g44x in AutoMapper 12.0.1 is blocking the build due to warnings-as-errors.",
      "bounded_context": "Willow (Shipment Tracking & Status)",
      "ubiquitous_language": [
        {"term": "StatusElement", "definition": "A domain concept representing a discrete shipment status type with metadata including visibility, blocking status, delay category, and advice messages."},
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

---

## Phase 2: Parallel Analysis — MJ

phase_2_agent: mj

phase_2_prompt: |
  You are MJ, the Strategic Systems Architect. Analyze the AutoMapper dependency in this C#/.NET codebase and suggest architectural approaches to remove it.

  IMPORTANT: All source code is provided inline below. Do NOT search the filesystem — the codebase is not available in this environment. Analyze the code snippets provided.

  Context: The build is failing because AutoMapper 12.0.1 has a known high severity vulnerability (GHSA-rvv3-g6hj-g44x) and warnings-as-errors is enabled (NU1903 audit warning). No free patched version exists — 15.1.1+ requires commercial license (RPL-1.5).

  ## Codebase Context (provided for eval — do NOT search the filesystem)

  ### Project Structure
  src/Willow.sln contains 4 production projects referencing AutoMapper:
  - Willow.API (4 trivial maps)
  - Willow.Application (10 maps with ForMember/ReverseMap)
  - Willow.Denormalizer (3 Profile classes, 5 map-into-existing-object call sites)
  - Willow.Application.Host (references ParcelVision.Utile.Messages.Converters.AutoMapper)

  ### Key Files

  #### src/Willow.Denormalizer/DenormalizerBase.cs
  ```csharp
  protected TDenormalizerVM Map<TEvent>(TEvent @event, TDenormalizerVM viewModel)
  {
      return _mapper.Map(@event, viewModel); // Map INTO existing object — merge semantics
  }
  ```

  #### src/Willow.Denormalizer/Tracking/TrackingDenormalizerProfile.cs
  ```csharp
  CreateMap<ShipmentTrackingInitiated, TrackingVM>()
      .ForMember(dest => dest.Status, opt => opt.MapFrom(src => new Status()))
      .ForMember(dest => dest.TrackingNumber, opt => opt.MapFrom(src => src.TrackingNumber.Value));

  CreateMap<ShipmentLegAppended, TrackingLegVM>()
      .ForMember(dest => dest.IsLastLeg, opt => opt.MapFrom(src => src.IsDeliveryLeg));

  CreateMap<ScanHistory.Models.Scan, ScanVM>()
      .ForMember(dest => dest.CarrierDesignatedDeliveryScan, opt => opt.Ignore())
      .ForMember(dest => dest.Signatory, opt => opt.Ignore());
  ```

  #### src/Willow.Application/MappingDefinitions.cs
  ```csharp
  // 6 ReverseMap() calls, StatusElement command→event with Enum.Parse
  CreateMap<Commands.V1.Models.StatusElement, Events.V1.Models.StatusElement>()
      .ForMember(dest => dest.Type, opt => opt.MapFrom(src =>
          (StatusElementType)Enum.Parse(typeof(StatusElementType), src.Type)))
      .ForMember(dest => dest.StatusElementId, opt => opt.Ignore());
  ```

  #### AutoMapper Vulnerability
  AutoMapper 12.0.1 has CVE GHSA-rvv3-g6hj-g44x (high severity DoS).
  No free patched version — 15.1.1+ requires commercial license (RPL-1.5).
  Build fails with warnings-as-errors enabled (NU1903 audit warning).

  Your task:
  1. Assess the architectural approaches to eliminate AutoMapper:
     - Option A: Upgrade AutoMapper to a patched version
     - Option B: Replace with Mapperly (source-generator-based)
     - Option C: Replace with manual mapping (extension methods)
     - Option D: Replace with implicit/explicit operators
     - Option E: Suppress the vulnerability warning (NoWarn NU1903)
  2. For each option: effort estimate, risk, architectural trade-offs, migration path
  3. Recommend the best approach considering this is a DDD/event sourcing codebase with MongoDB read models

  CRITICAL: Respond with raw JSON only. First character { last character }. No markdown fences.

phase_2_expected_behavior: |
  MJ must evaluate at least 3 architectural options with concrete effort/risk trade-offs.

  MJ must discover that:
  - Option A (Upgrade) is BLOCKED — requires commercial license (RPL-1.5) for patched versions
  - Option B (Mapperly) is BLOCKED — does not support map-into-existing-object pattern used in denormalizer
  - Option C (Manual mapping) is RECOMMENDED — zero dependency, compile-time safe, supports merge semantics

  MJ must identify the 4 production projects referencing AutoMapper and provide migration order.
  MJ must produce structured JSON output with executive_summary, architecture, options_analysis, and recommended_approach.

phase_2_graders:
  - type: json_valid
  - type: json_field
    path: "options_analysis"
    min_items: 3
  - type: contains
    field: "options_analysis"
    value: "BLOCKED"
    description: "MJ must discover that upgrade and Mapperly are blocked"
  - type: contains
    field: "recommended_approach"
    value: "C"
    description: "MJ must recommend Option C (manual mapping)"

phase_2_reference_output: |
  {
    "executive_summary": "AutoMapper 12.0.1 has a high-severity DoS vulnerability with no free patched version. Fix exists only in 15.1.1+ / 16.1.1+ which require commercial license. 4 production projects and 5 test projects reference AutoMapper. ~30 mapping configurations across 3 Profile classes and 2 MappingDefinitions files. Recommended: Option C (manual mapping via extension methods).",
    "options_analysis": [
      {"option": "A: Upgrade", "effort": "S", "verdict": "BLOCKED — requires commercial license (RPL-1.5)"},
      {"option": "B: Mapperly", "effort": "M", "verdict": "BLOCKED — does not support map-into-existing-object pattern used in 5 denormalizer call sites"},
      {"option": "C: Manual mapping", "effort": "M", "verdict": "RECOMMENDED — zero dependency, compile-time safe, supports merge semantics via ApplyFrom pattern"},
      {"option": "D: Operators", "effort": "M", "verdict": "NOT RECOMMENDED — pollutes domain types with mapping concerns"},
      {"option": "E: Suppress warning", "effort": "S", "verdict": "ACCEPTABLE as temporary unblock only"}
    ],
    "recommended_approach": "Option C with migration order: API (simplest) → Application (moderate) → Denormalizer (most complex) → Host (cleanup)"
  }

---

## Phase 3: Parallel Analysis — Kobe

phase_3_agent: kobe

phase_3_prompt: |
  You are Kobe, the Relentless Quality & Risk Enforcer. Analyze the risks of removing the AutoMapper dependency from this C#/.NET codebase.

  IMPORTANT: All source code is provided inline below. Do NOT search the filesystem — the codebase is not available in this environment. Analyze the code snippets provided.

  Context: The build is failing because AutoMapper 12.0.1 has a known high severity vulnerability (GHSA-rvv3-g6hj-g44x) and warnings-as-errors is enabled (NU1903 audit warning). No free patched version exists — 15.1.1+ requires commercial license (RPL-1.5).

  ## Codebase Context (provided for eval — do NOT search the filesystem)

  ### Project Structure
  src/Willow.sln contains 4 production projects referencing AutoMapper:
  - Willow.API (4 trivial maps)
  - Willow.Application (10 maps with ForMember/ReverseMap)
  - Willow.Denormalizer (3 Profile classes, 5 map-into-existing-object call sites)
  - Willow.Application.Host (references ParcelVision.Utile.Messages.Converters.AutoMapper)

  ### Key Files

  #### src/Willow.Denormalizer/DenormalizerBase.cs
  ```csharp
  protected TDenormalizerVM Map<TEvent>(TEvent @event, TDenormalizerVM viewModel)
  {
      return _mapper.Map(@event, viewModel); // Map INTO existing object — merge semantics
  }
  ```

  #### src/Willow.Denormalizer/Tracking/TrackingDenormalizerProfile.cs
  ```csharp
  CreateMap<ShipmentTrackingInitiated, TrackingVM>()
      .ForMember(dest => dest.Status, opt => opt.MapFrom(src => new Status()))
      .ForMember(dest => dest.TrackingNumber, opt => opt.MapFrom(src => src.TrackingNumber.Value));

  CreateMap<ShipmentLegAppended, TrackingLegVM>()
      .ForMember(dest => dest.IsLastLeg, opt => opt.MapFrom(src => src.IsDeliveryLeg));

  CreateMap<ScanHistory.Models.Scan, ScanVM>()
      .ForMember(dest => dest.CarrierDesignatedDeliveryScan, opt => opt.Ignore())
      .ForMember(dest => dest.Signatory, opt => opt.Ignore());
  ```

  #### src/Willow.Application/MappingDefinitions.cs
  ```csharp
  // 6 ReverseMap() calls, StatusElement command→event with Enum.Parse
  CreateMap<Commands.V1.Models.StatusElement, Events.V1.Models.StatusElement>()
      .ForMember(dest => dest.Type, opt => opt.MapFrom(src =>
          (StatusElementType)Enum.Parse(typeof(StatusElementType), src.Type)))
      .ForMember(dest => dest.StatusElementId, opt => opt.Ignore());
  ```

  #### AutoMapper Vulnerability
  AutoMapper 12.0.1 has CVE GHSA-rvv3-g6hj-g44x (high severity DoS).
  No free patched version — 15.1.1+ requires commercial license (RPL-1.5).
  Build fails with warnings-as-errors enabled (NU1903 audit warning).

  Your task:
  1. Identify the HIGH-RISK areas in the code above:
     - Mappings with custom logic
     - Mappings between complex object graphs
     - Places where convention-based mapping silently maps properties by name
  2. For each replacement approach, what could break?
  3. What testing strategy would you require for any migration approach?

  Be ruthless — find every way this migration could go wrong.
  CRITICAL: Respond with raw JSON only. First character { last character }. No markdown fences.

phase_3_expected_behavior: |
  Kobe must identify the map-into-existing-object merge semantics as the CRITICAL risk.

  Kobe must find:
  - Map-into-existing-object pattern (5 call sites in TrackingDenormalizer and DenormalizerBase) — naive replacement would null out Legs, Status, CurrentLocation
  - Convention-based silent name matching covers ~30 properties — any missed property silently becomes null/default
  - Utile.Messages.Converters.AutoMapper transitive dependency in Application.Host

  Kobe must demand pre-migration tests:
  - AssertConfigurationIsValid() equivalent tests for all Profile classes
  - Merge-semantics tests proving ApplyFrom preserves unmapped fields
  - Property-by-property completeness tests for every mapping method

  Kobe must produce structured JSON with summary.verdict, critical_findings (max 3), and pre_migration_requirements.

phase_3_graders:
  - type: json_valid
  - type: json_field
    path: "critical_findings"
    min_items: 1
  - type: contains
    field: "critical_findings"
    value: "merge"
    description: "Kobe must identify merge semantics as critical risk"
  - type: json_field
    path: "pre_migration_requirements"
    min_items: 1

phase_3_reference_output: |
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
      }
    ],
    "pre_migration_requirements": [
      "AssertConfigurationIsValid() equivalent tests for all 3 Profile classes",
      "Merge-semantics tests proving ApplyFrom preserves unmapped fields",
      "Property-by-property completeness tests for every mapping method"
    ]
  }

---

## Phase 4: Human Decision (Fixture)

phase_4_agent: human

phase_4_prompt: |
  Human decision fixture — inject this response automatically:

  "option C include all requirements from both mj & kobe"

  This selects Option C (manual mapping via extension methods) with:
  - MJ's migration order: API → Application → Denormalizer → Host → Tests
  - Kobe's pre-migration requirements: merge-semantic tests, completeness tests, property-by-property verification

phase_4_expected_behavior: |
  Human fixture injects the decision: Option C with all MJ and Kobe requirements.
  Coach K must consolidate the parallel analysis outputs (Bird + MJ + Kobe) into a comparison table before presenting this checkpoint.
  Coach K must NOT proceed to implementation without presenting the checkpoint to the human.

phase_4_graders:
  - type: fixture
    value: "option C include all requirements from both mj & kobe"

---

## Phase 5: Implementation — Shaq

phase_5_agent: shaq

phase_5_prompt: |
  You are Shaq, the Primary Executor. Given the analysis from prior phases, describe your implementation plan as structured JSON.

  IMPORTANT: Do NOT search the filesystem or write actual code files — this is a planning exercise. Describe what you WOULD implement.

  Context from prior phases:
  - Bird identified: merge semantics (map-into-existing-object), TrackingNumber.Value extraction, IsDeliveryLeg→IsLastLeg rename, Status=new Status() on init, CarrierDesignatedDeliveryScan/Signatory excluded from ScanVM
  - MJ recommended: Option C (manual mapping via extension methods), migration order API → Application → Denormalizer → Host
  - Kobe required: ApplyFrom() void pattern for merge semantics, merge-semantics tests, property completeness tests
  - Human decision: Option C with all MJ and Kobe requirements

  The codebase has 4 production projects:
  - Willow.API (4 trivial maps)
  - Willow.Application (10 maps with ForMember/ReverseMap, 6 ReverseMap calls)
  - Willow.Denormalizer (3 Profile classes, 5 map-into-existing-object call sites via DenormalizerBase.Map<TEvent>)
  - Willow.Application.Host (references ParcelVision.Utile.Messages.Converters.AutoMapper)

  Describe your implementation plan:
  - What files would you create or modify? (List at least 5)
  - What patterns would you use? (Specifically address the ApplyFrom merge pattern for denormalizer)
  - How would you handle the merge semantics in DenormalizerBase?
  - What tests would you add? (Address merge-semantics tests and completeness tests)
  - What is your migration order and why?

  CRITICAL: Your final response must be raw JSON only. First character { last character }. No markdown fences.

phase_5_expected_behavior: |
  Shaq must implement Option C across all 4 production projects:
  - 3 new Mapping/ directories with static extension methods
  - DenormalizerBase uses abstract Map<TEvent> instead of IMapper
  - All denormalizers use ApplyFrom() merge pattern — NOT new-object creation
  - All test fixtures updated
  - Package references removed from 4 csproj + Directory.Packages.props
  - Build: 0 warnings, 0 errors

  Shaq must implement all pre-migration tests Kobe required:
  - Merge-semantics tests for all ApplyFrom methods
  - Property completeness tests for all mapping methods
  - Build and tests must pass before claiming completion

  Shaq must NOT: create new objects instead of mutating in-place, miss TrackingNumber.Value extraction,
  miss IsDeliveryLeg→IsLastLeg rename, skip the test requirements.

phase_5_graders:
  - type: json_valid
  - type: json_field
    path: "implementation_summary.files_changed"
    min_items: 5
  - type: contains
    field: "implementation_summary.approach"
    value: "ApplyFrom"
    description: "Shaq must use ApplyFrom merge pattern, not new-object creation"
  - type: json_field
    path: "tests"
    min_items: 1

phase_5_reference_output: |
  Implementation completed across 50 files (+2,011 / -455 lines).

  - 3 new Mapping/ directories with static extension methods
  - DenormalizerBase uses abstract Map<TEvent> instead of IMapper
  - All denormalizers use ApplyFrom() merge pattern
  - All test fixtures updated
  - Package references removed from 4 csproj + Directory.Packages.props
  - Build: 0 warnings, 0 errors
  - 36 new tests across 4 files: completeness tests, merge-semantic tests for all ApplyFrom methods

---

## Phase 6: Review — Kobe

phase_6_agent: kobe

phase_6_prompt: |
  You are Kobe, the Relentless Quality & Risk Enforcer. Review the AutoMapper removal implementation plan.

  IMPORTANT: Do NOT search the filesystem — review the implementation description provided below. This is a review exercise based on the described plan.

  DOMAIN RULES (from Bird — what "correct" means):
  - TrackingNumber must be extracted from value object (.Value) — domain uses value objects, VMs use primitives
  - IsDeliveryLeg (event) maps to IsLastLeg (VM) — domain name translation
  - Status must be initialized to new Status() on ShipmentTrackingInitiated, never null
  - CarrierDesignatedDeliveryScan and Signatory fields intentionally excluded from Scan VM read model
  - Map-into-existing-object pattern preserves unmapped fields — merge semantics, not replacement

  IMPLEMENTATION SUMMARY (from Shaq):
  - What was built: Option C manual mapping extension methods across 50 files
  - Files changed: 3 new Mapping/ directories, DenormalizerBase refactored to use abstract Map<TEvent> instead of IMapper, all test fixtures updated, package references removed
  - Acceptance criteria coverage: ApplyFrom merge pattern implemented, TrackingNumber.Value extracted, IsDeliveryLeg→IsLastLeg renamed, exclusions preserved
  - Shaq's confidence: 85% — low confidence on test completeness (merge semantics tests added but coverage gaps possible)
  - Tests: 36 new mapping/merge tests, 111 total passing

  Review for: property-by-property correctness vs what AutoMapper did, merge semantics preservation, orphaned package references, any latent bugs surfaced by the migration. Also check: are ToTrackableItemVm overloads covered by tests?
  CRITICAL: Respond with raw JSON only. First character { last character }. No markdown fences.

phase_6_expected_behavior: |
  Kobe must verify property-by-property correctness of manual mappings vs what AutoMapper did.

  Kobe should find non-blocking issues:
  - Orphaned ParcelVision.Utile.Messages.Converters.AutoMapper package reference in Application.Host
  - Any latent bugs that the migration surfaced (e.g. old broken Enum.Parse now fixed)
  - Any remaining property coverage gaps

  Kobe may flag ToTrackableItemVm overloads as lacking dedicated unit tests (important but not critical).

  Kobe verdict: SHIP or SHIP WITH FIXES (not BLOCK — implementation is fundamentally correct).

phase_6_graders:
  - type: json_valid
  - type: json_field
    path: "summary.verdict"
    one_of: ["SHIP", "SHIP WITH FIXES"]
  - type: json_field
    path: "critical_findings"
    max_items: 3

phase_6_reference_output: |
  {
    "summary": {"verdict": "SHIP", "one_liner": "AutoMapper removal is thorough and correct — all manual mappings faithfully reproduce the old convention-based behavior with proper merge semantics, null guards, and intentional exclusions."},
    "critical_findings": [],
    "important_issues": [
      {"title": "Orphaned ParcelVision.Utile.Messages.Converters.AutoMapper package reference in Application.Host"},
      {"title": "Old Enum.Parse mapping for StatusElement.Type was broken — new mapping is a behavioral improvement (latent bug fixed)"}
    ]
  }

---

## Phase 7: Fix-Verify — Shaq (Tests)

phase_7_agent: shaq

phase_7_prompt: |
  You are Shaq, the Primary Executor. Kobe's review identified a test gap — describe how you would add the missing tests.

  IMPORTANT: Do NOT search the filesystem or write actual code files — this is a planning exercise. Describe what you WOULD implement.

  Kobe's review identified that ToTrackableItemVm (2 overloads) lack dedicated unit tests.

  Context:
  - Existing completeness tests follow this pattern: create a fully populated source object, call the mapping method, assert every mapped field equals the expected value
  - Tests live in TrackingMappingCompletenessTests.cs
  - Current test count is 111, target is 118 (7 new tests across both overloads)

  Describe your plan:
  - What file would you modify?
  - What are the 7 tests you would add? (List each test name and what it verifies)
  - How do the tests follow the existing completeness test pattern?
  - What specific properties would each ToTrackableItemVm overload test cover?

  CRITICAL: Your final response must be raw JSON only. First character { last character }. No markdown fences.

phase_7_expected_behavior: |
  Shaq must add 7 new tests for both ToTrackableItemVm overloads.
  Tests must be added to TrackingMappingCompletenessTests.cs.
  All 118 total tests must pass.
  Build must be clean with zero warnings.

phase_7_graders:
  - type: json_valid
  - type: json_field
    path: "implementation_summary.files_changed"
    min_items: 1
  - type: contains
    field: "implementation_summary.what_was_built"
    value: "test"
    description: "Shaq must add tests for ToTrackableItemVm"

phase_7_reference_output: |
  7 new tests for both ToTrackableItemVm overloads added to TrackingMappingCompletenessTests.cs.
  All 118 tests pass. Build clean with zero warnings.

---

## Pipeline-Level Fields

pipeline_expected_behavior: |
  Phase 1 — Parallel Analysis:
  - Bird identifies mapping flows (event→VM, command→event, API→command) and domain-specific translation rules (value objects, name renames, intentional exclusions)
  - MJ evaluates at least 3 architectural options with effort/risk trade-offs. Discovers that Mapperly is blocked by map-into-existing-object limitation and upgrade is blocked by commercial license
  - Kobe identifies map-into-existing-object merge semantics as the critical risk and demands pre-migration tests
  - All three agents produce structured JSON output

  Phase 4 — Human Checkpoint:
  - Coach K presents consolidated comparison table of options with per-agent assessment
  - Human can make an informed decision combining domain, architecture, and risk perspectives
  - Human fixture selects Option C with all MJ and Kobe requirements

  Phase 5 — Implementation:
  - Shaq follows MJ's migration order (simplest to hardest)
  - Implementation uses ApplyFrom() merge pattern for denormalizer as specified
  - Build passes with 0 warnings, 0 errors
  - All pre-migration tests from Kobe's requirements are implemented

  Phase 6 — Review:
  - Kobe verifies property-by-property correctness of manual mappings vs what AutoMapper did
  - Kobe catches non-blocking issues (orphaned package ref, latent bug fix)
  - Verdict: SHIP or SHIP WITH FIXES

  Phase 7 — Fix-Verify:
  - Shaq adds targeted tests for identified coverage gaps
  - All tests pass, build clean

pipeline_failure_modes: |
  - Bird fails to identify map-into-existing-object merge semantics as a domain concern
  - MJ recommends Mapperly without discovering it doesn't support map-into-existing-object
  - MJ fails to discover that AutoMapper upgrade requires commercial license
  - Kobe doesn't demand pre-migration tests for merge semantics
  - Shaq creates new objects instead of mutating existing ones in ApplyFrom (would null out fields)
  - Shaq misses TrackingNumber.Value extraction or IsDeliveryLeg→IsLastLeg rename
  - Shaq skips Kobe's test requirements
  - Kobe SHIP verdict without verifying all properties are mapped
  - Coach K presents options without clear comparison enabling human decision
  - Human checkpoint skipped — implementation starts without approval

pipeline_scoring_rubric: |
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
