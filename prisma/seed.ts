// Données initiales : carte reprise de l'ancien site, tables, horaires, récompenses,
// académie et comptes du personnel. Idempotent : peut être relancé sans doublons.
import { PrismaClient, type Role } from '@prisma/client'
import * as argon2 from 'argon2'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const prisma = new PrismaClient()

const read = <T>(file: string): T => JSON.parse(readFileSync(join(__dirname, 'seed-data', file), 'utf8')) as T

interface LegacyDish {
  name: string
  category: string
  price: number
  image: string
  description: string
  prepTime?: string
  featured?: boolean
  chefVideo?: string
  allergens?: string[]
}

const CATEGORIES = [
  { slug: 'lapin', name: 'Lapin braisé', description: 'Notre spécialité, cuite lentement sur la braise.' },
  { slug: 'atieke', name: 'Atiéké', description: 'Semoule de manioc et ses accompagnements.' },
  { slug: 'spaghetti', name: 'Nouilles & spaghetti', description: 'Pâtes sautées à la façon de la maison.' },
  { slug: 'sandwichs', name: 'Sandwichs', description: 'Pain croustillant, garnitures généreuses.' },
  { slug: 'boissons', name: 'Boissons', description: 'Jus frais, bissap, gingembre et boissons chaudes.' },
  { slug: 'desserts', name: 'Desserts', description: 'Douceurs maison pour finir en beauté.' },
]

const slugify = (v: string) =>
  v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const referralCode = (name: string) =>
  `${(name[0] ?? 'M').toUpperCase()}${randomBytes(4).toString('hex').slice(0, 6).toUpperCase()}`

async function seedMenu(): Promise<void> {
  for (const [position, c] of CATEGORIES.entries()) {
    await prisma.category.upsert({ where: { slug: c.slug }, create: { ...c, position }, update: {} })
  }
  const categories = await prisma.category.findMany()
  const bySlug = new Map(categories.map((c) => [c.slug, c.id]))
  const used = new Set<string>()

  // L'ancien site référençait des photos de nouilles inexistantes : images provisoires.
  const fallback = ['/images/products/p1.jpg', '/images/products/p2.jpg', '/images/products/p3.jpg', '/images/products/p4.jpg', '/images/products/p5.jpg']
  let fallbackIndex = 0
  // L'ancien site avait deux plats en double : on leur donne un nom distinct.
  const renames: Record<string, string> = { 'Atiéké Traditionnel': 'Atiéké Maison', 'Atiéké Garni': 'Atiéké Royal' }
  const seenNames = new Set<string>()
  for (const d of read<LegacyDish[]>('dishes.json')) {
    if (seenNames.has(d.name) && renames[d.name]) d.name = renames[d.name]!
    seenNames.add(d.name)
    if (d.image.startsWith('/images/spaghetti/')) d.image = fallback[fallbackIndex++ % fallback.length]!
    let slug = slugify(d.name)
    for (let i = 2; used.has(slug); i++) slug = `${slugify(d.name)}-${i}`
    used.add(slug)
    const categoryId = bySlug.get(d.category)
    if (!categoryId) continue
    const tags = [
      ...(d.featured ? ['signature'] : []),
      ...(['boissons', 'desserts'].includes(d.category) ? ['vegetarian'] : []),
      ...(/piment|épic|pimenté/i.test(`${d.name} ${d.description}`) ? ['spicy'] : []),
    ]
    await prisma.dish.upsert({
      where: { slug },
      create: {
        slug,
        name: d.name,
        description: d.description,
        price: d.price,
        imageUrl: d.image,
        imageAlt: `${d.name} — ${d.description}`.slice(0, 200),
        categoryId,
        prepTimeMinutes: Number.parseInt(d.prepTime ?? '15', 10) || 15,
        isFeatured: !!d.featured,
        tags,
        allergens: d.allergens ?? [],
        chefVideoUrl: d.chefVideo,
      },
      update: {},
    })
  }
}

