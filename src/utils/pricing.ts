// Price today = silver weight x today's rate + making charge + stone price.
//
// Changed 2026-09-26 to match the agreed jewellery screens. Two differences
// from the previous behaviour, both deliberate:
//   * stone price is now included. It was excluded before, so a stone-set piece
//     was sold for less than the stone had cost.
//   * no rounding up to the nearest Rs 50. The screens state the formula on the
//     page, and a rounded figure would not match the arithmetic shown.
//
// Nothing is stored: the price moves with the daily rate. Issued invoices keep
// their own snapshot and are unaffected.
export function computePrice(
  weightGrams: number,
  makingCharge: number,
  ratePerGram: number,
  stonePrice: number = 0,
): number {
  return round2(weightGrams * ratePerGram + makingCharge + stonePrice);
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
