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
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiConsumes, ApiTags } from '@nestjs/swagger'
import { type AuthUser, isStaff } from '../../../shared/auth/auth-user'
import { CurrentUser, Public, Roles } from '../../../shared/auth/decorators'
import { memoryUpload, requireFile } from '../../../shared/http/upload'
import { MenuService } from '../application/menu.service'
import { CategoryDto, CreateDishDto, DishesQueryDto, UpdateDishDto } from './menu.dto'

const uuid = new ParseUUIDPipe({ version: '4' })

@ApiTags('menu')
@Controller()
export class MenuController {
  constructor(private readonly menu: MenuService) {}

  @Public()
  @Get('categories')
  categories(@CurrentUser() user?: AuthUser) {
    return this.menu.categories(isStaff(user))
  }

  @Public()
  @Get('dishes')
  dishes(@Query() query: DishesQueryDto, @CurrentUser() user?: AuthUser) {
    return this.menu.dishes({ ...query, includeUnavailable: isStaff(user) && query.includeUnavailable })
  }

  @Public()
  @Get('dishes/slugs')
  slugs() {
    return this.menu.slugs()
  }

  @Public()
  @Get('dishes/:slug')
  dish(@Param('slug') slug: string) {
    return this.menu.dishBySlug(slug)
  }
}

@ApiTags('admin/menu')
@Roles('MANAGER')
@Controller('admin')
export class AdminMenuController {
  constructor(private readonly menu: MenuService) {}

  @Post('categories')
  createCategory(@Body() dto: CategoryDto) {
    return this.menu.createCategory(dto)
  }

  @Patch('categories/:id')
  updateCategory(@Param('id', uuid) id: string, @Body() dto: CategoryDto) {
    return this.menu.updateCategory(id, dto)
  }

  @Delete('categories/:id')
  @HttpCode(204)
  deleteCategory(@Param('id', uuid) id: string) {
    return this.menu.deleteCategory(id)
  }

  @Post('dishes')
  createDish(@Body() dto: CreateDishDto) {
    return this.menu.createDish(dto)
  }

  @Patch('dishes/:id')
  updateDish(@Param('id', uuid) id: string, @Body() dto: UpdateDishDto) {
    return this.menu.updateDish(id, dto)
  }

  @Post('dishes/:id/image')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', memoryUpload))
  dishImage(@Param('id', uuid) id: string, @UploadedFile() file?: Express.Multer.File) {
    return this.menu.uploadDishImage(id, requireFile(file))
  }

  @Delete('dishes/:id')
  @HttpCode(204)
  deleteDish(@Param('id', uuid) id: string) {
    return this.menu.deleteDish(id)
  }

  /** Téléversement générique d'image (catégories, contenus…). */
  @Post('media')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', memoryUpload))
  media(@UploadedFile() file?: Express.Multer.File) {
    return this.menu.uploadImage(requireFile(file))
  }
}
