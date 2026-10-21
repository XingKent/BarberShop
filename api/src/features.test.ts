import { request } from "node:http";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession, TTL } from "./auth/sessions.js";
import { appointments, barberPhotos, customers, users } from "./db/schema.js";
import { ensureOwner } from "./auth/owner.js";
import {
  bookingBody,
  CLIENT_PASSWORD,
  createTestApp,
  newJar,
  seedShop,
  signUp,
  TUESDAY,
  type Jar,
  type Shop,
  type TestApp,
} from "./testkit.js";

let t: TestApp;
let shop: Shop;
const ownerJar = newJar();

beforeAll(async () => {
  t = await createTestApp();
  shop = await seedShop(t.db);
  await ensureOwner(t.db, "dono@barbearia.test", "senha-forte-123");
  // Sessão completa do dono aberta direto no banco (o login com TOTP já é testado em owner.test.ts).
  const [owner] = await t.db.select().from(users).where(eq(users.role, "OWNER"));
  const s = await createSession(t.db, owner!.id, "full", TTL.owner, t.now());
  ownerJar.cookie = `sid=${s.token}`;
});
afterAll(() => t.close());

// Imagens mínimas, mas com os bytes de abertura reais de cada formato.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 7)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 9)]);

function putPhoto(barberId: number, body: Buffer, type: string, jar?: Jar) {
  return fetch(`${t.base}/api/admin/barbers/${barberId}/photo`, {
    method: "PUT",
    headers: { "content-type": type, ...(jar?.cookie ? { cookie: jar.cookie } : {}) },
    body: new Uint8Array(body),
  });
}

describe("foto do barbeiro enviada pelo painel", () => {
  it("guarda a foto, serve para qualquer visitante e mostra o endereço na lista pública", async () => {
    const res = await putPhoto(shop.carlosId, PNG, "image/png", ownerJar);
    expect(res.status).toBe(200);
    const { photoUrl } = (await res.json()) as { photoUrl: string };
    expect(photoUrl).toMatch(new RegExp(`^/api/barbers/${shop.carlosId}/photo\\?v=\\d+$`));

    const img = await fetch(t.base + photoUrl); // sem cookie: visitante comum
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(img.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await img.arrayBuffer()).equals(PNG)).toBe(true);

    const list = await t.call("/api/barbers");
    expect(list.body.find((b: { name: string }) => b.name === "Carlos").photoUrl).toBe(photoUrl);
    expect(JSON.stringify(list.body)).not.toContain("data");
  });

  it("trocar a foto muda o endereço (cache) e mantém uma só linha", async () => {
    t.advance(1000);
    const res = await putPhoto(shop.carlosId, JPEG, "image/jpeg", ownerJar);
    const { photoUrl } = (await res.json()) as { photoUrl: string };
    const img = await fetch(t.base + photoUrl);
    expect(img.headers.get("content-type")).toBe("image/jpeg");
    const rows = await t.db.select().from(barberPhotos).where(eq(barberPhotos.barberId, shop.carlosId));
    expect(rows).toHaveLength(1);
  });

  it("recusa quem não é dono, arquivo que não é imagem, tipo falso e arquivo grande", async () => {
    const client = await signUp(t, { email: "foto@x.com" });
    expect((await putPhoto(shop.rafaelId, PNG, "image/png", client)).status).toBe(403);
    expect((await putPhoto(shop.rafaelId, PNG, "image/png")).status).toBe(401);

    const html = Buffer.from("<script>alert(1)</script>".padEnd(40, " "));
    const fake = await putPhoto(shop.rafaelId, html, "image/png", ownerJar); // Content-Type mente
    expect(fake.status).toBe(400);
    const big = await putPhoto(shop.rafaelId, Buffer.concat([JPEG, Buffer.alloc(700 * 1024)]), "image/jpeg", ownerJar);
    expect(big.status).toBe(413);
    expect(((await big.json()) as { error: string }).error).toMatch(/grande/);
    expect((await putPhoto(999, PNG, "image/png", ownerJar)).status).toBe(404);
    expect((await fetch(`${t.base}/api/barbers/${shop.rafaelId}/photo`)).status).toBe(404);
  });

  it("remover a foto limpa o endereço e o arquivo", async () => {
    const del = await t.call(`/api/admin/barbers/${shop.carlosId}/photo`, { method: "DELETE", jar: ownerJar });
    expect(del.status).toBe(200);
    expect(del.body.photoUrl).toBeNull();
    expect((await fetch(`${t.base}/api/barbers/${shop.carlosId}/photo`)).status).toBe(404);
    const list = await t.call("/api/barbers");
    expect(list.body.find((b: { name: string }) => b.name === "Carlos").photoUrl).toBeNull();
  });
});

