import { count } from "drizzle-orm";
import { config } from "../config.js";
import { createDb } from "./index.js";
import { barberHours, barbers, services } from "./schema.js";

const { db, pool } = createDb(config.databaseUrl);

const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(services);
if (n > 0) {
  console.log("Banco já tem dados, seed ignorado.");
} else {
  await db.insert(services).values([
    { name: "Corte", durationMin: 30, priceCents: 4000 },
    { name: "Barba", durationMin: 20, priceCents: 3000 },
    { name: "Corte + Barba", durationMin: 50, priceCents: 6500 },
  ]);

  const created = await db
    .insert(barbers)
    .values([{ name: "Carlos" }, { name: "Rafael" }])
    .returning();

  // Terça a sexta 9h–19h, sábado 9h–17h.
  const hours = created.flatMap((b) => [
    ...[2, 3, 4, 5].map((weekday) => ({
      barberId: b.id,
      weekday,
      startMin: 9 * 60,
      endMin: 19 * 60,
    })),
    { barberId: b.id, weekday: 6, startMin: 9 * 60, endMin: 17 * 60 },
  ]);
  await db.insert(barberHours).values(hours);
  console.log("Seed concluído: 3 serviços, 2 barbeiros.");
}

await pool.end();
