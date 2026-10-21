import { and, asc, count, desc, eq, gte, lt, ne } from "drizzle-orm";
import express, { Router } from "express";
import { z } from "zod";
import { dayEnd, dayStart, isValidDate, localDateOf } from "../availability.js";
import { loadAppointmentInfo } from "../booking.js";
import type { AppDeps } from "../deps.js";
import { appointmentMessage, notifyAll } from "../notifications.js";
import {
  appointmentStatus,
  appointments,
  barberHours,
  barberPhotos,
  barbers,
  customers,
  services,
  type AppointmentStatus,
} from "../db/schema.js";
import { AppError } from "../errors.js";

const dateParam = z.string().refine(isValidDate, "Data inválida (use AAAA-MM-DD)");
const idParam = z.coerce.number().int().positive();

// Transições permitidas: CANCELED e COMPLETED são finais.
const transitions: Record<AppointmentStatus, AppointmentStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELED"],
  CONFIRMED: ["COMPLETED", "CANCELED"],
  CANCELED: [],
  COMPLETED: [],
};

const serviceBody = z.object({
  name: z.string().trim().min(2).max(100),
  durationMin: z.number().int().min(5).max(480),
  priceCents: z.number().int().min(0),
});

const hoursBody = z
  .array(
    z
      .object({
        weekday: z.number().int().min(0).max(6),
        startMin: z.number().int().min(0).max(1439),
        endMin: z.number().int().min(1).max(1440),
      })
      .refine((h) => h.endMin > h.startMin, "Fim deve ser depois do início"),
  )
  .refine((a) => new Set(a.map((h) => h.weekday)).size === a.length, "Dia da semana repetido");

// Foto do barbeiro: arquivo do próprio site (começa com /) ou endereço https. Vazio remove a foto.
const photoUrlSchema = z
  .string()
  .trim()
  .max(300)
  .refine((s) => s === "" || /^(\/|https:\/\/)/.test(s), "A foto deve começar com / (arquivo do site) ou https://")
  .transform((s) => s || null);

/** O navegador reduz a foto para ~512 px antes de enviar; 600 KB sobra e impede abuso. */
const PHOTO_MAX_BYTES = 600 * 1024;

/** Confere o tipo pelos primeiros bytes do arquivo (o cabeçalho Content-Type não prova nada). */
export function sniffImageType(b: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 12 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") {
    return "image/webp";
  }
  return null;
}

