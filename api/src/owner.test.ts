import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureOwner } from "./auth/owner.js";
import { codeForStep, stepAt } from "./auth/totp.js";
import {
  bookingBody,
  createTestApp,
  newJar,
  seedShop,
  signUp,
  TUESDAY,
  type Jar,
  type Shop,
  type TestApp,
} from "./testkit.js";

const OWNER = "dono@barbearia.test";
const PASSWORD = "senha-forte-123";
const MINUTE = 60_000;

let t: TestApp;
let shop: Shop;
let secret = "";
const ownerJar = newJar();

const rightCode = () => codeForStep(secret, stepAt(t.now().getTime()));
function wrongCode() {
  const step = stepAt(t.now().getTime());
  const valid = new Set([-1, 0, 1].map((d) => codeForStep(secret, step + d)));
  return ["000000", "111111", "222222"].find((c) => !valid.has(c))!;
}
const login = (body: { password?: string; totp?: string }, jar?: Jar) =>
  t.call("/api/auth/owner/login", {
    method: "POST",
    body: { email: OWNER, password: PASSWORD, ...body },
    ...(jar ? { jar } : {}),
  });

beforeAll(async () => {
  t = await createTestApp();
  shop = await seedShop(t.db);
  await ensureOwner(t.db, OWNER, PASSWORD);
});
afterAll(() => t.close());

