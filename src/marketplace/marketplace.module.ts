import { Module } from '@nestjs/common';
import { MarketplaceController } from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletModule } from '../wallet/wallet.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { PointsModule } from '../points/points.module';
import { OptionalJwtGuard } from '../auth/optional-jwt.guard';

@Module({
  imports: [WalletModule, AuthModule, UsersModule, PointsModule],
  controllers: [MarketplaceController],
  providers: [MarketplaceService, PrismaService, OptionalJwtGuard],
})
export class MarketplaceModule {}