import { and, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { consumeCode, issueCode } from "../auth/codes.js";
import { requireTotpSetup, requireUser } from "../auth/middleware.js";
import { dummyVerify, hashPassword, verifyPassword } from "../auth/password.js";
import {
  clearSessionCookie,
  COOKIE,
  createSession,
  destroySession,
  parseCookies,
  setSessionCookie,
  TTL,
} from "../auth/sessions.js";
import { generateSecret, otpauthUri, verifyTotp } from "../auth/totp.js";
import type { CodePurpose } from "../db/schema.js";
import { appointments, customers, loginCodes, sessions, users } from "../db/schema.js";
import type { AppDeps } from "../deps.js";
import { AppError } from "../errors.js";
import { codeMessage, notifyAll } from "../notifications.js";

const MINUTE = 60 * 1000;
const LOCK_AFTER = 5;
const LOCK_MS = 15 * MINUTE;
/** Senha de cliente: 8 ou mais caracteres. (A do dono exige 10, ver auth/owner.ts.) */
const MIN_CLIENT_PASSWORD = 8;

const emailSchema = z.string().trim().toLowerCase().pipe(z.email("E-mail inválido").max(200));
const passwordSchema = z
  .string()
  .min(MIN_CLIENT_PASSWORD, `A senha precisa ter pelo menos ${MIN_CLIENT_PASSWORD} caracteres`)
  .max(200, "A senha é longa demais");
const phoneSchema = z
  .string()
  .transform((s) => s.replace(/\D/g, ""))
  .refine((s) => s.length >= 10 && s.length <= 13, "Celular inválido: informe com DDD");
const nameSchema = z.string().trim().min(2, "Informe seu nome").max(100);
const codeBodySchema = z.object({
  email: emailSchema,
  code: z.string().trim().regex(/^\d{6}$/, "O código tem 6 números"),
});

export function authRoutes(deps: AppDeps) {
  const { db, now, cookieSecure } = deps;
  const r = Router();

  // Quem está logado (ou null). Também devolve nome e celular já salvos, para preencher o agendamento.
  r.get("/me", async (req, res) => {
    if (!req.auth || req.auth.session.scope !== "full") {
      res.json({ user: null, customer: null });
      return;
    }
    const [customer] = await db
      .select({ name: customers.name, phone: customers.phone })
      .from(customers)
      .where(eq(customers.userId, req.auth.user.id));
    res.json({ user: req.auth.user, customer: customer ?? null });
  });

  r.post("/logout", async (req, res) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) await destroySession(db, token);
    clearSessionCookie(res, cookieSecure);
    res.json({ ok: true });
  });

  // ---------- Cliente: e-mail + senha ----------

  const wrongLogin = () => new AppError(401, "E-mail ou senha incorretos");
  const invalidCode = () => new AppError(400, "Código incorreto ou vencido. Peça um novo código.");

  /**
   * Gera e envia um código por e-mail. Quando `eligible` é falso (o e-mail não tem conta) o código
   * é gerado mas não enviado, para a resposta não revelar quais e-mails existem.
   */
  async function sendCode(email: string, purpose: CodePurpose, eligible: boolean) {
    const code = await issueCode(db, { email, purpose, now: now() });
    if (!eligible) return;
    const sent = await notifyAll(
      deps.channels,
      codeMessage({ kind: purpose, shopName: deps.shopName, email, code }),
    );
    if (!sent) throw new AppError(502, "Não conseguimos enviar o e-mail agora. Tente de novo em instantes.");
  }

  // Cria a conta e o cadastro (nome e celular). A pessoa só entra depois de confirmar o e-mail com o
  // código que recebe: assim os avisos de agendamento vão para o dono do e-mail, não para um desconhecido.
  r.post("/register", async (req, res) => {
    const body = z
      .object({ name: nameSchema, phone: phoneSchema, email: emailSchema, password: passwordSchema })
      .parse(req.body);

    const passwordHash = await hashPassword(body.password);
    const created = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ email: body.email, passwordHash })
        .onConflictDoNothing({ target: users.email })
        .returning({ id: users.id });
      if (!user) return false;
      await tx
        .insert(customers)
        .values({ userId: user.id, name: body.name, phone: body.phone, email: body.email });
      return true;
    });
    if (!created) {
      throw new AppError(
        409,
        'Já existe uma conta com este e-mail. Entre, ou use "Esqueci minha senha".',
        "EMAIL_TAKEN",
      );
    }
    await sendCode(body.email, "verify_email", true);
    res.status(201).json({ needsVerification: true });
  });

  r.post("/email/resend", async (req, res) => {
    const { email } = z.object({ email: emailSchema }).parse(req.body);
    const [user] = await db
      .select({ role: users.role, verified: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.email, email));
    await sendCode(email, "verify_email", user?.role === "CLIENT" && !user.verified);
    res.json({ ok: true });
  });

  // Confirma o e-mail com o código recebido e já deixa a pessoa logada.
  r.post("/email/verify", async (req, res) => {
    const { email, code } = codeBodySchema.parse(req.body);
    const t = now();
    if (!(await consumeCode(db, { email, purpose: "verify_email", code, now: t }))) throw invalidCode();

    const [user] = await db
      .update(users)
      .set({ emailVerifiedAt: t })
      .where(and(eq(users.email, email), eq(users.role, "CLIENT")))
      .returning({ id: users.id, email: users.email, role: users.role });
    if (!user) throw invalidCode();

    const session = await createSession(db, user.id, "full", TTL.client, t);
    setSessionCookie(res, session.token, session.expiresAt, cookieSecure);
    res.json({ user });
  });

  r.post("/login", async (req, res) => {
    const body = z
      .object({ email: emailSchema, password: z.string().min(1).max(200) })
      .parse(req.body);
    const t = now();

    const [user] = await db.select().from(users).where(eq(users.email, body.email));
    // O dono entra por /owner/login. Aqui ele recebe a mesma recusa de uma conta que não existe.
    if (!user || user.role !== "CLIENT" || !user.passwordHash) {
      await dummyVerify(body.password); // mesmo tempo de resposta, exista ou não a conta
      throw wrongLogin();
    }
    if (user.lockedUntil && user.lockedUntil > t) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - t.getTime()) / MINUTE);
      throw new AppError(429, `Muitas tentativas erradas. Tente de novo em ${minutes} min.`);
    }
    if (!(await verifyPassword(body.password, user.passwordHash))) {
      await registerFailure(user.id, t);
      throw wrongLogin();
    }
    if (!user.emailVerifiedAt) {
      // Senha certa, e-mail ainda não confirmado: manda um código novo e o site abre a tela de código.
      await sendCode(user.email, "verify_email", true);
      throw new AppError(403, "Confirme seu e-mail para entrar. Enviamos um novo código.", "EMAIL_NOT_VERIFIED");
    }

    await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, user.id));
    const session = await createSession(db, user.id, "full", TTL.client, t);
    setSessionCookie(res, session.token, session.expiresAt, cookieSecure);
    res.json({ user: { id: user.id, email: user.email, role: user.role } });
  });

  // A resposta é a mesma exista ou não a conta.
  r.post("/password/forgot", async (req, res) => {
    const { email } = z.object({ email: emailSchema }).parse(req.body);
    const [user] = await db.select({ role: users.role }).from(users).where(eq(users.email, email));
    await sendCode(email, "reset_password", user?.role === "CLIENT");
    res.json({ ok: true });
  });

  // Troca a senha com o código recebido. Encerra todas as sessões abertas dessa conta (se alguém
  // tinha entrado sem permissão, sai agora). Quem recebeu o código provou que o e-mail é seu.
  r.post("/password/reset", async (req, res) => {
    const { email, code, password } = codeBodySchema.extend({ password: passwordSchema }).parse(req.body);
    const t = now();
    if (!(await consumeCode(db, { email, purpose: "reset_password", code, now: t }))) throw invalidCode();

    const passwordHash = await hashPassword(password);
    const [user] = await db
      .update(users)
      .set({ passwordHash, emailVerifiedAt: t, failedLogins: 0, lockedUntil: null })
      .where(and(eq(users.email, email), eq(users.role, "CLIENT")))
      .returning({ id: users.id });
    if (!user) throw invalidCode();
    await db.delete(sessions).where(eq(sessions.userId, user.id));
    res.json({ ok: true });
  });

  // Nome e celular do cadastro (a barbearia usa para ligar se precisar).
  r.patch("/profile", requireUser, async (req, res) => {
    const body = z.object({ name: nameSchema, phone: phoneSchema }).parse(req.body);
    const [customer] = await db
      .update(customers)
      .set(body)
      .where(eq(customers.userId, req.auth!.user.id))
      .returning({ name: customers.name, phone: customers.phone });
    if (!customer) throw new AppError(404, "Cadastro não encontrado");
    res.json({ customer });
  });

  // Excluir a própria conta (pede a senha). O que sai: e-mail, senha, sessões, nome e celular.
  // O que fica, sem identificar ninguém: os atendimentos já feitos, para o faturamento do dono não
  // mudar. Horários futuros são cancelados e voltam a ficar livres.
  r.delete("/account", requireUser, async (req, res) => {
    const { password } = z.object({ password: z.string().min(1).max(200) }).parse(req.body);
    const t = now();
    const [user] = await db.select().from(users).where(eq(users.id, req.auth!.user.id));
    if (!user || user.role !== "CLIENT" || !user.passwordHash) {
      throw new AppError(403, "A conta do dono não pode ser excluída por aqui");
    }
    if (user.lockedUntil && user.lockedUntil > t) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - t.getTime()) / MINUTE);
      throw new AppError(429, `Muitas tentativas erradas. Tente de novo em ${minutes} min.`);
    }
    if (!(await verifyPassword(password, user.passwordHash))) {
      await registerFailure(user.id, t);
      throw new AppError(401, "Senha incorreta");
    }

    await db.transaction(async (tx) => {
      const [customer] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.userId, user.id));
      if (customer) {
        await tx
          .update(appointments)
          .set({ status: "CANCELED" })
          .where(
            and(
              eq(appointments.customerId, customer.id),
              inArray(appointments.status, ["PENDING", "CONFIRMED"]),
              gt(appointments.startsAt, t),
            ),
          );
        await tx
          .update(customers)
          .set({ name: "Cliente removido", phone: "", email: null, userId: null })
          .where(eq(customers.id, customer.id));
      }
      await tx.delete(loginCodes).where(eq(loginCodes.email, user.email));
      await tx.delete(users).where(eq(users.id, user.id)); // as sessões saem junto (cascade)
    });
    clearSessionCookie(res, cookieSecure);
    res.json({ ok: true });
  });

  // ---------- Dono: e-mail + senha + código do autenticador ----------

  async function registerFailure(userId: number, t: Date) {
    const [row] = await db
      .update(users)
      .set({ failedLogins: sql`${users.failedLogins} + 1` })
      .where(eq(users.id, userId))
      .returning({ failed: users.failedLogins });
    if (row && row.failed >= LOCK_AFTER) {
      await db
        .update(users)
        .set({ failedLogins: 0, lockedUntil: new Date(t.getTime() + LOCK_MS) })
        .where(eq(users.id, userId));
    }
  }

  r.post("/owner/login", async (req, res) => {
    const body = z
      .object({
        email: emailSchema,
        password: z.string().min(1).max(200),
        totp: z.string().trim().max(12).optional(),
      })
      .parse(req.body);
    const t = now();

    const [user] = await db.select().from(users).where(eq(users.email, body.email));
    if (!user || user.role !== "OWNER" || !user.passwordHash) {
      await dummyVerify(body.password); // mesmo tempo de resposta, exista ou não a conta
      throw wrongLogin();
    }
    if (user.lockedUntil && user.lockedUntil > t) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - t.getTime()) / MINUTE);
      throw new AppError(429, `Muitas tentativas erradas. Tente de novo em ${minutes} min.`);
    }
    if (!(await verifyPassword(body.password, user.passwordHash))) {
      await registerFailure(user.id, t);
      throw wrongLogin();
    }

    // Senha certa, mas o autenticador ainda não foi configurado: sessão curta só para isso.
    if (!user.totpEnabled || !user.totpSecret) {
      const session = await createSession(db, user.id, "totp_setup", TTL.totpSetup, t);
      setSessionCookie(res, session.token, session.expiresAt, cookieSecure);
      res.json({ needsTotpSetup: true });
      return;
    }

    if (!body.totp) {
      throw new AppError(401, "Digite o código do aplicativo autenticador", "TOTP_REQUIRED");
    }
    const step = verifyTotp(user.totpSecret, body.totp, t, user.totpLastStep);
    // Grava o intervalo usado só se for maior que o anterior: o mesmo código não vale duas vezes.
    const [claimed] =
      step === null
        ? []
        : await db
            .update(users)
            .set({ totpLastStep: step, failedLogins: 0, lockedUntil: null })
            .where(and(eq(users.id, user.id), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))))
            .returning({ id: users.id });
    if (!claimed) {
      await registerFailure(user.id, t);
      throw new AppError(401, "Código do autenticador incorreto ou já usado", "TOTP_INVALID");
    }

    const session = await createSession(db, user.id, "full", TTL.owner, t);
    setSessionCookie(res, session.token, session.expiresAt, cookieSecure);
    res.json({ user: { id: user.id, email: user.email, role: user.role } });
  });

  // Gera o segredo e o endereço otpauth:// (o front desenha o QR code a partir dele).
  r.get("/owner/totp/setup", requireTotpSetup, async (req, res) => {
    const auth = req.auth!;
    const secret = generateSecret();
    await db.update(users).set({ totpSecret: secret }).where(eq(users.id, auth.user.id));
    res.json({ secret, uri: otpauthUri(secret, auth.user.email, deps.shopName) });
  });

  r.post("/owner/totp/enable", requireTotpSetup, async (req, res) => {
    const auth = req.auth!;
    const { code } = z.object({ code: z.string().trim().max(12) }).parse(req.body);
    const t = now();

    const [user] = await db.select().from(users).where(eq(users.id, auth.user.id));
    if (!user?.totpSecret) throw new AppError(400, "Escaneie o QR code primeiro");
    if (user.lockedUntil && user.lockedUntil > t) {
      throw new AppError(429, "Muitas tentativas erradas. Tente de novo mais tarde.");
    }

    const step = verifyTotp(user.totpSecret, code, t, null);
    if (step === null) {
      await registerFailure(user.id, t);
      throw new AppError(400, "Código incorreto. Confira a hora do celular e tente de novo.", "TOTP_INVALID");
    }
    await db
      .update(users)
      .set({ totpEnabled: true, totpLastStep: step, failedLogins: 0, lockedUntil: null })
      .where(eq(users.id, user.id));

    // Troca a sessão curta de configuração por uma sessão completa.
    const setupToken = parseCookies(req.headers.cookie)[COOKIE];
    if (setupToken) await destroySession(db, setupToken);
    const session = await createSession(db, user.id, "full", TTL.owner, t);
    setSessionCookie(res, session.token, session.expiresAt, cookieSecure);
    res.json({ user: { id: user.id, email: user.email, role: user.role } });
  });

  return r;
}
