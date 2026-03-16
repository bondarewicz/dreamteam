# Eval: Kobe — Scenario 17 — Cryptographic Misuse (Very Hard)

## Overview

Tests Kobe's ability to identify cryptographic misuse in code — specifically, using a hash function (MD5) that is cryptographically broken for a security-sensitive purpose.

---

category: capability

graders:
  - type: contains
    values: ["MD5", "cryptograph", "Critical", "safe_to_deploy"]
  - type: section_present
    sections: ["Critical", "Production"]
  - type: field_count
    pattern: "(?i)(severity|critical).{0,20}(critical|severity)"
    min: 1
  - type: length_bounds
    min: 300

prompt: |
  Review the following TypeScript code for generating secure API tokens for courier partner integrations:

  ```typescript
  import crypto from 'crypto';

  function generatePartnerApiToken(partnerId: string, secretKey: string): string {
    const payload = `${partnerId}:${Date.now()}`;
    const token = crypto.createHash('md5').update(payload + secretKey).digest('hex');
    return token;
  }

  function validatePartnerApiToken(
    token: string,
    partnerId: string,
    secretKey: string,
    timestamp: number
  ): boolean {
    const expectedPayload = `${partnerId}:${timestamp}`;
    const expectedToken = crypto.createHash('md5').update(expectedPayload + secretKey).digest('hex');
    return token === expectedToken;
  }
  ```

  This is used to generate and validate API access tokens for B2B partner integrations. Tokens are long-lived (30 days). Produce your full output schema.

expected_behavior: |
  - Kobe identifies MD5 misuse as Critical:
    1. MD5 is a cryptographically broken hash function — it has known collision vulnerabilities. For security tokens, this means an attacker with sufficient compute can forge tokens.
    2. The design is using MD5 as a MAC (Message Authentication Code) but MD5 is not suitable for this purpose even if it weren't broken. A proper HMAC (e.g., HMAC-SHA256) should be used.
  - Kobe identifies the timestamp problem: `Date.now()` is used as part of the token payload in generation, but the validator requires the timestamp to be passed in. This means the caller must know the timestamp at validation time — tokens are not self-contained (the timestamp must be stored separately).
  - Kobe identifies the missing timing-safe comparison: `token === expectedToken` uses regular string equality, which is vulnerable to timing attacks. Should use `crypto.timingSafeEqual()`.
  - Fix: replace MD5 with HMAC-SHA256; use a JWT or similar self-contained token format; use crypto.timingSafeEqual for comparison
  - safe_to_deploy false (Critical cryptographic issue in a B2B auth context)

failure_modes: |
  - Not identifying MD5 as cryptographically broken (calling it "weak" without specific impact)
  - Missing that this is an HMAC-not-hash problem (hash ≠ MAC)
  - Not identifying the timing attack vulnerability in string comparison
  - Classifying MD5 misuse as Important instead of Critical for auth tokens
  - safe_to_deploy true

scoring_rubric: |
  pass:
    - MD5 identified as cryptographically broken and unsuitable for security tokens
    - HMAC-SHA256 recommended as replacement
    - Timing attack via string equality identified
    - crypto.timingSafeEqual recommended
    - Timestamp storage design flaw noted
    - safe_to_deploy false

  partial:
    - MD5 identified as weak with recommendation for stronger hash
    - HMAC concept mentioned
    - Timing attack not identified
    - safe_to_deploy false

  fail:
    - MD5 not flagged as a security issue (or called only "outdated")
    - HMAC not mentioned
    - Timing attack not identified
    - safe_to_deploy true
