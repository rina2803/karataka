import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { WalletModule } from '../wallet/wallet.module';
import { AdminGuard } from '../auth/admin.guard';

@Module({
  imports: [AuthModule, UsersModule, WalletModule],
  controllers: [AdminController],
  providers: [PrismaService, AdminGuard],
})
export class AdminModule {}
