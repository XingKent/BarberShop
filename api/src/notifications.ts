// Mensagens para o cliente e os canais por onde elas saem.
//
// Hoje só existe o canal de e-mail. Para acrescentar WhatsApp depois, basta criar outro Channel
// (que usa `to.phone`) e incluí-lo na lista de canais em createDeps (src/deps.ts).

import type { MailMessage, Mailer } from "./mail.js";

export interface NotificationMessage {
  to: { email?: string | null; phone?: string | null };
  subject: string;
  text: string;
  html: string;
}

export interface Channel {
  name: string;
  send(message: NotificationMessage): Promise<void>;
}

export function emailChannel(mailer: Mailer): Channel {
  return {
    name: "email",
    async send(m) {
      if (!m.to.email) return;
      const mail: MailMessage = { to: m.to.email, subject: m.subject, text: m.text, html: m.html };
      await mailer.send(mail);
    },
  };
}

/**
 * Envia por todos os canais. Falha de um canal não impede os outros nem derruba a reserva.
 * Devolve true se pelo menos um canal enviou.
 */
export async function notifyAll(channels: Channel[], message: NotificationMessage): Promise<boolean> {
  let sent = false;
  for (const channel of channels) {
    try {
      await channel.send(message);
      sent = true;
    } catch (err) {
      console.error(`Falha ao enviar aviso por ${channel.name}:`, err);
    }
  }
  return sent;
}

// ---------- Texto e HTML ----------

const TZ = "America/Sao_Paulo";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const dateLong = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: TZ }).format(d);

const timeOf = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(d);

const money = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

function layout(shopName: string, heading: string, paragraphs: string[], button?: { label: string; url: string }) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px;line-height:1.5">${p}</p>`).join("");
  const cta = button
    ? `<p style="margin:22px 0"><a href="${esc(button.url)}" style="background:#c92f2a;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">${esc(button.label)}</a></p>`
    : "";
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f3f5f4;font-family:Arial,Helvetica,sans-serif;color:#0f1b33">
<div style="max-width:520px;margin:0 auto;background:#ffffff">
<div style="height:10px;background:repeating-linear-gradient(-45deg,#c92f2a 0 9px,#ffffff 9px 18px,#1c3d8f 18px 27px,#ffffff 27px 36px)"></div>
<div style="padding:24px">
<p style="margin:0 0 18px;font-size:20px;font-weight:bold">${esc(shopName)}</p>
<h1 style="margin:0 0 16px;font-size:22px">${esc(heading)}</h1>
${body}${cta}
</div></div></body></html>`;
}

/** Código de 6 números por e-mail: confirmar o cadastro ou redefinir a senha. */
export function codeMessage(opts: {
  kind: "verify_email" | "reset_password";
  shopName: string;
  email: string;
  code: string;
}): NotificationMessage {
  const { kind, shopName, email, code } = opts;
  const verify = kind === "verify_email";
  const heading = verify ? "Confirme seu e-mail" : "Redefinir sua senha";
  const use = verify ? "Digite este código para confirmar seu e-mail e entrar:" : "Digite este código para criar uma nova senha:";
  return {
    to: { email },
    subject: `${verify ? "Seu código para confirmar o e-mail" : "Seu código para redefinir a senha"}: ${code}`,
    text: `${use} ${code}\nEle vale por 10 minutos. Se não foi você que pediu, ignore este e-mail.\n— ${shopName}`,
    html: layout(shopName, heading, [
      use,
      `<span style="font-size:32px;letter-spacing:6px;font-weight:bold">${esc(code)}</span>`,
      `Ele vale por 10 minutos. Se não foi você que pediu, ignore este e-mail.`,
    ]),
  };
}

export interface AppointmentInfo {
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  service: string;
  barber: string;
  startsAt: Date;
  priceCents: number;
  /** Link para ver ou cancelar o agendamento. */
  manageUrl: string;
}

export type AppointmentMessageKind = "received" | "confirmed" | "reminder" | "canceledByShop";

export function appointmentMessage(
  kind: AppointmentMessageKind,
  a: AppointmentInfo,
  ctx: { shopName: string; appUrl: string },
): NotificationMessage {
  const when = `${dateLong(a.startsAt)} às ${timeOf(a.startsAt)}`;
  const details = [
    `<strong>Serviço:</strong> ${esc(a.service)} (${esc(money(a.priceCents))})`,
    `<strong>Barbeiro:</strong> ${esc(a.barber)}`,
    `<strong>Quando:</strong> ${esc(when)}`,
  ];
  const detailsText = `Serviço: ${a.service} (${money(a.priceCents)})\nBarbeiro: ${a.barber}\nQuando: ${when}`;
  const first = a.customerName.split(" ")[0] ?? a.customerName;
  const to = { email: a.customerEmail, phone: a.customerPhone };

  switch (kind) {
    case "received":
      return {
        to,
        subject: `Horário reservado: ${dateLong(a.startsAt)} às ${timeOf(a.startsAt)}`,
        text: `${first}, seu horário na ${ctx.shopName} foi reservado.\n\n${detailsText}\n\nA barbearia vai confirmar em breve. Para ver ou cancelar: ${a.manageUrl}`,
        html: layout(
          ctx.shopName,
          "Horário reservado",
          [`${esc(first)}, seu horário foi reservado. A barbearia vai confirmar em breve.`, ...details],
          { label: "Ver ou cancelar agendamento", url: a.manageUrl },
        ),
      };
    case "confirmed":
      return {
        to,
        subject: `Horário confirmado: ${dateLong(a.startsAt)} às ${timeOf(a.startsAt)}`,
        text: `${first}, a ${ctx.shopName} confirmou o seu horário.\n\n${detailsText}\n\nPara ver ou cancelar: ${a.manageUrl}`,
        html: layout(ctx.shopName, "Horário confirmado", [`${esc(first)}, a barbearia confirmou o seu horário.`, ...details], {
          label: "Ver ou cancelar agendamento",
          url: a.manageUrl,
        }),
      };
    case "reminder":
      return {
        to,
        subject: `Lembrete: seu horário é às ${timeOf(a.startsAt)}`,
        text: `${first}, lembrando do seu horário na ${ctx.shopName} daqui a pouco.\n\n${detailsText}\n\nSe não puder vir, cancele para liberar o horário: ${a.manageUrl}`,
        html: layout(
          ctx.shopName,
          `Seu horário é às ${timeOf(a.startsAt)}`,
          [`${esc(first)}, lembrando do seu horário daqui a pouco.`, ...details, `Se não puder vir, cancele para liberar o horário para outra pessoa.`],
          { label: "Ver ou cancelar agendamento", url: a.manageUrl },
        ),
      };
    case "canceledByShop":
      return {
        to,
        subject: `Seu horário foi cancelado: ${dateLong(a.startsAt)} às ${timeOf(a.startsAt)}`,
        text: `${first}, a ${ctx.shopName} precisou cancelar o seu horário.\n\n${detailsText}\n\nEscolha outro horário em ${ctx.appUrl}/agendar`,
        html: layout(ctx.shopName, "Seu horário foi cancelado", [`${esc(first)}, a barbearia precisou cancelar este horário.`, ...details], {
          label: "Escolher outro horário",
          url: `${ctx.appUrl}/agendar`,
        }),
      };
  }
}
