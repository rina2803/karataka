import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const PUBLIC_USER = {
  id: true,
  username: true,
  displayName: true,
  avatarColor: true,
  avatarImage: true,
  createdAt: true,
  isApprovedSeller: true,
  isPartner: true,
} as const;

type SellerRow = {
  id: string | null;
  isPartner: boolean;
  name: string;
  avatarColor: string | null;
  avatarImage: string | null;
  productCount: number;
  followerCount: number;
};

/// Pages vendeur publiques et abonnements (« Suivre »).
@Injectable()
export class SellersService {
  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  /// Vendeurs ayant au moins un produit actif : vendeurs réels (`id`) et
  /// boutiques officielles historiques (`id` null, identifiées par le nom).
  async list(sort: 'popular' | 'name' = 'name', limit = 50, partnersOnly = false) {
    const groups = await this.prisma.product.groupBy({
      by: ['sellerId', 'sellerName'],
      where: { active: true },
      _count: { _all: true },
    });
    const ids = [...new Set(groups.map((g) => g.sellerId).filter((id): id is string => !!id))];
    const [users, followers] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: ids } }, select: PUBLIC_USER }),
      this.prisma.sellerFollow.groupBy({ by: ['sellerId'], where: { sellerId: { in: ids } }, _count: { _all: true } }),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const followersById = new Map(followers.map((f) => [f.sellerId, f._count._all]));

    const merged = new Map<string, SellerRow>();
    for (const g of groups) {
      const user = g.sellerId ? userById.get(g.sellerId) : undefined;
      const name = user ? user.displayName || user.username : g.sellerName || 'Tsenabe officiel';
      const key = g.sellerId ? `id:${g.sellerId}` : `name:${name.toLowerCase()}`;
      const prev = merged.get(key);
      merged.set(key, {
        id: g.sellerId,
        isPartner: user?.isPartner ?? false,
        name,
        avatarColor: user?.avatarColor ?? null,
        avatarImage: user?.avatarImage ?? null,
        productCount: (prev?.productCount ?? 0) + g._count._all,
        followerCount: g.sellerId ? followersById.get(g.sellerId) ?? 0 : 0,
      });
    }
    const rows = [...merged.values()].filter((r) => !partnersOnly || r.isPartner);
    // Partenaires toujours en tête, puis tri demandé.
    rows.sort(
      (a, b) =>
        Number(b.isPartner) - Number(a.isPartner) ||
        (sort === 'popular'
          ? b.followerCount - a.followerCount || b.productCount - a.productCount
          : a.name.localeCompare(b.name, 'fr')),
    );
    return rows.slice(0, limit);
  }

  async profile(sellerId: string, viewerId?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: sellerId }, select: PUBLIC_USER });
    if (!user) throw new NotFoundException('Vendeur introuvable');
    const [productCount, followerCount, cartSales, directSales, promoCount, following] = await Promise.all([
      this.prisma.product.count({ where: { sellerId, active: true } }),
      this.prisma.sellerFollow.count({ where: { sellerId } }),
      this.prisma.cartOrderItem.aggregate({
        where: { sellerId, order: { status: 'delivered' } },
        _sum: { quantity: true },
      }),
      this.prisma.marketplaceOrder.count({ where: { product: { sellerId } } }),
      this.prisma.product.count({ where: { sellerId, active: true, isPromo: true } }),
      viewerId
        ? this.prisma.sellerFollow.findUnique({ where: { followerId_sellerId: { followerId: viewerId, sellerId } } })
        : Promise.resolve(null),
    ]);
    return {
      id: user.id,
      name: user.displayName || user.username,
      username: user.username,
      avatarColor: user.avatarColor,
      avatarImage: user.avatarImage,
      memberSince: user.createdAt,
      verified: user.isApprovedSeller,
      isPartner: user.isPartner,
      productCount,
      promoCount,
      followerCount,
      salesCount: (cartSales._sum.quantity ?? 0) + directSales,
      isFollowing: !!following,
      isMe: viewerId === sellerId,
    };
  }

  async follow(followerId: string, sellerId: string) {
    if (followerId === sellerId) throw new BadRequestException('Vous ne pouvez pas vous suivre vous-même');
    const seller = await this.prisma.user.findUnique({ where: { id: sellerId }, select: { id: true } });
    if (!seller) throw new NotFoundException('Vendeur introuvable');
    const existing = await this.prisma.sellerFollow.findUnique({
      where: { followerId_sellerId: { followerId, sellerId } },
    });
    if (!existing) {
      await this.prisma.sellerFollow.create({ data: { followerId, sellerId } });
      const follower = await this.prisma.user.findUnique({ where: { id: followerId }, select: { displayName: true, username: true } });
      await this.notifications.notifyUser(sellerId, {
        type: 'follow',
        title: 'Nouvel abonné',
        body: `${follower?.displayName || follower?.username || 'Quelqu\'un'} suit maintenant votre boutique.`,
        data: { screen: 'seller', sellerId },
      });
    }
    return { following: true, followerCount: await this.prisma.sellerFollow.count({ where: { sellerId } }) };
  }

  async unfollow(followerId: string, sellerId: string) {
    await this.prisma.sellerFollow.deleteMany({ where: { followerId, sellerId } });
    return { following: false, followerCount: await this.prisma.sellerFollow.count({ where: { sellerId } }) };
  }

  /// Admin : vendeurs validés avec leur statut partenaire.
  async adminList() {
    const users = await this.prisma.user.findMany({
      where: { OR: [{ isApprovedSeller: true }, { isPartner: true }] },
      select: { ...PUBLIC_USER, _count: { select: { productsForSale: true, followers: true } } },
      orderBy: [{ isPartner: 'desc' }, { createdAt: 'desc' }],
    });
    return users.map((u) => ({
      id: u.id,
      name: u.displayName || u.username,
      avatarColor: u.avatarColor,
      isPartner: u.isPartner,
      productCount: u._count.productsForSale,
      followerCount: u._count.followers,
    }));
  }

  async setPartner(sellerId: string, isPartner: boolean) {
    const user = await this.prisma.user.findUnique({ where: { id: sellerId }, select: { id: true, isPartner: true } });
    if (!user) throw new NotFoundException('Vendeur introuvable');
    await this.prisma.user.update({ where: { id: sellerId }, data: { isPartner } });
    if (isPartner && !user.isPartner) {
      await this.notifications.notifyUser(sellerId, {
        type: 'seller',
        title: 'Vous êtes magasin partenaire ⭐',
        body: 'Votre boutique est maintenant mise en avant sur l\'accueil Karataka.',
        data: { screen: 'seller', sellerId },
      });
    }
    return { ok: true, isPartner };
  }

  async following(userId: string) {
    const rows = await this.prisma.sellerFollow.findMany({
      where: { followerId: userId },
      orderBy: { createdAt: 'desc' },
      include: { seller: { select: PUBLIC_USER } },
    });
    return rows.map((r) => ({
      id: r.seller.id,
      name: r.seller.displayName || r.seller.username,
      avatarColor: r.seller.avatarColor,
      avatarImage: r.seller.avatarImage,
      followedAt: r.createdAt,
    }));
  }
}
