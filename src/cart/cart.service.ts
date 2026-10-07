import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { formatAr } from '../common/format';
import { NotificationsService } from '../notifications/notifications.service';
import { PointsService } from '../points/points.service';
import { PrismaService } from '../prisma/prisma.service';

/// Mêmes règles de commission que la boutique instantanée (marketplace.service.ts).
const MARKETPLACE_COMMISSION_RATE = 0.05;

/// Frais de livraison : 6 000 Ar par fournisseur distinct dans le panier.
/// Le serveur recalcule toujours ce montant à partir des produits reçus.
const DELIVERY_FEE_PER_SUPPLIER = 6000;

const PAYMENT_LABEL: Record<string, string> = { mvola: 'MVola', wallet: 'portefeuille', cash: 'à la livraison' };

interface CheckoutItem {
  productId: string;
  quantity: number;
}

interface CheckoutBody {
  items: CheckoutItem[];
  deliveryName: string;
  deliveryPhone: string;
  deliveryAddress: string;
  deliveryCity: string;
  supplierCount?: number;
  deliveryLat?: number;
  deliveryLng?: number;
  paymentMethod?: string;
  paymentPhone?: string;
  paymentReference?: string;
}

/// Position GPS gardée seulement si elle est plausible.
function validPosition(lat?: number, lng?: number) {
  const la = Number(lat);
  const lo = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return {};
  return { deliveryLat: la, deliveryLng: lo };
}

@Injectable()
export class CartService {
  constructor(
    private prisma: PrismaService,
    private points: PointsService,
    private notifications: NotificationsService,
  ) {}

