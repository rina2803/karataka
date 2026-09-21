import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { ManualPaymentsController } from './manual-payments.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [AuthModule, WalletModule],
  controllers: [PaymentsController, ManualPaymentsController],
  providers: [PaymentsService, PrismaService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
