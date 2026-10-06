import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const PUBLIC_USER = {
  id: true,
  username: true,
  displayName: true,
  avatarColor: true,
  avatarImage: true,
  createdAt: true,
  isApprovedSeller: true,
} as const;

type SellerRow = {
  id: string | null;
  name: string;
  avatarColor: string | null;
  avatarImage: string | null;
  productCount: number;
  followerCount: number;
};

/// Pages vendeur publiques et abonnements (« Suivre »).
@Injectable()
export class SellersService {
  constructor(private prisma: PrismaService) {}

  /// Vendeurs ayant au moins un produit actif : vendeurs réels (`id`) et
  /// boutiques officielles historiques (`id` null, identifiées par le nom).
  async list(sort: 'popular' | 'name' = 'name', limit = 50) {
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
        name,
        avatarColor: user?.avatarColor ?? null,
        avatarImage: user?.avatarImage ?? null,
        productCount: (prev?.productCount ?? 0) + g._count._all,
        followerCount: g.sellerId ? followersById.get(g.sellerId) ?? 0 : 0,
      });
    }
    const rows = [...merged.values()];
    rows.sort(
      sort === 'popular'
        ? (a, b) => b.followerCount - a.followerCount || b.productCount - a.productCount
        : (a, b) => a.name.localeCompare(b.name, 'fr'),
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
    await this.prisma.sellerFollow.upsert({
      where: { followerId_sellerId: { followerId, sellerId } },
      create: { followerId, sellerId },
      update: {},
    });
    return { following: true, followerCount: await this.prisma.sellerFollow.count({ where: { sellerId } }) };
  }

  async unfollow(followerId: string, sellerId: string) {
    await this.prisma.sellerFollow.deleteMany({ where: { followerId, sellerId } });
    return { following: false, followerCount: await this.prisma.sellerFollow.count({ where: { sellerId } }) };
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
