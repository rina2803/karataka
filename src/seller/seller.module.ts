import { Module } from '@nestjs/common';
import { SellerController } from './seller.controller';
import { AdminSellerController } from './admin-seller.controller';
import { SellerService } from './seller.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { AdminGuard } from '../auth/admin.guard';
import { OptionalJwtGuard } from '../auth/optional-jwt.guard';
import { AdminPartnersController, SellersController } from './sellers.controller';
import { SellersService } from './sellers.service';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [SellerController, AdminSellerController, SellersController, AdminPartnersController],
  providers: [SellerService, SellersService, PrismaService, AdminGuard, OptionalJwtGuard],
})
export class SellerModule {}