describe("conta do dono", () => {
  it("é criada uma vez e não é sobrescrita; recusa senha curta", async () => {
    expect(await ensureOwner(t.db, "outro@barbearia.test", "outra-senha-123")).toBe("exists");
    await expect(ensureOwner(t.db, "x@barbearia.test", "curta")).rejects.toThrow(/pelo menos/);
    expect(await ensureOwner(t.db, "", "")).toBe("skipped");
  });

  it("não entra pelo login de cliente nem recebe código de redefinição", async () => {
    const asClient = await t.call("/api/auth/login", { method: "POST", body: { email: OWNER, password: PASSWORD } });
    const unknown = await t.call("/api/auth/login", {
      method: "POST",
      body: { email: "ninguem@barbearia.test", password: PASSWORD },
    });
    expect(asClient.status).toBe(401);
    expect(asClient.body.error).toBe(unknown.body.error);

    t.mailer.outbox.splice(0);
    const forgot = await t.call("/api/auth/password/forgot", { method: "POST", body: { email: OWNER } });
    expect(forgot.status).toBe(200); // mesma resposta de qualquer e-mail
    expect(t.mailer.outbox).toHaveLength(0);
    const reset = await t.call("/api/auth/password/reset", {
      method: "POST",
      body: { email: OWNER, code: "123456", password: "senha-do-invasor-1" },
    });
    expect(reset.status).toBe(400);
  });

  it("recusa senha errada e e-mail desconhecido com a mesma mensagem", async () => {
    const wrong = await login({ password: "senha-errada-123" });
    expect(wrong.status).toBe(401);
    const unknown = await t.call("/api/auth/owner/login", {
      method: "POST",
      body: { email: "ninguem@barbearia.test", password: PASSWORD },
    });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error).toBe(wrong.body.error);
  });

  it("no primeiro login, configura o autenticador antes de ter acesso ao painel", async () => {
    const jar = newJar();
    const first = await login({}, jar);
    expect(first.status).toBe(200);
    expect(first.body.needsTotpSetup).toBe(true);

    // A sessão de configuração não abre o painel.
    expect((await t.call("/api/admin/services", { jar })).status).toBe(401);
    expect((await t.call("/api/auth/owner/totp/setup")).status).toBe(401);

    const setup = await t.call("/api/auth/owner/totp/setup", { jar });
    expect(setup.status).toBe(200);
    secret = setup.body.secret;
    expect(setup.body.uri).toMatch(/^otpauth:\/\/totp\//);
    expect(setup.body.uri).toContain(`secret=${secret}`);

    const bad = await t.call("/api/auth/owner/totp/enable", { method: "POST", body: { code: wrongCode() }, jar });
    expect(bad.status).toBe(400);

    const ok = await t.call("/api/auth/owner/totp/enable", { method: "POST", body: { code: rightCode() }, jar });
    expect(ok.status).toBe(200);
    expect(ok.body.user).toMatchObject({ email: OWNER, role: "OWNER" });
    expect((await t.call("/api/admin/services", { jar })).status).toBe(200);
    ownerJar.cookie = jar.cookie; // usado nos testes do painel
  });

  it("nos logins seguintes exige o código, e o mesmo código não vale duas vezes", async () => {
    t.advance(2 * MINUTE);
    const noCode = await login({}, newJar());
    expect(noCode.status).toBe(401);
    expect(noCode.body.code).toBe("TOTP_REQUIRED");

    const jar = newJar();
    const code = rightCode();
    const good = await login({ totp: code }, jar);
    expect(good.status).toBe(200);
    expect((await t.call("/api/admin/services", { jar })).status).toBe(200);

    const replay = await login({ totp: code }, newJar());
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe("TOTP_INVALID");
    expect((await login({ totp: wrongCode() }, newJar())).status).toBe(401);
  });

  it("bloqueia depois de 5 senhas erradas e libera passado o tempo", async () => {
    t.advance(2 * MINUTE);
    expect((await login({ totp: rightCode() }, newJar())).status).toBe(200); // zera a contagem

    for (let i = 0; i < 5; i++) {
      expect((await login({ password: "senha-errada-123" })).status).toBe(401);
    }
    t.advance(MINUTE);
    t.mailer.outbox.splice(0);
    const locked = await login({ totp: rightCode() });
    expect(locked.status).toBe(429);
    expect(locked.body.error).toMatch(/Tente de novo em/);

    t.advance(16 * MINUTE);
    expect((await login({ totp: rightCode() }, newJar())).status).toBe(200);
  });

  it("cliente logado não acessa o painel, e o dono não agenda como cliente", async () => {
    const jar = await signUp(t, { email: "cliente@exemplo.com", phone: "(21) 99999-0020" });
    expect((await t.call("/api/admin/appointments", { jar })).status).toBe(403);
    expect((await t.call("/api/admin/appointments")).status).toBe(401);

    const asOwner = await t.call("/api/appointments", {
      method: "POST",
      jar: ownerJar,
      body: bookingBody(shop, shop.carlosId, "10:00"),
    });
    expect(asOwner.status).toBe(403);
  });
});

