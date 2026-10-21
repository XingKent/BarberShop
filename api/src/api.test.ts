import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appointments, customers } from "./db/schema.js";
import {
  APP_URL,
  bookingBody,
  CLIENT_PASSWORD,
  createTestApp,
  newJar,
  NOW,
  seedShop,
  signUp,
  TUESDAY,
  type Jar,
  type Shop,
  type TestApp,
} from "./testkit.js";

let t: TestApp;
let shop: Shop;

beforeAll(async () => {
  t = await createTestApp();
  shop = await seedShop(t.db);
});
afterAll(() => t.close());

const slotTimes = (body: { slots: { time: string }[] }) => body.slots.map((s) => s.time);
const post = (path: string, body: unknown, jar?: Jar) =>
  t.call(path, { method: "POST", body, ...(jar ? { jar } : {}) });
const book = (jar: Jar | undefined, barberId: number, time: string) =>
  t.call("/api/appointments", { method: "POST", body: bookingBody(shop, barberId, time), ...(jar ? { jar } : {}) });

describe("horários e agendamento", () => {
  let joao: Jar;
  let token = "";
  let appointmentId = 0;

  it("lista serviços e barbeiros ativos", async () => {
    const s = await t.call("/api/services");
    expect(s.status).toBe(200);
    expect(s.body).toHaveLength(1);
    expect(s.body[0]).toMatchObject({ name: "Corte", durationMin: 30, priceCents: 4000 });
    const b = await t.call("/api/barbers");
    expect(b.body).toHaveLength(2);
    expect(b.body[0]).toHaveProperty("photoUrl", null);
  });

  it("mostra horários dos dois barbeiros em dia de trabalho e nenhum em dia de folga", async () => {
    const r = await t.call(`/api/availability?date=${TUESDAY}&serviceId=${shop.serviceId}`);
    expect(r.status).toBe(200);
    // 9h–12h com corte de 30 min, de 15 em 15 min = 11 inícios por barbeiro.
    expect(r.body.slots).toHaveLength(22);
    expect(r.body.slots[0].time).toBe("09:00");
    expect((await t.call(`/api/availability?date=2026-10-11&serviceId=${shop.serviceId}`)).body.slots).toEqual([]);
    expect((await t.call(`/api/availability?date=2026-10-08&serviceId=${shop.serviceId}`)).body.slots).toEqual([]);
  });

  it("valida a data", async () => {
    const badDate = await t.call(`/api/availability?date=2026-13-40&serviceId=${shop.serviceId}`);
    expect(badDate.status).toBe(400);
  });

  it("agendar exige entrar na conta", async () => {
    const r = await book(undefined, shop.carlosId, "09:00");
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("LOGIN_REQUIRED");
  });

  it("reserva logado, avisa por e-mail com o link de gerenciar e bloqueia horário duplicado", async () => {
    joao = await signUp(t, { email: "joao@exemplo.com", phone: "(21) 99999-0001" });
    t.mailer.outbox.splice(0);

    const created = await book(joao, shop.carlosId, "09:00");
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("PENDING");
    token = created.body.cancelToken;
    appointmentId = created.body.id;

    expect(t.mailer.outbox).toHaveLength(1);
    const mail = t.mailer.outbox[0]!;
    expect(mail.to).toBe("joao@exemplo.com");
    expect(mail.subject).toMatch(/^Horário reservado/);
    expect(mail.text).toContain(`${APP_URL}/agendamento/${appointmentId}?token=${token}`);
    expect(mail.html).toContain("Carlos");

    const maria = await signUp(t, { email: "maria@exemplo.com", phone: "(21) 98888-0002" });
    t.mailer.outbox.splice(0);
    const overlap = await book(maria, shop.carlosId, "09:15");
    expect(overlap.status).toBe(409);
    expect(t.mailer.outbox).toHaveLength(0); // falha de reserva não gera e-mail

    expect((await book(maria, shop.rafaelId, "09:00")).status).toBe(201); // outro barbeiro, mesmo horário

    const r = await t.call(
      `/api/availability?date=${TUESDAY}&serviceId=${shop.serviceId}&barberId=${shop.carlosId}`,
    );
    const times = slotTimes(r.body);
    expect(times).not.toContain("09:00");
    expect(times).not.toContain("09:15");
    expect(times).toContain("09:30");
  });

  it("duas reservas simultâneas no mesmo horário: só uma vence", async () => {
    const a = await signUp(t, { email: "a@exemplo.com", phone: "(21) 97777-0003" });
    const b = await signUp(t, { email: "b@exemplo.com", phone: "(21) 96666-0004" });
    const [ra, rb] = await Promise.all([book(a, shop.carlosId, "10:00"), book(b, shop.carlosId, "10:00")]);
    expect([ra.status, rb.status].sort()).toEqual([201, 409]);
  });

  it("a reserva vale mesmo se o e-mail falhar", async () => {
    const c = await signUp(t, { email: "c@exemplo.com", phone: "(21) 95555-0005" });
    const original = [...t.deps.channels];
    t.deps.channels.splice(0, t.deps.channels.length, {
      name: "quebrado",
      send: async () => {
        throw new Error("SMTP fora do ar");
      },
    });
    const r = await book(c, shop.rafaelId, "11:00");
    t.deps.channels.splice(0, t.deps.channels.length, ...original);
    expect(r.status).toBe(201);
  });

  it("o link do e-mail só abre e cancela com o token certo, sem precisar entrar", async () => {
    expect((await t.call(`/api/appointments/${appointmentId}?token=errado`)).status).toBe(404);
    const view = await t.call(`/api/appointments/${appointmentId}?token=${token}`);
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ service: "Corte", barber: "Carlos", status: "PENDING" });
    expect(view.body.cancelToken).toBeUndefined();

    expect((await post(`/api/appointments/${appointmentId}/cancel`, { token: "errado" })).status).toBe(404);
    expect((await post(`/api/appointments/${appointmentId}/cancel`, { token })).status).toBe(200);
    expect((await post(`/api/appointments/${appointmentId}/cancel`, { token })).status).toBe(409);

    const r = await t.call(
      `/api/availability?date=${TUESDAY}&serviceId=${shop.serviceId}&barberId=${shop.carlosId}`,
    );
    expect(slotTimes(r.body)).toContain("09:00");
  });
});