  async checkout(userId: string, body: CheckoutBody) {
    if (!Array.isArray(body.items) || body.items.length === 0) {
      throw new BadRequestException('Le panier est vide');
    }
    const deliveryName = body.deliveryName?.trim();
    const deliveryPhone = body.deliveryPhone?.trim();
    const deliveryAddress = body.deliveryAddress?.trim();
    const deliveryCity = body.deliveryCity?.trim();
    if (!deliveryName || !deliveryPhone || !deliveryAddress || !deliveryCity) {
      throw new BadRequestException('Merci de renseigner le nom, téléphone, adresse et ville de livraison');
    }

    // Trois modes : MVola (numéro + référence obligatoires), portefeuille
    // (débité tout de suite, remboursé si refus) ou paiement à la livraison.
    // Le solde du portefeuille n'est touché QUE pour le mode « wallet ».
    const paymentMethod =
      body.paymentMethod === 'mvola' ? 'mvola' : body.paymentMethod === 'wallet' ? 'wallet' : 'cash';
    const paymentPhone = (body.paymentPhone ?? '').replace(/\s+/g, '');
    const paymentReference = body.paymentReference?.trim() ?? '';
    if (paymentMethod === 'mvola') {
      if (!/^(\+261|0)3[2-9]\d{7}$/.test(paymentPhone)) {
        throw new BadRequestException('Numéro MVola de paiement invalide');
      }
      if (paymentReference.length < 4) {
        throw new BadRequestException('Référence de paiement MVola requise');
      }
    }

    const order = await this.prisma.$transaction(async (tx) => {
      let itemsTotal = 0;
      let peerTotal = 0;
      const supplierKeys = new Set<string>();
      const lineData: { productId: string; quantity: number; unitPrice: string; sellerId: string | null }[] = [];

      for (const raw of body.items) {
        const quantity = Math.trunc(Number(raw.quantity));
        if (!raw.productId || !Number.isFinite(quantity) || quantity <= 0) {
          throw new BadRequestException('Article de panier invalide');
        }
        const product = await tx.product.findFirst({ where: { id: raw.productId, active: true } });
        if (!product) throw new BadRequestException('Un produit du panier n\'est plus disponible');
        if (product.sellerId === userId) throw new BadRequestException('Vous ne pouvez pas acheter votre propre produit');
        if (product.stock < quantity) throw new BadRequestException(`Stock insuffisant pour « ${product.name} »`);

        const unitPrice = Number(product.price);
        itemsTotal += unitPrice * quantity;
        if (product.sellerId) peerTotal += unitPrice * quantity;
        supplierKeys.add(
          product.sellerId ??
            product.sellerName?.trim().toLowerCase() ??
            'official',
        );
        lineData.push({ productId: product.id, quantity, unitPrice: String(unitPrice), sellerId: product.sellerId });
      }

      const deliveryFee = supplierKeys.size * DELIVERY_FEE_PER_SUPPLIER;
      const commissionAmount = Math.round(peerTotal * MARKETPLACE_COMMISSION_RATE);

      if (paymentMethod === 'wallet') {
        const total = itemsTotal + deliveryFee;
        const wallet = await tx.wallet.findUnique({ where: { userId } });
        if (!wallet) throw new BadRequestException('Portefeuille introuvable');
        const charged = await tx.wallet.updateMany({
          where: { id: wallet.id, balance: { gte: total } },
          data: { balance: { decrement: total } },
        });
        if (charged.count !== 1) {
          throw new BadRequestException(`Solde insuffisant : ${formatAr(total)} nécessaires`);
        }
        await tx.transaction.create({
          data: { walletId: wallet.id, amount: `-${total}`, type: 'cart_payment', meta: JSON.stringify({ items: lineData.length }) },
        });
      }

      return tx.cartOrder.create({
        data: {
          userId,
          deliveryName,
          deliveryPhone,
          deliveryAddress,
          deliveryCity,
          ...validPosition(body.deliveryLat, body.deliveryLng),
          deliveryFee: String(deliveryFee),
          itemsTotal: String(itemsTotal),
          commissionAmount: String(commissionAmount),
          paymentMethod,
          paymentPhone: paymentMethod === 'mvola' ? paymentPhone : null,
          paymentReference: paymentMethod === 'mvola' ? paymentReference : null,
          status: 'pending',
          items: { create: lineData },
        },
        include: { items: { include: { product: { select: { name: true, imageUrl: true } } } } },
      });
    });

    const total = Number(order.itemsTotal) + Number(order.deliveryFee);
    await this.notifications.notifyAdmins({
      type: 'order',
      title: 'Nouvelle commande à valider',
      body: `${order.deliveryName} — ${formatAr(total)} (${PAYMENT_LABEL[order.paymentMethod] ?? order.paymentMethod}), ${order.deliveryCity}`,
      data: { orderId: order.id, screen: 'admin-orders' },
    });
    return order;
  }

