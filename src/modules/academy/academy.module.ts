import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common'
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter'
import { ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger'
import type { Prisma } from '@prisma/client'
import { Type } from 'class-transformer'
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  Matches,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import { MailService } from '../../infrastructure/mail/mail.service'
import { enrollmentConfirmedMail } from '../../infrastructure/mail/mail-templates'
import { PrismaService } from '../../infrastructure/prisma/prisma.service'
import { RealtimeGateway } from '../../infrastructure/realtime/realtime.gateway'
import { type AuthUser, isStaff } from '../../shared/auth/auth-user'
import { CurrentUser, Public, Roles } from '../../shared/auth/decorators'
import { ForbiddenError, NotFoundError, ValidationError } from '../../shared/domain/domain-error'
import { type EnrollmentPaymentEvent, Events } from '../../shared/events'
import {
  type OnlinePaymentMethod,
  PAYMENT_INITIATOR,
  type PaymentInitiator,
} from '../payments/application/payment-initiator.port'
import { PaymentsModule } from '../payments/payments.module'
import { PHONE_PATTERN } from '../users/presentation/users.dto'

// L'ancien site stockait ressources et état du direct dans le navigateur de l'administrateur :
// ils sont maintenant en base et visibles de tous.

class CourseModuleDto {
  @ApiProperty() @IsString() @Length(1, 120) title!: string
  @ApiProperty() @IsString() @Length(1, 20) duration!: string
}

class CourseDto {
  @ApiProperty() @IsString() @Length(2, 160) title!: string
  @ApiProperty() @IsString() @Length(2, 80) instructor!: string
  @ApiProperty() @IsString() @Length(2, 40) level!: string
  @ApiProperty() @IsString() @Length(2, 40) duration!: string
  @ApiProperty() @IsInt() @Min(0) lessons!: number
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) students?: number
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(5) rating?: number
  @ApiProperty({ description: 'Prix en GNF' }) @IsInt() @Min(0) price!: number
  @ApiProperty() @IsString() @MaxLength(500) imageUrl!: string
  @ApiProperty() @IsString() @Length(2, 60) category!: string
  @ApiProperty() @IsString() @MaxLength(2000) description!: string
  @ApiProperty({ type: [CourseModuleDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CourseModuleDto)
  modules!: CourseModuleDto[]
  @ApiPropertyOptional() @IsOptional() @IsInt() position?: number
  @ApiPropertyOptional({ description: 'Formule donnée au restaurant' }) @IsOptional() @IsBoolean() onSite?: boolean
  @ApiPropertyOptional({ description: 'Formule recommandée' }) @IsOptional() @IsBoolean() featured?: boolean
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) schedule?: string
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) seats?: number
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(160, { each: true })
  perks?: string[]
}

const METHODS = ['ORANGE_MONEY', 'CARD', 'PAYPAL'] as const

class EnrollDto {
  @ApiProperty({ enum: METHODS }) @IsIn(METHODS) paymentMethod!: OnlinePaymentMethod
  @ApiPropertyOptional({ description: 'Numéro Orange Money du payeur' })
  @IsOptional()
  @Matches(PHONE_PATTERN, { message: 'Numéro invalide' })
  phone?: string
}

class UpdateCourseDto extends PartialType(CourseDto) {}

const RESOURCE_TYPES = ['pdf', 'video', 'link', 'image'] as const

class ResourceDto {
  @ApiProperty() @IsString() @Length(2, 160) title!: string
  @ApiProperty() @IsString() @MaxLength(1000) description!: string
  @ApiProperty() @IsString() @MaxLength(500) fileUrl!: string
  @ApiProperty() @IsString() @Length(2, 40) category!: string
  @ApiProperty({ enum: RESOURCE_TYPES }) @IsIn(RESOURCE_TYPES) type!: string
}

class LiveDto {
  @ApiProperty() @IsBoolean() isLive!: boolean
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) title?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) streamUrl?: string
}

