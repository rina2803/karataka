import { Body, Controller, Get, Param, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { WalletService } from '../wallet/wallet.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

const MIN_AMOUNT = 2000; // Ar

interface PendingTx {
  userId: string;
  type: 'deposit' | 'withdraw';
  amount: number;
  phone: string;
  settled: boolean;
}

@Controller('payments/mvola')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  // Suivi en mémoire des demandes en cours (confirmées via /status).
  private pending = new Map<string, PendingTx>();

  constructor(private payments: PaymentsService, private wallet: WalletService) {}

  @Get('status-config')
  configStatus() {
    return { configured: this.payments.isConfigured() };
  }

  @Post('deposit')
  async deposit(@Body() body: { phone: string; amount: number }, @Req() req: any) {
    const userId = req.user?.sub;
    if (!userId) throw new UnauthorizedException();

    const amount = Number(body.amount);
    if (!body.phone || body.phone.trim().length < 9) return { ok: false, error: 'Numéro de téléphone invalide' };
    if (!amount || amount < MIN_AMOUNT) return { ok: false, error: `Le montant minimum est de ${MIN_AMOUNT} Ar` };

    const reference = `dep-${userId}-${Date.now()}`;
    const result = await this.payments.requestDeposit(body.phone.trim(), amount, reference);
    if (!result.ok || !result.serverCorrelationId) return { ok: false, error: result.error };

    this.pending.set(result.serverCorrelationId, {
      userId,
      type: 'deposit',
      amount,
      phone: body.phone.trim(),
      settled: false,
    });
    return { ok: true, correlationId: result.serverCorrelationId };
  }

  @Post('withdraw')
  async withdraw(@Body() body: { phone: string; amount: number }, @Req() req: any) {
    const userId = req.user?.sub;
    if (!userId) throw new UnauthorizedException();

    const amount = Number(body.amount);
    if (!body.phone || body.phone.trim().length < 9) return { ok: false, error: 'Numéro de téléphone invalide' };
    if (!amount || amount < MIN_AMOUNT) return { ok: false, error: `Le montant minimum est de ${MIN_AMOUNT} Ar` };

    const currentWallet = await this.wallet.getWalletForUser(userId);
    if (!currentWallet || Number(currentWallet.balance) < amount) {
      return { ok: false, error: 'Solde insuffisant' };
    }

    const reference = `wd-${userId}-${Date.now()}`;
    const result = await this.payments.requestWithdrawal(body.phone.trim(), amount, reference);
    if (!result.ok || !result.serverCorrelationId) return { ok: false, error: result.error };

    // La mise en séquestre a lieu tout de suite pour éviter un double retrait
    // pendant que la confirmation MVola est en attente ; remboursée si échec.
    await this.wallet.withdraw(userId, String(amount), { via: 'mvola', reference, phase: 'pending' });

    this.pending.set(result.serverCorrelationId, {
      userId,
      type: 'withdraw',
      amount,
      phone: body.phone.trim(),
      settled: false,
    });
    return { ok: true, correlationId: result.serverCorrelationId };
  }

  @Get('status/:correlationId')
  async status(@Param('correlationId') correlationId: string, @Req() req: any) {
    const userId = req.user?.sub;
    const tx = this.pending.get(correlationId);
    if (!tx || tx.userId !== userId) return { status: 'failed', error: 'Demande introuvable' };
    if (tx.settled) return { status: 'completed' };

    const type = tx.type === 'deposit' ? 'merchantpay' : 'disbursement';
    const result = await this.payments.checkStatus(correlationId, type);

    if (result.status === 'completed' && !tx.settled) {
      tx.settled = true;
      if (tx.type === 'deposit') {
        await this.wallet.deposit(tx.userId, String(tx.amount), { via: 'mvola', correlationId, phone: tx.phone });
      }
      // Pour un retrait, les fonds ont déjà été débités à la demande —
      // rien à faire de plus ici, la confirmation MVola clôt juste le suivi.
    } else if (result.status === 'failed' && !tx.settled) {
      tx.settled = true;
      if (tx.type === 'withdraw') {
        // Rembourse la mise en séquestre si le retrait échoue côté MVola.
        await this.wallet.refundBet(tx.userId, String(tx.amount), { via: 'mvola', correlationId, reason: 'withdraw-failed' });
      }
    }

    return { status: result.status };
  }
}
