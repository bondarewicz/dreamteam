# Eval: Kobe — Scenario 05 — SQL Injection Vulnerability (Capability)

## Overview

Tests Kobe's ability to identify a SQL injection vulnerability, correctly classify it as Critical, and propose a specific fix.

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: critical_findings
    min_items: 1
    max_items: 3
  - type: json_field
    path: production_readiness.safe_to_deploy
    equals: false
  - type: json_field
    path: confidence.level
    min: 80

prompt: |
  Review the following Python code for a delivery search endpoint:

  ```python
  def search_deliveries(db_conn, customer_id: str, status_filter: str):
      query = f"""
          SELECT * FROM deliveries
          WHERE customer_id = '{customer_id}'
          AND status = '{status_filter}'
      """
      result = db_conn.execute(query)
      return result.fetchall()
  ```

  This endpoint is called from a public-facing API where customer_id and status_filter come directly from the HTTP request query parameters.

  Produce your full output schema.

expected_behavior: |
  - Kobe identifies SQL injection as a Critical finding: both customer_id and status_filter are interpolated directly into the SQL string without parameterization
  - The finding includes a concrete attack example: `status_filter = "' OR '1'='1"` would return all deliveries for all customers
  - The fix is specific: use parameterized queries (e.g., `db_conn.execute("SELECT * FROM deliveries WHERE customer_id = %s AND status = %s", (customer_id, status_filter))`)
  - production_readiness.safe_to_deploy is false / BLOCK
  - Kobe may note a secondary finding: `SELECT *` returns all columns including potentially sensitive data; this is at most Important (not Critical)
  - confidence.level >= 85 (SQL injection is a definitive finding, not ambiguous)

failure_modes: |
  - Not identifying the SQL injection vulnerability
  - Classifying SQL injection as Important instead of Critical in a public-facing API
  - Proposing input sanitization (e.g., escaping quotes) as the fix instead of parameterized queries (sanitization is not a complete fix)
  - Marking safe_to_deploy as true
  - Missing the attack vector (user-controlled input from HTTP request)

scoring_rubric: |
  pass:
    - SQL injection identified as Critical
    - Attack vector (user-controlled HTTP input) noted
    - Parameterized queries as the fix (not sanitization alone)
    - safe_to_deploy is false / BLOCK verdict
    - confidence.level >= 80

  partial:
    - SQL injection identified but classified as Important not Critical
    - Fix is parameterized queries but without explaining why sanitization is insufficient
    - safe_to_deploy false

  fail:
    - SQL injection not identified
    - safe_to_deploy true
    - Fix is input sanitization only
    - Not classified as Critical
