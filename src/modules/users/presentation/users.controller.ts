import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiConsumes, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../../shared/auth/auth-user'
import { CurrentUser, Roles } from '../../../shared/auth/decorators'
import { memoryUpload, requireFile } from '../../../shared/http/upload'
import { UsersService } from '../application/users.service'
import {
  AddressDto,
  SearchUsersQuery,
  SetActiveDto,
  UpdateProfileDto,
  UpdateRoleDto,
} from './users.dto'

const uuid = new ParseUUIDPipe({ version: '4' })

@ApiTags('me')
@Controller('me')
export class MeController {
  constructor(private readonly users: UsersService) {}

  @Patch()
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(user.id, dto)
  }

  @Delete()
  @HttpCode(204)
  deleteAccount(@CurrentUser() user: AuthUser) {
    return this.users.deleteAccount(user.id)
  }

  @Post('avatar')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', memoryUpload))
  avatar(@CurrentUser() user: AuthUser, @UploadedFile() file?: Express.Multer.File) {
    return this.users.setImage(user.id, 'avatarUrl', requireFile(file))
  }

  @Post('cover')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', memoryUpload))
  cover(@CurrentUser() user: AuthUser, @UploadedFile() file?: Express.Multer.File) {
    return this.users.setImage(user.id, 'coverUrl', requireFile(file))
  }

  @Get('addresses')
  addresses(@CurrentUser() user: AuthUser) {
    return this.users.listAddresses(user.id)
  }

  @Post('addresses')
  createAddress(@CurrentUser() user: AuthUser, @Body() dto: AddressDto) {
    return this.users.createAddress(user.id, dto)
  }

  @Put('addresses/:id')
  updateAddress(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Body() dto: AddressDto) {
    return this.users.updateAddress(user.id, id, dto)
  }

  @Delete('addresses/:id')
  @HttpCode(204)
  deleteAddress(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.users.deleteAddress(user.id, id)
  }

  @Get('favorites')
  favorites(@CurrentUser() user: AuthUser) {
    return this.users.favoriteDishes(user.id)
  }

  @Post('favorites/:dishId')
  toggleFavorite(@CurrentUser() user: AuthUser, @Param('dishId', uuid) dishId: string) {
    return this.users.toggleFavoriteDish(user.id, dishId)
  }

  @Get('blocked')
  blocked(@CurrentUser() user: AuthUser) {
    return this.users.blocked(user.id)
  }

  @Post('blocked/:userId')
  @HttpCode(204)
  block(@CurrentUser() user: AuthUser, @Param('userId', uuid) target: string) {
    return this.users.block(user.id, target)
  }

  @Delete('blocked/:userId')
  @HttpCode(204)
  unblock(@CurrentUser() user: AuthUser, @Param('userId', uuid) target: string) {
    return this.users.unblock(user.id, target)
  }

  @Get('contacts')
  contacts(@CurrentUser() user: AuthUser, @Query() query: SearchUsersQuery) {
    return this.users.searchContacts(user.id, query.q)
  }

  @Get('favorite-contacts')
  favoriteContacts(@CurrentUser() user: AuthUser) {
    return this.users.favoriteContacts(user.id)
  }

  @Post('favorite-contacts/:userId')
  toggleFavoriteContact(@CurrentUser() user: AuthUser, @Param('userId', uuid) target: string) {
    return this.users.toggleFavoriteContact(user.id, target)
  }
}

@ApiTags('admin/users')
@Roles('ADMIN')
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@Query() query: SearchUsersQuery) {
    return this.users.list(query.q)
  }

  @Patch(':id/role')
  setRole(@CurrentUser() actor: AuthUser, @Param('id', uuid) id: string, @Body() dto: UpdateRoleDto) {
    return this.users.setRole(actor.id, id, dto.role)
  }

  @Patch(':id/active')
  @HttpCode(204)
  setActive(@CurrentUser() actor: AuthUser, @Param('id', uuid) id: string, @Body() dto: SetActiveDto) {
    return this.users.setActive(actor.id, id, dto.isActive)
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() actor: AuthUser, @Param('id', uuid) id: string) {
    return this.users.remove(actor.id, id)
  }
}

@ApiTags('staff')
@Roles('MANAGER')
@Controller('admin/drivers')
export class DriversController {
  constructor(private readonly users: UsersService) {}

  @Get()
  async drivers() {
    const all = await this.users.list()
    return all.filter((u) => u.role === 'DRIVER' && u.isActive)
  }
}
