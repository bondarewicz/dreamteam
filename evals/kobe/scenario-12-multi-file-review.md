# Eval: Kobe — Scenario 12 — Multi-File Review with Cross-File Bugs (Hard)

## Overview

Tests Kobe's ability to identify bugs that span multiple files — where looking at each file individually shows no obvious issue but the interaction between them creates a vulnerability.

---

category: capability

graders:
  - type: contains
    values: ["Critical", "deploy"]
  - type: section_present
    sections: ["Critical", "Production"]
  - type: field_count
    pattern: "(?i)(severity|critical).{0,20}(critical|severity)"
    min: 1
  - type: length_bounds
    min: 300

prompt: |
  Review the following two files in a delivery management system:

  **File 1: auth-middleware.ts**
  ```typescript
  export function requireAuth(req: Request, res: Response, next: NextFunction) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!);
      req.user = decoded as User;
      next();
    } catch {
      res.status(401).json({ error: 'Invalid token' });
    }
  }
  ```

  **File 2: delivery-routes.ts**
  ```typescript
  import { requireAuth } from './auth-middleware';

  router.get('/deliveries/:id', requireAuth, async (req, res) => {
    const delivery = await db.deliveries.findById(req.params.id);
    res.json(delivery);
  });

  router.get('/deliveries/:id/location', async (req, res) => {
    // This doesn't need auth - location is public info for tracking
    const location = await db.deliveries.getLocation(req.params.id);
    res.json(location);
  });
  ```

  Produce your full output schema.

expected_behavior: |
  - Kobe identifies the primary finding: the `/deliveries/:id/location` endpoint has no authentication but returns delivery location data. While the comment says "location is public info for tracking", this endpoint has no customer/authorization check — anyone who knows or can guess a delivery ID can track ANY delivery, not just their own. This is a data privacy issue.
  - Kobe identifies a second subtle issue in the auth middleware: the `jwt.verify` call uses `process.env.JWT_SECRET!` with a non-null assertion. If `JWT_SECRET` is not set in the environment, this will be `undefined`. `jwt.verify(token, undefined)` behavior depends on the JWT library but may allow all tokens through (some libraries treat undefined secret as no verification). This is a Critical finding.
  - Fix for auth: check `process.env.JWT_SECRET` at startup and fail fast if missing; do not use non-null assertion for security-critical values
  - Fix for location endpoint: require auth and check that the requester owns or has tracking access to the delivery
  - safe_to_deploy false

failure_modes: |
  - Missing the JWT_SECRET undefined risk (non-null assertion on env var)
  - Not identifying the unauthenticated location endpoint as a privacy issue
  - Reviewing each file in isolation without identifying the missing auth on the location route
  - Classifying the JWT_SECRET issue as Suggestion (it is Critical — if secret is missing, all tokens may pass)

scoring_rubric: |
  pass:
    - JWT_SECRET undefined risk identified as Critical (non-null assertion on env var)
    - Unauthenticated location endpoint identified as privacy issue
    - Cross-file analysis: location endpoint lacks the requireAuth used in the other route
    - safe_to_deploy false
    - Both fixes specific

  partial:
    - One of the two findings identified
    - Cross-file analysis attempted
    - safe_to_deploy false

  fail:
    - Neither finding identified
    - Files reviewed in isolation with no cross-file finding
    - safe_to_deploy true
    - Only style findings
