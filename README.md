# fixed-point

Saturating add, subtract, multiply, and divide on fixed-point numbers stored as scaled integers. Intended for embedded-style DSP and game logic where you want deterministic arithmetic and no floating-point surprises, but you also don't want a runaway value to wrap around and corrupt downstream state.

## Usage

```js
import { fromReal, toReal, add, sub, mul, div, eq } from "./src/index.js";

const Q8 = 8; // 8 fractional bits, i.e. 1/256 resolution
const a = fromReal(1.5, Q8);
const b = fromReal(2.25, Q8);

console.log(toReal(add(a, b))); // 3.75
console.log(toReal(mul(a, b))); // 3.375
console.log(toReal(div(a, b))); // 0.666015625 (truncated, not rounded)
console.log(eq(a, b));          // false
```

A value is a plain object `{ raw, fractionalBits }` where `raw` is an integer and the real value is `raw / 2^fractionalBits`. Construct values with `fromReal(real, fractionalBits)` and recover them with `toReal(value)`. All arithmetic functions (`add`, `sub`, `mul`, `div`) require both operands to share the same `fractionalBits` and throw on mismatch — mixing scales silently would hide precision loss.

## Why this exists

Floating-point is fine for most code, but it is non-deterministic across architectures when you need bit-exact reproducibility, and it has nasty edge cases around `Infinity` and `NaN` that propagate invisibly. Fixed-point with saturating arithmetic gives you a closed numeric system: every operation produces a value in a known range, and overflow is a clamped result rather than a poison sentinel. The trade-off is reduced range and resolution compared to float, and the need to choose a `fractionalBits` up front.

The library uses JS `number` (64-bit float) as the backing integer type, which can represent every integer in `[-(2^53 - 1), 2^53 - 1]` exactly. Saturating bounds are derived from that: `MIN_RAW = -(2^52)`, `MAX_RAW = 2^52 - 1`. We do not use `BigInt`; doing so would widen the range but force every caller into BigInt math and lose the speed of plain-number arithmetic, which defeats the purpose for the DSP/sensor/game workloads this targets.

## Edges you will hit

- **Truncation, not rounding, in `mul` and `div`.** A product of two Q8 values has 16 fractional bits internally; we shift back down to 8 by truncating towards zero. `1/3` at Q8 is `85/256 = 0.33203125`, not `0.333984375`. This is deliberate — rounding adds a branch and a source of disagreement with hand-computed expectations, and saturating fixed-point libraries traditionally truncate.
- **Division by zero saturates**, it does not throw. Positive numerator over zero yields `MAX_RAW`; negative yields `MIN_RAW`; `0/0` yields `0`. This matches common fixed-point DSP conventions and keeps the type closed under division. If you need an error, check the denominator first.
- **Scale mismatch throws.** `add`, `sub`, `mul`, `div`, and `eq` all require matching `fractionalBits`. There is no implicit rescaling; rescaling loses precision and we will not guess whether you wanted that.
- **`fromReal` rounds half away from zero**, so `fromReal(-0.5, 0)` is `-1`, not `0`. JS `Math.round` rounds half-up towards `+Infinity`, which is asymmetric; we correct for it.
