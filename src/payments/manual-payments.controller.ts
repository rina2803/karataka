import { formatAr } from '../common/format';
import { NotificationsService } from '../notifications/notifications.service';
import { Body, Controller, Get, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

const MIN_AMOUNT = 2000; // Ar

/**
 * Dépôt/retrait "manuel" — le joueur envoie/reçoit l'argent lui-même via le
 * code MVola (#111*1*...) vers/depuis le numéro caisse, indique une
 * référence, puis un admin valide la demande pour créditer/débiter le
 * portefeuille. Solution de secours tant que l'API MVola n'est pas activée.
 */
@Controller('payments/manual')
@UseGuards(JwtAuthGuard)
export class ManualPaymentsController {
  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  @Post('deposit')
  async requestDeposit(@Body() body: { amount: number; reference?: string }, @Req() req: any) {
    const userId = req.user?.sub;
    if (!userId) throw new UnauthorizedException();

    const amount = Number(body.amount);
    if (!amount || amount < MIN_AMOUNT) return { ok: false, error: `Le montant minimum est de ${MIN_AMOUNT} Ar` };

    const request = await this.prisma.paymentRequest.create({
      data: {
        userId,
        type: 'deposit',
        amount: String(amount),
        reference: body.reference?.trim() || null,
        status: 'pending',
      },
    });
    await this.notifications.notifyAdmins({
      type: 'payment',
      title: 'Dépôt MVola à vérifier',
      body: `${formatAr(amount)}${request.reference ? ` — réf. ${request.reference}` : ''}`,
      data: { requestId: request.id, screen: 'admin-payments' },
    });
    return { ok: true, requestId: request.id };
  }

  @Post('withdraw')
  async requestWithdraw(
    @Body() body: { amount: number; reference?: string; phone?: string },
    @Req() req: any,
  ) {
    const userId = req.user?.sub;
    if (!userId) throw new UnauthorizedException();

    const amount = Number(body.amount);
    if (!amount || amount < MIN_AMOUNT) return { ok: false, error: `Le montant minimum est de ${MIN_AMOUNT} Ar` };

    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet || Number(wallet.balance) < amount) {
      return { ok: false, error: 'Solde insuffisant' };
    }

    const request = await this.prisma.paymentRequest.create({
      data: {
        userId,
        type: 'withdraw',
        amount: String(amount),
        reference: body.reference?.trim() || null,
        phone: body.phone?.trim() || null,
        status: 'pending',
      },
    });
    await this.notifications.notifyAdmins({
      type: 'payment',
      title: 'Retrait MVola demandé',
      body: `${formatAr(amount)} vers ${request.phone ?? 'numéro non précisé'}`,
      data: { requestId: request.id, screen: 'admin-payments' },
    });
    return { ok: true, requestId: request.id };
  }

  @Get('mine')
  async mine(@Req() req: any) {
    const userId = req.user?.sub;
    if (!userId) throw new UnauthorizedException();
    return this.prisma.paymentRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }
}
