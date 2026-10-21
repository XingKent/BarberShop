import nodemailer from "nodemailer";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Envio real por SMTP. Exemplo de SMTP_URL: smtp://usuario:senha@smtp.exemplo.com:587 */
export function createSmtpMailer(smtpUrl: string, from: string): Mailer {
  const transport = nodemailer.createTransport({
    url: smtpUrl,
    // Sem isso, um servidor de e-mail fora do ar seguraria o pedido do cliente por minutos.
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 10_000,
  });
  return {
    async send(m) {
      await transport.sendMail({ from, to: m.to, subject: m.subject, text: m.text, html: m.html });
    },
  };
}

/** Sem SMTP configurado (desenvolvimento): o e-mail aparece no log da API. */
export function createLogMailer(): Mailer {
  return {
    async send(m) {
      console.log(`\n[e-mail] Para: ${m.to}\n[e-mail] Assunto: ${m.subject}\n${m.text}\n`);
    },
  };
}

/** Para os testes: guarda as mensagens em vez de enviar. */
export function createMemoryMailer(): Mailer & { outbox: MailMessage[] } {
  const outbox: MailMessage[] = [];
  return {
    outbox,
    async send(m) {
      outbox.push(m);
    },
  };
}

export function createMailer(smtpUrl: string, from: string): Mailer {
  return smtpUrl ? createSmtpMailer(smtpUrl, from) : createLogMailer();
}
