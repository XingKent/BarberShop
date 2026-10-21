import type { Db } from "./db/index.js";
import type { Mailer } from "./mail.js";
import { emailChannel, type Channel } from "./notifications.js";

/** Tudo de que as rotas e o agendador de lembretes precisam, num lugar só (e fácil de trocar nos testes). */
export interface AppDeps {
  db: Db;
  mailer: Mailer;
  channels: Channel[];
  now: () => Date;
  cookieSecure: boolean;
  shopName: string;
  /** Endereço público do site, usado nos links dos e-mails (sem barra no final). */
  appUrl: string;
}

export function createDeps(opts: {
  db: Db;
  mailer: Mailer;
  now?: () => Date;
  cookieSecure?: boolean;
  shopName: string;
  appUrl: string;
}): AppDeps {
  return {
    db: opts.db,
    mailer: opts.mailer,
    // Para acrescentar WhatsApp depois: crie um Channel e coloque nesta lista.
    channels: [emailChannel(opts.mailer)],
    now: opts.now ?? (() => new Date()),
    cookieSecure: opts.cookieSecure ?? false,
    shopName: opts.shopName,
    appUrl: opts.appUrl.replace(/\/+$/, ""),
  };
}
