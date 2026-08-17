export type SaleSource = "homemade" | "bought";

export interface CreateSalePayload {
  ringName: string;
  category: string;
  jewelryId?: number | null;
  source: SaleSource;
  silverWeightGrams: number;
  silverRatePerGram: number;
  stoneWeightGrams?: number;
  stonePrice?: number;
  makingCharge?: number;
  soldPrice: number;
  soldAt: string;
  notes?: string;
}

export type UpdateSalePayload = Partial<CreateSalePayload>;

export interface SaleDTO {
  id: number;
  ringName: string;
  category: string;
  jewelryId: number | null;
  source: SaleSource;
  silverWeightGrams: number;
  silverRatePerGram: number;
  stoneWeightGrams: number | null;
  stonePrice: number;
  makingCharge: number;
  soldPrice: number;
  soldAt: string;
  notes: string | null;
  silverCost: number;
  totalCost: number;
  profit: number;
  createdAt: string;
}

export interface SalesSummary {
  count: number;
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
}

export interface SalesMonthlyPoint {
  month: string;
  revenue: number;
  cost: number;
  profit: number;
}

export interface SalesCategoryPoint {
  category: string;
  count: number;
  revenue: number;
  cost: number;
  profit: number;
}

export interface SalesProductPoint {
  name: string;
  count: number;
  revenue: number;
  profit: number;
  avgPrice: number;
}
