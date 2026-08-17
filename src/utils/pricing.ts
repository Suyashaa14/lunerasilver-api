const ROUND_TO = 50;

// Customer-facing prices are always rounded up to the nearest Rs 50 — the
// rounding difference is effectively absorbed into the making charge rather
// than showing customers odd figures like Rs 2,634.01.
export function computePrice(
  weightGrams: number,
  makingCharge: number,
  ratePerGram: number,
): number {
  return ceilToStep(weightGrams * ratePerGram + makingCharge, ROUND_TO);
}

export function backSolveMakingCharge(
  weightGrams: number,
  totalCost: number,
  ratePerGram: number,
): number {
  return round2(totalCost - weightGrams * ratePerGram);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function ceilToStep(n: number, step: number): number {
  // Subtract a tiny epsilon before ceiling so a value that's already an
  // exact multiple of `step` (up to floating-point noise) isn't bumped up.
  return Math.ceil(round2(n) / step - 1e-9) * step;
}
