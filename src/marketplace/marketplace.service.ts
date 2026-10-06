import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PointsService } from '../points/points.service';
import { NotificationsService } from '../notifications/notifications.service';
import { formatAr } from '../common/format';
import { clampInt } from '../common/pagination';
import { fallbackProductImage } from '../seed-catalog';

/// Commission plateforme sur les ventes entre joueurs (produits avec un
/// `sellerId` réel) — les produits officiels (sellerId null) n'en paient pas,
/// leur revenu revient déjà entièrement à la plateforme.
const MARKETPLACE_COMMISSION_RATE = 0.05;

const DEFAULT_PRODUCTS = [
  { id: 'tsenabe-tshirt', name: 'T-shirt Lalao & Karataka', description: 'T-shirt officiel du jeu.', price: 25000, stock: 20, category: 'Vêtements', sellerName: 'Tsenabe officiel', imageUrl: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=640&q=85', active: true },
  { id: 'tsenabe-cap', name: 'Casquette L&K', description: 'Casquette officielle bleu électrique.', price: 18000, stock: 15, category: 'Accessoires', sellerName: 'Tsenabe officiel', imageUrl: 'https://images.unsplash.com/photo-1521369909029-2afed882baee?w=640&q=85', active: true },
  { id: 'tsenabe-mug', name: 'Mug Tsenabe', description: 'Mug collector pour les joueurs.', price: 12000, stock: 30, category: 'Maison', sellerName: 'Tsenabe officiel', imageUrl: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=640&q=85', active: true },
];

const CATEGORY_PRIORITY = ['Repas', 'Vêtements', 'Beauté'];

const SELLER_SELECT = { id: true, username: true, displayName: true, avatarColor: true, avatarImage: true } as const;

/// `mode: insensitive` n'existe qu'en PostgreSQL ; SQLite (local) compare
/// déjà sans casse en ASCII via LIKE.
const INSENSITIVE = /^postgres(ql)?:\/\//.test(process.env.DATABASE_URL || '') ? { mode: 'insensitive' as const } : {};

export type ProductPageQuery = {
  page?: string | number;
  limit?: string | number;
  q?: string;
  category?: string;
  sellerId?: string;
  sellerName?: string;
  promo?: boolean;
  sort?: 'newest' | 'price_asc' | 'price_desc' | 'popular';
};

function withImage<T extends { imageUrl: string | null; category: string | null }>(product: T) {
  return { ...product, imageUrl: product.imageUrl || fallbackProductImage(product.category) };
}

@Injectable()
export class MarketplaceService {
  constructor(
    private prisma: PrismaService,
    private points: PointsService,
    private notifications: NotificationsService,
  ) {}

  async listProducts(category?: string) {
    const products = await this.prisma.product.findMany({
      where: {
        active: true,
        ...(category ? { category } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { seller: { select: SELLER_SELECT } },
    });
    if (products.length > 0) {
      return products.map(withImage);
    }
    return category ? DEFAULT_PRODUCTS.filter((product) => product.category === category) : DEFAULT_PRODUCTS;
  }

  /// Liste paginée (boutique, accueil, page vendeur) : filtres et tri faits
  /// en base, pour ne jamais charger tout le catalogue sur le téléphone.
  async listProductsPage(opts: ProductPageQuery) {
    const page = clampInt(opts.page, 1, 1, 10_000);
    const limit = clampInt(opts.limit, 20, 1, 50);
    const q = opts.q?.trim();
    const where: Prisma.ProductWhereInput = {
      active: true,
      ...(opts.category ? { category: opts.category } : {}),
      ...(opts.sellerId ? { sellerId: opts.sellerId } : {}),
      ...(opts.sellerName ? { sellerId: null, sellerName: opts.sellerName } : {}),
      ...(opts.promo ? { isPromo: true } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, ...INSENSITIVE } },
              { description: { contains: q, ...INSENSITIVE } },
              { sellerName: { contains: q, ...INSENSITIVE } },
              { category: { contains: q, ...INSENSITIVE } },
            ],
          }
        : {}),
    };
    const orderBy: Prisma.ProductOrderByWithRelationInput[] =
      opts.sort === 'price_asc'
        ? [{ price: 'asc' }]
        : opts.sort === 'price_desc'
          ? [{ price: 'desc' }]
          : opts.sort === 'popular'
            ? [{ cartItems: { _count: 'desc' } }, { createdAt: 'desc' }]
            : [{ createdAt: 'desc' }];
    const [total, products] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: { seller: { select: SELLER_SELECT } },
      }),
    ]);
    return { items: products.map(withImage), page, limit, total, hasMore: page * limit < total };
  }

  async getProduct(id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, active: true },
      include: { seller: { select: SELLER_SELECT } },
    });
    if (!product) throw new NotFoundException('Produit introuvable');
    return withImage(product);
  }

  /// Partage d'un produit : compté pour les statistiques ; si l'utilisateur
  /// est connecté, points de partage (une fois par produit, plafonnés/jour).
  /// Le partage lui-même n'est pas vérifiable : d'où le petit montant.
  async recordShare(productId: string, userId: string | undefined, channel: string) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, active: true }, select: { id: true } });
    if (!product) throw new NotFoundException('Produit introuvable');
    const safeChannel = ['native', 'facebook', 'whatsapp', 'copy'].includes(channel) ? channel : 'native';
    await this.prisma.productShare.create({ data: { productId, userId: userId ?? null, channel: safeChannel } });
    const points = userId ? await this.points.award(userId, 'share_product', `${productId}:${userId}`) : 0;
    return { ok: true, points };
  }

  productPhoto(productId: string) {
    return this.prisma.productPhoto.findUnique({ where: { productId } });
  }

  /// Enregistre une photo base64 (« data:image/png;base64,... » accepté) et
  /// renvoie le chemin public à mettre dans `imageUrl`.
  private async savePhoto(productId: string, raw: string) {
    const match = /^data:(image\/[a-z+]+);base64,(.*)$/s.exec(raw.trim());
    const mimeType = match ? match[1] : 'image/jpeg';
    const data = (match ? match[2] : raw).replace(/\s+/g, '');
    if (data.length < 100 || data.length > 8_000_000) {
      throw new BadRequestException('Photo invalide ou trop lourde (8 Mo max)');
    }
    await this.prisma.productPhoto.upsert({
      where: { productId },
      create: { productId, mimeType, data },
      update: { mimeType, data },
    });
    const imageUrl = `/marketplace/products/${productId}/image?v=${Date.now()}`;
    await this.prisma.product.update({ where: { id: productId }, data: { imageUrl } });
    return imageUrl;
  }

  async myProducts(sellerId: string) {
    return this.prisma.product.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createProduct(
    sellerId: string,
    body: { name: string; description?: string; price: number; stock: number; imageUrl?: string; imageBase64?: string; category?: string },
  ) {
    const name = body.name?.trim();
    const price = Number(body.price);
    const stock = Number(body.stock);
    if (!name) throw new BadRequestException('Le nom du produit est requis');
    if (!Number.isFinite(price) || price <= 0) throw new BadRequestException('Le prix doit être supérieur à 0');
    if (!Number.isFinite(stock) || stock < 0) throw new BadRequestException('Le stock ne peut pas être négatif');
    const imageUrl = body.imageUrl?.trim();
    const hasLink = !!imageUrl && /^https?:\/\//.test(imageUrl);
    if (!hasLink && !body.imageBase64) throw new BadRequestException('Ajoute une photo du produit');

    const seller = await this.prisma.user.findUnique({
      where: { id: sellerId },
      select: { username: true, displayName: true, isApprovedSeller: true },
    });
    if (!seller) throw new NotFoundException('Vendeur introuvable');
    if (!seller.isApprovedSeller) {
      throw new BadRequestException('Devenez vendeur validé avant de publier une annonce (CIN + selfie + numéro MVola à soumettre pour validation admin).');
    }

    const product = await this.prisma.product.create({
      data: {
        name,
        description: body.description?.trim() || null,
        price: String(price),
        stock: Math.trunc(stock),
        imageUrl: hasLink ? imageUrl : null,
        category: body.category?.trim() || 'general',
        sellerId,
        sellerName: seller.displayName || seller.username,
        active: true,
      },
    });
    if (!hasLink) product.imageUrl = await this.savePhoto(product.id, body.imageBase64!);
    return product;
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
    body: { name?: string; description?: string; price?: number; stock?: number; imageUrl?: string; imageBase64?: string; category?: string; active?: boolean },
  ) {
    await this.assertOwnerOrAdmin(productId, userId, isAdmin);
    if (body.price !== undefined && Number(body.price) <= 0) throw new BadRequestException('Le prix doit être supérieur à 0');
    if (body.stock !== undefined && Number(body.stock) < 0) throw new BadRequestException('Le stock ne peut pas être négatif');
    if (body.imageBase64) await this.savePhoto(productId, body.imageBase64);
    if (body.imageUrl !== undefined && !body.imageBase64 && !/^(https?:\/\/|\/marketplace\/products\/)/.test(body.imageUrl.trim())) {
      throw new BadRequestException('Un produit doit garder une photo (lien http/https)');
    }

    return this.prisma.product.update({
      where: { id: productId },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.description !== undefined ? { description: body.description.trim() || null } : {}),
        ...(body.price !== undefined ? { price: String(Number(body.price)) } : {}),
        ...(body.stock !== undefined ? { stock: Math.trunc(Number(body.stock)) } : {}),
        ...(body.imageUrl !== undefined ? { imageUrl: body.imageUrl.trim() } : {}),
        ...(body.category !== undefined ? { category: body.category.trim() || 'general' } : {}),
        ...(body.active !== undefined ? { active: !!body.active } : {}),
      },
    });
  }

  /// Le vendeur baisse son prix après création : l'ancien prix devient le
  /// prix barré et le produit apparaît dans « Promotions ». Ses abonnés
  /// sont prévenus à la première mise en promo.
  async setPromo(productId: string, userId: string, isAdmin: boolean, promoPrice: number) {
    const product = await this.assertOwnerOrAdmin(productId, userId, isAdmin);
    const regular = Number(product.isPromo && product.originalPrice ? product.originalPrice : product.price);
    const price = Math.round(Number(promoPrice));
    if (!Number.isFinite(price) || price <= 0) throw new BadRequestException('Prix promo invalide');
    if (price >= regular) throw new BadRequestException(`Le prix promo doit être inférieur à ${formatAr(regular)}`);
    const wasPromo = product.isPromo;
    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: { price: String(price), originalPrice: String(regular), isPromo: true },
    });
    if (!wasPromo && product.sellerId) {
      const followers = await this.prisma.sellerFollow.findMany({ where: { sellerId: product.sellerId }, select: { followerId: true } });
      const percent = Math.round(100 - (price * 100) / regular);
      await this.notifications.notifyUsers(
        followers.map((f) => f.followerId),
        {
          type: 'follow',
          title: `Promo -${percent} % chez ${product.sellerName ?? 'un vendeur suivi'}`,
          body: `${product.name} : ${formatAr(price)} au lieu de ${formatAr(regular)}`,
          data: { productId, screen: 'product' },
        },
      );
    }
    return updated;
  }

  async endPromo(productId: string, userId: string, isAdmin: boolean) {
    const product = await this.assertOwnerOrAdmin(productId, userId, isAdmin);
    if (!product.isPromo) return product;
    return this.prisma.product.update({
      where: { id: productId },
      data: { price: product.originalPrice ?? product.price, originalPrice: null, isPromo: false },
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
    const categories = rows.map((r) => r.category).filter((c): c is string => !!c && c !== 'general');
    const list = categories.length > 0 ? categories : DEFAULT_PRODUCTS.map((product) => product.category);
    // Ordre voulu : Repas, Vêtements, Beauté, puis les autres (alphabétique).
    const rank = (c: string) => {
      const i = CATEGORY_PRIORITY.indexOf(c);
      return i === -1 ? CATEGORY_PRIORITY.length : i;
    };
    return [...list].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'fr'));
  }

  listOrders(userId: string) {
    return this.prisma.marketplaceOrder.findMany({ where: { userId }, include: { product: true }, orderBy: { createdAt: 'desc' } });
  }

  async buy(productId: string, userId: string) {
    const order = await this.prisma.$transaction(async (tx) => {
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
    await this.points.award(userId, 'purchase', `market:${order.id}`);
    return order;
  }
}