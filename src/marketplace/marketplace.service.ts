import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
    });
    if (products.length > 0) return products;
    return category ? DEFAULT_PRODUCTS.filter((product) => product.category === category) : DEFAULT_PRODUCTS;
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
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new BadRequestException('Portefeuille introuvable');
      const charged = await tx.wallet.updateMany({ where: { id: wallet.id, balance: { gte: product.price } }, data: { balance: { decrement: product.price } } });
      if (charged.count !== 1) throw new BadRequestException('Solde insuffisant');
      await tx.product.update({ where: { id: product.id }, data: { stock: { decrement: 1 } } });
      await tx.transaction.create({ data: { walletId: wallet.id, amount: `-${product.price}`, type: 'marketplace_purchase', meta: JSON.stringify({ productId }) } });
      return tx.marketplaceOrder.create({ data: { productId, userId, amount: product.price } });
    });
  }
}