async function seedTables(): Promise<void> {
  const zones = ['INDOOR', 'INDOOR', 'INDOOR', 'INDOOR', 'INDOOR', 'INDOOR', 'OUTDOOR', 'OUTDOOR', 'OUTDOOR', 'VIP'] as const
  for (let n = 1; n <= 10; n++) {
    await prisma.table.upsert({
      where: { number: n },
      create: {
        number: n,
        capacity: n === 10 ? 8 : n % 3 === 0 ? 6 : n % 2 === 0 ? 4 : 2,
        zone: zones[n - 1],
        qrToken: randomBytes(16).toString('base64url'),
      },
      update: {},
    })
  }
}

async function seedHours(): Promise<void> {
  for (let day = 0; day <= 6; day++) {
    const weekend = day === 0 || day === 6
    await prisma.openingHours.upsert({
      where: { dayOfWeek: day },
      create: { dayOfWeek: day, opensAt: weekend ? '10:00' : '11:00', closesAt: weekend ? '23:00' : '22:00' },
      update: {},
    })
  }
}

async function seedRewards(): Promise<void> {
  if ((await prisma.reward.count()) > 0) return
  await prisma.reward.createMany({
    data: [
      { name: 'Boisson offerte', description: 'Un jus frais ou un bissap au choix.', pointsCost: 150, type: 'FREE_ITEM', value: 5000, category: 'DRINK' },
      { name: 'Dessert offert', description: 'Le dessert du jour offert avec votre commande.', pointsCost: 250, type: 'FREE_ITEM', value: 8000, category: 'FOOD' },
      { name: '10 % de réduction', description: 'Sur votre prochaine commande.', pointsCost: 300, type: 'DISCOUNT', value: 10, valueType: 'PERCENTAGE', category: 'DISCOUNT', minLevel: 'SILVER' },
      { name: 'Bon de 20 000 GNF', description: 'À valoir sur une commande ou au restaurant.', pointsCost: 1500, type: 'VOUCHER', value: 20000, category: 'SPECIAL', minLevel: 'GOLD' },
      { name: 'Lapin braisé offert', description: 'Notre plat signature, offert.', pointsCost: 1200, type: 'FREE_ITEM', value: 15000, category: 'FOOD', minLevel: 'SILVER' },
    ],
  })
}

