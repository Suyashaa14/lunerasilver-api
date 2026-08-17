import db from "../../utils/db";
import { hashPassword, comparePassword } from "../../utils/password";
import { SignupPayload, LoginCredentials, AuthUser } from "./interface/interface.auth";

export const signup = async (payload: SignupPayload): Promise<AuthUser> => {
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

  return { id, name: payload.name, email: payload.email, role: "customer" };
};

export const login = async (credentials: LoginCredentials): Promise<AuthUser> => {
  const user = await db("users").where({ email: credentials.email }).first();
  if (!user) {
    throw Object.assign(new Error("Invalid email or password"), { status: 401 });
  }

  const passwordMatches = await comparePassword(credentials.password, user.password_hash);
  if (!passwordMatches) {
    throw Object.assign(new Error("Invalid email or password"), { status: 401 });
  }

  return { id: user.id, name: user.name, email: user.email, role: user.role };
};

export const getUserById = async (id: number): Promise<AuthUser | undefined> => {
  return db("users").where({ id }).first("id", "name", "email", "role");
};
