// Ferramentas dos testes: banco Postgres embutido (PGlite) com as migrations reais, relógio falso,
// caixa de e-mail em memória e um cliente HTTP com "cookies". Não é usado em produção.

import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createApp } from "./app.js";
import { atMinute } from "./availability.js";
import type { Db } from "./db/index.js";
import * as schema from "./db/schema.js";
import { createDeps } from "./deps.js";
import { createMemoryMailer } from "./mail.js";

/** "Agora" nos testes: sexta 2026-10-09, 10:00 (horário de Brasília). */
export const NOW = atMinute("2026-10-09", 10 * 60);
export const TUESDAY = "2026-10-13";
export const APP_URL = "http://site.test";

export interface Jar {
  cookie: string;
}
export const newJar = (): Jar => ({ cookie: "" });

export async function createTestApp() {
  const client = new PGlite();
  const pg = drizzle(client, { schema });
  await migrate(pg, { migrationsFolder: "drizzle" });
  const db = pg as unknown as Db;

  const mailer = createMemoryMailer();
  let current = NOW;
  const deps = createDeps({
    db,
    mailer,
    now: () => current,
    shopName: "Barbearia Teste",
    appUrl: APP_URL,
  });
  const app = createApp(deps, { corsOrigin: APP_URL });
  const server: Server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function call(
    path: string,
    init: { method?: string; body?: unknown; jar?: Jar; headers?: Record<string, string> } = {},
  ) {
    const headers: Record<string, string> = { "content-type": "application/json", ...init.headers };
    if (init.jar?.cookie) headers.cookie = init.jar.cookie;
    const res = await fetch(base + path, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (init.jar) {
      for (const setCookie of res.headers.getSetCookie()) {
        const [pair = ""] = setCookie.split(";");
        const eq = pair.indexOf("=");
        if (pair.slice(0, eq) === "sid") {
          const value = pair.slice(eq + 1);
          init.jar.cookie = value ? `sid=${value}` : ""; // valor vazio = cookie apagado
        }
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, body: (await res.json()) as any };
  }

  return {
    db,
    deps,
    base,
    mailer,
    call,
    /** Último código de 6 números enviado por e-mail (confirmar e-mail ou redefinir senha). */
    lastCode(): string {
      const last = [...mailer.outbox].reverse().find((m) => m.subject.startsWith("Seu código para"));
      const code = last?.text.match(/\b(\d{6})\b/)?.[1];
      if (!code) throw new Error("Nenhum código no e-mail");
      return code;
    },
    now: () => current,
    setNow(d: Date) {
      current = d;
    },
    advance(ms: number) {
      current = new Date(current.getTime() + ms);
    },
    close() {
      server.close();
    },
  };
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;

/** 1 serviço de 30 min e 2 barbeiros que trabalham às terças, das 9h às 12h. */
export async function seedShop(db: Db) {
  const [service] = await db
    .insert(schema.services)
    .values({ name: "Corte", durationMin: 30, priceCents: 4000 })
    .returning();
  const [carlos, rafael] = await db
    .insert(schema.barbers)
    .values([{ name: "Carlos" }, { name: "Rafael" }])
    .returning();
  await db.insert(schema.barberHours).values([
    { barberId: carlos!.id, weekday: 2, startMin: 540, endMin: 720 },
    { barberId: rafael!.id, weekday: 2, startMin: 540, endMin: 720 },
  ]);
  return { serviceId: service!.id, carlosId: carlos!.id, rafaelId: rafael!.id };
}

export type Shop = Awaited<ReturnType<typeof seedShop>>;

export const bookingBody = (shop: Shop, barberId: number, time: string) => ({
  serviceId: shop.serviceId,
  barberId,
  startsAt: `${TUESDAY}T${time}:00-03:00`,
});

export const CLIENT_PASSWORD = "senha-do-cliente-1";

/** Cria uma conta de cliente, confirma o e-mail com o código recebido e devolve a sessão aberta. */
export async function signUp(
  t: TestApp,
  opts: { email: string; password?: string; name?: string; phone?: string },
): Promise<Jar> {
  const jar = newJar();
  const reg = await t.call("/api/auth/register", {
    method: "POST",
    body: {
      name: opts.name ?? "João Silva",
      phone: opts.phone ?? "(21) 99999-0001",
      email: opts.email,
      password: opts.password ?? CLIENT_PASSWORD,
    },
  });
  if (reg.status !== 201) throw new Error(`Cadastro falhou: ${reg.status} ${JSON.stringify(reg.body)}`);
  const ver = await t.call("/api/auth/email/verify", {
    method: "POST",
    body: { email: opts.email, code: t.lastCode() },
    jar,
  });
  if (ver.status !== 200) throw new Error(`Confirmação falhou: ${ver.status} ${JSON.stringify(ver.body)}`);
  return jar;
}
