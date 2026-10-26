import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureOwner } from "./auth/owner.js";
import { createSession, TTL } from "./auth/sessions.js";
import { MAX_ACTIVE_BOOKINGS } from "./booking.js";
import { users } from "./db/schema.js";
import {
  bookingBody,
  createTestApp,
  NOW,
  seedShop,
  signUp,
  TUESDAY,
  type Jar,
  type Shop,
  type TestApp,
} from "./testkit.js";

// Ataques que a API precisa continuar barrando. Nascem de uma auditoria de segurança: cada teste
// tenta fazer o que um invasor faria e confere que não funciona.

describe("permissões, IDOR e sessão", () => {
  let t: TestApp;
  let shop: Shop;
  let alice: Jar;
  let bob: Jar;
  let ownerId: number;

  beforeAll(async () => {
    t = await createTestApp();
    shop = await seedShop(t.db);
    await ensureOwner(t.db, "dono@barbearia.test", "senha-forte-123");
    const [owner] = await t.db.select().from(users).where(eq(users.role, "OWNER"));
    ownerId = owner!.id;
    alice = await signUp(t, { email: "alice@x.com", name: "Alice" });
    bob = await signUp(t, { email: "bob@x.com", name: "Bob" });
  });
  afterAll(() => t.close());

  const adminGets = [
    "/api/admin/appointments",
    "/api/admin/customers",
    "/api/admin/services",
    "/api/admin/barbers",
    "/api/admin/reports/revenue?from=2026-10-01&to=2026-10-31",
  ];

  it("o painel recusa quem não entrou (401) e quem é só cliente (403)", async () => {
    for (const path of adminGets) {
      expect((await t.call(path)).status, path).toBe(401);
      expect((await t.call(path, { jar: alice })).status, path).toBe(403);
    }
    const write = { method: "POST", body: { name: "X", durationMin: 10, priceCents: 1 } };
    expect((await t.call("/api/admin/services", write)).status).toBe(401);
    expect((await t.call("/api/admin/services", { ...write, jar: alice })).status).toBe(403);
    expect((await t.call("/api/admin/appointments/1", { method: "PATCH", jar: alice, body: { status: "COMPLETED" } })).status).toBe(403);
  });

  it("a sessão curta de configuração do 2FA não abre o painel", async () => {
    const s = await createSession(t.db, ownerId, "totp_setup", TTL.totpSetup, t.now());
    const jar = { cookie: `sid=${s.token}` };
    expect((await t.call("/api/admin/customers", { jar })).status).toBe(401);
    expect((await t.call("/api/auth/me", { jar })).body.user).toBeNull();
    expect((await t.call("/api/auth/owner/totp/setup", { jar: alice })).status).toBe(401);
  });

  it("uma cliente não vê nem cancela o horário de outra pessoa", async () => {
    const aliceBook = await t.call("/api/appointments", { method: "POST", jar: alice, body: bookingBody(shop, shop.carlosId, "09:00") });
    const bobBook = await t.call("/api/appointments", { method: "POST", jar: bob, body: bookingBody(shop, shop.carlosId, "09:30") });
    expect(aliceBook.status).toBe(201);
    expect(bobBook.status).toBe(201);
    const bobId = bobBook.body.id as number;

    expect((await t.call(`/api/me/appointments/${bobId}/cancel`, { method: "POST", jar: alice, body: {} })).status).toBe(404);
    const hist = await t.call("/api/me/appointments", { jar: alice });
    expect(hist.body.map((a: { id: number }) => a.id)).toEqual([aliceBook.body.id]);

    // Pelo link: sem token, token errado ou token de outro horário não abre nada.
    expect((await t.call(`/api/appointments/${bobId}`)).status).toBe(400);
    expect((await t.call(`/api/appointments/${bobId}?token=errado`)).status).toBe(404);
    expect((await t.call(`/api/appointments/${aliceBook.body.id}?token=${bobBook.body.cancelToken}`)).status).toBe(404);
    expect((await t.call(`/api/appointments/${bobId}/cancel`, { method: "POST", body: { token: "x".repeat(36) } })).status).toBe(404);

    // O que o link mostra não inclui token, e-mail nem celular.
    const view = await t.call(`/api/appointments/${bobId}?token=${bobBook.body.cancelToken}`);
    expect(view.status).toBe(200);
    expect(JSON.stringify(view.body)).not.toMatch(/@|phone|cancelToken/);
  });

  it("cadastro não aceita campos de permissão e o e-mail do dono não pode ser tomado", async () => {
    const reg = await t.call("/api/auth/register", {
      method: "POST",
      body: { name: "Mal", phone: "21999990002", email: "mal@x.com", password: "senha-longa-123", role: "OWNER", emailVerifiedAt: "2020-01-01", totpEnabled: true },
    });
    expect(reg.status).toBe(201);
    const [mal] = await t.db.select().from(users).where(eq(users.email, "mal@x.com"));
    expect(mal).toMatchObject({ role: "CLIENT", emailVerifiedAt: null, totpEnabled: false });

    const login = await t.call("/api/auth/login", { method: "POST", body: { email: "mal@x.com", password: "senha-longa-123" } });
    expect(login.status).toBe(403); // e-mail ainda não confirmado

    const takeover = await t.call("/api/auth/register", {
      method: "POST",
      body: { name: "Mal", phone: "21999990002", email: "DONO@barbearia.test", password: "senha-longa-123" },
    });
    expect(takeover.status).toBe(409);
    const asClient = await t.call("/api/auth/login", { method: "POST", body: { email: "dono@barbearia.test", password: "senha-forte-123" } });
    expect(asClient.status).toBe(401); // o dono só entra pelo login com 2FA
  });

  it("um cookie de sessão malformado não derruba a requisição", async () => {
    for (const cookie of ["sid=%", "sid=%E0%A4%A", "sid=%zz; other=%"]) {
      const res = await fetch(`${t.base}/api/auth/me`, { headers: { cookie } });
      expect(res.status, cookie).toBe(200);
      expect((await res.json()).user).toBeNull();
    }
  });

  it("entradas de injeção viram erro 4xx e não mexem no banco", async () => {
    const probes = await Promise.all([
      t.call("/api/availability?date=2026-10-13'%20OR%201=1--&serviceId=1"),
      t.call("/api/availability?date=2026-10-13&serviceId=1;DROP%20TABLE%20users"),
      t.call("/api/auth/login", { method: "POST", body: { email: "' OR '1'='1", password: "' OR '1'='1" } }),
      t.call("/api/auth/login", { method: "POST", body: { email: { $ne: null }, password: { $ne: null } } }),
      t.call(`/api/appointments/1?token=${encodeURIComponent("' OR 1=1--")}`),
    ]);
    for (const p of probes) expect(p.status).toBeGreaterThanOrEqual(400);
    for (const p of probes) expect(p.status).toBeLessThan(500);
    expect((await t.db.select().from(users)).length).toBeGreaterThan(3);
  });
});

