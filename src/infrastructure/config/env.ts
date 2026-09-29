import { z } from 'zod'

// Toutes les variables d'environnement sont validées au démarrage : l'API refuse de démarrer
// avec une configuration invalide plutôt que d'échouer plus tard en production.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4100),
  API_URL: z.url().default('http://localhost:4100'),
  WEB_URL: z.url().default('http://localhost:3100'),
  COOKIE_DOMAIN: z.string().optional(),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  GOOGLE_CLIENT_ID: z.string().optional(),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default('Maison Braise <no-reply@maisonbraise.gn>'),
  ADMIN_NOTIFICATION_EMAIL: z.email().default('contact@maisonbraise.gn'),

  UPLOAD_DIR: z.string().default('uploads'),

  OM_CLIENT_ID: z.string().optional(),
  OM_CLIENT_SECRET: z.string().optional(),
  OM_MERCHANT_KEY: z.string().optional(),
  OM_API_URL: z.url().default('https://api.orange.com'),
  // Chemin de l'API Web Payment pour la Guinée (« dev » en bac à sable)
  OM_WEBPAY_PATH: z.string().default('/orange-money-webpay/gn/v1'),
  // « OUV » en bac à sable, « GNF » en production
  OM_CURRENCY: z.string().default('GNF'),
  OM_WEBHOOK_SECRET: z.string().optional(),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_API_URL: z.url().default('https://api-m.sandbox.paypal.com'),
  PAYPAL_WEBHOOK_ID: z.string().optional(),
  PAYPAL_CURRENCY: z.string().length(3).default('EUR'),
  PAYPAL_GNF_RATE: z.coerce.number().positive().default(9500),

  TURN_URL: z.string().optional(),
  TURN_USERNAME: z.string().optional(),
  TURN_CREDENTIAL: z.string().optional(),

  REVALIDATE_SECRET: z.string().min(16).optional(),

  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
})

export type Env = z.infer<typeof envSchema>

export function validateEnv(raw: Record<string, unknown>): Env {
  // Les chaînes vides du .env sont traitées comme absentes.
  const cleaned = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== ''))
  const result = envSchema.safeParse(cleaned)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    throw new Error(`Configuration invalide :\n${issues.join('\n')}`)
  }
  return result.data
}
