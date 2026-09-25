export interface CreateExpensePayload {
  supplierId?: number | null;
  billNo?: string | null;
  vatAmount?: number;
  paymentMethod?: string | null;
  paymentReference?: string | null;
  receiptDocumentId?: number | null;
  category: string;
  amount: number;
  spentAt: string;
  note?: string;
}

export type UpdateExpensePayload = Partial<CreateExpensePayload>;

export interface ExpenseDTO {
  id: number;
  category: string;
  amount: number;
  spentAt: string;
  note: string | null;
  createdAt: string;
}

export interface ExpensesSummary {
  count: number;
  totalAmount: number;
}

export interface ExpensesMonthlyPoint {
  month: string;
  amount: number;
}

export interface ExpensesCategoryPoint {
  category: string;
  amount: number;
}
