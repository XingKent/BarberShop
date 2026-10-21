import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appointments } from "./db/schema.js";
import { sendDueReminders } from "./reminders.js";
import { bookingBody, createTestApp, NOW, seedShop, signUp, TUESDAY, type Jar, type Shop, type TestApp } from "./testkit.js";

let t: TestApp;
let shop: Shop;

const at = (hhmm: string) => new Date(`${TUESDAY}T${hhmm}:00-03:00`);
const accounts = new Map<string, Jar>();
/** Agenda como cliente logado (cria a conta na primeira vez que o e-mail aparece). */
async function book(barberId: number, time: string, phone: string, email: string) {
  let jar = accounts.get(email);
  if (!jar) {
    jar = await signUp(t, { email, phone });
    accounts.set(email, jar);
  }
  return t.call("/api/appointments", { method: "POST", jar, body: bookingBody(shop, barberId, time) });
}
const reminders = () => t.mailer.outbox.filter((m) => m.subject.startsWith("Lembrete"));

beforeAll(async () => {
  t = await createTestApp();
  shop = await seedShop(t.db);
});
afterAll(() => t.close());

describe("lembrete 2 horas antes", () => {
  it("envia uma vez, quando faltam 2 horas", async () => {
    t.setNow(NOW);
    const r = await book(shop.carlosId, "09:00", "(21) 99999-0031", "lembrete@exemplo.com");
    expect(r.status).toBe(201);
    t.mailer.outbox.splice(0);

    t.setNow(at("06:30")); // ainda faltam 2h30
    expect(await sendDueReminders(t.deps)).toBe(0);
    expect(reminders()).toHaveLength(0);

    t.setNow(at("07:00")); // faltam exatamente 2h
    expect(await sendDueReminders(t.deps)).toBe(1);
    expect(reminders()).toHaveLength(1);
    expect(reminders()[0]).toMatchObject({ to: "lembrete@exemplo.com" });
    expect(reminders()[0]!.subject).toBe("Lembrete: seu horário é às 09:00");
    expect(reminders()[0]!.text).toContain(`/agendamento/${r.body.id}?token=${r.body.cancelToken}`);

    t.setNow(at("07:01")); // rodando de novo no minuto seguinte, não repete
    expect(await sendDueReminders(t.deps)).toBe(0);
    expect(reminders()).toHaveLength(1);
  });

  it("não envia para agendamento cancelado", async () => {
    t.setNow(NOW);
    const r = await book(shop.rafaelId, "10:00", "(21) 99999-0032", "cancelou@exemplo.com");
    await t.call(`/api/appointments/${r.body.id}/cancel`, { method: "POST", body: { token: r.body.cancelToken } });
    t.mailer.outbox.splice(0);

    t.setNow(at("08:30"));
    expect(await sendDueReminders(t.deps)).toBe(0);
    expect(reminders()).toHaveLength(0);
  });

  it("não envia para quem reservou com menos de 2 horas de antecedência", async () => {
    t.setNow(at("08:00"));
    const r = await book(shop.carlosId, "09:30", "(21) 99999-0033", "corrido@exemplo.com");
    expect(r.status).toBe(201); // a confirmação da reserva já foi enviada
    t.mailer.outbox.splice(0);

    t.setNow(at("08:10"));
    expect(await sendDueReminders(t.deps)).toBe(0);
    expect(reminders()).toHaveLength(0);
  });

  it("se o envio falhar, tenta de novo no minuto seguinte", async () => {
    t.setNow(NOW);
    const r = await book(shop.rafaelId, "11:00", "(21) 99999-0034", "falha@exemplo.com");
    t.mailer.outbox.splice(0);

    t.setNow(at("09:00")); // faltam 2h para as 11h
    const original = [...t.deps.channels];
    t.deps.channels.splice(0, t.deps.channels.length, {
      name: "quebrado",
      send: async () => {
        throw new Error("SMTP fora do ar");
      },
    });
    expect(await sendDueReminders(t.deps)).toBe(0);
    const [row] = await t.db.select().from(appointments).where(eq(appointments.id, r.body.id));
    expect(row!.reminderSentAt).toBeNull(); // a marca foi desfeita

    t.deps.channels.splice(0, t.deps.channels.length, ...original);
    t.setNow(at("09:01"));
    expect(await sendDueReminders(t.deps)).toBe(1);
    expect(reminders()).toHaveLength(1);
    expect(reminders()[0]).toMatchObject({ to: "falha@exemplo.com" });
  });
});
