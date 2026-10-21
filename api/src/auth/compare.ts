import { timingSafeEqual } from "node:crypto";

/** Comparação de textos em tempo constante (para tokens e códigos). */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
