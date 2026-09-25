import { Module } from '@nestjs/common';
import { HomeController } from './home.controller';
import { HomeService } from './home.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { AdminGuard } from '../auth/admin.guard';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [HomeController],
  providers: [HomeService, PrismaService, AdminGuard],
})
export class HomeModule {}
