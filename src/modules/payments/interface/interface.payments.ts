export type PaymentMethod = "cash" | "cod" | "esewa_qr" | "bank_transfer" | "card";
export type PaymentStatus = "pending" | "verified" | "rejected" | "refunded";

export interface RecordPaymentPayload {
  invoiceId?: number | null;
  orderId?: number | null;
  amount: number;
  method: PaymentMethod;
  referenceNo?: string | null;
  receivedAt?: string;
  note?: string | null;
}

export interface RefundPaymentPayload {
  invoiceId?: number | null;
  orderId?: number | null;
  amount: number;
  method: PaymentMethod;
  reason: string;
  receivedAt?: string;
}

export interface PaymentDTO {
  id: number;
  invoiceId: number | null;
  orderId: number | null;
  amount: number;
  method: PaymentMethod;
  referenceNo: string | null;
  status: PaymentStatus;
  receivedAt: string;
  receivedDateBs: string;
  fiscalYear: string;
  verifiedBy: number | null;
  verifiedAt: string | null;
  note: string | null;
}

export interface InvoiceBalance {
  invoiceId: number;
  total: number;
  paid: number;
  pending: number;
  outstanding: number;
  isSettled: boolean;
}
