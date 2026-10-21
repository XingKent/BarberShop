const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export const money = (cents: number) => brl.format(cents / 100);

export function duration(min: number) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Data local (AAAA-MM-DD) de um Date, sem passar por UTC. */
export function ymd(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Cria um Date ao meio-dia local a partir de AAAA-MM-DD (evita saltos de fuso). */
export function parseYmd(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, m! - 1, d!, 12);
}

export function addDays(s: string, n: number) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

export const weekdayShort = (s: string) =>
  parseYmd(s).toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");

export const dayLong = (s: string) =>
  parseYmd(s).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });

export const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });

export const dateTimeLong = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Sao_Paulo",
  }) + ` às ${timeOf(iso)}`;

export function phoneMask(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export const statusLabel = {
  PENDING: "Aguardando confirmação",
  CONFIRMED: "Confirmado",
  CANCELED: "Cancelado",
  COMPLETED: "Concluído",
} as const;

export const SHOP_NAME = import.meta.env.VITE_SHOP_NAME ?? "Barbearia do Gui";

/** Contato exibido no rodapé. Defina VITE_SHOP_ADDRESS e VITE_SHOP_PHONE para aparecerem. */
export const SHOP_ADDRESS: string = import.meta.env.VITE_SHOP_ADDRESS ?? "";
export const SHOP_PHONE: string = import.meta.env.VITE_SHOP_PHONE ?? "";