describe("cadastro e login do cliente (e-mail e senha)", () => {
  it("recusa dados inválidos no cadastro", async () => {
    const base = { name: "Ana Lima", phone: "(21) 97777-1000", email: "ana@exemplo.com", password: CLIENT_PASSWORD };
    const short = await post("/api/auth/register", { ...base, password: "1234567" });
    expect(short.status).toBe(400);
    expect(short.body.issues[0].message).toMatch(/pelo menos 8/);
    expect((await post("/api/auth/register", { ...base, phone: "123" })).status).toBe(400);
    expect((await post("/api/auth/register", { ...base, email: "sem-arroba" })).status).toBe(400);
    expect((await post("/api/auth/register", { ...base, name: "A" })).status).toBe(400);
  });

  it("só entra depois de confirmar o e-mail com o código", async () => {
    const email = "carla@exemplo.com";
    t.mailer.outbox.splice(0);
    const reg = await post("/api/auth/register", {
      name: "Carla Dias",
      phone: "(21) 97777-1001",
      email: "Carla@Exemplo.com", // qualquer caixa
      password: CLIENT_PASSWORD,
    });
    expect(reg.status).toBe(201);
    expect(reg.body.needsVerification).toBe(true);
    expect(t.mailer.outbox).toHaveLength(1);
    expect(t.mailer.outbox[0]).toMatchObject({ to: email });
    expect(t.mailer.outbox[0]!.subject).toMatch(/^Seu código para confirmar o e-mail/);

    // Senha certa, e-mail não confirmado: não entra, e recebe um código novo.
    const jar = newJar();
    const early = await post("/api/auth/login", { email, password: CLIENT_PASSWORD }, jar);
    expect(early.status).toBe(403);
    expect(early.body.code).toBe("EMAIL_NOT_VERIFIED");
    expect(jar.cookie).toBe("");
    expect(t.mailer.outbox).toHaveLength(2);

    const code = t.lastCode();
    const wrong = code === "000000" ? "111111" : "000000";
    expect((await post("/api/auth/email/verify", { email, code: wrong }, jar)).status).toBe(400);
    expect(jar.cookie).toBe("");

    const ok = await post("/api/auth/email/verify", { email, code }, jar);
    expect(ok.status).toBe(200);
    expect(ok.body.user).toMatchObject({ email, role: "CLIENT" });
    expect(jar.cookie).toMatch(/^sid=/);
    // O mesmo código não vale duas vezes.
    expect((await post("/api/auth/email/verify", { email, code }, newJar())).status).toBe(400);

    const me = await t.call("/api/auth/me", { jar });
    expect(me.body.user).toMatchObject({ email, role: "CLIENT" });
    expect(me.body.customer).toMatchObject({ name: "Carla Dias", phone: "21977771001" });

    const again = newJar();
    expect((await post("/api/auth/login", { email, password: CLIENT_PASSWORD }, again)).status).toBe(200);
    expect(again.cookie).toMatch(/^sid=/);
  });

  it("não deixa cadastrar o mesmo e-mail duas vezes", async () => {
    await signUp(t, { email: "dupla@exemplo.com", phone: "(21) 97777-1002" });
    const r = await post("/api/auth/register", {
      name: "Outra Pessoa",
      phone: "(21) 97777-1003",
      email: "dupla@exemplo.com",
      password: CLIENT_PASSWORD,
    });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("EMAIL_TAKEN");
  });

  it("senha errada e e-mail desconhecido recebem a mesma resposta", async () => {
    await signUp(t, { email: "igual@exemplo.com", phone: "(21) 97777-1004" });
    const wrong = await post("/api/auth/login", { email: "igual@exemplo.com", password: "senha-errada-123" });
    const unknown = await post("/api/auth/login", { email: "ninguem@exemplo.com", password: "senha-errada-123" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(unknown.body.error).toBe(wrong.body.error);
  });

  it("bloqueia a conta depois de 5 senhas erradas e libera passado o tempo", async () => {
    const email = "bloqueio@exemplo.com";
    await signUp(t, { email, phone: "(21) 97777-1005" });
    for (let i = 0; i < 5; i++) {
      expect((await post("/api/auth/login", { email, password: "senha-errada-123" })).status).toBe(401);
    }
    const locked = await post("/api/auth/login", { email, password: CLIENT_PASSWORD }); // até a certa é recusada
    expect(locked.status).toBe(429);
    expect(locked.body.error).toMatch(/Tente de novo em/);

    t.advance(16 * 60_000);
    expect((await post("/api/auth/login", { email, password: CLIENT_PASSWORD }, newJar())).status).toBe(200);
    t.setNow(NOW);
  });

  it("limita pedidos seguidos de código e bloqueia o código depois de 5 erros", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await post("/api/auth/email/resend", { email: "limite@exemplo.com" })).status);
    expect(statuses).toEqual([200, 200, 200, 429]);

    const email = "tentativas@exemplo.com";
    await post("/api/auth/register", { name: "Tiago Reis", phone: "(21) 97777-1006", email, password: CLIENT_PASSWORD });
    const code = t.lastCode();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await post("/api/auth/email/verify", { email, code: wrong });
    expect((await post("/api/auth/email/verify", { email, code })).status).toBe(400); // nem o certo vale mais
  });

  describe("esqueci minha senha", () => {
    const email = "esqueci@exemplo.com";
    let oldSession: Jar;

    it("recebe um código e troca a senha; sessões antigas caem", async () => {
      oldSession = await signUp(t, { email, phone: "(21) 97777-1007" });
      expect((await t.call("/api/auth/me", { jar: oldSession })).body.user).not.toBeNull();

      t.mailer.outbox.splice(0);
      expect((await post("/api/auth/password/forgot", { email })).status).toBe(200);
      expect(t.mailer.outbox).toHaveLength(1);
      expect(t.mailer.outbox[0]!.subject).toMatch(/^Seu código para redefinir a senha/);

      const code = t.lastCode();
      const weak = await post("/api/auth/password/reset", { email, code, password: "curta" });
      expect(weak.status).toBe(400);

      const ok = await post("/api/auth/password/reset", { email, code, password: "nova-senha-123" });
      expect(ok.status).toBe(200);
      expect((await post("/api/auth/password/reset", { email, code, password: "outra-senha-123" })).status).toBe(400);

      expect((await t.call("/api/auth/me", { jar: oldSession })).body.user).toBeNull();
      expect((await post("/api/auth/login", { email, password: CLIENT_PASSWORD })).status).toBe(401);
      expect((await post("/api/auth/login", { email, password: "nova-senha-123" }, newJar())).status).toBe(200);
    });

    it("responde igual para e-mail sem conta e não envia nada", async () => {
      t.mailer.outbox.splice(0);
      expect((await post("/api/auth/password/forgot", { email: "nunca-existiu@exemplo.com" })).status).toBe(200);
      expect(t.mailer.outbox).toHaveLength(0);
    });

    it("o código de confirmar e-mail não serve para trocar a senha", async () => {
      const victim = "vitima@exemplo.com";
      await post("/api/auth/register", { name: "Vera Luz", phone: "(21) 97777-1008", email: victim, password: CLIENT_PASSWORD });
      const verifyCode = t.lastCode();
      const r = await post("/api/auth/password/reset", { email: victim, code: verifyCode, password: "senha-do-invasor-1" });
      expect(r.status).toBe(400);
      expect((await post("/api/auth/login", { email: victim, password: "senha-do-invasor-1" })).status).toBe(401);
    });

    it("quem nunca confirmou o e-mail recupera a conta pelo mesmo caminho", async () => {
      const lost = "perdida@exemplo.com";
      await post("/api/auth/register", { name: "Paula Dias", phone: "(21) 97777-1009", email: lost, password: CLIENT_PASSWORD });
      await post("/api/auth/password/forgot", { email: lost });
      const code = t.lastCode();
      expect((await post("/api/auth/password/reset", { email: lost, code, password: "senha-recuperada-1" })).status).toBe(200);
      expect((await post("/api/auth/login", { email: lost, password: "senha-recuperada-1" }, newJar())).status).toBe(200);
    });
  });
});

