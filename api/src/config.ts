const env = process.env;

export const config = {
  port: Number(env.PORT ?? 3000),
  databaseUrl: env.DATABASE_URL ?? "postgresql://barbearia:barbearia@localhost:5432/barbearia",
  /** Origem do front, para CORS e para a checagem de origem das requisições com cookie. */
  corsOrigin: env.CORS_ORIGIN ?? "http://localhost:5173",
  /** Endereço público do site, usado nos links dos e-mails. */
  appUrl: env.APP_URL ?? "http://localhost:5173",
  shopName: env.SHOP_NAME ?? "Barbearia Navalha",
  /** Ex.: smtp://usuario:senha@smtp.exemplo.com:587. Vazio = os e-mails aparecem no log da API. */
  smtpUrl: env.SMTP_URL ?? "",
  mailFrom: env.MAIL_FROM ?? "Barbearia Navalha <nao-responda@localhost>",
  /** Conta do dono, criada na primeira inicialização. O 2FA é configurado no primeiro login. */
  ownerEmail: env.OWNER_EMAIL ?? "",
  ownerPassword: env.OWNER_PASSWORD ?? "",
  /** Defina COOKIE_SECURE=true quando o site for servido em HTTPS. */
  cookieSecure: env.COOKIE_SECURE === "true",
};