describe("excluir a própria conta", () => {
  const EMAIL = "sai@x.com";
  let jar: Jar;
  let futureId = 0;
  let customerId = 0;

  it("pede a senha: sem sessão ou com senha errada, nada é apagado", async () => {
    jar = await signUp(t, { email: EMAIL, name: "Maria Souza", phone: "(21) 98888-7777" });
    const booked = await t.call("/api/appointments", { method: "POST", jar, body: bookingBody(shop, shop.carlosId, "09:00") });
    expect(booked.status).toBe(201);
    futureId = booked.body.id;

    expect((await t.call("/api/auth/account", { method: "DELETE", body: { password: CLIENT_PASSWORD } })).status).toBe(401);
    const wrong = await t.call("/api/auth/account", { method: "DELETE", jar, body: { password: "senha-errada-123" } });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toBe("Senha incorreta");
    expect((await t.call("/api/auth/me", { jar })).body.user.email).toBe(EMAIL);
  });

  it("apaga a conta, cancela horários futuros e preserva o histórico sem dados pessoais", async () => {
    const [c] = await t.db.select().from(customers).where(eq(customers.name, "Maria Souza"));
    customerId = c!.id;
    // Um atendimento já concluído, que conta no faturamento do dono.
    await t.db.insert(appointments).values({
      customerId,
      barberId: shop.carlosId,
      serviceId: shop.serviceId,
      startsAt: new Date("2026-10-02T12:00:00Z"),
      endsAt: new Date("2026-10-02T12:30:00Z"),
      priceCents: 4000,
      status: "COMPLETED",
      cancelToken: "token-concluido-1234",
    });

    const del = await t.call("/api/auth/account", { method: "DELETE", jar, body: { password: CLIENT_PASSWORD } });
    expect(del.status).toBe(200);

    // Saiu da conta e não consegue entrar de novo.
    expect((await t.call("/api/auth/me", { jar })).body.user).toBeNull();
    const again = await t.call("/api/auth/login", { method: "POST", body: { email: EMAIL, password: CLIENT_PASSWORD } });
    expect(again.status).toBe(401);
    expect(await t.db.select().from(users).where(eq(users.email, EMAIL))).toHaveLength(0);

    // Horário futuro cancelado e livre de novo; concluído continua.
    const [future] = await t.db.select().from(appointments).where(eq(appointments.id, futureId));
    expect(future!.status).toBe("CANCELED");
    const slots = await t.call(`/api/availability?date=${TUESDAY}&serviceId=${shop.serviceId}&barberId=${shop.carlosId}`);
    expect(slots.body.slots.map((s: { time: string }) => s.time)).toContain("09:00");
    const [done] = await t.db
      .select()
      .from(appointments)
      .where(and(eq(appointments.customerId, customerId), eq(appointments.status, "COMPLETED")));
    expect(done).toBeTruthy();

    // Nome, celular e e-mail somem do cadastro.
    const [anon] = await t.db.select().from(customers).where(eq(customers.id, customerId));
    expect(anon).toMatchObject({ name: "Cliente removido", phone: "", email: null, userId: null });

    // O dono não vê o cadastro removido na lista de clientes, mas o faturamento não muda.
    const list = await t.call("/api/admin/customers", { jar: ownerJar });
    expect(JSON.stringify(list.body)).not.toContain("Maria");
    expect(list.body.some((c: { id: number }) => c.id === customerId)).toBe(false);
    const rev = await t.call("/api/admin/reports/revenue?from=2026-10-01&to=2026-10-09", { jar: ownerJar });
    expect(rev.body.totalCents).toBe(4000);
  });

  it("o mesmo e-mail pode abrir uma conta nova depois", async () => {
    const fresh = await signUp(t, { email: EMAIL, name: "Maria Nova" });
    expect((await t.call("/api/auth/me", { jar: fresh })).body.user.email).toBe(EMAIL);
  });

  it("a conta do dono não é excluída por esta rota", async () => {
    const res = await t.call("/api/auth/account", { method: "DELETE", jar: ownerJar, body: { password: "senha-forte-123" } });
    expect(res.status).toBe(403);
    expect(await t.db.select().from(users).where(eq(users.role, "OWNER"))).toHaveLength(1);
  });

  it("senha errada repetida trava a tentativa (não vira forma de descobrir a senha)", async () => {
    const j = await signUp(t, { email: "trava@x.com" });
    for (let i = 0; i < 5; i++) {
      await t.call("/api/auth/account", { method: "DELETE", jar: j, body: { password: "errada-errada" } });
    }
    const blocked = await t.call("/api/auth/account", { method: "DELETE", jar: j, body: { password: CLIENT_PASSWORD } });
    expect(blocked.status).toBe(429);
    expect(await t.db.select().from(users).where(eq(users.email, "trava@x.com"))).toHaveLength(1);
  });
});

// O celular abre o site pelo IP do computador na rede (ex.: http://192.168.0.10:5173). O pedido chega
// à API com Origin e Host iguais a esse endereço, e precisa passar.
describe("pedidos que alteram dados vindos de outro endereço do próprio site", () => {
  function post(headers: Record<string, string>): Promise<number> {
    const url = new URL(t.base);
    return new Promise((resolve, reject) => {
      const req = request(
        { host: url.hostname, port: url.port, path: "/api/auth/login", method: "POST", headers: { "content-type": "application/json", ...headers } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify({ email: "ninguem@x.com", password: "qualquer-coisa" }));
    });
  }

  it("aceita Origin igual ao Host (IP da rede, com porta)", async () => {
    expect(await post({ host: "192.168.0.10:5173", origin: "http://192.168.0.10:5173" })).toBe(401); // chegou na regra de login
  });

  it("recusa Origin de outro site", async () => {
    expect(await post({ host: "192.168.0.10:5173", origin: "http://site-malicioso.test" })).toBe(403);
  });

  it("recusa Origin com a mesma máquina mas porta diferente", async () => {
    expect(await post({ host: "192.168.0.10:5173", origin: "http://192.168.0.10:9999" })).toBe(403);
  });
});
