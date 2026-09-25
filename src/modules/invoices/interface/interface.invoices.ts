export interface IssueInvoiceLine {
  jewelryId: number;
  /** Overrides the computed shelf price, for a negotiated counter sale. */
  unitPrice?: number;
  discount?: number;
}

export interface IssueInvoicePayload {
  /** Either an existing buyer... */
  customerId?: number;
  /** ...or details to find-or-create one by phone. */
  customer?: { name: string; phone?: string | null; pan?: string | null; addressLine?: string | null; city?: string | null };
  paymentMethod: "cash" | "cod" | "esewa_qr" | "bank_transfer";
  /** Defaults to today. */
  issuedAt?: string;
  /** Set when the invoice settles a storefront order. */
  orderId?: number | null;
  items: IssueInvoiceLine[];
}

export interface InvoiceItemDTO {
  id: number;
  jewelryId: number | null;
  name: string;
  sku: string | null;
  silverWeightGrams: number | null;
  silverRatePerGram: number | null;
  makingCharge: number | null;
  stoneWeightGrams: number | null;
  stonePrice: number | null;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxableAmount: number;
  vatAmount: number;
  lineTotal: number;
}

export interface InvoiceDTO {
  id: number;
  invoiceNo: string;
  fiscalYear: string;
  series: string;
  orderId: number | null;
  customerId: number;
  issuedAt: string;
  issuedDateBs: string;
  seller: { name: string; address: string; pan: string };
  buyer: { name: string; address: string; pan: string | null };
  subtotal: number;
  discount: number;
  taxableAmount: number;
  vatAmount: number;
  vatRate: number;
  totalAmount: number;
  paymentMethod: string;
  isVoid: boolean;
  voidReason: string | null;
  printCount: number;
  items: InvoiceItemDTO[];
}