@Injectable()
export class AcademyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly mail: MailService,
    @Inject(PAYMENT_INITIATOR) private readonly payments: PaymentInitiator,
    private readonly events: EventEmitter2,
  ) {}

  /** Vide le cache des pages publiques (places restantes, formations). */
  private changed(): void {
    this.events.emit(Events.ContentUpdated)
  }

  /** Formations avec le nombre de places restantes (inscriptions payées déduites). */
  async courses() {
    const [courses, confirmed] = await Promise.all([
      this.prisma.academyCourse.findMany({ orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.courseEnrollment.groupBy({ by: ['courseId'], where: { status: 'CONFIRMED' }, _count: true }),
    ])
    const taken = new Map(confirmed.map((c) => [c.courseId, c._count]))
    return courses.map((c) => ({
      ...c,
      seatsLeft: c.seats === null ? null : Math.max(0, c.seats - (taken.get(c.id) ?? 0)),
    }))
  }

  // ───────── Inscriptions payantes

  async enroll(courseId: string, user: AuthUser, dto: EnrollDto) {
    const course = await this.prisma.academyCourse.findUnique({ where: { id: courseId } })
    if (!course) throw new NotFoundError('Formation')
    if (course.price <= 0) throw new ValidationError('Cette formation n’est pas payante')
    if (dto.paymentMethod === 'ORANGE_MONEY' && !dto.phone) {
      throw new ValidationError('Indiquez votre numéro Orange Money')
    }
    if (course.seats !== null) {
      const taken = await this.prisma.courseEnrollment.count({ where: { courseId, status: 'CONFIRMED' } })
      if (taken >= course.seats) throw new ValidationError('Cette session est complète')
    }
    const account = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { email: true } })
    const enrollment = await this.prisma.courseEnrollment.create({
      data: { courseId, courseTitle: course.title, amount: course.price, userId: user.id, phone: dto.phone },
    })
    const payment = await this.payments.initiateEnrollment({
      enrollmentId: enrollment.id,
      enrollmentNumber: enrollment.number,
      courseTitle: course.title,
      amount: course.price,
      method: dto.paymentMethod,
      payerPhone: dto.phone,
      customerEmail: account.email,
    })
    return { enrollmentId: enrollment.id, ...payment }
  }

  async enrollment(id: string, user: AuthUser) {
    const e = await this.prisma.courseEnrollment.findUnique({
      where: { id },
      include: {
        course: { select: { imageUrl: true, schedule: true, onSite: true, duration: true, instructor: true } },
        payment: { select: { provider: true, status: true, checkoutUrl: true } },
      },
    })
    if (!e) throw new NotFoundError('Inscription')
    if (e.userId !== user.id && !isStaff(user)) throw new ForbiddenError('Accès refusé')
    return {
      ...e,
      payment: e.payment && {
        ...e.payment,
        checkoutUrl: e.payment.status === 'PENDING' ? e.payment.checkoutUrl : null,
      },
    }
  }

  myEnrollments(user: AuthUser) {
    return this.prisma.courseEnrollment.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        course: { select: { imageUrl: true, schedule: true, onSite: true } },
        payment: { select: { provider: true, status: true } },
      },
    })
  }

  allEnrollments() {
    return this.prisma.courseEnrollment.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        user: { select: { firstName: true, lastName: true, email: true, phone: true } },
        payment: { select: { provider: true, status: true } },
      },
    })
  }

  @OnEvent(Events.EnrollmentPaymentSucceeded, { async: true, promisify: true })
  async onPaid({ enrollmentId }: EnrollmentPaymentEvent): Promise<void> {
    const e = await this.prisma.courseEnrollment.update({
      where: { id: enrollmentId },
      data: { status: 'CONFIRMED' },
      include: {
        user: { select: { firstName: true, email: true } },
        course: { select: { schedule: true, onSite: true } },
      },
    })
    await this.mail.send({
      to: e.user.email,
      ...enrollmentConfirmedMail({
        firstName: e.user.firstName,
        number: e.number,
        courseTitle: e.courseTitle,
        amount: e.amount,
        schedule: e.course?.schedule,
        onSite: e.course?.onSite ?? false,
      }),
    })
    this.realtime.toStaff('enrollment:paid', { id: e.id, courseTitle: e.courseTitle })
    this.changed()
  }

  @OnEvent(Events.EnrollmentPaymentFailed, { async: true, promisify: true })
  async onPaymentFailed({ enrollmentId }: EnrollmentPaymentEvent): Promise<void> {
    await this.prisma.courseEnrollment.updateMany({
      where: { id: enrollmentId, status: 'PENDING_PAYMENT' },
      data: { status: 'CANCELLED' },
    })
  }

  async createCourse(dto: CourseDto) {
    const course = await this.prisma.academyCourse.create({
      data: { ...dto, modules: dto.modules as unknown as Prisma.InputJsonValue, perks: dto.perks ?? [] },
    })
    this.changed()
    return course
  }

  async updateCourse(id: string, dto: UpdateCourseDto) {
    const course = await this.prisma.academyCourse.update({
      where: { id },
      data: { ...dto, modules: dto.modules as unknown as Prisma.InputJsonValue | undefined, perks: dto.perks },
    })
    this.changed()
    return course
  }

  async deleteCourse(id: string): Promise<void> {
    await this.prisma.academyCourse.delete({ where: { id } })
    this.changed()
  }

  resources() {
    return this.prisma.academyResource.findMany({ orderBy: { createdAt: 'desc' } })
  }

  createResource(dto: ResourceDto) {
    return this.prisma.academyResource.create({ data: dto })
  }

  async deleteResource(id: string): Promise<void> {
    await this.prisma.academyResource.delete({ where: { id } })
  }

  live() {
    return this.prisma.liveSession.upsert({ where: { id: 'studio' }, create: {}, update: {} })
  }

  async setLive(dto: LiveDto) {
    const current = await this.live()
    const live = await this.prisma.liveSession.update({
      where: { id: 'studio' },
      data: {
        ...dto,
        startedAt: dto.isLive ? (current.isLive ? current.startedAt : new Date()) : null,
      },
    })
    this.realtime.server.emit('studio:live', live)
    return live
  }
}

