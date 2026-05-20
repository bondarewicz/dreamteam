# Eval: Kobe — Scenario 22 — C# EF Core N+1 Query

## Overview

Tests Kobe's ability to identify an EF Core N+1 query pattern. The code is functionally correct but issues 3N+1 database queries for N orders — a production performance cliff that degrades linearly with record count.

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: critical_findings
    min_items: 1
  - type: json_field
    path: production_readiness.safe_to_deploy
    equals: false

prompt: |
  Review the following C# ASP.NET Core endpoint that returns order summaries:

  ```csharp
  [HttpGet("orders/pending")]
  public async Task<IActionResult> GetPendingOrderSummaries()
  {
      var orders = await _context.Orders
          .Where(o => o.Status == OrderStatus.Pending)
          .ToListAsync();

      var summaries = orders.Select(async order => new OrderSummaryDto
      {
          OrderId    = order.Id,
          CustomerName = (await _context.Customers.FindAsync(order.CustomerId))!.Name,
          ItemCount  = await _context.OrderItems.CountAsync(i => i.OrderId == order.Id),
          Total      = await _context.OrderItems
                           .Where(i => i.OrderId == order.Id)
                           .SumAsync(i => i.Price * i.Quantity)
      });

      return Ok(await Task.WhenAll(summaries));
  }
  ```

  The `orders` table currently has ~2,000 pending orders in production. Produce your full output schema.

expected_behavior: |
  - Kobe identifies the N+1 query pattern as Critical given 2,000 pending orders
  - Calculates or estimates the query count: 1 (initial load) + 3 per order = 6,001 queries for 2,000 orders
  - Notes that `Task.WhenAll` on async EF Core projections floods the connection pool with concurrent queries
  - Fix: use `.Include(o => o.Customer).Include(o => o.Items)` or a server-side `.Select()` projection that produces a single SQL query
  - May note secondary risk: `FindAsync` with a parallel `Task.WhenAll` can cause DbContext thread-safety issues (DbContext is not thread-safe)
  - production_readiness.safe_to_deploy false (will cause connection pool exhaustion / DB timeouts in production with 2,000 rows)

failure_modes: |
  - Accepting the code because it works correctly on small datasets
  - Missing the N+1 — treating each `FindAsync` as negligible
  - Not flagging the `Task.WhenAll` + EF Core DbContext concurrency issue (DbContext is not thread-safe)
  - Proposing caching as the fix instead of fixing the query pattern
  - Classifying as Important rather than Critical given the explicit 2,000-row production context

scoring_rubric: |
  pass:
    - N+1 identified as Critical
    - Query count quantified (or estimated at N*3+1)
    - Fix is server-side projection or Include — not caching
    - DbContext thread-safety concern under Task.WhenAll noted
    - safe_to_deploy false

  partial:
    - N+1 identified but query count not estimated
    - Fix correct but DbContext concurrency not noted
    - safe_to_deploy false

  fail:
    - N+1 not identified
    - safe_to_deploy true
    - Caching proposed as the primary fix
