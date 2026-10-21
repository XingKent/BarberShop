import type { RequestHandler } from "express";
import type { Db } from "../db/index.js";
import { COOKIE, findSession, parseCookies } from "./sessions.js";

/** Carrega a sessão do cookie (se houver) em req.auth. */
export function sessionLoader(db: Db, now: () => Date): RequestHandler {
  return async (req, _res, next) => {
    try {
      const token = parseCookies(req.headers.cookie)[COOKIE];
      if (token) {
        const found = await findSession(db, token, now());
        if (found) req.auth = found;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Proteção contra requisições vindas de outro site (CSRF): pedidos que alteram dados e trazem
 * o cabeçalho Origin só passam se a origem for o próprio site ou a configurada em CORS_ORIGIN.
 */
export function sameOriginGuard(allowedOrigin: string): RequestHandler {
  return (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (!origin) return next();
    let host = "";
    try {
      host = new URL(origin).host;
    } catch {
      /* origem malformada: cai no bloqueio abaixo */
    }
    if (origin === allowedOrigin || (host && host === req.headers.host)) return next();
    res.status(403).json({ error: "Origem não permitida" });
  };
}

/** Qualquer usuário logado (sessão completa). */
export const requireUser: RequestHandler = (req, res, next) => {
  if (!req.auth || req.auth.session.scope !== "full") {
    res.status(401).json({ error: "Entre na sua conta para continuar", code: "LOGIN_REQUIRED" });
    return;
  }
  next();
};

/** Cliente logado (a conta do dono não agenda horários). */
export const requireClient: RequestHandler = (req, res, next) => {
  if (!req.auth || req.auth.session.scope !== "full") {
    res.status(401).json({ error: "Entre na sua conta para agendar", code: "LOGIN_REQUIRED" });
    return;
  }
  if (req.auth.user.role !== "CLIENT") {
    res.status(403).json({ error: "A conta do dono não agenda horários. Use uma conta de cliente." });
    return;
  }
  next();
};

/** Só o dono, com sessão completa (senha e código do autenticador já confirmados). */
export const requireOwner: RequestHandler = (req, res, next) => {
  if (!req.auth || req.auth.session.scope !== "full") {
    res.status(401).json({ error: "Entre com a conta do dono", code: "LOGIN_REQUIRED" });
    return;
  }
  if (req.auth.user.role !== "OWNER") {
    res.status(403).json({ error: "Acesso restrito ao dono da barbearia" });
    return;
  }
  next();
};

/** Etapa intermediária: dono que acertou a senha e ainda vai ativar o autenticador. */
export const requireTotpSetup: RequestHandler = (req, res, next) => {
  if (!req.auth || req.auth.session.scope !== "totp_setup" || req.auth.user.role !== "OWNER") {
    res.status(401).json({ error: "Entre com e-mail e senha para configurar o autenticador" });
    return;
  }
  next();
};
