# Eval: Kobe — Scenario 19 — Prototype Pollution Vulnerability (Expert)

## Overview

Expert-level: Tests Kobe's ability to identify a prototype pollution vulnerability in JavaScript object merging code used in a security-sensitive context.

---

category: capability

graders:
  - type: contains
    values: ["prototype", "pollution", "Critical", "safe_to_deploy"]
  - type: section_present
    sections: ["critical_findings", "production_readiness"]
  - type: field_count
    pattern: "severity:\\s*Critical"
    min: 1
  - type: length_bounds
    min: 300
    max: 6000

prompt: |
  Review the following TypeScript code that merges user-provided delivery preferences with default settings:

  ```typescript
  function deepMerge(target: any, source: any): any {
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object') {
        if (!target[key]) target[key] = {};
        deepMerge(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
    return target;
  }

  async function applyDeliveryPreferences(
    req: Request,
    res: Response
  ): Promise<void> {
    const defaults = { leaveAtDoor: false, requireSignature: true, notifyBySms: true };
    const userPreferences = req.body; // User-provided JSON from request body

    const merged = deepMerge(defaults, userPreferences);
    await db.deliveries.updatePreferences(req.user.id, merged);

    res.json({ success: true });
  }
  ```

  Produce your full output schema.

expected_behavior: |
  - Kobe identifies the prototype pollution vulnerability as Critical:
    - `for (const key in source)` iterates over ALL enumerable properties including inherited ones AND special keys like `__proto__`
    - A malicious user can send: `{ "__proto__": { "isAdmin": true } }` as the request body
    - This will merge `{ "isAdmin": true }` into `Object.prototype`, affecting ALL objects in the Node.js process for the lifetime of that process
    - Any subsequent code that does `if (obj.isAdmin)` will return true for ALL objects
  - The attack vector: if the platform has any admin check like `if (user.isAdmin) allowAdminAction()`, prototype pollution can make every user appear to be an admin
  - Fix: use a safe merge that explicitly excludes `__proto__`, `constructor`, and `prototype` keys; or use `Object.assign` with spread instead of recursive deepMerge; or use a well-maintained library with prototype pollution protection (lodash merge after v4.17.21)
  - Kobe should note that deepMerge with user-provided data is a classic prototype pollution attack vector
  - safe_to_deploy false (Critical security vulnerability)

failure_modes: |
  - Not identifying prototype pollution as the vulnerability
  - Identifying it only as "input validation" without explaining the prototype pollution mechanism
  - Missing that the attack modifies Object.prototype globally in the process
  - Classifying as Important instead of Critical for a user-facing endpoint
  - safe_to_deploy true

scoring_rubric: |
  pass:
    - Prototype pollution identified by name
    - __proto__ key attack vector explained
    - Impact on Object.prototype explained (global effect)
    - Safe merge fix or safe library recommended
    - Specific attack payload example (or equivalent)
    - safe_to_deploy false

  partial:
    - Prototype pollution identified but mechanism vague
    - __proto__ mentioned but impact not fully explained
    - Fix suggested but not specific

  fail:
    - Prototype pollution not identified
    - Only "sanitize user input" advice without specifics
    - safe_to_deploy true
    - No mention of __proto__ or Object.prototype
