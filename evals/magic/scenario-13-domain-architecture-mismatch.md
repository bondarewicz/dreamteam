# Eval: Magic — Scenario 13 — Domain-Architecture Scope Mismatch (Hard)

## Overview

Tests Magic's ability to detect when MJ's architecture significantly exceeds the scope of Bird's domain analysis, and to flag the out-of-scope additions rather than quietly synthesizing them into the brief.

---

category: capability

prompt: |
  Bird produced this domain analysis for the "product search" feature:
  - Domain rule: Search returns products matching all provided keywords (AND logic)
  - Domain rule: Search results are sorted by relevance score descending
  - AC1: Given keywords ["red", "shoe"], when search is called, then only products with both "red" and "shoe" in their name or description are returned
  - AC2: Given multiple matching products, results are sorted by relevance score descending
  - Scope note: This is keyword search only. Faceted filtering (by category, price range, brand) is explicitly out of scope for this release.

  MJ produced this architecture summary:
  - Implement a SearchService using Elasticsearch
  - The service will support keyword search (AND logic) using a multi_match query
  - The service will also support faceted filtering by: category (term filter), price_min/price_max (range filter), brand (term filter)
  - Relevance scoring uses Elasticsearch's default BM25 algorithm
  - All filter parameters are optional; keyword is required

  Produce a handoff brief for Shaq.

expected_behavior: |
  - Magic identifies the scope mismatch: Bird explicitly marked faceted filtering as out of scope, but MJ's architecture includes category, price range, and brand filters
  - Magic escalates: "ESCALATION: Bird's domain analysis explicitly marks faceted filtering (category, price range, brand) as out of scope for this release. MJ's architecture includes these filters. Cannot produce a handoff brief until the scope is resolved — Shaq should not implement features Bird has excluded."
  - Magic does NOT silently include MJ's faceted filter architecture in the brief
  - Magic does NOT tell Shaq to implement both and let Kobe sort it out in review
  - The in-scope content (keyword search, AND logic, relevance sorting) is accurately represented and could form the basis of a valid brief once the out-of-scope issue is resolved
  - Escalation specifies the conflicting parties (Bird vs MJ) and the specific features in conflict

failure_modes: |
  - Producing a brief that includes faceted filtering as if it were in scope
  - Noting the mismatch as a "nice to have" rather than a scope conflict
  - Telling Shaq to implement the keyword search and "optionally" implement the filters
  - Escalating but including MJ's full architecture including filters in the brief
  - Missing Bird's explicit "out of scope" note

scoring_rubric: |
  pass:
    - Scope mismatch explicitly identified: Bird excludes faceted filtering, MJ includes it
    - Both conflicting positions quoted or precisely paraphrased with agent attribution
    - Escalation to Coach K (not Shaq) for resolution
    - No faceted filtering in the brief
    - In-scope content (keyword search, ACs) correctly represented
    - Escalation asks the specific question: confirm scope for this release

  partial:
    - Mismatch identified but escalation is informal or vague
    - Brief produced with filtering marked as "out of scope per Bird" — issue noted but not blocked
    - In-scope content correct

  fail:
    - Mismatch not identified
    - Brief includes faceted filtering as in-scope
    - Bird's scope note not reflected
    - Shaq directed to implement MJ's full architecture
