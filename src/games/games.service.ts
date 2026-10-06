import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { PointsService } from '../points/points.service';
import { NotificationsService } from '../notifications/notifications.service';

/// Écart entre le début de chaque ronde du bracket — donne un vrai « emploi
/// du temps » du tournoi sans dépendre de la durée réelle des parties.
const ROUND_GAP_MINUTES = 25;

/// Tailles de tournoi possibles (bracket à élimination directe).
const TOURNAMENT_SIZES = [2, 4, 8, 16, 32];
const TOURNAMENT_GAMES = ['chess', 'checkers', 'fanorona'];

@Injectable()
export class GamesService {
  constructor(
    private prisma: PrismaService,
    private wallet: WalletService,
    private points: PointsService,
    private notifications: NotificationsService,
  ) {}

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

  async createTournament(
    creatorId: string,
    body: { name: string; entryFee: number; startsAt: string; maxParticipants?: number; game?: string },
  ) {
    const startsAt = new Date(body.startsAt);
    const name = body.name?.trim() ?? '';
    if (!name || name.length > 60 || Number(body.entryFee) < 0 || !body.startsAt || Number.isNaN(startsAt.getTime())) {
      throw new BadRequestException('Nom, frais et date du tournoi requis');
    }
    const maxParticipants = Number(body.maxParticipants ?? 8);
    if (!TOURNAMENT_SIZES.includes(maxParticipants)) {
      throw new BadRequestException(`Nombre de joueurs possible : ${TOURNAMENT_SIZES.join(', ')}`);
    }
    const game = TOURNAMENT_GAMES.includes(body.game ?? '') ? body.game! : 'chess';
    const tournament = await this.prisma.tournament.create({
      data: { name, entryFee: String(Number(body.entryFee) || 0), startsAt, maxParticipants, game, createdById: creatorId },
    });
    await this.notifications.notifyAdmins({
      type: 'tournament',
      title: 'Nouveau tournoi créé',
      body: `« ${name} » — ${maxParticipants} joueurs`,
      data: { tournamentId: tournament.id, screen: 'tournament' },
    });
    return tournament;
  }

  async joinTournament(tournamentId: string, userId: string) {
    const tournament = await this.prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!tournament) throw new BadRequestException('Tournament not found');
    if (tournament.status !== 'open' || tournament.bracketGenerated) {
      throw new BadRequestException('Les inscriptions de ce tournoi sont fermées');
    }
    if (tournament.startsAt <= new Date()) throw new BadRequestException('Tournament already started');
    const count = await this.prisma.tournamentParticipant.count({ where: { tournamentId } });
    if (count >= tournament.maxParticipants) throw new BadRequestException('Ce tournoi est complet');

