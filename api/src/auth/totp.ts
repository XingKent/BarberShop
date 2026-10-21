// TOTP (RFC 6238): o mesmo esquema do Google Authenticator, Authy e Microsoft Authenticator.
// Um código de 6 dígitos que muda a cada 30 segundos, calculado a partir de um segredo
// compartilhado (que o dono escaneia uma vez, por QR code) e da hora atual.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const STEP_SECONDS = 30;
export const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("Segredo base32 inválido");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

export function stepAt(ms: number): number {
  return Math.floor(ms / 1000 / STEP_SECONDS);
}

export function codeForStep(secret: string, step: number, digits = DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    (hmac[offset + 1]! << 16) |
    (hmac[offset + 2]! << 8) |
    hmac[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/**
 * Confere o código digitado. Aceita o intervalo atual e um para cada lado (relógios um pouco
 * fora de hora) e recusa qualquer intervalo igual ou anterior ao último já usado, para que
 * o mesmo código não valha duas vezes. Devolve o intervalo aceito, ou null.
 */
export function verifyTotp(
  secret: string,
  code: string,
  now: Date,
  lastStep: number | null,
  window = 1,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = stepAt(now.getTime());
  const given = Buffer.from(code);
  let matched: number | null = null;
  // Percorre todos os candidatos (sem parar no primeiro) para manter o tempo constante.
  for (let delta = -window; delta <= window; delta++) {
    const step = current + delta;
    if (lastStep !== null && step <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(codeForStep(secret, step)), given)) matched = step;
  }
  return matched;
}

export function otpauthUri(secret: string, account: string, issuer: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return (
    `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}` +
    `&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`
  );
}
