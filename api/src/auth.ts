import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Protege as rotas do painel com um token Bearer (ADMIN_TOKEN). */
export function requireAdmin(adminToken: string): RequestHandler {
  return (req, res, next) => {
    if (!adminToken) {
      res.status(503).json({ error: "Painel desativado: defina ADMIN_TOKEN no servidor" });
      return;
    }
    const header = req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token || !safeEqual(token, adminToken)) {
      res.status(401).json({ error: "Não autorizado" });
      return;
    }
    next();
  };
}
