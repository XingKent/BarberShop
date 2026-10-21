import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { sessions, users } from "../db/schema.js";
import { hashPassword, MIN_PASSWORD_LENGTH } from "./password.js";

/**
 * Cria a conta do dono na primeira inicialização, a partir de OWNER_EMAIL e OWNER_PASSWORD.
 * Se já existe um dono, não mexe em nada (a senha não é sobrescrita por mudar o .env).
 * O autenticador (2FA) é configurado no primeiro login.
 */
export async function ensureOwner(
  db: Db,
  email: string,
  password: string,
): Promise<"created" | "exists" | "skipped"> {
  if (!email || !password) return "skipped";
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`OWNER_PASSWORD precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres`);
  }
  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.role, "OWNER")).limit(1);
  if (owner) return "exists";

  const passwordHash = await hashPassword(password);
  const normalized = email.trim().toLowerCase();
  const [row] = await db
    .insert(users)
    .values({ email: normalized, role: "OWNER", passwordHash })
    .onConflictDoUpdate({ target: users.email, set: { role: "OWNER", passwordHash } })
    .returning({ id: users.id });
  // Se esse e-mail já tinha conta de cliente, encerra as sessões antigas dela.
  if (row) await db.delete(sessions).where(eq(sessions.userId, row.id));
  return "created";
}
