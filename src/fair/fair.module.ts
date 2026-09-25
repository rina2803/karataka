import { Module } from '@nestjs/common';
import { FairService } from './fair.service';
import { FairController } from './fair.controller';
import { FairAdminController } from './fair-admin.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { AdminGuard } from '../auth/admin.guard';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [FairController, FairAdminController],
  providers: [FairService, PrismaService, AdminGuard],
})
export class FairModule {}
