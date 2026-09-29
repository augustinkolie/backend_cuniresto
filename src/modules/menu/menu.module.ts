import { Module } from '@nestjs/common'
import { MENU_READER } from './application/menu-reader.port'
import { MenuService } from './application/menu.service'
import { PrismaMenuReader } from './infrastructure/prisma-menu-reader'
import { AdminMenuController, MenuController } from './presentation/menu.controller'

@Module({
  controllers: [MenuController, AdminMenuController],
  providers: [MenuService, { provide: MENU_READER, useClass: PrismaMenuReader }],
  exports: [MENU_READER],
})
export class MenuModule {}
