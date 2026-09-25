import { Module } from '@nestjs/common';
import { AppReleaseController } from './app-release.controller';
import { AppReleaseService } from './app-release.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { AdminGuard } from '../auth/admin.guard';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [AppReleaseController],
  providers: [AppReleaseService, PrismaService, AdminGuard],
})
export class AppReleaseModule {}
