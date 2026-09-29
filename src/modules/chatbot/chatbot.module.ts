import { Body, Controller, Get, HttpCode, Injectable, Logger, Module, Post } from '@nestjs/common'
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, Length, ValidateNested } from 'class-validator'
import { AppConfig } from '../../infrastructure/config/app-config.service'
import { PrismaService } from '../../infrastructure/prisma/prisma.service'
import { Public } from '../../shared/auth/decorators'
import { ContentModule } from '../content/content.module'
import { ContentService } from '../content/application/content.service'

class HistoryEntryDto {
  @ApiProperty({ enum: ['user', 'assistant'] }) @IsIn(['user', 'assistant']) role!: 'user' | 'assistant'
  @ApiProperty() @IsString() @Length(1, 2000) content!: string
}

class ChatMessageDto {
  @ApiProperty() @IsString() @Length(1, 1000) message!: string
  @ApiPropertyOptional({ type: [HistoryEntryDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => HistoryEntryDto)
  history?: HistoryEntryDto[]
}

export interface ChatReply {
  text: string
  suggestions: string[]
  dishes?: Array<{ name: string; slug: string; price: number }>
}

const normalize = (t: string) =>
  t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
const gnf = (n: number) => `${new Intl.NumberFormat('fr-FR').format(n)} GNF`
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']

/**
 * Assistant culinaire : moteur de règles (toujours disponible) enrichi par Gemini
 * lorsque GEMINI_API_KEY est configurée. Les prix et plats viennent toujours de la base.
 */
@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly content: ContentService,
    private readonly config: AppConfig,
  ) {}

  welcome(): ChatReply {
    return {
      text:
        'Bonjour ! Je suis l’assistant de Maison Braise. Je peux vous conseiller un plat, ' +
        'vous donner nos prix et horaires, ou vous aider à réserver.',
      suggestions: ['Vos plats signatures', 'Voir la carte', 'Horaires', 'Réserver une table'],
    }
  }

  async reply(message: string, history: HistoryEntryDto[] = []): Promise<ChatReply> {
    if (this.config.get('GEMINI_API_KEY')) {
      const ai = await this.gemini(message, history).catch((e: unknown) => {
        this.logger.warn(`Gemini indisponible : ${String(e)}`)
        return null
      })
      if (ai) return ai
    }
    return this.rules(message)
  }

  private async rules(message: string): Promise<ChatReply> {
    const text = normalize(message)
    const has = (...words: string[]) => words.some((w) => text.includes(w))

    if (has('merci', 'thank')) {
      return { text: 'Avec plaisir ! Autre chose pour vous ?', suggestions: ['Voir la carte', 'Réserver une table'] }
    }
    if (has('au revoir', 'bye', 'a bientot')) {
      return { text: 'Au revoir et à bientôt chez Maison Braise !', suggestions: [] }
    }
    if (has('horaire', 'ouvert', 'ferme', 'heure')) {
      const { hours } = await this.content.openingHours()
      const lines = hours.map((h) => `• ${DAYS[h.dayOfWeek]} : ${h.isClosed ? 'fermé' : `${h.opensAt} – ${h.closesAt}`}`)
      return { text: `Nos horaires :\n${lines.join('\n')}`, suggestions: ['Réserver une table', 'Adresse'] }
    }
    if (has('adresse', 'ou etes', 'situe', 'localisation', 'trouver')) {
      const { restaurant } = await this.content.publicSettings()
      return {
        text: `Nous sommes à ${restaurant.address}, ${restaurant.city}. Téléphone : ${restaurant.phone}.`,
        suggestions: ['Horaires', 'Réserver une table'],
      }
    }
    if (has('reserv', 'table', 'place')) {
      return {
        text: 'Vous pouvez réserver en ligne : choisissez la date, l’heure et le nombre de couverts, la confirmation arrive par e-mail.',
        suggestions: ['Réserver une table', 'Horaires'],
      }
    }
    if (has('livr', 'emporter', 'commander', 'delai')) {
      return {
        text: 'Commandez en ligne en livraison (standard 3 000 GNF, express 5 000 GNF) ou à emporter. Paiement par Orange Money, carte ou PayPal.',
        suggestions: ['Voir la carte', 'Vos plats signatures'],
      }
    }
    if (has('prix', 'cout', 'combien', 'tarif', 'cher', 'budget')) {
      const agg = await this.prisma.dish.aggregate({
        where: { deletedAt: null, isAvailable: true },
        _min: { price: true },
        _max: { price: true },
      })
      return {
        text: `Nos plats vont de ${gnf(agg._min.price ?? 0)} à ${gnf(agg._max.price ?? 0)}.`,
        suggestions: ['Voir la carte', 'Vos plats signatures'],
      }
    }

    const dishes = await this.prisma.dish.findMany({
      where: { deletedAt: null, isAvailable: true },
      select: { name: true, slug: true, price: true, description: true, tags: true, category: { select: { name: true, slug: true } } },
    })
    const matches = dishes.filter(
      (d) =>
        text.includes(normalize(d.name)) ||
        normalize(d.category.name).split(/\s+/).some((w) => w.length > 3 && text.includes(w)) ||
        (has('vegetarien', 'vegetarian') && d.tags.includes('vegetarian')) ||
        (has('epice', 'piment', 'spicy') && d.tags.includes('spicy')),
    )
    const picks = (matches.length > 0 ? matches : dishes.filter((d) => d.tags.includes('signature'))).slice(0, 3)
    if (picks.length > 0 && (matches.length > 0 || has('recommand', 'conseil', 'signature', 'populaire', 'meilleur', 'quoi', 'faim'))) {
      return {
        text: `${matches.length > 0 ? 'Voici ce que je vous propose' : 'Nos plats signatures'} :\n${picks
          .map((d) => `• ${d.name} — ${gnf(d.price)}`)
          .join('\n')}`,
        suggestions: ['Voir la carte', 'Réserver une table'],
        dishes: picks.map((d) => ({ name: d.name, slug: d.slug, price: d.price })),
      }
    }
    if (has('carte', 'menu', 'plats', 'categorie')) {
      const categories = await this.prisma.category.findMany({ where: { isVisible: true }, orderBy: { position: 'asc' } })
      return {
        text: `Notre carte : ${categories.map((c) => c.name).join(', ')}. Que souhaitez-vous découvrir ?`,
        suggestions: categories.slice(0, 4).map((c) => c.name),
      }
    }
    return this.welcome()
  }

