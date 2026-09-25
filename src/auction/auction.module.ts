import { Module } from '@nestjs/common';
import { AuctionController, AdminAuctionController } from './auction.controller';
import { AuctionService } from './auction.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { AdminGuard } from '../auth/admin.guard';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [AuctionController, AdminAuctionController],
  providers: [AuctionService, PrismaService, AdminGuard],
})
export class AuctionModule {}
