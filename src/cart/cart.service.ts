import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
  constructor(private prisma: PrismaService) {}

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

  async approve(id: string) {
    const order = await this.prisma.cartOrder.findUnique({ where: { id }, include: { items: true } });
    if (!order) throw new NotFoundException('Commande introuvable');
    if (order.status !== 'pending') throw new BadRequestException('Cette commande a déjà été traitée');

    return this.prisma.$transaction(async (tx) => {
      // Le stock a pu bouger entre la commande et la validation — on revérifie.
      for (const item of order.items) {
        const product = await tx.product.findUnique({ where: { id: item.productId } });
        if (!product || product.stock < item.quantity) {
          throw new BadRequestException(`Stock devenu insuffisant pour un article de la commande (${item.productId})`);
        }
      }

      // Payée par le portefeuille si le solde suffit, sinon paiement à la
      // livraison (le responsable a appelé le client avant de valider).
      const total = Number(order.itemsTotal) + Number(order.deliveryFee);
      const wallet = await tx.wallet.findUnique({ where: { userId: order.userId } });
      const charged = wallet
        ? await tx.wallet.updateMany({
            where: { id: wallet.id, balance: { gte: total } },
            data: { balance: { decrement: total } },
          })
        : { count: 0 };
      const paidByWallet = charged.count === 1;
      if (wallet && paidByWallet) {
        await tx.transaction.create({
          data: { walletId: wallet.id, amount: `-${total}`, type: 'cart_purchase', meta: JSON.stringify({ orderId: id }) },
        });
      }

      for (const item of order.items) {
        await tx.product.update({ where: { id: item.productId }, data: { stock: { decrement: item.quantity } } });

        // Vendeurs crédités seulement pour un paiement par portefeuille ; à
        // la livraison, l'encaissement se fait hors application.
        if (item.sellerId && paidByWallet) {
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
      }

      await tx.cartOrder.update({
        where: { id },
        data: {
          status: 'approved',
          reviewedAt: new Date(),
          reviewNote: paidByWallet ? 'Payée par le portefeuille' : 'Paiement à la livraison',
        },
      });
      return { ok: true, paidByWallet };
    });
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