export function adminRoutes(deps: AppDeps) {
  const { db, now } = deps;
  const r = Router();

  // ---- Agendamentos ----
  r.get("/appointments", async (req, res) => {
    const today = localDateOf(now());
    const q = z
      .object({
        from: dateParam.default(today),
        to: dateParam.optional(),
        status: z.enum(appointmentStatus.enumValues).optional(),
        barberId: idParam.optional(),
      })
      .parse(req.query);
    const to = q.to ?? q.from;

    const conditions = [
      gte(appointments.startsAt, dayStart(q.from)),
      lt(appointments.startsAt, dayEnd(to)),
    ];
    if (q.status) conditions.push(eq(appointments.status, q.status));
    if (q.barberId) conditions.push(eq(appointments.barberId, q.barberId));

    const rows = await db
      .select({
        id: appointments.id,
        startsAt: appointments.startsAt,
        endsAt: appointments.endsAt,
        status: appointments.status,
        priceCents: appointments.priceCents,
        service: services.name,
        barberId: barbers.id,
        barber: barbers.name,
        customer: customers.name,
        phone: customers.phone,
      })
      .from(appointments)
      .innerJoin(services, eq(services.id, appointments.serviceId))
      .innerJoin(barbers, eq(barbers.id, appointments.barberId))
      .innerJoin(customers, eq(customers.id, appointments.customerId))
      .where(and(...conditions))
      .orderBy(asc(appointments.startsAt));
    res.json(rows);
  });

  r.patch("/appointments/:id", async (req, res) => {
    const id = idParam.parse(req.params.id);
    const { status } = z.object({ status: z.enum(appointmentStatus.enumValues) }).parse(req.body);

    const [current] = await db.select().from(appointments).where(eq(appointments.id, id));
    if (!current) throw new AppError(404, "Agendamento não encontrado");
    if (!transitions[current.status].includes(status)) {
      throw new AppError(409, `Não é possível mudar de ${current.status} para ${status}`);
    }
    const [updated] = await db
      .update(appointments)
      .set({ status })
      .where(eq(appointments.id, id))
      .returning();

    // Avisa o cliente quando a barbearia confirma ou cancela. Falha no aviso não desfaz a mudança.
    if (status === "CONFIRMED" || status === "CANCELED") {
      const info = await loadAppointmentInfo(db, id, deps.appUrl);
      if (info) {
        const kind = status === "CONFIRMED" ? "confirmed" : "canceledByShop";
        await notifyAll(deps.channels, appointmentMessage(kind, info, deps));
      }
    }
    const { cancelToken: _omit, ...visible } = updated!;
    res.json(visible);
  });

  // ---- Serviços ----
  r.get("/services", async (_req, res) => {
    res.json(await db.select().from(services).orderBy(asc(services.name)));
  });

  r.post("/services", async (req, res) => {
    const body = serviceBody.parse(req.body);
    const [created] = await db.insert(services).values(body).returning();
    res.status(201).json(created);
  });

  r.patch("/services/:id", async (req, res) => {
    const id = idParam.parse(req.params.id);
    const body = serviceBody.partial().extend({ active: z.boolean().optional() }).parse(req.body);
    if (Object.keys(body).length === 0) throw new AppError(400, "Nada para atualizar");
    const [updated] = await db.update(services).set(body).where(eq(services.id, id)).returning();
    if (!updated) throw new AppError(404, "Serviço não encontrado");
    res.json(updated);
  });

  // ---- Barbeiros ----
  r.get("/barbers", async (_req, res) => {
    const list = await db.select().from(barbers).orderBy(asc(barbers.name));
    const hours = await db.select().from(barberHours).orderBy(asc(barberHours.weekday));
    res.json(
      list.map((b) => ({
        ...b,
        hours: hours
          .filter((h) => h.barberId === b.id)
          .map(({ weekday, startMin, endMin }) => ({ weekday, startMin, endMin })),
      })),
    );
  });

  r.post("/barbers", async (req, res) => {
    const { name, photoUrl } = z
      .object({ name: z.string().trim().min(2).max(100), photoUrl: photoUrlSchema.optional() })
      .parse(req.body);
    const [created] = await db
      .insert(barbers)
      .values({ name, photoUrl: photoUrl ?? null })
      .returning();
    res.status(201).json(created);
  });

  r.patch("/barbers/:id", async (req, res) => {
    const id = idParam.parse(req.params.id);
    const body = z
      .object({
        name: z.string().trim().min(2).max(100).optional(),
        active: z.boolean().optional(),
        photoUrl: photoUrlSchema.optional(),
      })
      .parse(req.body);
    if (Object.keys(body).length === 0) throw new AppError(400, "Nada para atualizar");
    const [updated] = await db.update(barbers).set(body).where(eq(barbers.id, id)).returning();
    if (!updated) throw new AppError(404, "Barbeiro não encontrado");
    res.json(updated);
  });

  // Foto do barbeiro: o navegador envia a imagem já reduzida (corpo bruto image/*). Guardamos no banco
  // e a foto passa a ser servida em /api/barbers/:id/photo. O ?v= muda a cada troca (evita cache velho).
  r.put("/barbers/:id/photo", express.raw({ type: "image/*", limit: PHOTO_MAX_BYTES }), async (req, res) => {
    const id = idParam.parse(req.params.id);
    const data: unknown = req.body;
    if (!Buffer.isBuffer(data) || data.length === 0) throw new AppError(400, "Envie uma imagem JPEG, PNG ou WebP");
    const contentType = sniffImageType(data);
    if (!contentType) throw new AppError(400, "Formato não aceito. Use JPEG, PNG ou WebP");
    const [barber] = await db.select({ id: barbers.id }).from(barbers).where(eq(barbers.id, id));
    if (!barber) throw new AppError(404, "Barbeiro não encontrado");

    const updatedAt = now();
    await db.transaction(async (tx) => {
      await tx
        .insert(barberPhotos)
        .values({ barberId: id, contentType, data, updatedAt })
        .onConflictDoUpdate({ target: barberPhotos.barberId, set: { contentType, data, updatedAt } });
      await tx
        .update(barbers)
        .set({ photoUrl: `/api/barbers/${id}/photo?v=${updatedAt.getTime()}` })
        .where(eq(barbers.id, id));
    });
    res.json({ photoUrl: `/api/barbers/${id}/photo?v=${updatedAt.getTime()}` });
  });

  r.delete("/barbers/:id/photo", async (req, res) => {
    const id = idParam.parse(req.params.id);
    const [barber] = await db.select({ id: barbers.id }).from(barbers).where(eq(barbers.id, id));
    if (!barber) throw new AppError(404, "Barbeiro não encontrado");
    await db.transaction(async (tx) => {
      await tx.delete(barberPhotos).where(eq(barberPhotos.barberId, id));
      await tx.update(barbers).set({ photoUrl: null }).where(eq(barbers.id, id));
    });
    res.json({ photoUrl: null });
  });

  // Substitui toda a grade de horários do barbeiro.
  r.put("/barbers/:id/hours", async (req, res) => {
    const id = idParam.parse(req.params.id);
    const hours = hoursBody.parse(req.body);
    const [barber] = await db.select().from(barbers).where(eq(barbers.id, id));
    if (!barber) throw new AppError(404, "Barbeiro não encontrado");
    await db.transaction(async (tx) => {
      await tx.delete(barberHours).where(eq(barberHours.barberId, id));
      if (hours.length) {
        await tx.insert(barberHours).values(hours.map((h) => ({ ...h, barberId: id })));
      }
    });
    res.json(hours);
  });

  // ---- Clientes ----
  r.get("/customers", async (_req, res) => {
    const rows = await db
      .select({
        id: customers.id,
        name: customers.name,
        phone: customers.phone,
        email: customers.email,
        createdAt: customers.createdAt,
        appointments: count(appointments.id),
      })
      .from(customers)
      .leftJoin(appointments, eq(appointments.customerId, customers.id))
      .where(ne(customers.phone, "")) // contas excluídas pelo cliente ficam sem celular
      .groupBy(customers.id)
      .orderBy(desc(customers.createdAt));
    res.json(rows);
  });

  // ---- Faturamento ----
  // Considera só atendimentos COMPLETED, usando o preço gravado no agendamento.
  r.get("/reports/revenue", async (req, res) => {
    const today = localDateOf(now());
    const q = z
      .object({ from: dateParam.default(today), to: dateParam.default(today) })
      .parse(req.query);

    const rows = await db
      .select({
        startsAt: appointments.startsAt,
        priceCents: appointments.priceCents,
        barberId: barbers.id,
        barber: barbers.name,
        serviceId: services.id,
        service: services.name,
      })
      .from(appointments)
      .innerJoin(services, eq(services.id, appointments.serviceId))
      .innerJoin(barbers, eq(barbers.id, appointments.barberId))
      .where(
        and(
          eq(appointments.status, "COMPLETED"),
          gte(appointments.startsAt, dayStart(q.from)),
          lt(appointments.startsAt, dayEnd(q.to)),
        ),
      );

    const group = <K extends string | number>(key: (row: (typeof rows)[number]) => K) => {
      const map = new Map<K, { totalCents: number; count: number }>();
      for (const row of rows) {
        const k = key(row);
        const acc = map.get(k) ?? { totalCents: 0, count: 0 };
        acc.totalCents += row.priceCents;
        acc.count += 1;
        map.set(k, acc);
      }
      return map;
    };

    const totalCents = rows.reduce((sum, row) => sum + row.priceCents, 0);
    const barberNames = new Map(rows.map((x) => [x.barberId, x.barber]));
    const serviceNames = new Map(rows.map((x) => [x.serviceId, x.service]));

    res.json({
      from: q.from,
      to: q.to,
      totalCents,
      count: rows.length,
      averageTicketCents: rows.length ? Math.round(totalCents / rows.length) : 0,
      byDay: [...group((x) => localDateOf(x.startsAt))]
        .map(([date, v]) => ({ date, ...v }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      byBarber: [...group((x) => x.barberId)].map(([barberId, v]) => ({
        barberId,
        name: barberNames.get(barberId),
        ...v,
      })),
      byService: [...group((x) => x.serviceId)].map(([serviceId, v]) => ({
        serviceId,
        name: serviceNames.get(serviceId),
        ...v,
      })),
    });
  });

  return r;
}
