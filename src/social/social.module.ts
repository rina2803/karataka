import { Module } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma/prisma.service';
import { UsersModule } from '../users/users.module';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [SocialController],
  providers: [SocialService, PrismaService, AdminGuard],
})
export class SocialModule {}
