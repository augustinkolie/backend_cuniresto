import { z } from 'zod'

// Paramètres modifiables depuis l'administration, validés à l'écriture.
export const settingSchemas = {
  restaurant: z.object({
    name: z.string().min(2).max(80),
    tagline: z.string().max(160),
    phone: z.string().max(30),
    whatsapp: z.string().max(30).optional(),
    email: z.email(),
    address: z.string().max(200),
    city: z.string().max(80),
    mapUrl: z.url().optional(),
    socials: z
      .object({
        facebook: z.url().optional(),
        instagram: z.url().optional(),
        tiktok: z.url().optional(),
      })
      .default({}),
  }),
  reservations: z.object({
    capacityPerSlot: z.number().int().min(1).max(500),
    minNoticeMinutes: z.number().int().min(0).max(24 * 60),
    maxDaysAhead: z.number().int().min(1).max(365),
    lastSeatingBeforeCloseMinutes: z.number().int().min(0).max(240),
  }),
} as const

export type SettingKey = keyof typeof settingSchemas

export const DEFAULT_SETTINGS: { [K in SettingKey]: z.infer<(typeof settingSchemas)[K]> } = {
  restaurant: {
    name: 'Maison Braise',
    tagline: 'Le lapin braisé et la cuisine guinéenne au feu de bois',
    phone: '+224 620 00 00 00',
    whatsapp: '+224 620 00 00 00',
    email: 'contact@maisonbraise.gn',
    address: 'Kaloum, avenue de la République',
    city: 'Conakry',
    socials: {},
  },
  reservations: {
    capacityPerSlot: 40,
    minNoticeMinutes: 60,
    maxDaysAhead: 60,
    lastSeatingBeforeCloseMinutes: 60,
  },
}

/** Blocs de texte éditables (accueil, à propos…). */
export const CONTENT_KEYS = ['home', 'about', 'chef', 'contact', 'reservation', 'terms', 'privacy', 'help'] as const
export type ContentKey = (typeof CONTENT_KEYS)[number]
