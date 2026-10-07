import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PointsModule } from '../points/points.module';
import { PrismaService } from '../prisma/prisma.service';
import { UsersModule } from '../users/users.module';
import { WalletModule } from '../wallet/wallet.module';
import { ArenaGateway } from './arena.gateway';

@Module({
  imports: [AuthModule, UsersModule, WalletModule, PointsModule],
  providers: [ArenaGateway, PrismaService],
})
export class ArenaModule {}