    try {
      const result = await this.prisma.$transaction(async (tx) => {
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
      // Points seulement pour les tournois payants : un tournoi gratuit
      // pourrait être créé/rejoint en boucle pour farmer des points.
      if (!result.alreadyJoined && Number(tournament.entryFee) > 0) {
        await this.points.award(userId, 'tournament_join', tournamentId);
      }
      if (!result.alreadyJoined && tournament.createdById && tournament.createdById !== userId) {
        const joined = await this.prisma.tournamentParticipant.count({ where: { tournamentId } });
        const full = joined >= tournament.maxParticipants;
        await this.notifications.notifyUser(tournament.createdById, {
          type: 'tournament',
          title: full ? 'Tournoi complet 🏆' : 'Nouveau participant',
          body: full
            ? `« ${tournament.name} » est complet : vous pouvez lancer le tournoi.`
            : `« ${tournament.name} » : ${joined}/${tournament.maxParticipants} inscrits.`,
          data: { tournamentId, screen: 'tournament' },
        });
      }
      return result;
    } catch (error: any) {
      if (error?.code === 'P2002') return { ok: true, alreadyJoined: true };
      throw error;
    }
  }

  /// Classement d'un jeu en ligne : victoires enregistrées par le serveur
  /// (jamais déclarées par l'app). Les jeux joués en local n'y figurent pas.
  async leaderboard(slug: string, limit: number) {
    const [wins, played] = await Promise.all([
      this.prisma.match.groupBy({
        by: ['winnerId'],
        where: { game: { slug }, winnerId: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { winnerId: 'desc' } },
        take: limit,
      }),
      this.prisma.gamePlayer.groupBy({
        by: ['userId'],
        where: { match: { game: { slug }, state: { contains: '"finished"' } } },
        _count: { _all: true },
      }),
    ]);
    const ids = wins.map((w) => w.winnerId!).filter(Boolean);
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, username: true, displayName: true, avatarColor: true, avatarImage: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    const playedById = new Map(played.map((p) => [p.userId, p._count._all]));
    return wins
      .filter((w) => byId.has(w.winnerId!))
      .map((w, i) => {
        const u = byId.get(w.winnerId!)!;
        return {
          rank: i + 1,
          userId: u.id,
          name: u.displayName || u.username,
          avatarColor: u.avatarColor,
          avatarImage: u.avatarImage,
          wins: w._count._all,
          played: playedById.get(u.id) ?? w._count._all,
        };
      });
  }

  /// Joueurs distincts et parties terminées par jeu (cartes de la page Jeux).
  async stats() {
    const games = await this.prisma.game.findMany({ select: { id: true, slug: true } });
    return Promise.all(
      games.map(async (g) => {
        const [players, matches] = await Promise.all([
          this.prisma.gamePlayer.findMany({ where: { match: { gameId: g.id } }, distinct: ['userId'], select: { userId: true } }),
          this.prisma.match.count({ where: { gameId: g.id } }),
        ]);
        return { slug: g.slug, players: players.length, matches };
      }),
    );
  }

  /// Génère le bracket (rondes + horaires) une seule fois — idempotent : un
  /// second appel renvoie simplement le bracket déjà en base.
  /// Lancement du tournoi : seul le créateur (ou l'admin pour les tournois
  /// sans créateur) peut le faire, et seulement une fois le tournoi complet.
  async generateBracket(tournamentId: string, requesterId: string, requesterIsAdmin: boolean) {
    const tournament = await this.prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!tournament) throw new BadRequestException('Tournament not found');
    if (tournament.bracketGenerated) return this.getBracket(tournamentId);
    const allowed = tournament.createdById ? tournament.createdById === requesterId : requesterIsAdmin;
    if (!allowed) throw new ForbiddenException('Seul le créateur du tournoi peut le lancer');
    const joined = await this.prisma.tournamentParticipant.count({ where: { tournamentId } });
    if (joined < tournament.maxParticipants) {
      throw new BadRequestException(`Tournoi pas encore complet (${joined}/${tournament.maxParticipants})`);
    }

    const participants = await this.prisma.tournamentParticipant.findMany({
      where: { tournamentId },
      orderBy: { joinedAt: 'asc' },
    });
    const playerIds = participants.map((p) => p.userId);
    if (playerIds.length < 2) {
      throw new BadRequestException('Il faut au moins 2 participants pour générer le bracket');
    }

    const size = Math.pow(2, Math.ceil(Math.log2(playerIds.length)));
    const totalRounds = Math.log2(size);

    type MatchRow = {
      tournamentId: string;
      round: number;
      position: number;
      player1Id: string | null;
      player2Id: string | null;
      winnerId: string | null;
      status: string;
      scheduledAt: Date;
    };
    const matchesToCreate: MatchRow[] = [];

    // Ronde 0 : appariement séquentiel des inscrits ; les places vacantes
    // (bracket plus grand que le nombre d'inscrits) sont des « byes » —
    // le joueur présent est immédiatement qualifié pour la ronde suivante.
    const round1Prefill = new Map<number, { player1Id?: string; player2Id?: string }>();
    const matchesInRound0 = size / 2;
    for (let i = 0; i < matchesInRound0; i++) {
      const p1 = playerIds[i * 2] ?? null;
      const p2 = playerIds[i * 2 + 1] ?? null;
      const isBye = !p1 || !p2;
      const winnerId = isBye ? (p1 ?? p2) : null;
      matchesToCreate.push({
        tournamentId,
        round: 0,
        position: i,
        player1Id: p1,
        player2Id: p2,
        winnerId,
        status: isBye && winnerId ? 'done' : 'scheduled',
        scheduledAt: new Date(tournament.startsAt.getTime() + 0 * ROUND_GAP_MINUTES * 60000),
      });
      if (isBye && winnerId && totalRounds > 1) {
        const nextPosition = Math.floor(i / 2);
        const slot = i % 2 === 0 ? 'player1Id' : 'player2Id';
        const entry = round1Prefill.get(nextPosition) ?? {};
        (entry as any)[slot] = winnerId;
        round1Prefill.set(nextPosition, entry);
      }
    }

    // Rondes suivantes : places vides, remplies au fil des résultats (sauf
    // pré-remplissage immédiat des qualifiés par bye ci-dessus).
    for (let r = 1; r < totalRounds; r++) {
      const matchesInRound = size / Math.pow(2, r + 1);
      for (let pos = 0; pos < matchesInRound; pos++) {
        const prefill = r === 1 ? round1Prefill.get(pos) : undefined;
        matchesToCreate.push({
          tournamentId,
          round: r,
          position: pos,
          player1Id: prefill?.player1Id ?? null,
          player2Id: prefill?.player2Id ?? null,
          winnerId: null,
          status: 'scheduled',
          scheduledAt: new Date(tournament.startsAt.getTime() + r * ROUND_GAP_MINUTES * 60000),
        });
      }
    }

    await this.prisma.$transaction([
      this.prisma.tournamentMatch.createMany({ data: matchesToCreate }),
      this.prisma.tournament.update({ where: { id: tournamentId }, data: { bracketGenerated: true } }),
    ]);

    await this.prisma.tournament.update({ where: { id: tournamentId }, data: { status: 'started' } });
    const players = await this.prisma.tournamentParticipant.findMany({ where: { tournamentId }, select: { userId: true } });
    await this.notifications.notifyUsers(
      players.map((p) => p.userId),
      {
        type: 'tournament',
        title: 'Le tournoi commence ! 🏁',
        body: `« ${tournament.name} » est lancé : consultez votre premier match.`,
        data: { tournamentId, screen: 'tournament' },
      },
    );
    return this.getBracket(tournamentId);
  }

