// Regras de horário disponível. Funções puras (sem banco) para serem fáceis de testar.
//
// Trabalhamos com "minutos desde 00:00 do dia local". O Brasil não tem horário de verão
// desde 2019, então um offset fixo (-03:00) é suficiente para a primeira versão.

export const TZ_OFFSET = "-03:00";
const TZ_OFFSET_MS = -3 * 60 * 60 * 1000;

/** Intervalo entre opções de início (09:00, 09:15, 09:30...). */
export const STEP_MIN = 15;
/** Antecedência mínima para agendar (não dá para marcar daqui a 5 minutos). */
export const MIN_LEAD_MIN = 30;

export interface Interval {
  start: number;
  end: number;
}

export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

/** Instante em que o dia local começa (00:00 no fuso -03:00). */
export function dayStart(date: string): Date {
  return new Date(`${date}T00:00:00${TZ_OFFSET}`);
}

export function dayEnd(date: string): Date {
  return new Date(dayStart(date).getTime() + 24 * 60 * 60 * 1000);
}

/** Dia da semana de uma data de calendário (0 = domingo). Não depende de fuso. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** Data local (YYYY-MM-DD) de um instante. */
export function localDateOf(instant: Date): string {
  return new Date(instant.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

export function atMinute(date: string, minutes: number): Date {
  return new Date(dayStart(date).getTime() + minutes * 60_000);
}

export function toHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Converte agendamentos existentes em intervalos de minutos relativos ao dia. */
export function busyIntervals(
  date: string,
  appts: { startsAt: Date; endsAt: Date }[],
): Interval[] {
  const base = dayStart(date).getTime();
  return appts.map((a) => ({
    start: (a.startsAt.getTime() - base) / 60_000,
    end: (a.endsAt.getTime() - base) / 60_000,
  }));
}

/** Primeiro minuto do dia em que ainda é possível agendar, dado o "agora". */
export function earliestStartMin(date: string, now: Date, leadMin = MIN_LEAD_MIN): number {
  return Math.ceil((now.getTime() - dayStart(date).getTime()) / 60_000) + leadMin;
}

export function computeSlotStarts(opts: {
  workStartMin: number;
  workEndMin: number;
  durationMin: number;
  busy: Interval[];
  earliestMin?: number;
  stepMin?: number;
}): number[] {
  const { workStartMin, workEndMin, durationMin, busy } = opts;
  const earliest = opts.earliestMin ?? Number.NEGATIVE_INFINITY;
  const step = opts.stepMin ?? STEP_MIN;
  const slots: number[] = [];
  for (let start = workStartMin; start + durationMin <= workEndMin; start += step) {
    if (start < earliest) continue;
    const end = start + durationMin;
    if (busy.some((b) => start < b.end && end > b.start)) continue;
    slots.push(start);
  }
  return slots;
}
