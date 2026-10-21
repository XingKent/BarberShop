import {
  boolean,
  customType,
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const appointmentStatus = pgEnum("appointment_status", [
  "PENDING",
  "CONFIRMED",
  "CANCELED",
  "COMPLETED",
]);

export type AppointmentStatus = (typeof appointmentStatus.enumValues)[number];

export const services = pgTable("services", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  durationMin: integer("duration_min").notNull(),
  priceCents: integer("price_cents").notNull(),
  active: boolean("active").notNull().default(true),
});

export const barbers = pgTable("barbers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  // Endereço da foto (ex.: /fotos/carlos.jpg). Sem foto, a tela mostra a inicial do nome.
  photoUrl: text("photo_url"),
});

// Arquivo da foto enviada pelo painel (JPEG, PNG ou WebP, já redimensionada no navegador).
// Fica em tabela própria para que as listas de barbeiros nunca carreguem os bytes da imagem.
export const barberPhotos = pgTable("barber_photos", {
  barberId: integer("barber_id")
    .primaryKey()
    .references(() => barbers.id, { onDelete: "cascade" }),
  contentType: text("content_type").notNull(),
  data: bytea("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Horário de trabalho do barbeiro por dia da semana (0 = domingo ... 6 = sábado).
// startMin/endMin são minutos desde 00:00 (ex.: 9h = 540, 18h = 1080).
export const barberHours = pgTable(
  "barber_hours",
  {
    id: serial("id").primaryKey(),
    barberId: integer("barber_id")
      .notNull()
      .references(() => barbers.id, { onDelete: "cascade" }),
    weekday: integer("weekday").notNull(),
    startMin: integer("start_min").notNull(),
    endMin: integer("end_min").notNull(),
  },
  (t) => [unique().on(t.barberId, t.weekday)],
);

export const userRole = pgEnum("user_role", ["CLIENT", "OWNER"]);
export type UserRole = (typeof userRole.enumValues)[number];

// Contas de acesso. Cliente e dono entram com e-mail + senha; o dono ainda confirma com o código
// do aplicativo autenticador (TOTP). O cliente confirma o e-mail por um código antes do 1º acesso.
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(), // sempre em minúsculas
  role: userRole("role").notNull().default("CLIENT"),
  passwordHash: text("password_hash"),
  // Preenchido quando o cliente prova que o e-mail é dele (código recebido). Só então ele entra.
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  totpSecret: text("totp_secret"), // base32, só o dono
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  // Último intervalo de 30 s já aceito: impede reaproveitar o mesmo código.
  totpLastStep: integer("totp_last_step"),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessionScope = pgEnum("session_scope", ["full", "totp_setup"]);
export type SessionScope = (typeof sessionScope.enumValues)[number];

export const sessions = pgTable(
  "sessions",
  {
    id: serial("id").primaryKey(),
    // Guardamos só o hash do token que vai no cookie.
    tokenHash: text("token_hash").notNull().unique(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: sessionScope("scope").notNull().default("full"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const codePurpose = pgEnum("code_purpose", ["verify_email", "reset_password"]);
export type CodePurpose = (typeof codePurpose.enumValues)[number];

// Códigos de 6 números enviados por e-mail: confirmar o e-mail do cadastro e redefinir a senha.
// (A tabela se chama login_codes por histórico.)
export const loginCodes = pgTable(
  "login_codes",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    purpose: codePurpose("purpose").notNull().default("verify_email"),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("login_codes_email_idx").on(t.email, t.createdAt)],
);

// Perfil de cliente (nome e celular para a barbearia), um por conta. O celular não é único:
// ele serve só para a barbearia ligar, e não identifica (nem dá acesso a) nenhum cadastro.
export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .unique()
    .references(() => users.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const appointments = pgTable(
  "appointments",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id),
    barberId: integer("barber_id")
      .notNull()
      .references(() => barbers.id),
    serviceId: integer("service_id")
      .notNull()
      .references(() => services.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    // Preço copiado do serviço na hora do agendamento: o faturamento não muda se o preço mudar depois.
    priceCents: integer("price_cents").notNull(),
    status: appointmentStatus("status").notNull().default("PENDING"),
    // Permite que quem agendou sem login veja e cancele pelo link do e-mail.
    cancelToken: text("cancel_token").notNull(),
    // Preenchido quando o lembrete de 2 h antes é enviado (evita enviar duas vezes).
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("appointments_barber_starts_idx").on(t.barberId, t.startsAt)],
);
