# Eval: Kobe — Scenario 14 — Dependency Risk Assessment (Very Hard)

## Overview

Tests Kobe's ability to assess the risks of third-party dependency choices in code, including version pinning, license compatibility, and supply chain risks.

---

category: capability

graders:
  - type: contains
    values: ["dependency", "risk", "safe_to_deploy"]
  - type: section_present
    sections: ["production_readiness"]
  - type: length_bounds
    min: 300
    max: 6000

prompt: |
  Review the following package.json for a payment processing microservice:

  ```json
  {
    "name": "payment-service",
    "dependencies": {
      "stripe": "*",
      "express": "^4.18.0",
      "jsonwebtoken": "8.5.1",
      "pg": "^8.0.0",
      "crypto-random-string": "5.0.0",
      "left-pad": "1.3.0",
      "moment": "^2.29.0"
    }
  }
  ```

  This service processes payments. Produce your full output schema.

expected_behavior: |
  - Kobe identifies the following dependency risks:
    1. `stripe: "*"` — wildcard version for a payment library is Critical. Any new major Stripe version (which may have breaking changes or changed payment flows) will be automatically installed on next `npm install`. This can break payment processing silently.
    2. `jsonwebtoken: "8.5.1"` — pinned to an old version. This version has known security vulnerabilities (the 8.x line had CVEs). Kobe should flag this as a security risk.
    3. `crypto-random-string: "5.0.0"` — this package switched to ESM-only in v5. If the service uses CommonJS (likely with pg and express which are CJS), this will cause a runtime import error.
    4. `left-pad: "1.3.0"` — a trivial utility that famously caused widespread outages in 2016 when it was unpublished; using a 3-line npm package as a dependency is a risk indicator (supply chain / tiny package risk)
    5. `moment: "^2.29.0"` — moment.js is officially deprecated (the maintainers recommend migrating to Day.js or date-fns); technical debt risk
  - Kobe correctly classifies these by severity:
    - `stripe: "*"` is Critical (payment library with wildcard)
    - `jsonwebtoken` CVE is Critical or Important
    - `crypto-random-string` ESM issue is Important (will cause runtime error)
    - `left-pad` is Important (supply chain risk)
    - `moment` deprecation is Suggestion
  - safe_to_deploy false due to stripe wildcard and jsonwebtoken CVE

failure_modes: |
  - Missing the stripe wildcard version as Critical
  - Not identifying the jsonwebtoken security issue
  - Missing the crypto-random-string ESM compatibility issue
  - Not mentioning left-pad supply chain risk
  - safe_to_deploy true

scoring_rubric: |
  pass:
    - stripe wildcard identified as Critical
    - jsonwebtoken security vulnerability flagged
    - At least 3 of the 5 risks identified
    - safe_to_deploy false
    - Severity ratings differentiated (not all the same)

  partial:
    - stripe wildcard identified
    - 2 other risks noted
    - safe_to_deploy false

  fail:
    - stripe wildcard not identified
    - Fewer than 2 risks identified
    - safe_to_deploy true
    - Only general "keep dependencies updated" advice
