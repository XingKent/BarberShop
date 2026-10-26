import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import type { Response } from "express";
import type { Db } from "../db/index.js";
import { loginCodes, sessions, users, type SessionScope, type UserRole } from "../db/schema.js";

export const COOKIE = "sid";

const HOUR = 60 * 60 * 1000;
export const TTL = {
  client: 30 * 24 * HOUR,
  owner: 12 * HOUR,
  totpSetup: 0.25 * HOUR,
};

export interface AuthContext {
  user: { id: number; email: string; role: UserRole };
  session: { id: number; scope: SessionScope; tokenHash: string };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export async function createSession(
  db: Db,
  userId: number,
  scope: SessionScope,
  ttlMs: number,
  now: Date,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + ttlMs);
  await db.insert(sessions).values({ tokenHash: sha256(token), userId, scope, expiresAt });
  return { token, expiresAt };
}

export async function findSession(db: Db, token: string, now: Date): Promise<AuthContext | undefined> {
  const tokenHash = sha256(token);
  const [row] = await db
    .select({
      sessionId: sessions.id,
      scope: sessions.scope,
      userId: users.id,
      email: users.email,
      role: users.role,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)));
  if (!row) return undefined;
  return {
    user: { id: row.userId, email: row.email, role: row.role },
    session: { id: row.sessionId, scope: row.scope, tokenHash },
  };
}

export async function destroySession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}

/** Remove sessões e códigos vencidos. */
export async function purgeExpired(db: Db, now: Date): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, now));
  await db.delete(loginCodes).where(lt(loginCodes.expiresAt, now));
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (!key) continue;
    const raw = part.slice(i + 1).trim();
    try {
      out[key] = decodeURIComponent(raw);
    } catch {
      out[key] = raw; // cookie com "%" solto: segue como texto puro (a sessão simplesmente não existe)
    }
  }
  return out;
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date, secure: boolean) {
  res.cookie(COOKIE, token, {
    httpOnly: true, // o JavaScript da página não consegue ler o cookie
    sameSite: "lax",
    secure,
    expires: expiresAt,
    path: "/",
  });
}

export function clearSessionCookie(res: Response, secure: boolean) {
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: "lax", secure, path: "/" });
}
