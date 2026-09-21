import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';

@Injectable()
export class GamesService {
  constructor(private prisma: PrismaService, private wallet: WalletService) {}

  private async ensureDefaultTournaments() {
    const count = await this.prisma.tournament.count();
    if (count > 0) return;

    const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await this.prisma.tournament.createMany({
      data: [
        { name: 'Tournoi Échecs du soir', entryFee: '0', startsAt: start },
        { name: 'Tournoi Fanorona', entryFee: '0', startsAt: new Date(start.getTime() + 24 * 60 * 60 * 1000) },
        { name: 'Dames du week-end', entryFee: '0', startsAt: new Date(start.getTime() + 2 * 24 * 60 * 60 * 1000) },
      ],
    });
  }

  async listTournaments() {
    await this.ensureDefaultTournaments();
    return this.prisma.tournament.findMany({
      orderBy: { startsAt: 'asc' },
      include: {
        participants: {
          include: { user: { select: { id: true, username: true, displayName: true, avatarColor: true } } },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });
  }

  async listParticipants(tournamentId: string) {
    const tournament = await this.prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!tournament) throw new BadRequestException('Tournament not found');
    return this.prisma.tournamentParticipant.findMany({
      where: { tournamentId },
      orderBy: { joinedAt: 'asc' },
      include: { user: { select: { id: true, username: true, displayName: true, avatarColor: true } } },
    });
  }

  async createTournament(body: { name: string; entryFee: number; startsAt: string }) {
    const startsAt = new Date(body.startsAt);
    if (!body.name?.trim() || Number(body.entryFee) < 0 || !body.startsAt || Number.isNaN(startsAt.getTime())) {
      throw new BadRequestException('Invalid tournament data');
    }
    return this.prisma.tournament.create({
      data: { name: body.name.trim(), entryFee: String(body.entryFee), startsAt },
    });
  }

  async joinTournament(tournamentId: string, userId: string) {
    const tournament = await this.prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!tournament) throw new BadRequestException('Tournament not found');
    if (tournament.startsAt <= new Date()) throw new BadRequestException('Tournament already started');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.tournamentParticipant.findUnique({
          where: { tournamentId_userId: { tournamentId, userId } },
        });
        if (existing) return { ok: true, alreadyJoined: true, participant: existing };

        const wallet = await tx.wallet.findUnique({ where: { userId } });
        if (!wallet) throw new BadRequestException('Wallet not found');
        const charged = await tx.wallet.updateMany({
          where: { id: wallet.id, balance: { gte: tournament.entryFee } },
          data: { balance: { decrement: tournament.entryFee } },
        });
        if (charged.count !== 1) throw new BadRequestException('Insufficient funds');

        await tx.transaction.create({
          data: {
            walletId: wallet.id,
            amount: `-${tournament.entryFee}`,
            type: 'challenge_entry',
            meta: JSON.stringify({ tournamentId }),
          },
        });
        const participant = await tx.tournamentParticipant.create({ data: { tournamentId, userId } });
        return { ok: true, alreadyJoined: false, participant };
      });
    } catch (error: any) {
      if (error?.code === 'P2002') return { ok: true, alreadyJoined: true };
      throw error;
    }
  }

  async createMatch(gameId: string, creatorId: string, betAmount: string) {
    // create match with initial state
    const match = await this.prisma.match.create({ data: { gameId, state: '{}', betAmount } });
    // add creator as player
    await this.prisma.gamePlayer.create({ data: { userId: creatorId, matchId: match.id, side: 'A' } });
    return match;
  }

  async joinMatch(matchId: string, userId: string, side = 'B') {
    const match = await this.prisma.match.findUnique({ where: { id: matchId } });
    if (!match) throw new BadRequestException('Match not found');
    await this.prisma.gamePlayer.create({ data: { userId, matchId, side } });
    return { ok: true };
  }

  async finishMatch(matchId: string, winnerUserId: string) {
    const match = await this.prisma.match.findUnique({ where: { id: matchId } });
    if (!match) throw new BadRequestException('Match not found');
    // pay out
    const res = await this.wallet.distributePayouts(winnerUserId, match.betAmount.toString());
    await this.prisma.match.update({ where: { id: matchId }, data: { winnerId: winnerUserId } });
    return res;
  }
}