describe("painel do dono", () => {
  let carlosAppt = 0;
  let rafaelAppt = 0;

  it("lista agendamentos do dia sem expor o token do cliente", async () => {
    const g1 = await signUp(t, { email: "g1@exemplo.com", phone: "(21) 99999-0021" });
    const g2 = await signUp(t, { email: "g2@exemplo.com", phone: "(21) 99999-0022" });
    const a = await t.call("/api/appointments", {
      method: "POST",
      jar: g1,
      body: bookingBody(shop, shop.carlosId, "09:00"),
    });
    const b = await t.call("/api/appointments", {
      method: "POST",
      jar: g2,
      body: bookingBody(shop, shop.rafaelId, "09:00"),
    });
    carlosAppt = a.body.id;
    rafaelAppt = b.body.id;

    const list = await t.call(`/api/admin/appointments?from=${TUESDAY}`, { jar: ownerJar });
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(2);
    expect(JSON.stringify(list.body)).not.toContain("cancelToken");
  });

  it("segue o fluxo de status e avisa o cliente ao confirmar e ao cancelar", async () => {
    const patch = (id: number, status: string) =>
      t.call(`/api/admin/appointments/${id}`, { method: "PATCH", jar: ownerJar, body: { status } });

    expect((await patch(rafaelAppt, "COMPLETED")).status).toBe(409); // não pode pular a confirmação

    t.mailer.outbox.splice(0);
    const confirmed = await patch(rafaelAppt, "CONFIRMED");
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.cancelToken).toBeUndefined();
    expect(t.mailer.outbox).toHaveLength(1);
    expect(t.mailer.outbox[0]).toMatchObject({ to: "g2@exemplo.com" });
    expect(t.mailer.outbox[0]!.subject).toMatch(/^Horário confirmado/);
    expect((await patch(rafaelAppt, "COMPLETED")).status).toBe(200);

    t.mailer.outbox.splice(0);
    expect((await patch(carlosAppt, "CANCELED")).status).toBe(200);
    expect(t.mailer.outbox).toHaveLength(1);
    expect(t.mailer.outbox[0]!.subject).toMatch(/^Seu horário foi cancelado/);
    expect(t.mailer.outbox[0]!.text).toContain("/agendar");
    const free = await t.call(
      `/api/availability?date=${TUESDAY}&serviceId=${shop.serviceId}&barberId=${shop.carlosId}`,
    );
    expect(free.body.slots.map((s: { time: string }) => s.time)).toContain("09:00");
  });

  it("calcula faturamento só de atendimentos concluídos", async () => {
    const r = await t.call(`/api/admin/reports/revenue?from=${TUESDAY}&to=${TUESDAY}`, { jar: ownerJar });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ totalCents: 4000, count: 1, averageTicketCents: 4000 });
    expect(r.body.byBarber).toEqual([{ barberId: shop.rafaelId, name: "Rafael", totalCents: 4000, count: 1 }]);
  });

  it("gerencia serviços, horários e a foto do barbeiro", async () => {
    const created = await t.call("/api/admin/services", {
      method: "POST",
      jar: ownerJar,
      body: { name: "Barba", durationMin: 20, priceCents: 3000 },
    });
    expect(created.status).toBe(201);
    const off = await t.call(`/api/admin/services/${created.body.id}`, {
      method: "PATCH",
      jar: ownerJar,
      body: { active: false },
    });
    expect(off.body.active).toBe(false);
    expect((await t.call("/api/services")).body).toHaveLength(1); // inativo some da lista pública

    const photo = await t.call(`/api/admin/barbers/${shop.carlosId}`, {
      method: "PATCH",
      jar: ownerJar,
      body: { photoUrl: "/fotos/carlos.jpg" },
    });
    expect(photo.body.photoUrl).toBe("/fotos/carlos.jpg");
    const publicList = await t.call("/api/barbers");
    expect(publicList.body.find((b: { name: string }) => b.name === "Carlos").photoUrl).toBe("/fotos/carlos.jpg");
    const evil = await t.call(`/api/admin/barbers/${shop.carlosId}`, {
      method: "PATCH",
      jar: ownerJar,
      body: { photoUrl: "javascript:alert(1)" },
    });
    expect(evil.status).toBe(400);
    const removed = await t.call(`/api/admin/barbers/${shop.carlosId}`, {
      method: "PATCH",
      jar: ownerJar,
      body: { photoUrl: "" },
    });
    expect(removed.body.photoUrl).toBeNull();

    const hours = await t.call(`/api/admin/barbers/${shop.carlosId}/hours`, {
      method: "PUT",
      jar: ownerJar,
      body: [{ weekday: 3, startMin: 600, endMin: 900 }],
    });
    expect(hours.status).toBe(200);
    const r = await t.call(`/api/availability?date=${TUESDAY}&serviceId=${shop.serviceId}&barberId=${shop.carlosId}`);
    expect(r.body.slots).toEqual([]); // Carlos não trabalha mais na terça
  });

  it("lista clientes com contagem de agendamentos", async () => {
    const r = await t.call("/api/admin/customers", { jar: ownerJar });
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThanOrEqual(2);
    expect(r.body[0]).toHaveProperty("appointments");
  });
});
