import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { config } from "../config/config";
import routes from "./route";
import authenticationRoutes from "./services/authentication/index.authentication";
import publicRoutes from "./publicRoute";
import { notFound, errorHandler } from "./middleware/errorHandler";
import { authGate } from "./middleware/auth";
import { startSchedulers } from "./utils/scheduler";

const app = express();

/**
 * No ETags, and nothing cached.
 *
 * Express tags every JSON response by default, so a browser revalidates and can
 * be handed a 304 with no body -- or worse, a figure it cached earlier. These
 * endpoints answer "what is the balance right now", and a stale answer to that
 * is not a saving, it is a wrong number on a screen someone is making decisions
 * from. A revalidated error body is also what turned one bad response into a
 * dead Reports screen.
 */
app.set("etag", false);

const feOrigin = config.frontend.baseUrl.replace(/\/+$/, "");
const apexOrigin = feOrigin.replace("://www.", "://");
const allowedOrigins = [apexOrigin, apexOrigin.replace("://", "://www.")];

app.use(
  cors({
    origin: allowedOrigins,
    maxAge: 600,
  }),
);

app.use(express.json());
app.use(cookieParser());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

app.use("/auth", authenticationRoutes);

app.use("/api", authGate, routes);
app.use("/public", publicRoutes);

app.use(notFound);
app.use(errorHandler);

app.listen(config.app.port, () => {
  console.log(`Lunera Silver API listening on http://localhost:${config.app.port}`);
  startSchedulers();
});

export default app;
