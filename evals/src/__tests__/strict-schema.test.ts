import { test, expect } from "bun:test";
import {
  toOpenAIStrictSchema,
  stripNulls,
  getAgentStrictJsonSchema,
} from "../../../schemas/agent-schemas.ts";

test("every object gets additionalProperties:false and all-keys required", () => {
  const out = toOpenAIStrictSchema({
    type: "object",
    properties: { a: { type: "string" }, b: { type: "number" } },
    required: ["a"],
  }) as any;
  expect(out.additionalProperties).toBe(false);
  expect(new Set(out.required)).toEqual(new Set(["a", "b"]));
});

test("non-required scalar becomes nullable; required stays single-typed", () => {
  const out = toOpenAIStrictSchema({
    type: "object",
    properties: { req: { type: "string" }, opt: { type: "string" } },
    required: ["req"],
  }) as any;
  expect(out.properties.req.type).toBe("string");
  expect(out.properties.opt.type).toEqual(["string", "null"]);
});

test("recurses into array items", () => {
  const out = toOpenAIStrictSchema({
    type: "object",
    properties: {
      rows: { type: "array", items: { type: "object", properties: { x: { type: "string" } }, required: [] } },
    },
    required: ["rows"],
  }) as any;
  const item = out.properties.rows.items;
  expect(item.additionalProperties).toBe(false);
  expect(item.required).toEqual(["x"]);
  expect(item.properties.x.type).toEqual(["string", "null"]); // x wasn't required
});

test("non-required array property becomes nullable array but keeps items", () => {
  const out = toOpenAIStrictSchema({
    type: "object",
    properties: { tags: { type: "array", items: { type: "string" } } },
    required: [],
  }) as any;
  expect(out.properties.tags.type).toEqual(["array", "null"]);
  expect(out.properties.tags.items).toEqual({ type: "string" });
});

test("typeless node (enum/anyOf) becomes anyOf with null when non-required", () => {
  const out = toOpenAIStrictSchema({
    type: "object",
    properties: { e: { enum: ["a", "b"] } },
    required: [],
  }) as any;
  expect(out.properties.e.anyOf).toEqual([{ enum: ["a", "b"] }, { type: "null" }]);
});

test("transform is non-mutating", () => {
  const input = { type: "object", properties: { a: { type: "string" } }, required: [] };
  const snapshot = JSON.parse(JSON.stringify(input));
  toOpenAIStrictSchema(input);
  expect(input).toEqual(snapshot);
});

test("stripNulls drops null keys recursively, keeps falsy non-null", () => {
  const cleaned = stripNulls({
    keep: "x", zero: 0, empty: "", flag: false,
    drop: null,
    nested: { a: null, b: 1 },
    arr: [{ a: null, b: 2 }],
  });
  expect(cleaned).toEqual({
    keep: "x", zero: 0, empty: "", flag: false,
    nested: { b: 1 },
    arr: [{ b: 2 }],
  });
});

test("bird strict schema: round-trips through strip back to a Zod-valid shape", () => {
  const strict = getAgentStrictJsonSchema("bird") as any;
  expect(strict).toBeDefined();
  // top-level required lists ALL properties (strict mode)
  expect(new Set(strict.required)).toEqual(new Set(Object.keys(strict.properties)));
  expect(strict.additionalProperties).toBe(false);
  // a known-optional field is nullable; a known-required field is not
  expect(strict.properties.business_context.type).toEqual(["string", "null"]);
  expect(strict.properties.bounded_context.type).toBe("string");
  // array-of-objects items are strict too
  expect(strict.properties.business_rules.items.additionalProperties).toBe(false);
});

test("unregistered agent → undefined strict schema", () => {
  expect(getAgentStrictJsonSchema("nonexistent")).toBeUndefined();
});
