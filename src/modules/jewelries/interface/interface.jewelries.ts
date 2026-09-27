export interface CreateJewelryPayload {
  /** The shop's margin on this piece, in rupees. */
  profitAmount?: number;
  /** The shop's own code. Generated when left blank. */
  sku?: string;
  material?: string;
  purity?: string;
  name: string;
  category: string;
  silverWeightGrams: number;
  pricingMode: "makingCharge" | "totalCost";
  makingCharge?: number;
  totalCost?: number;
  stoneWeightGrams?: number;
  stonePrice?: number;
}

export type UpdateJewelryPayload = Partial<CreateJewelryPayload>;

export interface JewelryDTO {
  id: number;
  name: string;
  sku: string | null;
  material: string | null;
  purity: string | null;
  /** The shop's own margin, in rupees, typed per piece. */
  profitAmount: number;
  /** The silver rate actually paid, so the cost can explain itself later. */
  costRatePerGram: number | null;
  category: string;
  imageUrl: string | null;
  silverWeightGrams: number;
  makingCharge: number;
  status: "available" | "sold";
  price: number;
  stoneWeightGrams: number | null;
  stonePrice: number | null;
  estimatedCost: number;
  createdAt: string;
}
