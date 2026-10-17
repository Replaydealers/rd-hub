// Tsumiki V1.1 – E-Mail-Versand über SMTP (z. B. IONOS-Postfach noreply@tsumiki.de).
// Ohne SMTP_PASS in .env werden Mails nur im Postausgang gespeichert, nicht verschickt.
import nodemailer from 'nodemailer';

export function createMailer() {
  const pass = process.env.SMTP_PASS;
  if (!pass) return { mode: 'aus', send: null };
  const from = process.env.MAIL_FROM || 'Tsumiki <noreply@tsumiki.de>';
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.ionos.de',
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth: { user: process.env.SMTP_USER || from.match(/<([^>]+)>/)?.[1] || from, pass },
  });
  const send = (to, subject, html) => {
    if (!to) return;
    transport.sendMail({ from, to, subject, html, replyTo: process.env.MAIL_REPLY_TO || 'info@tsumiki.de', bcc: process.env.MAIL_BCC || undefined })
      .catch((e) => console.warn('E-Mail an', to, 'nicht verschickt:', e.message));
  };
  return { mode: 'aktiv', send };
}
