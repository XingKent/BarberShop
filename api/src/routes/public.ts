import { and, asc, desc, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { atMinute, isValidDate, toHHMM } from "../availability.js";
import { safeEqual } from "../auth/compare.js";
import { requireClient, requireUser } from "../auth/middleware.js";
import { createAppointment, loadAppointmentInfo, slotStartsForBarber } from "../booking.js";
import { appointments, barberPhotos, barbers, customers, services } from "../db/schema.js";
import type { AppDeps } from "../deps.js";
import { AppError } from "../errors.js";
import { appointmentMessage, notifyAll } from "../notifications.js";

const dateParam = z.string().refine(isValidDate, "Data inválida (use AAAA-MM-DD)");
const idParam = z.coerce.number().int().positive();

const availabilityQuery = z.object({
  date: dateParam,
  serviceId: idParam,
  barberId: idParam.optional(),
});

const bookingBody = z.object({
  serviceId: idParam,
  barberId: idParam,
  startsAt: z.iso.datetime({ offset: true }),
});

const tokenBody = z.object({ token: z.string().min(1) });

export function publicRoutes(deps: AppDeps) {
  const { db, now } = deps;
  const r = Router();

  async function loadAppointment(id: number) {
    const [row] = await db
      .select({
        id: appointments.id,
        startsAt: appointments.startsAt,
        endsAt: appointments.endsAt,
        status: appointments.status,
        priceCents: appointments.priceCents,
        cancelToken: appointments.cancelToken,
        service: services.name,
        barber: barbers.name,
        customer: customers.name,
      })
      .from(appointments)
      .innerJoin(services, eq(services.id, appointments.serviceId))
      .innerJoin(barbers, eq(barbers.id, appointments.barberId))
      .innerJoin(customers, eq(customers.id, appointments.customerId))
      .where(eq(appointments.id, id));
    return row;
  }

  async function cancel(row: { id: number; status: string; startsAt: Date }) {
    if (row.status !== "PENDING" && row.status !== "CONFIRMED") {
      throw new AppError(409, "Este agendamento não pode mais ser cancelado");
    }
    if (row.startsAt.getTime() <= now().getTime()) {
      throw new AppError(409, "O horário já passou");
    }
    await db.update(appointments).set({ status: "CANCELED" }).where(eq(appointments.id, row.id));
  }

  r.get("/services", async (_req, res) => {
    const rows = await db
      .select()
      .from(services)
      .where(eq(services.active, true))
      .orderBy(asc(services.name));
    res.json(rows.map(({ active: _a, ...s }) => s));
  });

  r.get("/barbers", async (_req, res) => {
    const rows = await db
      .select({ id: barbers.id, name: barbers.name, photoUrl: barbers.photoUrl })
      .from(barbers)
      .where(eq(barbers.active, true))
      .orderBy(asc(barbers.name));
    res.json(rows);
  });

  // Foto do barbeiro. Só é lida quando alguém subiu uma; o endereço leva ?v= e pode ficar em cache.
  r.get("/barbers/:id/photo", async (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const [photo] = await db
      .select({ contentType: barberPhotos.contentType, data: barberPhotos.data })
      .from(barberPhotos)
      .innerJoin(barbers, eq(barbers.id, barberPhotos.barberId))
      .where(and(eq(barberPhotos.barberId, id), eq(barbers.active, true)));
    if (!photo) throw new AppError(404, "Foto não encontrada");
    res
      .set({
        "Content-Type": photo.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      })
      .send(photo.data);
  });

  r.get("/availability", async (req, res) => {
    const q = availabilityQuery.parse(req.query);

    const [service] = await db
      .select()
      .from(services)
      .where(and(eq(services.id, q.serviceId), eq(services.active, true)));
    if (!service) throw new AppError(404, "Serviço não encontrado");

    const list = await db
      .select()
      .from(barbers)
      .where(
        q.barberId
          ? and(eq(barbers.active, true), eq(barbers.id, q.barberId))
          : eq(barbers.active, true),
      );

    const slots: { barberId: number; barberName: string; time: string; startsAt: string }[] = [];
    for (const b of list) {
      const starts = await slotStartsForBarber(db, {
        date: q.date,
        barberId: b.id,
        durationMin: service.durationMin,
        now: now(),
      });
      for (const m of starts) {
        slots.push({
          barberId: b.id,
          barberName: b.name,
          time: toHHMM(m),
          startsAt: atMinute(q.date, m).toISOString(),
        });
      }
    }
    slots.sort((a, b) => a.time.localeCompare(b.time) || a.barberId - b.barberId);

    res.json({ date: q.date, durationMin: service.durationMin, slots });
  });

  // Agendar exige conta de cliente: nome, celular e e-mail dos avisos vêm do cadastro.
  r.post("/appointments", requireClient, async (req, res) => {
    const body = bookingBody.parse(req.body);
    const [profile] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.userId, req.auth!.user.id));
    if (!profile) throw new AppError(400, "Complete seu cadastro (nome e celular) em Minha conta antes de agendar.");

    const { appointment } = await createAppointment(
      db,
      {
        serviceId: body.serviceId,
        barberId: body.barberId,
        startsAt: new Date(body.startsAt),
        customerId: profile.id,
      },
      now(),
    );

    // O aviso não pode derrubar a reserva: se o e-mail falhar, o horário continua reservado.
    const info = await loadAppointmentInfo(db, appointment.id, deps.appUrl);
    if (info) await notifyAll(deps.channels, appointmentMessage("received", info, deps));

    res.status(201).json({
      id: appointment.id,
      cancelToken: appointment.cancelToken,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      status: appointment.status,
    });
  });

  // Pelo link do e-mail (sem precisar entrar): vê e cancela o agendamento com o token do link.
  r.get("/appointments/:id", async (req, res) => {
    const id = idParam.parse(req.params.id);
    const { token } = tokenBody.parse(req.query);
    const row = await loadAppointment(id);
    if (!row || !safeEqual(row.cancelToken, token)) throw new AppError(404, "Agendamento não encontrado");
    const { cancelToken: _t, ...visible } = row;
    res.json(visible);
  });

  r.post("/appointments/:id/cancel", async (req, res) => {
    const id = idParam.parse(req.params.id);
    const { token } = tokenBody.parse(req.body);
    const row = await loadAppointment(id);
    if (!row || !safeEqual(row.cancelToken, token)) throw new AppError(404, "Agendamento não encontrado");
    await cancel(row);
    res.json({ id, status: "CANCELED" });
  });

  // Conta do cliente: histórico e cancelamento.
  r.get("/me/appointments", requireUser, async (req, res) => {
    const rows = await db
      .select({
        id: appointments.id,
        startsAt: appointments.startsAt,
        endsAt: appointments.endsAt,
        status: appointments.status,
        priceCents: appointments.priceCents,
        service: services.name,
        barber: barbers.name,
      })
      .from(appointments)
      .innerJoin(customers, eq(customers.id, appointments.customerId))
      .innerJoin(services, eq(services.id, appointments.serviceId))
      .innerJoin(barbers, eq(barbers.id, appointments.barberId))
      .where(eq(customers.userId, req.auth!.user.id))
      .orderBy(desc(appointments.startsAt));
    res.json(rows);
  });

  r.post("/me/appointments/:id/cancel", requireUser, async (req, res) => {
    const id = idParam.parse(req.params.id);
    const [row] = await db
      .select({ id: appointments.id, status: appointments.status, startsAt: appointments.startsAt })
      .from(appointments)
      .innerJoin(customers, eq(customers.id, appointments.customerId))
      .where(and(eq(appointments.id, id), eq(customers.userId, req.auth!.user.id)));
    if (!row) throw new AppError(404, "Agendamento não encontrado");
    await cancel(row);
    res.json({ id, status: "CANCELED" });
  });

  return r;
}
