import { describe, expect, it } from "vitest";
import {
  atMinute,
  busyIntervals,
  computeSlotStarts,
  earliestStartMin,
  isValidDate,
  localDateOf,
  toHHMM,
  weekdayOf,
} from "./availability.js";

const H = (h: number, m = 0) => h * 60 + m;

describe("computeSlotStarts", () => {
  it("gera horários de 15 em 15 min até caber o serviço no expediente", () => {
    const slots = computeSlotStarts({
      workStartMin: H(9),
      workEndMin: H(10),
      durationMin: 30,
      busy: [],
    });
    expect(slots.map(toHHMM)).toEqual(["09:00", "09:15", "09:30"]);
  });

  it("não oferece horários que sobrepõem um agendamento existente", () => {
    const slots = computeSlotStarts({
      workStartMin: H(9),
      workEndMin: H(11),
      durationMin: 30,
      busy: [{ start: H(9, 30), end: H(10) }],
    });
    // 09:15 terminaria 09:45 (sobrepõe); 09:30 e 09:45 também; 10:00 em diante livre.
    expect(slots.map(toHHMM)).toEqual(["09:00", "10:00", "10:15", "10:30"]);
  });

  it("permite começar exatamente quando outro agendamento termina", () => {
    const slots = computeSlotStarts({
      workStartMin: H(9),
      workEndMin: H(10),
      durationMin: 30,
      busy: [{ start: H(9), end: H(9, 30) }],
    });
    expect(slots.map(toHHMM)).toContain("09:30");
  });

  it("respeita a antecedência mínima", () => {
    const slots = computeSlotStarts({
      workStartMin: H(9),
      workEndMin: H(10),
      durationMin: 30,
      busy: [],
      earliestMin: H(9, 20),
    });
    expect(slots.map(toHHMM)).toEqual(["09:30"]);
  });

  it("retorna vazio se o serviço é maior que o expediente", () => {
    expect(
      computeSlotStarts({ workStartMin: H(9), workEndMin: H(9, 20), durationMin: 30, busy: [] }),
    ).toEqual([]);
  });
});

describe("datas e fuso (-03:00)", () => {
  it("valida datas de calendário", () => {
    expect(isValidDate("2026-10-09")).toBe(true);
    expect(isValidDate("2026-02-30")).toBe(false);
    expect(isValidDate("09/10/2026")).toBe(false);
  });

  it("calcula o dia da semana (2026-10-09 é sexta)", () => {
    expect(weekdayOf("2026-10-09")).toBe(5);
  });

  it("converte minutos do dia para instante e de volta", () => {
    const start = atMinute("2026-10-09", H(9));
    expect(start.toISOString()).toBe("2026-10-09T12:00:00.000Z");
    expect(localDateOf(start)).toBe("2026-10-09");
    // 23:30 local do dia 9 já é dia 10 em UTC, mas a data local continua 9.
    expect(localDateOf(atMinute("2026-10-09", H(23, 30)))).toBe("2026-10-09");
  });

  it("converte agendamentos em intervalos relativos ao dia", () => {
    const busy = busyIntervals("2026-10-09", [
      { startsAt: atMinute("2026-10-09", H(14)), endsAt: atMinute("2026-10-09", H(14, 45)) },
    ]);
    expect(busy).toEqual([{ start: H(14), end: H(14, 45) }]);
  });

  it("antecedência mínima: hoje bloqueia o passado, dias futuros ficam livres", () => {
    const now = atMinute("2026-10-09", H(10));
    expect(earliestStartMin("2026-10-09", now, 30)).toBe(H(10, 30));
    expect(earliestStartMin("2026-10-10", now, 30)).toBeLessThan(0);
    expect(earliestStartMin("2026-10-08", now, 30)).toBeGreaterThan(H(24));
  });
});
