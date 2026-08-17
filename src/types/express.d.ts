import { JwtPayload } from "../utils/auth";

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}
