import { sign, verify, SignOptions } from "jsonwebtoken";
import { config } from "../../config/config";

// name and email ride in the token because the client has no /auth/me to call:
// it decodes this payload to render the signed-in user. Nothing secret goes in
// here -- a JWT payload is base64, not encrypted, and anyone holding the token
// can read it.
export interface JwtPayload {
  id: number;
  name: string;
  email: string;
  role: "admin" | "staff" | "customer";
}

export const signToken = (payload: JwtPayload): string => {
  const options = { expiresIn: config.auth.jwtExpiresIn } as SignOptions;
  return sign(payload, config.auth.jwtSecret, options);
};

export const verifyToken = (token: string): JwtPayload => {
  return verify(token, config.auth.jwtSecret) as JwtPayload;
};
