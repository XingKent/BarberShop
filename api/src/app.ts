import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { requireOwner, sameOriginGuard, sessionLoader } from "./auth/middleware.js";
import type { AppDeps } from "./deps.js";
import { AppError } from "./errors.js";
import { adminRoutes } from "./routes/admin.js";
import { authRoutes } from "./routes/auth.js";
import { publicRoutes } from "./routes/public.js";

export interface AppOptions {
  /** Endereço do site (origem permitida para CORS e para pedidos que alteram dados). */
  corsOrigin: string;
}

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Dados inválidos",
      issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
    return;
  }
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
    return;
  }
  // Erros do próprio Express/body-parser (ex.: JSON malformado).
  const status = typeof err?.status === "number" ? err.status : 500;
  if (status < 500) {
    res.status(status).json({ error: status === 413 ? "O arquivo é grande demais" : "Requisição inválida" });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Erro interno" });
};

export function createApp(deps: AppDeps, opts: AppOptions) {
  const app = express();
  app.disable("x-powered-by");

  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(cors({ origin: opts.corsOrigin, credentials: true }));
  app.use(express.json({ limit: "50kb" }));
  app.use(sameOriginGuard(opts.corsOrigin));
  app.use(sessionLoader(deps.db, deps.now));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/api/auth", authRoutes(deps));
  app.use("/api/admin", requireOwner, adminRoutes(deps));
  app.use("/api", publicRoutes(deps));

  app.use((_req, res) => {
    res.status(404).json({ error: "Rota não encontrada" });
  });
  app.use(errorHandler);
  return app;
}
