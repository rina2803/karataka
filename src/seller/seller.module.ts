import { Module } from '@nestjs/common';
import { SellerController } from './seller.controller';
import { AdminSellerController } from './admin-seller.controller';
import { SellerService } from './seller.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { AdminGuard } from '../auth/admin.guard';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [SellerController, AdminSellerController],
  providers: [SellerService, PrismaService, AdminGuard],
})
export class SellerModule {}
