import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/// Commission plateforme sur les ventes entre joueurs (produits avec un
/// `sellerId` réel) — les produits officiels (sellerId null) n'en paient pas,
/// leur revenu revient déjà entièrement à la plateforme.
const MARKETPLACE_COMMISSION_RATE = 0.05;

const DEFAULT_PRODUCTS = [
  { id: 'tsenabe-tshirt', name: 'T-shirt Lalao & Karataka', description: 'T-shirt officiel du jeu.', price: 25000, stock: 20, category: 'Vêtements', sellerName: 'Tsenabe officiel', imageUrl: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=640&q=85', active: true },
  { id: 'tsenabe-cap', name: 'Casquette L&K', description: 'Casquette officielle bleu électrique.', price: 18000, stock: 15, category: 'Accessoires', sellerName: 'Tsenabe officiel', imageUrl: 'https://images.unsplash.com/photo-1521369909029-2afed882baee?w=640&q=85', active: true },
  { id: 'tsenabe-mug', name: 'Mug Tsenabe', description: 'Mug collector pour les joueurs.', price: 12000, stock: 30, category: 'Maison', sellerName: 'Tsenabe officiel', imageUrl: 'https://images.unsplash.com/photo-1514228742587-6b1558feca88?w=640&q=85', active: true },
];

@Injectable()
export class MarketplaceService {
  constructor(private prisma: PrismaService) {}

  async listProducts(category?: string) {
    const products = await this.prisma.product.findMany({
      where: {
        active: true,
        ...(category ? { category } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { seller: { select: { id: true, username: true, displayName: true, avatarColor: true } } },
    });
    if (products.length > 0) return products;
    return category ? DEFAULT_PRODUCTS.filter((product) => product.category === category) : DEFAULT_PRODUCTS;
  }

  async myProducts(sellerId: string) {
    return this.prisma.product.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createProduct(
    sellerId: string,
    body: { name: string; description?: string; price: number; stock: number; imageUrl?: string; category?: string },
  ) {
    const name = body.name?.trim();
    const price = Number(body.price);
    const stock = Number(body.stock);
    if (!name) throw new BadRequestException('Le nom du produit est requis');
    if (!Number.isFinite(price) || price <= 0) throw new BadRequestException('Le prix doit être supérieur à 0');
    if (!Number.isFinite(stock) || stock < 0) throw new BadRequestException('Le stock ne peut pas être négatif');

    const seller = await this.prisma.user.findUnique({
      where: { id: sellerId },
      select: { username: true, displayName: true, isApprovedSeller: true },
    });
    if (!seller) throw new NotFoundException('Vendeur introuvable');
    if (!seller.isApprovedSeller) {
      throw new BadRequestException('Devenez vendeur validé avant de publier une annonce (CIN + selfie + numéro MVola à soumettre pour validation admin).');
    }

    return this.prisma.product.create({
      data: {
        name,
        description: body.description?.trim() || null,
        price: String(price),
        stock: Math.trunc(stock),
        imageUrl: body.imageUrl?.trim() || null,
        category: body.category?.trim() || 'general',
        sellerId,
        sellerName: seller.displayName || seller.username,
        active: true,
      },
    });
  }

  private async assertOwnerOrAdmin(productId: string, userId: string, isAdmin: boolean) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Produit introuvable');
    if (!isAdmin && product.sellerId !== userId) throw new ForbiddenException('Ce produit ne vous appartient pas');
    return product;
  }

  async updateProduct(
    productId: string,
    userId: string,
    isAdmin: boolean,
    body: { name?: string; description?: string; price?: number; stock?: number; imageUrl?: string; category?: string; active?: boolean },
  ) {
    await this.assertOwnerOrAdmin(productId, userId, isAdmin);
    if (body.price !== undefined && Number(body.price) <= 0) throw new BadRequestException('Le prix doit être supérieur à 0');
    if (body.stock !== undefined && Number(body.stock) < 0) throw new BadRequestException('Le stock ne peut pas être négatif');

    return this.prisma.product.update({
      where: { id: productId },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.description !== undefined ? { description: body.description.trim() || null } : {}),
        ...(body.price !== undefined ? { price: String(Number(body.price)) } : {}),
        ...(body.stock !== undefined ? { stock: Math.trunc(Number(body.stock)) } : {}),
        ...(body.imageUrl !== undefined ? { imageUrl: body.imageUrl.trim() || null } : {}),
        ...(body.category !== undefined ? { category: body.category.trim() || 'general' } : {}),
        ...(body.active !== undefined ? { active: !!body.active } : {}),
      },
    });
  }

  async archiveProduct(productId: string, userId: string, isAdmin: boolean) {
    await this.assertOwnerOrAdmin(productId, userId, isAdmin);
    await this.prisma.product.update({ where: { id: productId }, data: { active: false } });
    return { ok: true };
  }

  async listCategories() {
    const rows = await this.prisma.product.findMany({
      where: { active: true, category: { not: null } },
      select: { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' },
    });
    const categories = rows.map((r) => r.category).filter((c): c is string => !!c);
    return categories.length > 0 ? categories : DEFAULT_PRODUCTS.map((product) => product.category);
  }

  listOrders(userId: string) {
    return this.prisma.marketplaceOrder.findMany({ where: { userId }, include: { product: true }, orderBy: { createdAt: 'desc' } });
  }

  async buy(productId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findFirst({ where: { id: productId, active: true } });
      if (!product || product.stock < 1) throw new BadRequestException('Produit indisponible');
      if (product.sellerId === userId) throw new BadRequestException('Vous ne pouvez pas acheter votre propre produit');

      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new BadRequestException('Portefeuille introuvable');
      const charged = await tx.wallet.updateMany({ where: { id: wallet.id, balance: { gte: product.price } }, data: { balance: { decrement: product.price } } });
      if (charged.count !== 1) throw new BadRequestException('Solde insuffisant');
      await tx.product.update({ where: { id: product.id }, data: { stock: { decrement: 1 } } });
      await tx.transaction.create({ data: { walletId: wallet.id, amount: `-${product.price}`, type: 'marketplace_purchase', meta: JSON.stringify({ productId }) } });

      const price = Number(product.price);
      let commissionAmount = 0;

      if (product.sellerId) {
        commissionAmount = Math.round(price * MARKETPLACE_COMMISSION_RATE);
        const payout = price - commissionAmount;
        const sellerWallet = await tx.wallet.findUnique({ where: { userId: product.sellerId } });
        if (sellerWallet) {
          await tx.wallet.update({ where: { id: sellerWallet.id }, data: { balance: { increment: payout } } });
          await tx.transaction.create({
            data: {
              walletId: sellerWallet.id,
              amount: String(payout),
              type: 'marketplace_sale',
              meta: JSON.stringify({ productId, commissionAmount, buyerId: userId }),
            },
          });
        }

        // Commission → portefeuille plateforme (userId null), même convention
        // que WalletService.distributePayouts pour les frais de partie.
        let platformWallet = await tx.wallet.findFirst({ where: { userId: null } });
        if (!platformWallet) {
          platformWallet = await tx.wallet.create({ data: { balance: String(commissionAmount) } });
        } else {
          await tx.wallet.update({ where: { id: platformWallet.id }, data: { balance: { increment: commissionAmount } } });
        }
        await tx.transaction.create({
          data: { walletId: platformWallet.id, amount: String(commissionAmount), type: 'fee', meta: JSON.stringify({ source: 'marketplace', productId }) },
        });
      }

      return tx.marketplaceOrder.create({ data: { productId, userId, amount: product.price, commissionAmount: String(commissionAmount) } });
    });
  }
}