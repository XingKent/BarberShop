import { randomInt } from "node:crypto";
import { and, count, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { loginCodes, type CodePurpose } from "../db/schema.js";
import { AppError } from "../errors.js";
import { safeEqual } from "./compare.js";
import { sha256 } from "./sessions.js";

const MINUTE = 60 * 1000;
const CODE_TTL_MS = 10 * MINUTE;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_WINDOW = 3;
const WINDOW_MS = 15 * MINUTE;

// O hash inclui a finalidade e o e-mail: um código de "confirmar e-mail" não serve para redefinir senha.
const hashOf = (email: string, purpose: CodePurpose, code: string) => sha256(`${purpose}:${email}:${code}`);

/**
 * Gera um código de 6 números e guarda só o hash. Devolve o código para ser enviado por e-mail.
 * Limita os pedidos por e-mail. Quem chama gera o código mesmo quando o e-mail não tem conta
 * (e só deixa de enviar), para que a resposta não revele quais e-mails existem.
 */
export async function issueCode(
  db: Db,
  opts: { email: string; purpose: CodePurpose; now: Date },
): Promise<string> {
  const { email, purpose, now } = opts;
  const [recent] = await db
    .select({ n: count() })
    .from(loginCodes)
    .where(
      and(
        eq(loginCodes.email, email),
        eq(loginCodes.purpose, purpose),
        gt(loginCodes.createdAt, new Date(now.getTime() - WINDOW_MS)),
      ),
    );
  if ((recent?.n ?? 0) >= MAX_CODES_PER_WINDOW) {
    throw new AppError(429, "Você pediu códigos demais. Espere alguns minutos e tente de novo.");
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.insert(loginCodes).values({
    email,
    purpose,
    codeHash: hashOf(email, purpose, code),
    expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    createdAt: now,
  });
  return code;
}

/** Confere o código mais recente. Cada código vale uma vez só e tem 5 tentativas. */
export async function consumeCode(
  db: Db,
  opts: { email: string; purpose: CodePurpose; code: string; now: Date },
): Promise<boolean> {
  const { email, purpose, code, now } = opts;
  const [row] = await db
    .select()
    .from(loginCodes)
    .where(
      and(
        eq(loginCodes.email, email),
        eq(loginCodes.purpose, purpose),
        isNull(loginCodes.consumedAt),
        gt(loginCodes.expiresAt, now),
      ),
    )
    // O id desempata códigos criados no mesmo instante: vale sempre o último enviado.
    .orderBy(desc(loginCodes.createdAt), desc(loginCodes.id))
    .limit(1);
  if (!row || row.attempts >= MAX_ATTEMPTS) return false;

  if (!safeEqual(row.codeHash, hashOf(email, purpose, code))) {
    await db
      .update(loginCodes)
      .set({ attempts: sql`${loginCodes.attempts} + 1` })
      .where(eq(loginCodes.id, row.id));
    return false;
  }
  // Consome de forma atômica: duas requisições com o mesmo código não passam as duas.
  const [claimed] = await db
    .update(loginCodes)
    .set({ consumedAt: now })
    .where(and(eq(loginCodes.id, row.id), isNull(loginCodes.consumedAt)))
    .returning({ id: loginCodes.id });
  return !!claimed;
}