describe("conta do cliente", () => {
  const email = "minha.conta@exemplo.com";
  let jar: Jar;
  let myAppointmentId = 0;

  it("agenda usando o cadastro e vê o histórico", async () => {
    jar = await signUp(t, { email, name: "Marina Costa", phone: "(21) 97777-2000" });
    t.mailer.outbox.splice(0);
    const r = await book(jar, shop.rafaelId, "09:30");
    expect(r.status).toBe(201);
    myAppointmentId = r.body.id;
    expect(t.mailer.outbox).toHaveLength(1);
    expect(t.mailer.outbox[0]!.to).toBe(email);
    expect(t.mailer.outbox[0]!.text).toContain("Marina"); // nome do cadastro

    const list = await t.call("/api/me/appointments", { jar });
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ id: myAppointmentId, status: "PENDING", barber: "Rafael" });
    expect((await t.call("/api/me/appointments")).status).toBe(401);
  });

  it("edita nome e celular", async () => {
    const r = await t.call("/api/auth/profile", {
      method: "PATCH",
      jar,
      body: { name: "Marina C. Costa", phone: "(21) 98888-7777" },
    });
    expect(r.status).toBe(200);
    expect(r.body.customer).toEqual({ name: "Marina C. Costa", phone: "21988887777" });
    expect((await t.call("/api/auth/me", { jar })).body.customer.name).toBe("Marina C. Costa");
    expect((await t.call("/api/auth/profile", { method: "PATCH", body: { name: "X Y", phone: "21988887777" } })).status).toBe(401);
  });

  it("celular repetido não dá acesso nem desvia avisos de outra pessoa", async () => {
    const dona = await signUp(t, { email: "dona@exemplo.com", phone: "(21) 90000-1111" });
    const booked = await book(dona, shop.carlosId, "11:00");
    expect(booked.status).toBe(201);

    // Alguém se cadastra com o mesmo celular da dona.
    const curioso = await signUp(t, { email: "curioso@exemplo.com", phone: "(21) 90000-1111" });
    expect((await t.call("/api/me/appointments", { jar: curioso })).body).toEqual([]);
    expect((await post(`/api/me/appointments/${booked.body.id}/cancel`, {}, curioso)).status).toBe(404);

    // Os dois cadastros são separados, e o agendamento da dona continua avisando o e-mail dela.
    const rows = await t.db.select().from(customers).where(eq(customers.phone, "21900001111"));
    expect(rows).toHaveLength(2);
    const [appt] = await t.db.select().from(appointments).where(eq(appointments.id, booked.body.id));
    const owner = rows.find((c) => c.id === appt!.customerId);
    expect(owner?.email).toBe("dona@exemplo.com");
  });

  it("só o dono do agendamento cancela pela conta", async () => {
    const other = await signUp(t, { email: "intruso@exemplo.com", phone: "(21) 97777-2001" });
    expect((await post(`/api/me/appointments/${myAppointmentId}/cancel`, {}, other)).status).toBe(404);
    expect((await post(`/api/me/appointments/${myAppointmentId}/cancel`, {}, jar)).status).toBe(200);
    expect((await t.call("/api/me/appointments", { jar })).body[0].status).toBe("CANCELED");
  });

  it("sair encerra a sessão", async () => {
    const out = await post("/api/auth/logout", {}, jar);
    expect(out.status).toBe(200);
    expect(jar.cookie).toBe("");
    expect((await t.call("/api/auth/me", { jar })).body.user).toBeNull();
  });

  it("recusa pedidos que alteram dados vindos de outro site", async () => {
    const r = await t.call("/api/auth/logout", { method: "POST", headers: { origin: "http://evil.test" } });
    expect(r.status).toBe(403);
    const ok = await t.call("/api/auth/logout", { method: "POST", headers: { origin: APP_URL } });
    expect(ok.status).toBe(200);
  });
});
