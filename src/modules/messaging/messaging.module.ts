import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common'
import { FilesInterceptor } from '@nestjs/platform-express'
import { ApiConsumes, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator'
import { type AuthedSocket, RealtimeGateway } from '../../infrastructure/realtime/realtime.gateway'
import type { AuthUser } from '../../shared/auth/auth-user'
import { CurrentUser } from '../../shared/auth/decorators'
import { CursorQueryDto } from '../../shared/http/pagination'
import { memoryUpload } from '../../shared/http/upload'
import { MessagingService } from './messaging.service'

// Durées proposées pour les messages éphémères : désactivé, 24 h, 7 jours, 90 jours.
const DISAPPEARING = [0, 86_400, 604_800, 7_776_000]

class OpenDirectDto {
  @ApiProperty() @IsUUID() participantId!: string
}

class CreateGroupDto {
  @ApiProperty() @IsString() @Length(1, 80) name!: string
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(99) @IsUUID('4', { each: true }) participantIds!: string[]
}

class UpdateConversationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 80) name?: string
  @ApiPropertyOptional({ enum: DISAPPEARING }) @IsOptional() @IsInt() @IsIn(DISAPPEARING) disappearingSeconds?: number
}

class AddMembersDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @IsUUID('4', { each: true }) userIds!: string[]
}

class SendMessageDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) content?: string
  @ApiPropertyOptional() @IsOptional() @IsUUID() replyToId?: string
}

class ReactionDto {
  @ApiProperty() @IsString() @Length(1, 16) emoji!: string
}

const uuid = new ParseUUIDPipe({ version: '4' })

@ApiTags('messaging')
@Controller()
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Get('conversations')
  list(@CurrentUser() user: AuthUser) {
    return this.messaging.conversations(user.id)
  }

  @Post('conversations')
  open(@CurrentUser() user: AuthUser, @Body() dto: OpenDirectDto) {
    return this.messaging.openDirect(user.id, dto.participantId)
  }

  @Post('conversations/group')
  group(@CurrentUser() user: AuthUser, @Body() dto: CreateGroupDto) {
    return this.messaging.createGroup(user.id, dto.name, dto.participantIds)
  }

  @Get('conversations/:id')
  one(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.messaging.conversation(id, user.id)
  }

  @Patch('conversations/:id')
  update(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Body() dto: UpdateConversationDto) {
    return this.messaging.update(id, user.id, dto)
  }

  @Post('conversations/:id/members')
  addMembers(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Body() dto: AddMembersDto) {
    return this.messaging.addMembers(id, user.id, dto.userIds)
  }

  @Delete('conversations/:id/members/:userId')
  @HttpCode(204)
  removeMember(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Param('userId', uuid) target: string,
  ) {
    return this.messaging.removeMember(id, user.id, target)
  }

  @Get('conversations/:id/messages')
  messages(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Query() q: CursorQueryDto) {
    return this.messaging.messages(id, user.id, q)
  }

  @Post('conversations/:id/messages')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('attachments', 10, memoryUpload))
  send(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body() dto: SendMessageDto,
    @UploadedFiles() files: Express.Multer.File[] = [],
  ) {
    return this.messaging.send(id, user.id, dto, files)
  }

  @Post('conversations/:id/read')
  @HttpCode(204)
  read(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.messaging.markRead(id, user.id)
  }

  @Get('messages/starred')
  starred(@CurrentUser() user: AuthUser) {
    return this.messaging.starred(user.id)
  }

  @Delete('messages/:id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.messaging.deleteMessage(id, user.id)
  }

  @Put('messages/:id/reaction')
  react(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Body() dto: ReactionDto) {
    return this.messaging.react(id, user.id, dto.emoji)
  }

  @Put('messages/:id/star')
  star(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.messaging.toggleStar(id, user.id)
  }
}

/** Indicateur « en train d'écrire », relayé uniquement aux membres de la conversation. */
@WebSocketGateway({ path: '/socket.io', cors: { origin: true, credentials: true } })
export class MessagingGateway {
  constructor(
    private readonly messaging: MessagingService,
    private readonly realtime: RealtimeGateway,
  ) {}

  @SubscribeMessage('typing')
  async typing(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: { conversationId?: string; isTyping?: boolean },
  ) {
    const user = socket.data.user
    if (!user || typeof body?.conversationId !== 'string') return
    try {
      await this.messaging.membership(body.conversationId, user.id)
    } catch {
      return
    }
    for (const id of await this.messaging.memberIds(body.conversationId)) {
      if (id !== user.id) {
        this.realtime.toUser(id, 'typing', {
          conversationId: body.conversationId,
          userId: user.id,
          isTyping: !!body.isTyping,
        })
      }
    }
  }
}

@Module({
  controllers: [MessagingController],
  providers: [MessagingService, MessagingGateway],
  exports: [MessagingService],
})
export class MessagingModule {}
