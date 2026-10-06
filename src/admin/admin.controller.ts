import { formatAr } from '../common/format';
import { NotificationsService } from '../notifications/notifications.service';
import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { fallbackProductImage } from '../seed-catalog';

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(private prisma: PrismaService, private wallet: WalletService, private notifications: NotificationsService) {}

  @Get('stats')
  async stats() {
    const [userCount, pendingCount, wallets] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.paymentRequest.count({ where: { status: 'pending' } }),
      this.prisma.wallet.findMany({ select: { balance: true } }),
    ]);
    const totalBalance = wallets.reduce((sum, w) => sum + Number(w.balance), 0);
    return { userCount, pendingCount, totalBalance };
  }

  @Get('payment-requests')
  async listRequests(@Query('status') status?: string) {
    const requests = await this.prisma.paymentRequest.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: { select: { id: true, username: true, displayName: true, avatarColor: true, email: true, wallet: { select: { balance: true } } } } },
    });
    return requests;
  }

  @Post('payment-requests/:id/approve')
  async approve(@Param('id') id: string, @Req() req: any) {
    const request = await this.prisma.paymentRequest.findUnique({ where: { id } });
    if (!request) return { ok: false, error: 'Demande introuvable' };
    if (request.status !== 'pending') return { ok: false, error: 'Demande déjà traitée' };

    if (request.type === 'deposit') {
      await this.wallet.deposit(request.userId, request.amount.toString(), {
        via: 'mvola-manual',
        reference: request.reference,
        requestId: request.id,
      });
    } else {
      const currentWallet = await this.wallet.getWalletForUser(request.userId);
      if (!currentWallet || Number(currentWallet.balance) < Number(request.amount)) {
        return { ok: false, error: 'Le joueur n\'a plus un solde suffisant pour ce retrait' };
      }
      await this.wallet.withdraw(request.userId, request.amount.toString(), {
        via: 'mvola-manual',
        reference: request.reference,
        requestId: request.id,
      });
    }

    await this.prisma.paymentRequest.update({
      where: { id },
      data: { status: 'approved', reviewedAt: new Date(), reviewedBy: req.user?.sub },
    });
    await this.notifications.notifyUser(request.userId, {
      type: 'payment',
      title: request.type === 'deposit' ? 'Dépôt crédité ✅' : 'Retrait envoyé ✅',
      body:
        request.type === 'deposit'
          ? `${formatAr(request.amount)} ajoutés à votre portefeuille.`
          : `${formatAr(request.amount)} envoyés sur votre MVola.`,
      data: { screen: 'wallet' },
    });
    return { ok: true };
  }

  @Post('payment-requests/:id/reject')
  async reject(@Param('id') id: string, @Body() body: { reason?: string }, @Req() req: any) {
    const request = await this.prisma.paymentRequest.findUnique({ where: { id } });
    if (!request) return { ok: false, error: 'Demande introuvable' };
    if (request.status !== 'pending') return { ok: false, error: 'Demande déjà traitée' };

    await this.prisma.paymentRequest.update({
      where: { id },
      data: {
        status: 'rejected',
        reviewedAt: new Date(),
        reviewedBy: req.user?.sub,
        reference: body.reason ? `${request.reference ?? ''} [refusé: ${body.reason}]`.trim() : request.reference,
      },
    });
    await this.notifications.notifyUser(request.userId, {
      type: 'payment',
      title: request.type === 'deposit' ? 'Dépôt refusé' : 'Retrait refusé',
      body: body.reason ? `Motif : ${body.reason}` : 'Contactez-nous pour plus d\'informations.',
      data: { screen: 'wallet' },
    });
    return { ok: true };
  }

  @Get('users')
  async listUsers() {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        username: true,
        email: true,
        displayName: true,
        avatarColor: true,
        role: true,
        createdAt: true,
        wallet: { select: { balance: true } },
      },
    });
    return users.map((u) => ({ ...u, balance: u.wallet?.balance ?? '0' }));
  }

  @Get('products')
  products() {
    return this.prisma.product.findMany({ orderBy: { createdAt: 'desc' } });
  }

  @Post('products')
  createProduct(@Body() body: { name: string; description?: string; price: number; originalPrice?: number; isPromo?: boolean; stock: number; imageUrl?: string; category?: string; sellerName?: string }) {
    return this.prisma.product.create({
      data: {
        name: body.name.trim(),
        description: body.description?.trim(),
        price: String(body.price),
        originalPrice: body.originalPrice !== undefined && body.originalPrice !== null ? String(body.originalPrice) : undefined,
        isPromo: body.isPromo ?? false,
        stock: Number(body.stock),
        // Toujours une photo : celle fournie, sinon l'image de la catégorie.
        imageUrl: body.imageUrl?.trim() || fallbackProductImage(body.category?.trim()),
        category: body.category?.trim() || 'general',
        sellerName: body.sellerName?.trim() || 'Tsenabe officiel',
      },
    });
  }

  @Put('products/:id')
  updateProduct(@Param('id') id: string, @Body() body: { name?: string; description?: string; price?: number; originalPrice?: number; isPromo?: boolean; stock?: number; imageUrl?: string; category?: string; sellerName?: string; active?: boolean }) {
    return this.prisma.product.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.description !== undefined ? { description: body.description.trim() } : {}),
        ...(body.price !== undefined ? { price: String(body.price) } : {}),
        ...(body.originalPrice !== undefined ? { originalPrice: body.originalPrice === null ? null : String(body.originalPrice) } : {}),
        ...(body.isPromo !== undefined ? { isPromo: body.isPromo } : {}),
        ...(body.stock !== undefined ? { stock: Number(body.stock) } : {}),
        ...(body.imageUrl !== undefined ? { imageUrl: body.imageUrl.trim() || fallbackProductImage(body.category?.trim()) } : {}),
        ...(body.category !== undefined ? { category: body.category.trim() || 'general' } : {}),
        ...(body.sellerName !== undefined ? { sellerName: body.sellerName.trim() || 'Tsenabe officiel' } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
      },
    });
  }

  @Delete('products/:id')
  archiveProduct(@Param('id') id: string) {
    return this.prisma.product.update({ where: { id }, data: { active: false } });
  }
}