  /// Commandes du client, avec pour chaque commande livrée la liste des
  /// vendeurs à noter (et la note déjà donnée).
  async myOrders(userId: string) {
    const orders = await this.prisma.cartOrder.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { items: { include: { product: { select: { name: true, imageUrl: true } } } } },
    });
    const sellerIds = [...new Set(orders.flatMap((o) => o.items.map((i) => i.sellerId)).filter((v): v is string => !!v))];
    const [sellers, reviews] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: sellerIds } }, select: { id: true, username: true, displayName: true } }),
      this.prisma.sellerReview.findMany({
        where: { userId, orderId: { in: orders.map((o) => o.id) } },
        select: { orderId: true, sellerId: true, rating: true, comment: true },
      }),
    ]);
    const sellerName = new Map(sellers.map((s) => [s.id, s.displayName || s.username]));
    return orders.map((o) => {
      const ids = [...new Set(o.items.map((i) => i.sellerId).filter((v): v is string => !!v))];
      return {
        ...o,
        sellers: ids.map((id) => {
          const review = reviews.find((r) => r.orderId === o.id && r.sellerId === id);
          return { id, name: sellerName.get(id) ?? 'Vendeur', rating: review?.rating ?? null, comment: review?.comment ?? null };
        }),
      };
    });
  }

  /// Note de satisfaction 1 à 5 du client pour un vendeur de sa commande,
  /// possible uniquement après la livraison. Renvoyer une note la modifie.
  async review(userId: string, orderId: string, body: { sellerId?: string; rating?: number; comment?: string }) {
    const rating = Math.trunc(Number(body.rating));
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      throw new BadRequestException('La note doit être comprise entre 1 et 5');
    }
    const order = await this.prisma.cartOrder.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order || order.userId !== userId) throw new NotFoundException('Commande introuvable');
    if (order.status !== 'delivered') {
      throw new BadRequestException('Vous pourrez noter le vendeur après la livraison');
    }
    const sellerIds = [...new Set(order.items.map((i) => i.sellerId).filter((v): v is string => !!v))];
    const sellerId = body.sellerId ?? (sellerIds.length === 1 ? sellerIds[0] : undefined);
    if (!sellerId || !sellerIds.includes(sellerId)) {
      throw new BadRequestException('Ce vendeur ne fait pas partie de la commande');
    }
    const comment = body.comment?.trim().slice(0, 500) || null;
    const existing = await this.prisma.sellerReview.findUnique({ where: { orderId_sellerId: { orderId, sellerId } } });
    const review = await this.prisma.sellerReview.upsert({
      where: { orderId_sellerId: { orderId, sellerId } },
      create: { orderId, sellerId, userId, rating, comment },
      update: { rating, comment },
    });
    if (!existing) {
      await this.notifications.notifyUser(sellerId, {
        type: 'review',
        title: `Nouvelle note : ${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}`,
        body: comment ? `« ${comment.slice(0, 120)} »` : 'Un client a noté votre boutique après sa livraison.',
        data: { orderId, screen: 'seller-orders' },
      });
    }
    return review;
  }

  listOrders(status?: string) {
    return this.prisma.cartOrder.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        user: { select: { id: true, username: true, displayName: true, avatarColor: true } },
        items: { include: { product: { select: { name: true, imageUrl: true } } } },
      },
    });
  }

  /// Validation par un admin : stock réservé, commande « en attente de
  /// livraison ». Le paiement (MVola ou à la livraison) se fait hors portefeuille.
  async approve(id: string) {
    const order = await this.prisma.cartOrder.findUnique({ where: { id }, include: { items: true } });
    if (!order) throw new NotFoundException('Commande introuvable');
    if (order.status !== 'pending') throw new BadRequestException('Cette commande a déjà été traitée');

    await this.prisma.$transaction(async (tx) => {
      for (const item of order.items) {
        const reserved = await tx.product.updateMany({
          where: { id: item.productId, stock: { gte: item.quantity } },
          data: { stock: { decrement: item.quantity } },
        });
        if (reserved.count !== 1) {
          throw new BadRequestException('Stock devenu insuffisant pour un article de la commande');
        }
      }
      await tx.cartOrder.update({
        where: { id },
        data: { status: 'approved', reviewedAt: new Date(), reviewNote: null },
      });
    });
    await this.notifications.notifyUser(order.userId, {
      type: 'order',
      title: 'Commande validée ✅',
      body: 'Votre commande est validée et part en livraison.',
      data: { orderId: id, screen: 'orders' },
    });
    const sellerIds = order.items.map((i) => i.sellerId).filter((v): v is string => !!v);
    await this.notifications.notifyUsers(sellerIds, {
      type: 'order',
      title: 'Nouvelle vente à préparer',
      body: 'Une commande contenant vos produits vient d\'être validée.',
      data: { orderId: id, screen: 'seller-orders' },
    });
    return { ok: true };
  }

  /// Livraison effectuée : achat terminé, les vendeurs sont crédités (moins
  /// la commission plateforme).
  async markDelivered(id: string) {
    const order = await this.prisma.cartOrder.findUnique({ where: { id }, include: { items: true } });
    if (!order) throw new NotFoundException('Commande introuvable');
    if (order.status !== 'approved') throw new BadRequestException('La commande doit être validée avant la livraison');

    const result = await this.prisma.$transaction(async (tx) => {
      for (const item of order.items) {
        if (!item.sellerId) continue;
        const lineTotal = Number(item.unitPrice) * item.quantity;
        const commission = Math.round(lineTotal * MARKETPLACE_COMMISSION_RATE);
        const payout = lineTotal - commission;
        const sellerWallet = await tx.wallet.findUnique({ where: { userId: item.sellerId } });
        if (sellerWallet) {
          await tx.wallet.update({ where: { id: sellerWallet.id }, data: { balance: { increment: payout } } });
          await tx.transaction.create({
            data: {
              walletId: sellerWallet.id,
              amount: String(payout),
              type: 'marketplace_sale',
              meta: JSON.stringify({ orderId: id, productId: item.productId, commission }),
            },
          });
        }
        let platformWallet = await tx.wallet.findFirst({ where: { userId: null } });
        if (!platformWallet) {
          platformWallet = await tx.wallet.create({ data: { balance: String(commission) } });
        } else {
          await tx.wallet.update({ where: { id: platformWallet.id }, data: { balance: { increment: commission } } });
        }
        await tx.transaction.create({
          data: { walletId: platformWallet.id, amount: String(commission), type: 'fee', meta: JSON.stringify({ source: 'cart', orderId: id }) },
        });
      }
      await tx.cartOrder.update({ where: { id }, data: { status: 'delivered', deliveredAt: new Date() } });
      return { ok: true };
    });
    // Points d'achat seulement une fois la livraison confirmée par l'admin.
    const earned = await this.points.award(order.userId, 'purchase', `cart:${id}`);
    await this.points.rewardReferral(order.userId);
    await this.notifications.notifyUser(order.userId, {
      type: 'order',
      title: 'Commande livrée 📦',
      body:
        (earned > 0 ? `Merci pour votre achat ! +${earned} Karataka Points.` : 'Merci pour votre achat !') +
        (order.items.some((i) => i.sellerId) ? ' Donnez une note de 1 à 5 au vendeur ⭐' : ''),
      data: { orderId: id, screen: 'orders' },
    });
    const sellerIds = order.items.map((i) => i.sellerId).filter((v): v is string => !!v);
    await this.notifications.notifyUsers(sellerIds, {
      type: 'order',
      title: 'Vente finalisée 💰',
      body: 'La livraison est confirmée : le montant (moins 5 % de commission) est crédité sur votre portefeuille.',
      data: { orderId: id, screen: 'wallet' },
    });
    return result;
  }

  async reject(id: string, reviewNote?: string) {
    const order = await this.prisma.cartOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Commande introuvable');
    if (order.status !== 'pending') throw new BadRequestException('Cette commande a déjà été traitée');

    const refund = Number(order.itemsTotal) + Number(order.deliveryFee);
    await this.prisma.$transaction(async (tx) => {
      await tx.cartOrder.update({
        where: { id },
        data: { status: 'rejected', reviewedAt: new Date(), reviewNote: reviewNote ?? null },
      });
      // Payée par portefeuille : remboursement intégral.
      if (order.paymentMethod === 'wallet') {
        const wallet = await tx.wallet.findUnique({ where: { userId: order.userId } });
        if (wallet) {
          await tx.wallet.update({ where: { id: wallet.id }, data: { balance: { increment: refund } } });
          await tx.transaction.create({
            data: { walletId: wallet.id, amount: String(refund), type: 'cart_refund', meta: JSON.stringify({ orderId: id }) },
          });
        }
      }
    });
    await this.notifications.notifyUser(order.userId, {
      type: 'order',
      title: 'Commande refusée',
      body:
        (reviewNote ? `Motif : ${reviewNote}. ` : '') +
        (order.paymentMethod === 'wallet' ? `${formatAr(refund)} remboursés sur votre portefeuille.` : 'Contactez-nous pour plus d\'informations.'),
      data: { orderId: id, screen: 'orders' },
    });
    return { ok: true };
  }
}