const uuid = new ParseUUIDPipe({ version: '4' })

@ApiTags('academy')
@Controller()
export class AcademyController {
  constructor(private readonly academy: AcademyService) {}

  @Public() @Get('academy/courses') courses() { return this.academy.courses() }
  @Public() @Get('academy/resources') resources() { return this.academy.resources() }
  @Public() @Get('academy/live') live() { return this.academy.live() }

  @Post('academy/courses/:id/enroll')
  enroll(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Body() dto: EnrollDto) {
    return this.academy.enroll(id, user, dto)
  }

  @Get('academy/enrollments/me')
  myEnrollments(@CurrentUser() user: AuthUser) { return this.academy.myEnrollments(user) }

  @Get('academy/enrollments/:id')
  enrollment(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) { return this.academy.enrollment(id, user) }

  @Roles('MANAGER') @Get('admin/academy/enrollments')
  allEnrollments() { return this.academy.allEnrollments() }

  @Roles('MANAGER') @Post('admin/academy/courses')
  createCourse(@Body() dto: CourseDto) { return this.academy.createCourse(dto) }

  @Roles('MANAGER') @Patch('admin/academy/courses/:id')
  updateCourse(@Param('id', uuid) id: string, @Body() dto: UpdateCourseDto) { return this.academy.updateCourse(id, dto) }

  @Roles('MANAGER') @Delete('admin/academy/courses/:id') @HttpCode(204)
  deleteCourse(@Param('id', uuid) id: string) { return this.academy.deleteCourse(id) }

  @Roles('MANAGER') @Post('admin/academy/resources')
  createResource(@Body() dto: ResourceDto) { return this.academy.createResource(dto) }

  @Roles('MANAGER') @Delete('admin/academy/resources/:id') @HttpCode(204)
  deleteResource(@Param('id', uuid) id: string) { return this.academy.deleteResource(id) }

  @Roles('MANAGER') @Put('admin/academy/live')
  setLive(@Body() dto: LiveDto) { return this.academy.setLive(dto) }
}

@Module({ imports: [PaymentsModule], controllers: [AcademyController], providers: [AcademyService] })
export class AcademyModule {}
