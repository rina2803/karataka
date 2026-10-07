import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/// Barème Karataka Points — défini UNIQUEMENT côté serveur. L'app ne fait
/// qu'afficher ; aucune route ne permet à un client de choisir un montant.
export const POINT_RULES = {
  chess_win: { amount: 50, label: "Partie d'échecs gagnée", dailyCap: 10 },
  chess_play: { amount: 10, label: "Partie d'échecs jouée", dailyCap: 5 },
  game_win: { amount: 30, label: 'Partie en ligne gagnée', dailyCap: 10 },
  game_play: { amount: 5, label: 'Partie en ligne jouée', dailyCap: 10 },
  purchase: { amount: 100, label: 'Achat effectué', dailyCap: 5 },
  tournament_join: { amount: 20, label: 'Inscription à un tournoi', dailyCap: 3 },
  share_product: { amount: 5, label: 'Produit partagé', dailyCap: 3 },
  daily_spin: { amount: 0, label: 'Roue du jour', dailyCap: 1 },
  referral_referrer: { amount: 100, label: 'Parrainage : votre filleul a fait son 1er achat', dailyCap: 10 },
  referral_welcome: { amount: 50, label: 'Bienvenue : bonus de parrainage', dailyCap: 1 },
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
  async award(userId: string, reason: PointReason, refKey: string, amountOverride?: number): Promise<number> {
    const base = POINT_RULES[reason];
    const rule = { ...base, amount: amountOverride ?? base.amount };
    if (rule.amount <= 0) return 0;
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

  /// Points de fin de partie des autres jeux en ligne (dames, fanorona,
  /// ludo, belote, domino, morpion, puissance 4, quiz). Appelé uniquement
  /// par le serveur de jeu, pour des parties sans bot assez longues.
  async awardGameResult(matchId: string, playerIds: string[], winnerIds: string[]) {
    if (playerIds.length < 2) return;
    for (const id of playerIds) await this.award(id, 'game_play', `${matchId}:${id}`);
    for (const winnerId of winnerIds) {
      const opponents = playerIds.filter((id) => id !== winnerId && !winnerIds.includes(id));
      // Une victoire « farmée » contre le même adversaire ne rapporte que 2 fois par jour.
      const key = opponents.sort().join(',');
      const already = await this.prisma.pointTransaction.count({
        where: {
          userId: winnerId,
          reason: 'game_win',
          refKey: { endsWith: `:${key}` },
          createdAt: { gte: startOfMadagascarDay() },
        },
      });
      if (already >= MAX_WINS_VS_SAME_OPPONENT_PER_DAY) continue;
      await this.award(winnerId, 'game_win', `${matchId}:${winnerId}:${key}`);
    }
  }

  // ——— Roue du jour ———

  /// Cases de la roue (points) et leur poids de tirage.
  static readonly SPIN_PRIZES = [5, 10, 15, 20, 30, 50, 100, 200];
  private static readonly SPIN_WEIGHTS = [30, 25, 15, 12, 8, 6, 3, 1];

  private dayKey(date = new Date()) {
    return startOfMadagascarDay(date).toISOString().slice(0, 10);
  }

  async spinStatus(userId: string) {
    const today = this.dayKey();
    const last = await this.prisma.dailySpin.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
    const yesterday = this.dayKey(new Date(Date.now() - 24 * 3600_000));
    const streak = !last ? 0 : last.day === today || last.day === yesterday ? last.streak : 0;
    return {
      prizes: PointsService.SPIN_PRIZES,
      spunToday: last?.day === today,
      lastPrize: last?.day === today ? last.prize : null,
      streak,
      nextDayBonus: Math.min(30, 5 * (last?.day === today ? streak : streak + 1)),
    };
  }

  /// Un tirage par jour ; une série de jours consécutifs ajoute un bonus
  /// (+5 par jour, jusqu'à +30).
  async spin(userId: string) {
    const status = await this.spinStatus(userId);
    if (status.spunToday) return { ...status, error: "Vous avez déjà tourné la roue aujourd'hui, revenez demain !" };
    const total = PointsService.SPIN_WEIGHTS.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    let index = 0;
    while (roll >= PointsService.SPIN_WEIGHTS[index]) roll -= PointsService.SPIN_WEIGHTS[index++];
    const prize = PointsService.SPIN_PRIZES[index];
    const streak = status.streak + 1;
    const bonus = Math.min(30, 5 * streak);
    const day = this.dayKey();
    try {
      await this.prisma.dailySpin.create({ data: { userId, day, prize: prize + bonus, streak } });
    } catch {
      return { ...status, spunToday: true, error: "Vous avez déjà tourné la roue aujourd'hui" };
    }
    const earned = await this.award(userId, 'daily_spin', `${userId}:${day}`, prize + bonus);
    return { prizes: PointsService.SPIN_PRIZES, index, prize, bonus, streak, earned, spunToday: true };
  }

  // ——— Parrainage ———

  async referral(userId: string, publicBase: string) {
    let user = await this.prisma.user.findUnique({ where: { id: userId }, select: { referralCode: true, username: true } });
    if (!user) return null;
    if (!user.referralCode) {
      const base = user.username.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase() || 'KARA';
      for (let i = 0; i < 5 && !user.referralCode; i++) {
        const code = `${base}${Math.floor(100 + Math.random() * 900)}`;
        try {
          user = await this.prisma.user.update({ where: { id: userId }, data: { referralCode: code }, select: { referralCode: true, username: true } });
        } catch {
          /* code déjà pris : on retente */
        }
      }
    }
    const [invited, earned] = await Promise.all([
      this.prisma.user.count({ where: { referredById: userId } }),
      this.prisma.pointTransaction.aggregate({ where: { userId, reason: 'referral_referrer' }, _sum: { amount: true } }),
    ]);
    return {
      code: user.referralCode,
      link: `${publicBase}/download`,
      invited,
      earned: earned._sum.amount ?? 0,
      rewardReferrer: POINT_RULES.referral_referrer.amount,
      rewardWelcome: POINT_RULES.referral_welcome.amount,
    };
  }

  /// Enregistre le parrain à l'inscription (code saisi par le filleul).
  async attachReferrer(userId: string, code?: string) {
    const clean = (code ?? '').trim().toUpperCase();
    if (!clean) return;
    const referrer = await this.prisma.user.findUnique({ where: { referralCode: clean }, select: { id: true } });
    if (!referrer || referrer.id === userId) return;
    await this.prisma.user.update({ where: { id: userId }, data: { referredById: referrer.id } });
  }

  /// Premier achat livré d'un filleul : bonus pour lui et pour son parrain
  /// (une seule fois — la clé de référence l'empêche de se répéter).
  async rewardReferral(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { referredById: true } });
    if (!user?.referredById) return;
    const welcome = await this.award(userId, 'referral_welcome', userId);
    if (welcome > 0) await this.award(user.referredById, 'referral_referrer', userId);
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
    return Object.entries(POINT_RULES)
      .filter(([, r]) => r.amount > 0)
      .map(([reason, r]) => ({ reason, ...r }));
  }
}
