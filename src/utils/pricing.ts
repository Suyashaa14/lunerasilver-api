/**
 * What a piece sells for today.
 *
 *   silver weight x TODAY'S rate      moves every day with the market
 * + making charge paid to the supplier   fixed the day it was bought
 * + stone price paid to the supplier     fixed the day it was bought
 * + the shop's profit                    typed in rupees, per piece
 * = price today
 *
 * Only the silver moves. The making charge and the stone are passed on at what
 * they cost, and the profit is the shop's own margin on top -- which is why it
 * is a column of its own rather than folded into the making charge. Folding it
 * in is what made the making charge mean "what we paid" on the buying screen
 * and "what we earn" on the selling screen at the same time.
 *
 * Nothing is stored: the price is worked out on every screen that shows it.
 * Issued invoices keep their own snapshot and never change.
 */
export function computePrice(
  weightGrams: number,
  makingCharge: number,
  ratePerGram: number,
  stonePrice: number = 0,
  profitAmount: number = 0,
): number {
  return round2(weightGrams * ratePerGram + makingCharge + stonePrice + profitAmount);
}

/**
 * What a piece cost, settled the day it was bought and fixed from then on.
 *
 * The rate is the one actually paid to the supplier, not today's. A piece
 * bought when silver was cheap keeps that cost for ever -- that gap between the
 * rate paid and today's rate is the shop holding stock, and it only reads
 * correctly if the cost stops moving.
 */
export function computeCost(
  weightGrams: number,
  makingCharge: number,
  ratePaidPerGram: number,
  stonePrice: number = 0,
): number {
  return round2(weightGrams * ratePaidPerGram + makingCharge + stonePrice);
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
