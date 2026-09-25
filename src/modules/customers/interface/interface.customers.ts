export interface CustomerDTO {
  id: number;
  userId: number | null;
  name: string;
  phone: string | null;
  email: string | null;
  pan: string | null;
  addressLine: string | null;
  city: string | null;
  createdAt: string;
}

export interface CreateCustomerPayload {
  name: string;
  phone?: string | null;
  email?: string | null;
  pan?: string | null;
  addressLine?: string | null;
  city?: string | null;
  userId?: number | null;
}

export type UpdateCustomerPayload = Partial<CreateCustomerPayload>;

export interface ListCustomerFilters {
  search?: string;
  page: number;
  pageSize: number;
}
