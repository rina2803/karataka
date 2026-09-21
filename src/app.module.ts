import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { WalletModule } from './wallet/wallet.module';
import { PaymentsModule } from './payments/payments.module';
import { GamesModule } from './games/games.module';
import { RealtimeModule } from './realtime/realtime.module';
import { MessagesModule } from './messages/messages.module';
import { AdminModule } from './admin/admin.module';
import { PrismaService } from './prisma/prisma.service';
import { HealthController } from './health.controller';
import { MarketplaceModule } from './marketplace/marketplace.module';

@Module({
  imports: [
    AuthModule,
    UsersModule,
    WalletModule,
    PaymentsModule,
    GamesModule,
    RealtimeModule,
    MessagesModule,
    AdminModule,
    MarketplaceModule,
  ],
  controllers: [HealthController],
  providers: [PrismaService],
})
export class AppModule {}