async function seedAcademy(): Promise<void> {
  // Trois formules de cuisine africaine données au restaurant (payables en ligne).
  if ((await prisma.academyCourse.count({ where: { onSite: true } })) === 0) {
    const photo = (id: string) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1200&q=80`
    const common = { onSite: true, category: 'Cours au restaurant', instructor: 'Le chef et la brigade Maison Braise', students: 0, rating: 0 }
    await prisma.academyCourse.createMany({
      data: [
        {
          ...common,
          position: -3,
          title: 'Découverte — Initiation à la cuisine guinéenne',
          level: 'Débutant',
          duration: '1 séance de 3 h',
          lessons: 1,
          price: 75_000,
          seats: 12,
          schedule: 'Samedi 9 h – 12 h, au restaurant',
          imageUrl: photo('1566554273541-37a9ca77b91f'),
          description: 'Une matinée en cuisine pour découvrir les épices et les bases de la cuisine guinéenne, puis déguster ensemble ce que vous avez préparé.',
          perks: ['Tous les ingrédients fournis', 'Tablier Maison Braise offert', 'Dégustation de vos plats sur place', 'Fiches recettes à emporter'],
          modules: [
            { title: 'Les épices et les bases de la cuisine guinéenne', duration: '45 min' },
            { title: 'Riz gras pas à pas', duration: '1 h' },
            { title: 'Sauce arachide', duration: '45 min' },
            { title: 'Dégustation commentée', duration: '30 min' },
          ],
        },
        {
          ...common,
          position: -2,
          featured: true,
          title: 'Essentiel — Les grands classiques africains',
          level: 'Intermédiaire',
          duration: '4 séances de 4 h',
          lessons: 4,
          price: 280_000,
          seats: 10,
          schedule: '4 samedis de suite, 9 h – 13 h, au restaurant',
          imageUrl: photo('1565608087341-404b25492fee'),
          description: 'Quatre samedis pour maîtriser les plats qui font la réputation de la maison : lapin braisé, atiéké, sauces et street food d’Afrique de l’Ouest.',
          perks: ['Tous les ingrédients fournis', 'Tablier Maison Braise offert', 'Repas partagé à chaque séance', 'Carnet de 20 recettes de la maison'],
          modules: [
            { title: 'Lapin braisé mariné une nuit', duration: '4 h' },
            { title: 'Atiéké et poisson braisé', duration: '4 h' },
            { title: 'Sauce feuille et mafé', duration: '4 h' },
            { title: 'Fataya, alloco et street food', duration: '4 h' },
          ],
        },
        {
          ...common,
          position: -1,
          title: 'Maître du feu — Formation complète braise & cuisine africaine',
          level: 'Avancé',
          duration: '8 séances sur 4 semaines',
          lessons: 8,
          price: 650_000,
          seats: 6,
          schedule: 'Mardis et jeudis, 14 h – 18 h, en cuisine avec la brigade',
          imageUrl: photo('1687422808277-2334638f09fb'),
          description: 'La formation complète, en petit groupe et aux côtés de notre brigade : feu, marinades, découpe, cuissons, dressage, jusqu’au service d’un plat en salle.',
          perks: [
            'Travail en cuisine avec la brigade',
            'Une soirée de service au restaurant',
            'Tablier et couteau de chef offerts',
            'Suivi personnalisé par le chef',
          ],
          modules: [
            { title: 'Maîtriser le feu et le charbon', duration: '4 h' },
            { title: 'Marinades et épices d’Afrique de l’Ouest', duration: '4 h' },
            { title: 'Découpe et préparation du lapin', duration: '4 h' },
            { title: 'Grillades, braisés et sauces', duration: '8 h' },
            { title: 'Dressage et service en salle', duration: '8 h' },
          ],
        },
      ],
    })
  }
  if ((await prisma.academyResource.count()) === 0) {
    await prisma.academyResource.create({
      data: {
        title: 'Guide des épices africaines',
        description: 'Un guide complet sur l’utilisation des épices locales.',
        fileUrl: '/images/academy/guide-epices.pdf',
        category: 'guide',
        type: 'pdf',
      },
    })
  }
  await prisma.liveSession.upsert({ where: { id: 'studio' }, create: {}, update: {} })
}

async function seedUsers(): Promise<void> {
  const password = process.env.SEED_PASSWORD ?? randomBytes(9).toString('base64url')
  const hash = await argon2.hash(password, { type: argon2.argon2id })
  const staff: Array<{ email: string; firstName: string; lastName: string; role: Role }> = [
    { email: process.env.SEED_ADMIN_EMAIL ?? 'admin@maisonbraise.gn', firstName: 'Admin', lastName: 'Maison Braise', role: 'ADMIN' },
    ...(process.env.NODE_ENV === 'production'
      ? []
      : [
          { email: 'manager@maisonbraise.gn', firstName: 'Mariama', lastName: 'Camara', role: 'MANAGER' as Role },
          { email: 'cuisine@maisonbraise.gn', firstName: 'Ibrahima', lastName: 'Sow', role: 'KITCHEN' as Role },
          { email: 'serveur@maisonbraise.gn', firstName: 'Fatoumata', lastName: 'Bah', role: 'WAITER' as Role },
          { email: 'livreur@maisonbraise.gn', firstName: 'Mamadou', lastName: 'Diallo', role: 'DRIVER' as Role },
          { email: 'client@maisonbraise.gn', firstName: 'Aïssatou', lastName: 'Barry', role: 'CUSTOMER' as Role },
        ]),
  ]
  const created: string[] = []
  for (const s of staff) {
    const exists = await prisma.user.findUnique({ where: { email: s.email } })
    if (exists) continue
    const user = await prisma.user.create({
      data: { ...s, passwordHash: hash, referralCode: referralCode(s.firstName), phone: '+224 620 00 00 00' },
    })
    await prisma.loyaltyAccount.create({ data: { userId: user.id } })
    created.push(`${s.role.padEnd(8)} ${s.email}`)
  }
  if (created.length > 0) {
    console.log(`\nComptes créés (mot de passe : ${password}) :\n  ${created.join('\n  ')}\n`)
  }
}

async function main(): Promise<void> {
  await seedMenu()
  await seedTables()
  await seedHours()
  await seedRewards()
  await seedAcademy()
  await seedUsers()
  const [dishes, tables] = await Promise.all([prisma.dish.count(), prisma.table.count()])
  console.log(`Base prête : ${dishes} plats, ${tables} tables.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => void prisma.$disconnect())
