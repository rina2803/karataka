import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/// Barème Karataka Points — défini UNIQUEMENT côté serveur. L'app ne fait
/// qu'afficher ; aucune route ne permet à un client de choisir un montant.
export const POINT_RULES = {
  chess_win: { amount: 50, label: "Partie d'échecs gagnée", dailyCap: 10 },
  chess_play: { amount: 10, label: "Partie d'échecs jouée", dailyCap: 5 },
  purchase: { amount: 100, label: 'Achat effectué', dailyCap: 5 },
  tournament_join: { amount: 20, label: 'Inscription à un tournoi', dailyCap: 3 },
  share_product: { amount: 5, label: 'Produit partagé', dailyCap: 3 },
} as const;

export type PointReason = keyof typeof POINT_RULES;

/// Une partie en ligne ne rapporte des points qu'après ce nombre de coups
/// (numéro de coup FEN) : bloque les parties « éclair » montées entre comptes.
export const MIN_CHESS_MOVES_FOR_POINTS = 10;
/// Victoires récompensées par jour contre un même adversaire.
export const MAX_WINS_VS_SAME_OPPONENT_PER_DAY = 2;

/// Début de la journée à Madagascar (UTC+3), en UTC.
export function startOfMadagascarDay(now = new Date()) {
  const shifted = new Date(now.getTime() + 3 * 3600_000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - 3 * 3600_000);
}

@Injectable()
export class PointsService {
  private readonly log = new Logger(PointsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Attribue les points d'une règle, au plus une fois par `refKey` et dans la
   * limite du plafond journalier. Ne lève jamais : un échec d'attribution ne
   * doit pas casser l'action principale (achat, partie…).
   */
  async award(userId: string, reason: PointReason, refKey: string): Promise<number> {
    const rule = POINT_RULES[reason];
    try {
      const today = await this.prisma.pointTransaction.count({
        where: { userId, reason, createdAt: { gte: startOfMadagascarDay() } },
      });
      if (today >= rule.dailyCap) return 0;
      await this.prisma.$transaction([
        this.prisma.pointTransaction.create({
          data: { userId, reason, refKey: `${reason}:${refKey}`, amount: rule.amount, label: rule.label },
        }),
        this.prisma.user.update({ where: { id: userId }, data: { points: { increment: rule.amount } } }),
      ]);
      return rule.amount;
    } catch (error) {
      // P2002 = refKey déjà utilisé : points déjà attribués, rien à faire.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
        this.log.warn(`award ${reason} ${refKey} failed: ${(error as Error).message}`);
      }
      return 0;
    }
  }

  /// Points de fin de partie d'échecs en ligne (appelé par le serveur de jeu,
  /// jamais par l'app).
  async awardChessResult(matchId: string, playerIds: string[], winnerId: string | null, fullMoves: number) {
    if (fullMoves < MIN_CHESS_MOVES_FOR_POINTS || playerIds.length !== 2) return;
    for (const id of playerIds) await this.award(id, 'chess_play', `${matchId}:${id}`);
    if (!winnerId) return;
    const opponentId = playerIds.find((id) => id !== winnerId);
    if (!opponentId) return;
    const winsVsOpponent = await this.prisma.pointTransaction.count({
      where: {
        userId: winnerId,
        reason: 'chess_win',
        refKey: { endsWith: `:${opponentId}` },
        createdAt: { gte: startOfMadagascarDay() },
      },
    });
    if (winsVsOpponent >= MAX_WINS_VS_SAME_OPPONENT_PER_DAY) return;
    await this.award(winnerId, 'chess_win', `${matchId}:${opponentId}`);
  }

  async summary(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { points: true } });
    return { points: user?.points ?? 0 };
  }

  async history(userId: string, page: number, limit: number) {
    const [total, items] = await Promise.all([
      this.prisma.pointTransaction.count({ where: { userId } }),
      this.prisma.pointTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: { id: true, amount: true, reason: true, label: true, createdAt: true },
      }),
    ]);
    return { items, page, limit, total, hasMore: page * limit < total };
  }

  rules() {
    return Object.entries(POINT_RULES).map(([reason, r]) => ({ reason, ...r }));
  }
}
