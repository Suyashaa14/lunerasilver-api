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
