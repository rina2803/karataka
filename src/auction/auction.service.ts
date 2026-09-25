import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/// Erreur interne : une autre offre a été acceptée pendant notre transaction
/// (concurrence) — on relance simplement la tentative avec l'état frais.
class ConcurrentBidError extends Error {}

@Injectable()
export class AuctionService {
  constructor(private prisma: PrismaService) {}

  /// `AuctionBid.userId` et `AuctionLot.currentBidderId` sont de simples
  /// chaînes (pas de relation Prisma déclarée) — on va chercher les profils
  /// utilisateurs nous-mêmes et on les recolle à la réponse.
  private async attachBidders(lots: any[]) {
    const ids = new Set<string>();
    for (const lot of lots) {
      if (lot.currentBidderId) ids.add(lot.currentBidderId);
      for (const b of lot.bids ?? []) ids.add(b.userId);
    }
    if (ids.size === 0) return lots;
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, username: true, displayName: true, avatarColor: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return lots.map((lot) => ({
      ...lot,
      currentBidder: lot.currentBidderId ? (byId.get(lot.currentBidderId) ?? null) : null,
      bids: (lot.bids ?? []).map((b: any) => ({ ...b, user: byId.get(b.userId) ?? null })),
    }));
  }

  async listActive() {
    const lots = await this.prisma.auctionLot.findMany({
      where: { status: 'active' },
      orderBy: { endsAt: 'asc' },
      include: { bids: { orderBy: { createdAt: 'desc' }, take: 5 } },
    });
    return this.attachBidders(lots);
  }

  async getOne(id: string) {
    const lot = await this.prisma.auctionLot.findUnique({
      where: { id },
      include: { bids: { orderBy: { createdAt: 'desc' }, take: 30 } },
    });
    if (!lot) throw new NotFoundException('Lot introuvable');
    const [withBidders] = await this.attachBidders([lot]);
    return withBidders;
  }

  async placeBid(lotId: string, userId: string, amount: number) {
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Montant invalide');

    for (let attempt = 0; attempt < 3; attempt++) {
      const lot = await this.prisma.auctionLot.findUnique({ where: { id: lotId } });
      if (!lot) throw new NotFoundException('Lot introuvable');
      if (lot.status !== 'active' || lot.endsAt.getTime() <= Date.now()) {
        throw new BadRequestException('Cette enchère est terminée');
      }
      if (lot.currentBidderId === userId) {
        throw new BadRequestException('Vous êtes déjà le meilleur enchérisseur');
      }
      const minBid = Number(lot.currentBid);
      if (amount <= minBid) throw new BadRequestException(`L'offre doit dépasser ${minBid} Ar`);

      const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
      if (!wallet || Number(wallet.balance) < amount) {
        throw new BadRequestException('Solde insuffisant pour cette offre');
      }

      try {
        const result = await this.prisma.$transaction(async (tx) => {
          // Garde de concurrence optimiste : n'accepte la mise que si
          // `currentBid` n'a pas changé depuis notre lecture ci-dessus.
          const updated = await tx.auctionLot.updateMany({
            where: { id: lotId, currentBid: lot.currentBid, status: 'active' },
            data: { currentBid: String(amount), currentBidderId: userId },
          });
          if (updated.count !== 1) throw new ConcurrentBidError();
          await tx.auctionBid.create({ data: { lotId, userId, amount: String(amount) } });
          return tx.auctionLot.findUnique({
            where: { id: lotId },
            include: { bids: { orderBy: { createdAt: 'desc' }, take: 5 } },
          });
        });
        const [withBidders] = await this.attachBidders([result]);
        return withBidders;
      } catch (err) {
        if (err instanceof ConcurrentBidError) continue;
        throw err;
      }
    }
    throw new BadRequestException("Une autre offre vient d'être placée, réessayez.");
  }

  // ---- Administration ------------------------------------------------

  adminList() {
    return this.prisma.auctionLot.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async adminCreate(body: { title: string; description?: string; imageUrl?: string; startingBid: number; endsAt: string }) {
    const title = body.title?.trim();
    const startingBid = Number(body.startingBid);
    const endsAt = new Date(body.endsAt);
    if (!title) throw new BadRequestException('Le titre est requis');
    if (!Number.isFinite(startingBid) || startingBid <= 0) {
      throw new BadRequestException('La mise de départ doit être supérieure à 0');
    }
    if (Number.isNaN(endsAt.getTime()) || endsAt.getTime() <= Date.now()) {
      throw new BadRequestException("La date de fin doit être dans le futur");
    }
    return this.prisma.auctionLot.create({
      data: {
        title,
        description: body.description?.trim() || null,
        imageUrl: body.imageUrl?.trim() || null,
        startingBid: String(startingBid),
        currentBid: String(startingBid),
        status: 'active',
        endsAt,
      },
    });
  }

  async adminUpdate(id: string, body: { title?: string; description?: string; imageUrl?: string; endsAt?: string }) {
    const lot = await this.prisma.auctionLot.findUnique({ where: { id } });
    if (!lot) throw new NotFoundException('Lot introuvable');
    return this.prisma.auctionLot.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title.trim() } : {}),
        ...(body.description !== undefined ? { description: body.description.trim() || null } : {}),
        ...(body.imageUrl !== undefined ? { imageUrl: body.imageUrl.trim() || null } : {}),
        ...(body.endsAt !== undefined ? { endsAt: new Date(body.endsAt) } : {}),
      },
    });
  }

  async adminEnd(id: string) {
    const lot = await this.prisma.auctionLot.findUnique({ where: { id } });
    if (!lot) throw new NotFoundException('Lot introuvable');
    if (lot.status !== 'active') throw new BadRequestException('Ce lot est déjà terminé');

    return this.prisma.$transaction(async (tx) => {
      await tx.auctionLot.update({ where: { id }, data: { status: 'ended' } });
      if (!lot.currentBidderId) return { ok: true, settled: false, reason: 'no-bids' };

      const wallet = await tx.wallet.findUnique({ where: { userId: lot.currentBidderId } });
      if (!wallet || Number(wallet.balance) < Number(lot.currentBid)) {
        return { ok: true, settled: false, reason: 'insufficient-balance' };
      }

      await tx.wallet.update({ where: { id: wallet.id }, data: { balance: { decrement: lot.currentBid } } });
      await tx.transaction.create({
        data: { walletId: wallet.id, amount: `-${lot.currentBid}`, type: 'auction_win', meta: JSON.stringify({ lotId: id }) },
      });

      let platformWallet = await tx.wallet.findFirst({ where: { userId: null } });
      if (!platformWallet) {
        platformWallet = await tx.wallet.create({ data: { balance: String(lot.currentBid) } });
      } else {
        await tx.wallet.update({ where: { id: platformWallet.id }, data: { balance: { increment: lot.currentBid } } });
      }
      await tx.transaction.create({
        data: { walletId: platformWallet.id, amount: String(lot.currentBid), type: 'auction_revenue', meta: JSON.stringify({ lotId: id }) },
      });

      return { ok: true, settled: true };
    });
  }

  async adminDelete(id: string) {
    const bidCount = await this.prisma.auctionBid.count({ where: { lotId: id } });
    if (bidCount > 0) {
      // On ne supprime jamais un historique d'offres réelles — on annule le
      // lot à la place (traçabilité honnête).
      await this.prisma.auctionLot.update({ where: { id }, data: { status: 'cancelled' } });
      return { ok: true, cancelled: true };
    }
    await this.prisma.auctionLot.delete({ where: { id } });
    return { ok: true, deleted: true };
  }
}
