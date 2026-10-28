const env = process.env;

const appUrl = env.APP_URL ?? "http://localhost:5173";

export const config = {
  port: Number(env.PORT ?? 3000),
  databaseUrl: env.DATABASE_URL ?? "postgresql://barbearia:barbearia@localhost:5432/barbearia",
  /** Origem do front, para CORS e para a checagem de origem das requisições com cookie. */
  corsOrigin: env.CORS_ORIGIN ?? "http://localhost:5173",
  /** Endereço público do site, usado nos links dos e-mails. */
  appUrl,
  shopName: env.SHOP_NAME ?? "Barbearia",
  /** Ex.: smtp://usuario:senha@smtp.exemplo.com:587. Vazio = os e-mails aparecem no log da API. */
  smtpUrl: env.SMTP_URL ?? "",
  mailFrom: env.MAIL_FROM ?? "Barbearia<nao-responda@localhost>",
  /** Conta do dono, criada na primeira inicialização. O 2FA é configurado no primeiro login. */
  ownerEmail: env.OWNER_EMAIL ?? "",
  ownerPassword: env.OWNER_PASSWORD ?? "",
  /** Liga sozinho quando APP_URL é https://. COOKIE_SECURE=true/false força um valor. */
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === "true" : appUrl.startsWith("https://"),
  /** RATE_LIMIT=off desliga o limite de tentativas por IP (útil em demonstrações e testes manuais). */
  rateLimit: env.RATE_LIMIT !== "off",
  /**
   * Quantos servidores intermediários (nginx, balanceador) ficam entre o visitante e a API. Serve para
   * descobrir o IP real de quem acessa (limite de tentativas). Use 0 se a API for exposta direto.
   */
  trustProxyHops: Number(env.TRUST_PROXY_HOPS ?? 1),
};
