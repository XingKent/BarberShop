import { randomUUID } from "node:crypto";
import { and, count, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";
import {
  atMinute,
  busyIntervals,
  computeSlotStarts,
  dayEnd,
  dayStart,
  earliestStartMin,
  localDateOf,
  weekdayOf,
} from "./availability.js";
import type { Db } from "./db/index.js";
import { appointments, barberHours, barbers, customers, services } from "./db/schema.js";
import { AppError } from "./errors.js";
import type { AppointmentInfo } from "./notifications.js";

/** Minutos de início livres para um barbeiro em uma data, para um serviço de certa duração. */
export async function slotStartsForBarber(
  db: Db,
  opts: { date: string; barberId: number; durationMin: number; now: Date },
): Promise<number[]> {
  const { date, barberId, durationMin, now } = opts;

  const [hours] = await db
    .select()
    .from(barberHours)
    .where(and(eq(barberHours.barberId, barberId), eq(barberHours.weekday, weekdayOf(date))));
  if (!hours) return [];

  const existing = await db
    .select({ startsAt: appointments.startsAt, endsAt: appointments.endsAt })
    .from(appointments)
    .where(
      and(
        eq(appointments.barberId, barberId),
        ne(appointments.status, "CANCELED"),
        lt(appointments.startsAt, dayEnd(date)),
        gt(appointments.endsAt, dayStart(date)),
      ),
    );

  return computeSlotStarts({
    workStartMin: hours.startMin,
    workEndMin: hours.endMin,
    durationMin,
    busy: busyIntervals(date, existing),
    earliestMin: earliestStartMin(date, now),
  });
}

export interface NewBooking {
  serviceId: number;
  barberId: number;
  startsAt: Date;
  /** Cadastro (nome e celular) da conta de quem está agendando. */
  customerId: number;
}

/** Até quantos dias à frente dá para reservar. */
export const MAX_DAYS_AHEAD = 60;
/** Quantos horários futuros (pendentes ou confirmados) uma pessoa pode ter ao mesmo tempo. */
export const MAX_ACTIVE_BOOKINGS = 3;

export async function createAppointment(db: Db, input: NewBooking, now = new Date()) {
  if (input.startsAt.getTime() > now.getTime() + MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000) {
    throw new AppError(400, `Só dá para reservar com até ${MAX_DAYS_AHEAD} dias de antecedência.`);
  }
  return db.transaction(async (tx) => {
    // Trava por barbeiro até o fim da transação: duas pessoas tentando o mesmo horário
    // são atendidas uma de cada vez, e a segunda recebe "horário indisponível".
    await tx.execute(sql`select pg_advisory_xact_lock(${input.barberId})`);
    // Trava por cliente também (sempre depois da do barbeiro, para nunca travar em ciclo): duas reservas
    // simultâneas da mesma pessoa não passam do limite juntas.
    await tx.execute(sql`select pg_advisory_xact_lock(1, ${input.customerId})`);

    // Sem este limite, uma única conta poderia reservar todos os horários da barbearia e bloquear os outros clientes.
    const [active] = await tx
      .select({ n: count() })
      .from(appointments)
      .where(
        and(
          eq(appointments.customerId, input.customerId),
          inArray(appointments.status, ["PENDING", "CONFIRMED"]),
          gt(appointments.startsAt, now),
        ),
      );
    if ((active?.n ?? 0) >= MAX_ACTIVE_BOOKINGS) {
      throw new AppError(
        409,
        `Você já tem ${MAX_ACTIVE_BOOKINGS} horários marcados. Cancele um deles ou espere o atendimento para marcar outro.`,
        "TOO_MANY_BOOKINGS",
      );
    }

    const [service] = await tx
      .select()
      .from(services)
      .where(and(eq(services.id, input.serviceId), eq(services.active, true)));
    if (!service) throw new AppError(404, "Serviço não encontrado");

    const [barber] = await tx
      .select()
      .from(barbers)
      .where(and(eq(barbers.id, input.barberId), eq(barbers.active, true)));
    if (!barber) throw new AppError(404, "Barbeiro não encontrado");

    const date = localDateOf(input.startsAt);
    const startMin = (input.startsAt.getTime() - dayStart(date).getTime()) / 60_000;
    const free = await slotStartsForBarber(tx, {
      date,
      barberId: barber.id,
      durationMin: service.durationMin,
      now,
    });
    if (!free.includes(startMin)) throw new AppError(409, "Horário indisponível");

    const [appointment] = await tx
      .insert(appointments)
      .values({
        customerId: input.customerId,
        barberId: barber.id,
        serviceId: service.id,
        startsAt: atMinute(date, startMin),
        endsAt: atMinute(date, startMin + service.durationMin),
        priceCents: service.priceCents,
        cancelToken: randomUUID(),
        createdAt: now,
      })
      .returning();
    if (!appointment) throw new AppError(500, "Falha ao criar agendamento");
    return { appointment, service, barber };
  });
}

/** Dados de um agendamento no formato das mensagens ao cliente. */
export async function loadAppointmentInfo(
  db: Db,
  id: number,
  appUrl: string,
): Promise<AppointmentInfo | undefined> {
  const [row] = await db
    .select({
      id: appointments.id,
      cancelToken: appointments.cancelToken,
      startsAt: appointments.startsAt,
      priceCents: appointments.priceCents,
      service: services.name,
      barber: barbers.name,
      customerName: customers.name,
      customerEmail: customers.email,
      customerPhone: customers.phone,
    })
    .from(appointments)
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .innerJoin(barbers, eq(barbers.id, appointments.barberId))
    .innerJoin(customers, eq(customers.id, appointments.customerId))
    .where(eq(appointments.id, id));
  if (!row) return undefined;
  return {
    customerName: row.customerName,
    customerEmail: row.customerEmail,
    customerPhone: row.customerPhone,
    service: row.service,
    barber: row.barber,
    startsAt: row.startsAt,
    priceCents: row.priceCents,
    manageUrl: `${appUrl}/agendamento/${row.id}?token=${row.cancelToken}`,
  };
}
