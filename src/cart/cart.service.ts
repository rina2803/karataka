import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PointsService } from '../points/points.service';
import { PrismaService } from '../prisma/prisma.service';

/// Mêmes règles de commission que la boutique instantanée (marketplace.service.ts).
const MARKETPLACE_COMMISSION_RATE = 0.05;

/// Frais de livraison : 6 000 Ar par fournisseur distinct dans le panier.
/// Le serveur recalcule toujours ce montant à partir des produits reçus.
const DELIVERY_FEE_PER_SUPPLIER = 6000;

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
  constructor(private prisma: PrismaService, private points: PointsService) {}

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

    // MVola : numéro qui a payé + référence de transaction obligatoires.
    const paymentMethod = body.paymentMethod === 'mvola' ? 'mvola' : 'cash';
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

    return this.prisma.$transaction(async (tx) => {
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
  }

  myOrders(userId: string) {
    return this.prisma.cartOrder.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { items: { include: { product: { select: { name: true, imageUrl: true } } } } },
    });
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

    return this.prisma.$transaction(async (tx) => {
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
      return { ok: true };
    });
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
    await this.points.award(order.userId, 'purchase', `cart:${id}`);
    return result;
  }

  async reject(id: string, reviewNote?: string) {
    const order = await this.prisma.cartOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Commande introuvable');
    if (order.status !== 'pending') throw new BadRequestException('Cette commande a déjà été traitée');

    await this.prisma.cartOrder.update({
      where: { id },
      data: { status: 'rejected', reviewedAt: new Date(), reviewNote: reviewNote ?? null },
    });
    return { ok: true };
  }
}
