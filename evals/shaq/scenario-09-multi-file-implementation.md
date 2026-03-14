# Eval: Shaq — Scenario 09 — Multi-File Implementation (Hard)

## Overview

Tests Shaq's ability to implement a feature that spans multiple files, correctly organizing responsibilities across modules and ensuring the test file covers integration between them.

---

category: capability

prompt: |
  Bird has defined acceptance criteria for a "coupon application" feature:

  AC1: Given a valid coupon code "SAVE10", when applyCoupon(cartTotal, couponCode) is called, then the discounted total is cartTotal * 0.90 (10% off)
  AC2: Given an expired coupon code, when applyCoupon is called, then it throws with code COUPON_EXPIRED
  AC3: Given an unknown coupon code, when applyCoupon is called, then it throws with code COUPON_NOT_FOUND
  AC4: Given a coupon with a minimum order requirement of $50 and a cartTotal of $40, when applyCoupon is called, then it throws with code ORDER_MINIMUM_NOT_MET
  AC5: Given a coupon is marked as single-use and has already been used, when applyCoupon is called, then it throws with code COUPON_ALREADY_USED

  MJ says:
  - Implement in three files:
    - .tmp/coupons/coupon-repository.ts — interface CouponRepository with method getCoupon(code: string): Coupon | null
    - .tmp/coupons/coupon-service.ts — class CouponService(repo: CouponRepository) with method applyCoupon(cartTotal: number, couponCode: string): number
    - .tmp/coupons/coupon-service.test.ts — tests using a mock CouponRepository

  Implement the full feature across all three files.

expected_behavior: |
  - CouponRepository is defined as an interface (not a class), with the exact method signature from MJ
  - CouponService injects CouponRepository via the constructor
  - applyCoupon enforces all 5 ACs in order: existence check (AC3), expiry check (AC2), single-use check (AC5), minimum order check (AC4), then calculation (AC1)
  - Tests use a mock/stub CouponRepository — no real database calls in tests
  - All 5 ACs are tested with explicit test case names
  - AC1 is tested with a specific value (e.g., cartTotal=100, expected result=90)
  - Error objects have a code property matching the exact error codes from Bird
  - files_changed lists all three files with their purpose
  - acceptance_criteria_coverage maps all 5 ACs to test names

failure_modes: |
  - CouponRepository implemented as a concrete class rather than an interface
  - CouponService directly instantiates a CouponRepository instead of injecting it (untestable)
  - Tests that use a real database or file instead of a mock repository
  - Missing AC5 (single-use check) — often overlooked
  - Error codes different from Bird's spec (e.g., EXPIRED instead of COUPON_EXPIRED)
  - Only one file created (all logic in one file despite MJ's three-file spec)

scoring_rubric: |
  pass:
    - All three files created matching MJ's naming spec
    - CouponRepository is an interface
    - CouponService injects the repository
    - All 5 ACs implemented with correct error codes
    - Tests use mock repository, cover all 5 ACs
    - files_changed lists all three files
    - acceptance_criteria_coverage maps all 5 ACs

  partial:
    - Three files created but CouponRepository is a class instead of interface
    - 4 of 5 ACs correct; AC5 likely missing
    - Tests use mock but coverage incomplete

  fail:
    - Fewer than three files (logic not separated per spec)
    - CouponService not using dependency injection
    - Tests without mock repository
    - Multiple AC error codes wrong
    - acceptance_criteria_coverage absent