  async getBracket(tournamentId: string) {
    const tournament = await this.prisma.tournament.findUnique({ where: { id: tournamentId } });
    if (!tournament) throw new BadRequestException('Tournament not found');
    if (!tournament.bracketGenerated) return { generated: false };

    const matches = await this.prisma.tournamentMatch.findMany({
      where: { tournamentId },
      orderBy: [{ round: 'asc' }, { position: 'asc' }],
    });

    const userIds = Array.from(
      new Set(
        matches
          .flatMap((m) => [m.player1Id, m.player2Id, m.winnerId])
          .filter((id): id is string => !!id),
      ),
    );
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, username: true, displayName: true, avatarColor: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const roundsMap = new Map<number, any[]>();
    for (const m of matches) {
      const list = roundsMap.get(m.round) ?? [];
      list.push({
        id: m.id,
        position: m.position,
        player1: m.player1Id ? (userMap.get(m.player1Id) ?? null) : null,
        player2: m.player2Id ? (userMap.get(m.player2Id) ?? null) : null,
        winnerId: m.winnerId,
        scheduledAt: m.scheduledAt,
        status: m.status,
      });
      roundsMap.set(m.round, list);
    }
    const rounds = Array.from(roundsMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([round, matchList]) => ({ round, matches: matchList }));

    return { generated: true, rounds };
  }

  async reportMatchResult(tournamentId: string, matchId: string, winnerId: string, requesterId: string) {
    const match = await this.prisma.tournamentMatch.findUnique({ where: { id: matchId } });
    if (!match || match.tournamentId !== tournamentId) throw new BadRequestException('Match not found');
    if (match.status === 'done') throw new BadRequestException('Résultat déjà enregistré');
    if (!match.player1Id || !match.player2Id) {
      throw new BadRequestException('Les deux joueurs ne sont pas encore connus pour ce match');
    }
    if (winnerId !== match.player1Id && winnerId !== match.player2Id) {
      throw new BadRequestException('Le gagnant doit être un des deux joueurs du match');
    }

    const isPlayer = requesterId === match.player1Id || requesterId === match.player2Id;
    if (!isPlayer) {
      const requester = await this.prisma.user.findUnique({ where: { id: requesterId } });
      if (!requester || requester.role !== 'admin') {
        throw new ForbiddenException(
          'Seuls les joueurs du match ou un administrateur peuvent déclarer le résultat',
        );
      }
    }

    const nextRound = match.round + 1;
    const nextPosition = Math.floor(match.position / 2);
    const slot = match.position % 2 === 0 ? 'player1Id' : 'player2Id';

    await this.prisma.$transaction(async (tx) => {
      await tx.tournamentMatch.update({ where: { id: matchId }, data: { winnerId, status: 'done' } });
      const nextMatch = await tx.tournamentMatch.findUnique({
        where: { tournamentId_round_position: { tournamentId, round: nextRound, position: nextPosition } },
      });
      if (nextMatch) {
        await tx.tournamentMatch.update({ where: { id: nextMatch.id }, data: { [slot]: winnerId } });
      }
    });

    return this.getBracket(tournamentId);
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
