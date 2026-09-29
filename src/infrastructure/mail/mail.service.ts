import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq'
import { Injectable, Logger } from '@nestjs/common'
import type { Job, Queue } from 'bullmq'
import nodemailer, { type Transporter } from 'nodemailer'
import { AppConfig } from '../config/app-config.service'

export const MAIL_QUEUE = 'mail'

export interface MailJob {
  to: string
  subject: string
  html: string
}

/** Point d'entrée des modules : l'envoi passe par une file BullMQ avec relances automatiques. */
@Injectable()
export class MailService {
  constructor(@InjectQueue(MAIL_QUEUE) private readonly queue: Queue<MailJob>) {}

  async send(mail: MailJob): Promise<void> {
    await this.queue.add('send', mail, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: true,
      removeOnFail: 100,
    })
  }
}

@Processor(MAIL_QUEUE)
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name)
  private readonly transporter: Transporter

  constructor(private readonly config: AppConfig) {
    super()
    const user = config.get('SMTP_USER')
    this.transporter = nodemailer.createTransport({
      host: config.get('SMTP_HOST'),
      port: config.get('SMTP_PORT'),
      secure: config.get('SMTP_PORT') === 465,
      auth: user ? { user, pass: config.get('SMTP_PASSWORD') } : undefined,
    })
  }

  async process(job: Job<MailJob>): Promise<void> {
    await this.transporter.sendMail({ from: this.config.get('MAIL_FROM'), ...job.data })
    this.logger.log(`E-mail « ${job.data.subject} » envoyé`)
  }
}
