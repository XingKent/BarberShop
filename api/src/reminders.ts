import { and, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import { loadAppointmentInfo } from "./booking.js";
import { appointments } from "./db/schema.js";
import type { AppDeps } from "./deps.js";
import { appointmentMessage, notifyAll } from "./notifications.js";

/** O lembrete sai quando faltam 2 horas (ou menos) para o horário. */
export const REMINDER_LEAD_MS = 2 * 60 * 60 * 1000;

/**
 * Envia os lembretes que já estão na hora. Pode rodar quantas vezes quiser (a cada minuto):
 * cada agendamento recebe um lembrete só.
 */
export async function sendDueReminders(deps: AppDeps): Promise<number> {
  const { db } = deps;
  const t = deps.now();

  // Marca como enviado ANTES de enviar. Assim duas execuções ao mesmo tempo (ou duas cópias da
  // API) não mandam o mesmo lembrete duas vezes. Se o envio falhar, a marca é desfeita abaixo.
  const claimed = await db
    .update(appointments)
    .set({ reminderSentAt: t })
    .where(
      and(
        isNull(appointments.reminderSentAt),
        inArray(appointments.status, ["PENDING", "CONFIRMED"]),
        gt(appointments.startsAt, t),
        lte(appointments.startsAt, new Date(t.getTime() + REMINDER_LEAD_MS)),
        // Quem reservou com menos de 2 h de antecedência acabou de receber a confirmação:
        // não faz sentido mandar um lembrete logo em seguida.
        sql`${appointments.createdAt} <= ${appointments.startsAt} - interval '2 hours'`,
      ),
    )
    .returning({ id: appointments.id });

  let sent = 0;
  for (const { id } of claimed) {
    const info = await loadAppointmentInfo(db, id, deps.appUrl);
    const ok = info
      ? await notifyAll(deps.channels, appointmentMessage("reminder", info, deps))
      : false;
    if (ok) sent++;
    else await db.update(appointments).set({ reminderSentAt: null }).where(eq(appointments.id, id));
  }
  return sent;
}

/** Roda os lembretes a cada minuto enquanto a API estiver no ar. Devolve uma função para parar. */
export function startReminderLoop(deps: AppDeps, intervalMs = 60_000): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await sendDueReminders(deps);
    } catch (err) {
      console.error("Falha ao enviar lembretes:", err);
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  return () => clearInterval(timer);
}
