import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [AuthModule, UsersModule, WalletModule],
  providers: [RealtimeGateway, PrismaService],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
