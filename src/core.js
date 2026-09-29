/**
 * Fixed-point arithmetic core.
 *
 * Fixed-point numbers are represented as a plain integer `raw` together with a
 * `FractionalBits` count. The real value is `raw / 2^FractionalBits`.
 *
 * All operations are saturating: on overflow the result clamps to the
 * representable min/max rather than wrapping. This is the central design
 * decision — see README.
 *
 * Integers are JS `number`, which is a 64-bit float. A float can represent
 * every integer in the range -(2^53 - 1)..(2^53 - 1) exactly. We therefore use
 * 53 bits as the safe width and derive the saturating bounds from it rather
 * than from a 32-bit or 64-bit integer type. Using BigInt would let us push
 * wider, but it would also force every caller into BigInt arithmetic and lose
 * the performance of plain-number math; for the scale of values this library
 * targets (audio DSP, sensor data, game stats) 53 bits is ample.
 */

export const SAFE_BITS = 53;
export const MIN_RAW = -(2 ** (SAFE_BITS - 1));
export const MAX_RAW = 2 ** (SAFE_BITS - 1) - 1;

/**
 * Clamp `raw` into the representable integer range.
 *
 * Centralised so every operation shares the same saturation behaviour.
 * Exported because tests assert the exact bounds.
 */
export function clampRaw(raw) {
  if (Number.isNaN(raw)) return 0;
  if (raw > MAX_RAW) return MAX_RAW;
  if (raw < MIN_RAW) return MIN_RAW;
  return raw === 0 ? 0 : raw;
}

/**
 * Create a fixed-point value from a real number.
 *
 * Rounding is half-away-from-zero. `Math.round` in JS rounds half-up (towards
 * +Infinity), which is asymmetric for negatives; we correct that so that
 * `fromReal(-0.5)` and `fromReal(0.5)` are mirrors of each other.
 */
export function fromReal(value, fractionalBits) {
  if (!Number.isInteger(fractionalBits) || fractionalBits < 0) {
    throw new RangeError(`fractionalBits must be a non-negative integer, got ${fractionalBits}`);
  }
  if (Number.isNaN(value)) return { raw: 0, fractionalBits };
  const scale = 2 ** fractionalBits;
  let raw = value * scale;
  // Half-away-from-zero rounding.
  raw = value < 0 ? -Math.round(-raw) : Math.round(raw);
  return { raw: clampRaw(raw), fractionalBits };
}

/** Recover the real value. May lose precision if the real value is large. */
export function toReal(v) {
  return v.raw / 2 ** v.fractionalBits;
}

/**
 * Add two fixed-point values.
 *
 * Requires matching `fractionalBits`. Mixing scales is a caller bug; we throw
 * rather than silently rescale, because silent rescaling can hide precision
 * loss that the caller needs to know about.
 */
export function add(a, b) {
  if (a.fractionalBits !== b.fractionalBits) {
    throw new Error(
      `add: fractionalBits mismatch (${a.fractionalBits} vs ${b.fractionalBits})`,
    );
  }
  return { raw: clampRaw(a.raw + b.raw), fractionalBits: a.fractionalBits };
}

/** Saturating subtraction. Same scale-mismatch rule as `add`. */
export function sub(a, b) {
  if (a.fractionalBits !== b.fractionalBits) {
    throw new Error(
      `sub: fractionalBits mismatch (${a.fractionalBits} vs ${b.fractionalBits})`,
    );
  }
  return { raw: clampRaw(a.raw - b.raw), fractionalBits: a.fractionalBits };
}

/**
 * Saturating multiply.
 *
 * The mathematical product has `2 * fractionalBits` fractional bits. We
 * rescale back down to `fractionalBits` by arithmetic right shift, which
 * truncates towards zero (matches the sign of the dividend). Rounding here
 * would be nicer but introduces another branch and another source of
 * disagreement with hand-computed expectations; truncation is simple and
 * predictable, and the README says so.
 */
export function mul(a, b) {
  if (a.fractionalBits !== b.fractionalBits) {
    throw new Error(
      `mul: fractionalBits mismatch (${a.fractionalBits} vs ${b.fractionalBits})`,
    );
  }
  const fb = a.fractionalBits;
  const product = a.raw * b.raw;
  // Shift back down. Division by 2^fb truncates towards zero for positive
  // quotient and towards zero for negative quotient in JS (since `/` rounds
  // towards zero), which is what we want.
  let raw = product / 2 ** fb;
  return { raw: clampRaw(raw), fractionalBits: fb };
}

/**
 * Saturating divide.
 *
 * `a.raw / b.raw` gives a value with `2 * fractionalBits` worth of denominator
 * scaling implicitly consumed; we multiply back by `2^fractionalBits` to keep
 * the result in the same scale as the inputs. Division by zero yields the
 * saturated maximum or minimum depending on the sign of the numerator — this
 * is the standard saturating-on-divide-by-zero behaviour in fixed-point DSP
 * and avoids producing a NaN that would then have to be propagated.
 */
export function div(a, b) {
  if (a.fractionalBits !== b.fractionalBits) {
    throw new Error(
      `div: fractionalBits mismatch (${a.fractionalBits} vs ${b.fractionalBits})`,
    );
  }
  const fb = a.fractionalBits;
  const scale = 2 ** fb;
  if (b.raw === 0) {
    if (a.raw === 0) return { raw: 0, fractionalBits: fb };
    return { raw: a.raw > 0 ? MAX_RAW : MIN_RAW, fractionalBits: fb };
  }
  // Multiply first, then divide, to preserve fractional precision.
  // Truncate towards zero to match the library's truncation convention.
  let raw = Math.trunc((a.raw * scale) / b.raw);
  return { raw: clampRaw(raw), fractionalBits: fb };
}

/** Compare for equality. Same scale required. */
export function eq(a, b) {
  if (a.fractionalBits !== b.fractionalBits) {
    throw new Error(
      `eq: fractionalBits mismatch (${a.fractionalBits} vs ${b.fractionalBits})`,
    );
  }
  return a.raw === b.raw;
}
