export interface SignupPayload {
  name: string;
  email: string;
  password: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: "admin" | "staff" | "customer";
}

export interface AuthResult {
  user: AuthUser;
  token: string;
}
