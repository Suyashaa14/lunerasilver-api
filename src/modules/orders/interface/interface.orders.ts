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

/** A piece the shop will make to order: only the customer's brief, no price yet. */
export interface CustomOrderItem {
  name: string;
  description?: string;
  category: string;
  size?: string;
}

/**
 * An order taken at the counter or over the phone. Unlike the storefront path
 * there is no cart and no login: the pieces are named outright and the buyer is
 * matched on their phone number, the same way a counter sale matches them.
 *
 * A line is either an existing piece (`jewelryId`) or a custom one (`custom`).
 * A custom line's inspiration image is a file sent alongside, matched to the
 * line by its position.
 */
export interface CreateCounterOrderPayload {
  recipientName: string;
  phone: string;
  addressLine: string;
  city: string;
  notes?: string;
  paymentMethod: "cod" | "esewa_qr";
  items: { jewelryId?: number; custom?: CustomOrderItem }[];
}

export interface UpdateOrderDetailsPayload {
  recipientName?: string;
  phone?: string;
  addressLine?: string;
  city?: string;
  notes?: string | null;
  paymentMethod?: "cod" | "esewa_qr";
  /** Corrections to custom lines that have not been made yet. */
  items?: { id: number; name: string; description?: string; category: string; size?: string }[];
}
