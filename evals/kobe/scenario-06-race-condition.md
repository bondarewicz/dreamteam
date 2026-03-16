# Eval: Kobe — Scenario 06 — Race Condition in Inventory (Capability)

## Overview

Tests Kobe's ability to identify a classic check-then-act race condition in inventory management that would allow overselling under concurrent load.

---

category: capability

graders:
  - type: contains
    values: ["race condition", "Critical", "concurrent", "atomic", "safe_to_deploy"]
  - type: section_present
    sections: ["Critical", "Production"]
  - type: field_count
    pattern: "(?i)(severity|critical).{0,20}(critical|severity)"
    min: 1
  - type: length_bounds
    min: 200

prompt: |
  Review the following TypeScript function that handles adding an item to a cart with stock checking:

  ```typescript
  async function addToCart(
    userId: string,
    productId: string,
    quantity: number
  ): Promise<void> {
    const stock = await db.products.getStock(productId);
    if (stock < quantity) {
      throw new Error("Insufficient stock");
    }
    await db.cart.addItem(userId, productId, quantity);
    await db.products.decrementStock(productId, quantity);
  }
  ```

  This is called from a public API. Products are popular; multiple users can attempt to add the same product simultaneously.

  Produce your full output schema.

expected_behavior: |
  - Kobe identifies the race condition: the stock check (getStock) and the decrement (decrementStock) are not atomic; if two users simultaneously pass the stock check (both see stock >= quantity), both will proceed to decrement, potentially driving stock below zero (overselling)
  - This is a Critical finding because it directly enables overselling, which has direct business and fulfillment impact
  - The fix is specific: use an atomic conditional update ("UPDATE products SET stock = stock - $quantity WHERE product_id = $id AND stock >= $quantity RETURNING stock") and check the affected row count; or use optimistic/pessimistic locking
  - Kobe notes this is a classic TOCTOU (time-of-check-time-of-use) problem
  - safe_to_deploy is false
  - confidence.level >= 80

failure_modes: |
  - Not identifying the race condition between check and decrement
  - Classifying it as Important instead of Critical (overselling is a business-critical bug)
  - Proposing a retry loop as the fix (does not solve the underlying atomicity problem)
  - Missing that the cart item is added before the stock is decremented (partial failure risk: item in cart but stock not decremented)
  - Setting safe_to_deploy to true

scoring_rubric: |
  pass:
    - Race condition identified as Critical
    - Atomic update fix proposed (or database-level locking)
    - TOCTOU pattern named or explained
    - safe_to_deploy false
    - Partial failure (cart add before decrement) also noted
    - confidence.level >= 75

  partial:
    - Race condition identified but classified as Important
    - Atomic fix proposed but not specific (e.g., "use a transaction")
    - safe_to_deploy false
    - Partial failure not noted

  fail:
    - Race condition not identified
    - safe_to_deploy true
    - Fix is retry loop or input validation
    - Not classified as Critical
