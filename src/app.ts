import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { config } from "../config/config";
import routes from "./route";
import publicRoutes from "./publicRoute";
import { notFound, errorHandler } from "./middleware/errorHandler";
import { startSchedulers } from "./utils/scheduler";

const app = express();

app.use(
  cors({
    origin: config.frontend.baseUrl,
    credentials: true,
  }),
);

app.use(express.json());
app.use(cookieParser());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api", routes);
app.use("/public", publicRoutes);

app.use(notFound);
app.use(errorHandler);

app.listen(config.app.port, () => {
  console.log(`Lunera Silver API listening on http://localhost:${config.app.port}`);
  startSchedulers();
});

export default app;
