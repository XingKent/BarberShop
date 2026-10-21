import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema.js";

// Tipo genérico: aceita tanto o Postgres real (node-postgres) quanto o PGlite usado nos testes,
// e também uma transação.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, typeof schema>;

export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString });
  return { db: drizzle(pool, { schema }) as Db, pool };
}

export { schema };
