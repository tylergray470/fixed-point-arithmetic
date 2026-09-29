import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SAFE_BITS,
  MIN_RAW,
  MAX_RAW,
  clampRaw,
  fromReal,
  toReal,
  add,
  sub,
  mul,
  div,
  eq,
} from "../src/index.js";

const Q8 = 8;

// ---- constants & helpers ----

test("SAFE_BITS is 53, matching safe integer range of JS number", () => {
  assert.equal(SAFE_BITS, 53);
});

test("MIN_RAW and MAX_RAW are symmetric about zero with one extra negative step", () => {
  // -(2^52) .. 2^52 - 1
  assert.equal(MIN_RAW, -(2 ** 52));
  assert.equal(MAX_RAW, 2 ** 52 - 1);
  assert.equal(-MIN_RAW, MAX_RAW + 1);
});

test("clampRaw saturates above, below, and passes through in range", () => {
  assert.equal(clampRaw(0), 0);
  assert.equal(clampRaw(1000), 1000);
  assert.equal(clampRaw(MAX_RAW), MAX_RAW);
  assert.equal(clampRaw(MAX_RAW + 1), MAX_RAW);
  assert.equal(clampRaw(MIN_RAW), MIN_RAW);
  assert.equal(clampRaw(MIN_RAW - 1), MIN_RAW);
  assert.equal(clampRaw(Number.POSITIVE_INFINITY), MAX_RAW);
  assert.equal(clampRaw(Number.NEGATIVE_INFINITY), MIN_RAW);
  assert.equal(clampRaw(NaN), 0);
});

// ---- fromReal / toReal round trip ----

test("fromReal rounds half away from zero, symmetric for sign", () => {
  // With Q8, one ulp = 1/256 = 0.00390625.
  // 0.5 ulp = 0.001953125 should round up to 1 ulp.
  assert.equal(fromReal(0.001953125, Q8).raw, 1);
  // -0.5 ulp should round down to -1 ulp (away from zero), not towards zero.
  assert.equal(fromReal(-0.001953125, Q8).raw, -1);
  // Just under half rounds towards zero.
  assert.equal(fromReal(0.0019, Q8).raw, 0);
  assert.equal(fromReal(-0.0019, Q8).raw, 0);
});

test("fromReal rejects negative or non-integer fractionalBits", () => {
  assert.throws(() => fromReal(1, -1), RangeError);
  assert.throws(() => fromReal(1, 1.5), RangeError);
});

test("fromReal maps NaN to zero raw", () => {
  const v = fromReal(NaN, Q8);
  assert.equal(v.raw, 0);
  assert.equal(v.fractionalBits, Q8);
});

test("toReal inverts fromReal for in-range values", () => {
  const v = fromReal(3.75, Q8);
  assert.equal(toReal(v), 3.75);
});

test("fromReal saturates very large magnitudes", () => {
  const big = fromReal(1e30, Q8);
  assert.equal(big.raw, MAX_RAW);
  const small = fromReal(-1e30, Q8);
  assert.equal(small.raw, MIN_RAW);
});

// ---- add / sub ----

test("add sums raw values and saturates at MAX_RAW", () => {
  const max = { raw: MAX_RAW, fractionalBits: Q8 };
  const one = { raw: 1, fractionalBits: Q8 };
  assert.deepEqual(add(max, one), { raw: MAX_RAW, fractionalBits: Q8 });
});

test("add saturates at MIN_RAW", () => {
  const min = { raw: MIN_RAW, fractionalBits: Q8 };
  const one = { raw: -1, fractionalBits: Q8 };
  assert.deepEqual(add(min, one), { raw: MIN_RAW, fractionalBits: Q8 });
});

test("add throws on fractionalBits mismatch", () => {
  const a = { raw: 1, fractionalBits: 8 };
  const b = { raw: 1, fractionalBits: 16 };
  assert.throws(() => add(a, b), /fractionalBits mismatch/);
});

test("sub subtracts and saturates at MIN_RAW", () => {
  const min = { raw: MIN_RAW, fractionalBits: Q8 };
  const one = { raw: 1, fractionalBits: Q8 };
  assert.deepEqual(sub(min, one), { raw: MIN_RAW, fractionalBits: Q8 });
});

test("sub saturates at MAX_RAW", () => {
  const max = { raw: MAX_RAW, fractionalBits: Q8 };
  const neg = { raw: -1, fractionalBits: Q8 };
  assert.deepEqual(sub(max, neg), { raw: MAX_RAW, fractionalBits: Q8 });
});

test("sub throws on fractionalBits mismatch", () => {
  const a = { raw: 1, fractionalBits: 8 };
  const b = { raw: 1, fractionalBits: 16 };
  assert.throws(() => sub(a, b), /fractionalBits mismatch/);
});