describe("abuso das reservas", () => {
  let t: TestApp;
  let shop: Shop;
  let alice: Jar;
  let bob: Jar;

  beforeAll(async () => {
    t = await createTestApp();
    shop = await seedShop(t.db);
    alice = await signUp(t, { email: "alice@x.com", name: "Alice" });
    bob = await signUp(t, { email: "bob@x.com", name: "Bob" });
  });
  afterAll(() => t.close());

  const book = (jar: Jar, barberId: number, time: string, date = TUESDAY) =>
    t.call("/api/appointments", { method: "POST", jar, body: { ...bookingBody(shop, barberId, time), startsAt: `${date}T${time}:00-03:00` } });

  it(`uma pessoa só pode ter ${MAX_ACTIVE_BOOKINGS} horários futuros ao mesmo tempo`, async () => {
    for (const time of ["09:00", "09:30", "10:00"]) expect((await book(alice, shop.carlosId, time)).status).toBe(201);
    const fourth = await book(alice, shop.carlosId, "10:30");
    expect(fourth.status).toBe(409);
    expect(fourth.body.code).toBe("TOO_MANY_BOOKINGS");

    // Outra pessoa não é afetada e o horário continua livre para ela.
    expect((await book(bob, shop.carlosId, "10:30")).status).toBe(201);

    // Cancelar libera uma vaga.
    const mine = await t.call("/api/me/appointments", { jar: alice });
    await t.call(`/api/me/appointments/${mine.body[0].id}/cancel`, { method: "POST", jar: alice, body: {} });
    expect((await book(alice, shop.rafaelId, "09:00")).status).toBe(201);
  });

  it("pedidos simultâneos da mesma pessoa não furam o limite", async () => {
    const carla = await signUp(t, { email: "carla@x.com", name: "Carla" });
    const tries = await Promise.all(
      ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"].map((time) => book(carla, shop.rafaelId, time, TUESDAY)),
    );
    const ok = tries.filter((r) => r.status === 201).length;
    expect(ok).toBeLessThanOrEqual(MAX_ACTIVE_BOOKINGS);
  });

  it("não dá para reservar com mais de 60 dias de antecedência", async () => {
    const dana = await signUp(t, { email: "dana@x.com", name: "Dana" });
    const far = await t.call("/api/appointments", {
      method: "POST",
      jar: dana,
      body: { serviceId: shop.serviceId, barberId: shop.carlosId, startsAt: new Date(NOW.getTime() + 61 * 86_400_000).toISOString() },
    });
    expect(far.status).toBe(400);
    expect(far.body.error).toMatch(/60 dias/);
    expect((await book(dana, shop.carlosId, "09:00", "2026-12-01")).status).toBe(201); // 53 dias: pode
  });
});

describe("limite de tentativas por IP", () => {
  it("segura quem tenta adivinhar senha e volta ao normal depois da janela", async () => {
    const t = await createTestApp({ rateLimit: true });
    await seedShop(t.db);
    try {
      const attempt = () => t.call("/api/auth/login", { method: "POST", body: { email: "ninguem@x.com", password: "tentativa-errada-1" } });
      for (let i = 0; i < 30; i++) expect((await attempt()).status).toBe(401);
      const blocked = await attempt();
      expect(blocked.status).toBe(429);
      t.advance(16 * 60 * 1000);
      expect((await attempt()).status).toBe(401);
    } finally {
      t.close();
    }
  });

  it("segura o uso do cadastro para encher a caixa de e-mail de outras pessoas", async () => {
    const t = await createTestApp({ rateLimit: true });
    try {
      const register = (i: number) =>
        t.call("/api/auth/register", { method: "POST", body: { name: "Spam", phone: "21999990004", email: `vitima${i}@gmail.com`, password: "senha-longa-123" } });
      for (let i = 0; i < 10; i++) expect((await register(i)).status).toBe(201);
      expect((await register(10)).status).toBe(429);
      expect(t.mailer.outbox.length).toBe(10);
    } finally {
      t.close();
    }
  });
});
