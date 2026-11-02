import nodemailer from "nodemailer";
import { env } from "../config/env";
import { logger } from "./logger";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

const transport = env.SMTP_HOST
  ? nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: false })
  : null;

// Development only: there is no real email delivery. Mail goes to the local
// SMTP catcher (Mailpit) when configured, otherwise it is printed to the console.
export const mailer = {
  async send(mail: Mail) {
    if (transport) {
      await transport.sendMail({ from: env.MAIL_FROM, ...mail });
      return;
    }
    if (env.NODE_ENV !== "production") {
      console.log(`\n--- email to ${mail.to} ---\n${mail.subject}\n${mail.text}\n---\n`);
      return;
    }
    logger.error("No mail transport configured");
  },
};