  private async gemini(message: string, history: HistoryEntryDto[]): Promise<ChatReply | null> {
    const [dishes, { restaurant }, { hours }] = await Promise.all([
      this.prisma.dish.findMany({
        where: { deletedAt: null, isAvailable: true },
        select: { name: true, slug: true, price: true, description: true, prepTimeMinutes: true },
        take: 60,
      }),
      this.content.publicSettings(),
      this.content.openingHours(),
    ])
    const system = [
      `Tu es l'assistant du restaurant ${restaurant.name} (${restaurant.city}, Guinée).`,
      'Réponds en français, chaleureusement, en 2 à 4 phrases, sans inventer de plat ni de prix.',
      'Propose à la fin une action concrète : voir la carte, commander ou réserver.',
      `Adresse : ${restaurant.address}, ${restaurant.city}. Téléphone : ${restaurant.phone}.`,
      `Horaires : ${hours.map((h) => `${DAYS[h.dayOfWeek]} ${h.isClosed ? 'fermé' : `${h.opensAt}-${h.closesAt}`}`).join(' ; ')}.`,
      'Livraison standard 3 000 GNF, express 5 000 GNF. Paiement : Orange Money, carte, PayPal.',
      `Carte (prix en GNF) :\n${dishes.map((d) => `- ${d.name} : ${d.price} GNF, ${d.prepTimeMinutes} min. ${d.description}`).join('\n')}`,
    ].join('\n')

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.config.get('GEMINI_MODEL')}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.config.get('GEMINI_API_KEY')! },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [
            ...history.map((h) => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.content }] })),
            { role: 'user', parts: [{ text: message }] },
          ],
          generationConfig: { maxOutputTokens: 400, temperature: 0.6 },
        }),
        signal: AbortSignal.timeout(10_000),
      },
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim()
    if (!text) return null

    const mentioned = dishes.filter((d) => normalize(text).includes(normalize(d.name))).slice(0, 3)
    return {
      text,
      suggestions: ['Voir la carte', 'Réserver une table'],
      dishes: mentioned.map((d) => ({ name: d.name, slug: d.slug, price: d.price })),
    }
  }
}

@ApiTags('chatbot')
@Public()
@Controller('chat')
export class ChatbotController {
  constructor(private readonly chatbot: ChatbotService) {}

  @Get('welcome')
  welcome() {
    return this.chatbot.welcome()
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('message')
  message(@Body() dto: ChatMessageDto) {
    return this.chatbot.reply(dto.message, dto.history)
  }
}

@Module({ imports: [ContentModule], controllers: [ChatbotController], providers: [ChatbotService] })
export class ChatbotModule {}
