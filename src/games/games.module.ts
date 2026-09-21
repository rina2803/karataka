import { Module } from '@nestjs/common';
import { GamesService } from './games.service';
import { GamesController } from './games.controller';
import { PrismaService } from '../prisma/prisma.service';
import { WalletModule } from '../wallet/wallet.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [WalletModule, AuthModule],
  controllers: [GamesController],
  providers: [GamesService, PrismaService],
  exports: [GamesService],
})
export class GamesModule {}
