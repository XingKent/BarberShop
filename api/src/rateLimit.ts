import type { RequestHandler } from "express";

/**
 * Limite de pedidos por IP, na memória da API (uma cópia da API = um contador). Segura quem tenta
 * adivinhar senhas e códigos, ou usa o cadastro para encher a caixa de e-mail de outras pessoas.
 * O limite por conta (5 erros = bloqueio) continua valendo por cima deste.
 */
export function createRateLimiter(now: () => Date) {
  return (opts: { windowMs: number; max: number }): RequestHandler => {
    const hits = new Map<string, { count: number; resetAt: number }>();
    return (req, res, next) => {
      const t = now().getTime();
      if (hits.size > 10_000) {
        for (const [key, h] of hits) if (h.resetAt <= t) hits.delete(key);
        if (hits.size > 50_000) hits.clear(); // proteção da memória contra uma enxurrada de IPs
      }
      const key = req.ip ?? "desconhecido";
      let h = hits.get(key);
      if (!h || h.resetAt <= t) {
        h = { count: 0, resetAt: t + opts.windowMs };
        hits.set(key, h);
      }
      h.count += 1;
      if (h.count > opts.max) {
        const seconds = Math.max(1, Math.ceil((h.resetAt - t) / 1000));
        res.setHeader("Retry-After", String(seconds));
        res.status(429).json({ error: "Muitas tentativas. Espere alguns minutos e tente de novo." });
        return;
      }
      next();
    };
  };
}
