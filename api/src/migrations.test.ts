import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

// Quem já usa o sistema tem um banco com dados na versão antiga. Este teste cria o banco como ele
// era (migration 0000), grava agendamentos, aplica as migrations novas por cima e confere que
// nada se perde e que o banco continua utilizável.

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
  entries: { tag: string }[];
};

async function apply(client: PGlite, tag: string) {
  const sql = readFileSync(`drizzle/${tag}.sql`, "utf8");
  for (const statement of sql.split("--> statement-breakpoint")) {
    if (statement.trim()) await client.exec(statement);
  }
}

describe("migrations sobre um banco que já tem dados", () => {
  it("mantém clientes e agendamentos antigos e libera as novas funções", async () => {
    const client = new PGlite();
    const [first, ...rest] = journal.entries;
    await apply(client, first!.tag);

    // Dados como o sistema antigo gravava (cliente sem conta, agendamentos com cancel_token próprio).
    await client.exec(`
      insert into services (name, duration_min, price_cents) values ('Corte', 30, 4000);
      insert into barbers (name) values ('Carlos');
      insert into customers (name, phone) values ('João Silva', '21999990001');
      insert into appointments (customer_id, barber_id, service_id, starts_at, ends_at, price_cents, status, cancel_token)
        values
        (1, 1, 1, '2026-10-13T12:00:00Z', '2026-10-13T12:30:00Z', 4000, 'CONFIRMED', 'token-antigo-1'),
        (1, 1, 1, '2026-10-13T13:00:00Z', '2026-10-13T13:30:00Z', 4000, 'COMPLETED', 'token-antigo-2');
    `);

    for (const entry of rest) await apply(client, entry.tag);

    const appts = await client.query<{
      id: number;
      status: string;
      cancel_token: string;
      reminder_sent_at: unknown;
    }>("select id, status, cancel_token, reminder_sent_at from appointments order by id");
    expect(appts.rows.map((a) => a.status)).toEqual(["CONFIRMED", "COMPLETED"]);
    // Todos continuam com um token de cancelamento (os links antigos deixam de valer, os novos funcionam).
    expect(appts.rows.every((a) => a.cancel_token && a.cancel_token.length > 10)).toBe(true);
    expect(new Set(appts.rows.map((a) => a.cancel_token)).size).toBe(2);
    expect(appts.rows.every((a) => a.reminder_sent_at === null)).toBe(true);

    const customers = await client.query<{ name: string; user_id: number | null }>(
      "select name, user_id from customers",
    );
    expect(customers.rows).toEqual([{ name: "João Silva", user_id: null }]);

    // O banco já aceita contas e sessões, e dois cadastros podem compartilhar o mesmo celular.
    await client.exec(`
      insert into users (email, role, password_hash) values ('a@x.com', 'CLIENT', 'h');
      insert into customers (user_id, name, phone) values (1, 'Outro', '21999990001');
    `);
    const users = await client.query("select id from users");
    expect(users.rows).toHaveLength(1);
  });
});
