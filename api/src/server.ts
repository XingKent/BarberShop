import { createApp } from "./app.js";
import { ensureOwner } from "./auth/owner.js";
import { purgeExpired } from "./auth/sessions.js";
import { config } from "./config.js";
import { createDb } from "./db/index.js";
import { createDeps } from "./deps.js";
import { createMailer } from "./mail.js";
import { startReminderLoop } from "./reminders.js";

const { db, pool } = createDb(config.databaseUrl);
const deps = createDeps({
  db,
  mailer: createMailer(config.smtpUrl, config.mailFrom),
  cookieSecure: config.cookieSecure,
  shopName: config.shopName,
  appUrl: config.appUrl,
});

const owner = await ensureOwner(db, config.ownerEmail, config.ownerPassword);
if (owner === "created") {
  console.log(`Conta do dono criada para ${config.ownerEmail}. Entre em /admin e configure o autenticador.`);
} else if (owner === "skipped") {
  console.warn(
    "OWNER_EMAIL e OWNER_PASSWORD não definidos: se ainda não existe conta do dono, o painel fica inacessível.",
  );
}
if (!config.smtpUrl) {
  console.warn("SMTP_URL não definido: os e-mails (códigos de login, confirmações) aparecem só neste log.");
}

const app = createApp(deps, {
  corsOrigin: config.corsOrigin,
  rateLimit: config.rateLimit,
  trustProxy: config.trustProxyHops,
});
const server = app.listen(config.port, () => {
  console.log(`API ouvindo na porta ${config.port}`);
});

const stopReminders = startReminderLoop(deps);
const purgeTimer = setInterval(() => {
  purgeExpired(db, new Date()).catch((err) => console.error("Falha ao limpar sessões vencidas:", err));
}, 60 * 60 * 1000);

function shutdown() {
  stopReminders();
  clearInterval(purgeTimer);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
