import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

/// Commission plateforme, identique à cart.service.ts.
const COMMISSION_RATE = 0.05;

@Injectable()
export class SellerService {
  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  async apply(
    userId: string,
    body: { cinNumber: string; cinPhotoBase64: string; selfieBase64: string; mvolaNumber: string },
  ) {
    const cinNumber = body.cinNumber?.trim();
    const mvolaNumber = body.mvolaNumber?.trim();
    if (!cinNumber) throw new BadRequestException('Le numéro de CIN est requis');
    if (!body.cinPhotoBase64) throw new BadRequestException('La photo de la CIN est requise');
    if (!body.selfieBase64) throw new BadRequestException('Le selfie avec la CIN est requis');
    if (!mvolaNumber) throw new BadRequestException('Le numéro MVola est requis');

    const existing = await this.prisma.sellerApplication.findFirst({
      where: { userId, status: { in: ['pending', 'approved'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return { ok: true, alreadySubmitted: true, application: existing };

    const application = await this.prisma.sellerApplication.create({
      data: {
        userId,
        cinNumber,
        cinPhotoUrl: body.cinPhotoBase64,
        selfieUrl: body.selfieBase64,
        mvolaNumber,
      },
    });
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { displayName: true, username: true } });
    await this.notifications.notifyAdmins({
      type: 'seller',
      title: 'Nouvelle demande vendeur',
      body: `${user?.displayName || user?.username || 'Un utilisateur'} veut vendre sur Karataka (CIN à vérifier).`,
      data: { applicationId: application.id, screen: 'admin-sellers' },
    });
    return { ok: true, alreadySubmitted: false, application };
  }

  /// Espace vendeur : les commandes contenant au moins un produit du
  /// vendeur, avec seulement SES lignes (pas celles des autres vendeurs).
  /// Statuts : pending = commandée (en validation), approved = validée
  /// (en livraison), delivered = livrée et payée au vendeur, rejected.
  async orders(sellerId: string, status?: string) {
    const statusFilter = ['pending', 'approved', 'delivered', 'rejected'].includes(status ?? '') ? status : undefined;
    const orders = await this.prisma.cartOrder.findMany({
      where: { items: { some: { sellerId } }, ...(statusFilter ? { status: statusFilter } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        user: { select: { username: true, displayName: true } },
        items: { where: { sellerId }, include: { product: { select: { id: true, name: true, imageUrl: true } } } },
      },
    });
    const reviews = await this.prisma.sellerReview.findMany({
      where: { sellerId, orderId: { in: orders.map((o) => o.id) } },
      select: { orderId: true, rating: true, comment: true },
    });
    const reviewByOrder = new Map(reviews.map((r) => [r.orderId, r]));

    return orders.map((o) => {
      const total = o.items.reduce((sum, i) => sum + Number(i.unitPrice) * i.quantity, 0);
      const commission = Math.round(total * COMMISSION_RATE);
      // Coordonnées de livraison visibles seulement une fois la commande
      // validée par l'admin (le vendeur doit alors préparer l'envoi).
      const showContact = o.status === 'approved' || o.status === 'delivered';
      return {
        id: o.id,
        status: o.status,
        createdAt: o.createdAt,
        reviewedAt: o.reviewedAt,
        deliveredAt: o.deliveredAt,
        paymentMethod: o.paymentMethod,
        buyer: o.user.username,
        deliveryCity: o.deliveryCity,
        deliveryName: showContact ? o.deliveryName : null,
        deliveryPhone: showContact ? o.deliveryPhone : null,
        deliveryAddress: showContact ? o.deliveryAddress : null,
        items: o.items.map((i) => ({
          productId: i.productId,
          name: i.product?.name ?? 'Produit',
          imageUrl: i.product?.imageUrl ?? null,
          quantity: i.quantity,
          unitPrice: Number(i.unitPrice),
        })),
        total,
        commission,
        payout: total - commission,
        review: reviewByOrder.get(o.id) ?? null,
      };
    });
  }

  /// Chiffres de l'espace vendeur : nombre de commandes par statut, chiffre
  /// d'affaires encaissé (livré) et note moyenne.
  async summary(sellerId: string) {
    const [items, rating] = await Promise.all([
      this.prisma.cartOrderItem.findMany({
        where: { sellerId },
        select: { orderId: true, quantity: true, unitPrice: true, order: { select: { status: true } } },
      }),
      this.prisma.sellerReview.aggregate({ where: { sellerId }, _avg: { rating: true }, _count: { _all: true } }),
    ]);
    const ordersByStatus: Record<string, Set<string>> = {
      pending: new Set(), approved: new Set(), delivered: new Set(), rejected: new Set(),
    };
    let paidRevenue = 0;
    let pendingRevenue = 0;
    let soldUnits = 0;
    for (const item of items) {
      const st = item.order.status;
      ordersByStatus[st]?.add(item.orderId);
      const line = Number(item.unitPrice) * item.quantity;
      if (st === 'delivered') {
        paidRevenue += line - Math.round(line * COMMISSION_RATE);
        soldUnits += item.quantity;
      } else if (st === 'approved') {
        pendingRevenue += line - Math.round(line * COMMISSION_RATE);
      }
    }
    return {
      counts: Object.fromEntries(Object.entries(ordersByStatus).map(([k, v]) => [k, v.size])),
      paidRevenue,
      pendingRevenue,
      soldUnits,
      ratingAvg: rating._avg.rating ? Math.round(rating._avg.rating * 10) / 10 : null,
      ratingCount: rating._count._all,
    };
  }

  async status(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { isApprovedSeller: true } });
    const latest = await this.prisma.sellerApplication.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return {
      isApprovedSeller: user?.isApprovedSeller ?? false,
      application: latest
        ? { id: latest.id, status: latest.status, reviewNote: latest.reviewNote, createdAt: latest.createdAt }
        : null,
    };
  }

  async listApplications(status?: string) {
    return this.prisma.sellerApplication.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        user: { select: { id: true, username: true, displayName: true, avatarColor: true, email: true, phone: true } },
      },
    });
  }

  async approve(id: string) {
    const application = await this.prisma.sellerApplication.findUnique({ where: { id } });
    if (!application) throw new NotFoundException('Candidature introuvable');
    if (application.status !== 'pending') throw new BadRequestException('Cette candidature a déjà été traitée');

    await this.prisma.$transaction(async (tx) => {
      await tx.sellerApplication.update({ where: { id }, data: { status: 'approved', reviewedAt: new Date() } });
      await tx.user.update({ where: { id: application.userId }, data: { isApprovedSeller: true } });
    });
    await this.notifications.notifyUser(application.userId, {
      type: 'seller',
      title: 'Vous êtes vendeur Karataka 🎉',
      body: 'Votre dossier est validé : publiez vos premiers produits dès maintenant.',
      data: { screen: 'seller-space' },
    });
    return { ok: true };
  }

  async reject(id: string, reviewNote?: string) {
    const application = await this.prisma.sellerApplication.findUnique({ where: { id } });
    if (!application) throw new NotFoundException('Candidature introuvable');
    if (application.status !== 'pending') throw new BadRequestException('Cette candidature a déjà été traitée');

    await this.prisma.sellerApplication.update({
      where: { id },
      data: { status: 'rejected', reviewedAt: new Date(), reviewNote: reviewNote ?? null },
    });
    await this.notifications.notifyUser(application.userId, {
      type: 'seller',
      title: 'Demande vendeur refusée',
      body: reviewNote ? `Motif : ${reviewNote}. Vous pouvez renvoyer un dossier.` : 'Vous pouvez renvoyer un dossier complet.',
      data: { screen: 'seller-space' },
    });
    return { ok: true };
  }
}
