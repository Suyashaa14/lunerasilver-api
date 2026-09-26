export interface CreateOrderPayload {
  recipientName: string;
  phone: string;
  addressLine: string;
  city: string;
  notes?: string;
  paymentMethod: "cod" | "esewa_qr";
}

export interface UpdateOrderStatusPayload {
  status?: "pending" | "confirmed" | "completed" | "cancelled";
  paymentStatus?: "unpaid" | "awaiting_verification" | "paid";
}

/**
 * An order taken at the counter or over the phone. Unlike the storefront path
 * there is no cart and no login: the pieces are named outright and the buyer is
 * matched on their phone number, the same way a counter sale matches them.
 */
export interface CreateCounterOrderPayload {
  recipientName: string;
  phone: string;
  addressLine: string;
  city: string;
  notes?: string;
  paymentMethod: "cod" | "esewa_qr";
  items: { jewelryId: number }[];
}
