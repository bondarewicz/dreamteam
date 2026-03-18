# Eval: Shaq — Scenario 12 — Pattern Matching with Existing Codebase (Hard)

## Overview

Tests Shaq's ability to implement a new feature by following the established patterns shown in existing code — matching naming conventions, error handling patterns, and structural conventions without being explicitly told what they are.

---

category: capability

graders:
  - type: json_valid
  - type: json_field
    path: implementation_summary.files_changed
    min_items: 1

prompt: |
  Below is an example of an existing feature in the codebase. Study it, then implement a new feature following the same patterns.

  EXISTING PATTERN — ProductService:

  ```typescript
  // .tmp/products/product-repository.ts
  export interface ProductRepository {
    findById(id: string): Promise<Product | null>;
    save(product: Product): Promise<void>;
  }

  // .tmp/products/product-service.ts
  import { ProductRepository } from "./product-repository";
  import { AppError } from "../shared/app-error";

  export class ProductService {
    constructor(private readonly repo: ProductRepository) {}

    async getProduct(id: string): Promise<Product> {
      const product = await this.repo.findById(id);
      if (!product) {
        throw new AppError("PRODUCT_NOT_FOUND", `Product ${id} not found`);
      }
      return product;
    }
  }

  // .tmp/shared/app-error.ts
  export class AppError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
    }
  }
  ```

  NEW FEATURE — WarehouseService:

  Bird's acceptance criteria:
  AC1: Given a warehouse ID that exists, when getWarehouse is called, then the warehouse is returned
  AC2: Given a warehouse ID that does not exist, when getWarehouse is called, then throw with code WAREHOUSE_NOT_FOUND
  AC3: Given a warehouse and a new capacity value, when updateCapacity is called, then the warehouse's capacity is updated and saved

  MJ says: implement WarehouseService following the same file and class structure as ProductService.

  Implement the WarehouseService, its repository interface, and tests.

expected_behavior: |
  - Files follow the same structure: .tmp/warehouses/warehouse-repository.ts and .tmp/warehouses/warehouse-service.ts
  - WarehouseRepository is an interface (not a class) matching the ProductRepository pattern
  - WarehouseService constructor injects WarehouseRepository
  - AppError is imported from ../shared/app-error — Shaq does NOT create a new error class
  - Error thrown in AC2 uses AppError with code "WAREHOUSE_NOT_FOUND" (matching the PRODUCT_NOT_FOUND pattern)
  - updateCapacity method calls repo.save after updating the capacity
  - Tests use mock repository (matching the injectable pattern)
  - Naming conventions match: camelCase methods, PascalCase classes

failure_modes: |
  - Creating a new WarehouseError class instead of reusing AppError
  - Using a different file path convention (e.g., .tmp/warehouse/WarehouseService.ts instead of kebab-case)
  - WarehouseRepository as a class instead of interface
  - Constructor not using readonly or using a different DI pattern
  - Not calling repo.save in updateCapacity

scoring_rubric: |
  pass:
    - File paths follow established pattern (.tmp/warehouses/warehouse-*.ts, kebab-case)
    - WarehouseRepository is an interface
    - WarehouseService injects repository via constructor with readonly
    - AppError reused (not a new class created)
    - Error code follows naming pattern: WAREHOUSE_NOT_FOUND
    - updateCapacity calls repo.save
    - Tests use mock repository
    - acceptance_criteria_coverage maps all 3 ACs

  partial:
    - Pattern mostly followed but one deviation (e.g., new error class instead of AppError)
    - Functional implementation but minor naming inconsistency
    - Tests present but mock pattern differs from existing codebase

  fail:
    - New error class created instead of reusing AppError
    - WarehouseRepository is a concrete class
    - File structure diverges significantly
    - Constructor does not inject repository
    - acceptance_criteria_coverage absent
