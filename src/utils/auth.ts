import { sign, verify, SignOptions } from "jsonwebtoken";
import { config } from "../../config/config";

export interface JwtPayload {
  id: number;
  role: "admin" | "customer";
}

export const signToken = (payload: JwtPayload): string => {
  const options = { expiresIn: config.auth.jwtExpiresIn } as SignOptions;
  return sign(payload, config.auth.jwtSecret, options);
};

export const verifyToken = (token: string): JwtPayload => {
  return verify(token, config.auth.jwtSecret) as JwtPayload;
};
