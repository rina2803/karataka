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
import { TestController } from './test.controller';
import { AuctionModule } from './auction/auction.module';
import { FairModule } from './fair/fair.module';
import { SellerModule } from './seller/seller.module';
import { CartModule } from './cart/cart.module';
import { HomeModule } from './home/home.module';
import { AppReleaseModule } from './app-release/app-release.module';
import { PointsModule } from './points/points.module';
import { ShareModule } from './share/share.module';

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
    AuctionModule,
    FairModule,
    SellerModule,
    CartModule,
    HomeModule,
    AppReleaseModule,
    PointsModule,
    ShareModule,
  ],
  controllers: [HealthController, TestController],
  providers: [PrismaService],
})
export class AppModule {}
