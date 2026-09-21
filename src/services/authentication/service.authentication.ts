import db from "../../utils/db";
import { hashPassword, comparePassword } from "../../utils/password";
import { signToken } from "../../utils/auth";
import { SignupPayload, LoginCredentials, AuthUser, AuthResult } from "./interface.authentication";

// Authentication lives outside src/modules on purpose: these are the only
// endpoints reachable without a token, so they are mounted at the base level
// and never pass through the /api gate.

const issue = (user: AuthUser): AuthResult => ({
  user,
  token: signToken({ id: user.id, name: user.name, email: user.email, role: user.role }),
});

export const signup = async (payload: SignupPayload): Promise<AuthResult> => {
  const existing = await db("users").where({ email: payload.email }).first();
  if (existing) {
    throw Object.assign(new Error("Email already registered"), { status: 409 });
  }

  const password_hash = await hashPassword(payload.password);
  const [id] = await db("users").insert({
    name: payload.name,
    email: payload.email,
    password_hash,
    role: "customer",
  });

  return issue({ id, name: payload.name, email: payload.email, role: "customer" });
};

export const login = async (credentials: LoginCredentials): Promise<AuthResult> => {
  const user = await db("users").where({ email: credentials.email }).first();
  if (!user) {
    throw Object.assign(new Error("Invalid email or password"), { status: 401 });
  }

  const passwordMatches = await comparePassword(credentials.password, user.password_hash);
  if (!passwordMatches) {
    throw Object.assign(new Error("Invalid email or password"), { status: 401 });
  }

  return issue({ id: user.id, name: user.name, email: user.email, role: user.role });
};

export const getUserById = async (id: number): Promise<AuthUser | undefined> => {
  return db("users").where({ id }).first("id", "name", "email", "role");
};