// ---- mul ----

test("mul of 2 * 3 = 6 at Q8", () => {
  const a = fromReal(2, Q8);
  const b = fromReal(3, Q8);
  assert.deepEqual(mul(a, b), fromReal(6, Q8));
});

test("mul of 0.5 * 0.5 = 0.25 at Q8", () => {
  const a = fromReal(0.5, Q8);
  const b = fromReal(0.5, Q8);
  assert.deepEqual(mul(a, b), fromReal(0.25, Q8));
});

test("mul truncates towards zero, not rounds", () => {
  // 1/3 * 1 = 0.333... at Q8 -> raw = 85 (0.33203125), truncated from 85.333...
  const third = fromReal(1 / 3, Q8);
  const one = fromReal(1, Q8);
  const r = mul(third, one);
  assert.equal(r.raw, 85);
  assert.equal(r.fractionalBits, Q8);
});

test("mul truncation is symmetric in sign", () => {
  // -1/3 * 1 -> raw = -85 (truncated towards zero from -85.333...)
  const negThird = fromReal(-1 / 3, Q8);
  const one = fromReal(1, Q8);
  const r = mul(negThird, one);
  assert.equal(r.raw, -85);
});

test("mul saturates when product overflows MAX_RAW", () => {
  const big = { raw: MAX_RAW, fractionalBits: Q8 };
  const two = fromReal(2, Q8);
  assert.equal(mul(big, two).raw, MAX_RAW);
});

test("mul saturates when product overflows MIN_RAW", () => {
  const small = { raw: MIN_RAW, fractionalBits: Q8 };
  const two = fromReal(2, Q8);
  assert.equal(mul(small, two).raw, MIN_RAW);
});

test("mul throws on fractionalBits mismatch", () => {
  const a = { raw: 2, fractionalBits: 8 };
  const b = { raw: 3, fractionalBits: 16 };
  assert.throws(() => mul(a, b), /fractionalBits mismatch/);
});

// ---- div ----

test("div of 6 / 3 = 2 at Q8", () => {
  const a = fromReal(6, Q8);
  const b = fromReal(3, Q8);
  assert.deepEqual(div(a, b), fromReal(2, Q8));
});

test("div of 1 / 3 preserves fractional precision at Q8", () => {
  const a = fromReal(1, Q8);
  const b = fromReal(3, Q8);
  // 1/3 at Q8 = 85/256 = 0.33203125 (truncated)
  assert.equal(div(a, b).raw, 85);
});

test("div truncates towards zero for negative result", () => {
  const a = fromReal(-1, Q8);
  const b = fromReal(3, Q8);
  // -1/3 at Q8 -> -85 (towards zero from -85.333...)
  assert.equal(div(a, b).raw, -85);
});

test("div by positive zero with positive numerator saturates to MAX_RAW", () => {
  const a = fromReal(5, Q8);
  const zero = fromReal(0, Q8);
  assert.equal(div(a, zero).raw, MAX_RAW);
});

test("div by zero with negative numerator saturates to MIN_RAW", () => {
  const a = fromReal(-5, Q8);
  const zero = fromReal(0, Q8);
  assert.equal(div(a, zero).raw, MIN_RAW);
});

test("div of zero by zero yields zero", () => {
  const zero = fromReal(0, Q8);
  assert.equal(div(zero, zero).raw, 0);
});

test("div saturates when quotient overflows MAX_RAW", () => {
  const big = { raw: MAX_RAW, fractionalBits: Q8 };
  const tiny = fromReal(0.25, Q8); // raw = 64
  assert.equal(div(big, tiny).raw, MAX_RAW);
});

test("div saturates when quotient overflows MIN_RAW", () => {
  const small = { raw: MIN_RAW, fractionalBits: Q8 };
  const tiny = fromReal(0.25, Q8);
  assert.equal(div(small, tiny).raw, MIN_RAW);
});

test("div throws on fractionalBits mismatch", () => {
  const a = { raw: 6, fractionalBits: 8 };
  const b = { raw: 3, fractionalBits: 16 };
  assert.throws(() => div(a, b), /fractionalBits mismatch/);
});

// ---- eq ----

test("eq is true for equal raw and scale", () => {
  assert.equal(eq(fromReal(3.5, Q8), fromReal(3.5, Q8)), true);
});

test("eq is false for different raw", () => {
  assert.equal(eq(fromReal(3.5, Q8), fromReal(3.6, Q8)), false);
});

test("eq throws on fractionalBits mismatch", () => {
  const a = { raw: 1, fractionalBits: 8 };
  const b = { raw: 1, fractionalBits: 16 };
  assert.throws(() => eq(a, b), /fractionalBits mismatch/);
});
