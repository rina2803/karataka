import { Logger } from '@nestjs/common';
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { NotificationsService } from '../notifications/notifications.service';
import { PointsService } from '../points/points.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';
import { GameEngine, GameResult, IllegalMove, randomItem } from './engine';
import { belote } from './engines/belote';
import { dames } from './engines/dames';
import { domino } from './engines/domino';
import { fanorona } from './engines/fanorona';
import { ludo } from './engines/ludo';
import { morpion } from './engines/morpion';
import { puissance4 } from './engines/puissance4';
import { quiz } from './engines/quiz';

/// Jeux en ligne arbitrés par le serveur (tout sauf les échecs). Le serveur
/// garde l'état officiel, vérifie chaque coup, tient le temps, fait jouer les
/// bots et règle mises et Karataka Points.
export const ENGINES: Record<string, GameEngine> = Object.fromEntries(
  [dames, fanorona, morpion, puissance4, ludo, belote, domino, quiz].map((e) => [e.slug, e]),
);

const MIN_STAKE = 2000;
/// Tours manqués d'affilée avant d'être considéré comme parti.
const MAX_STRIKES = 3;
const BOT_NAMES = ['Bot Koto', 'Bot Soa', 'Bot Fara', 'Bot Lala', 'Bot Rado', 'Bot Mamy', 'Bot Tiana'];
const BOT_COLORS = ['#7C3AED', '#0E9F6E', '#EA580C', '#DB2777', '#0891B2', '#65A30D', '#B45309'];

interface Seat {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
  avatarImage: string | null;
  bot: boolean;
  /// Joueur parti en cours de partie : un bot joue à sa place, il ne peut
  /// plus gagner.
  left: boolean;
}

interface ArenaRoom {
  id: string;
  game: string;
  hostId: string;
  status: 'waiting' | 'playing' | 'finished';
  seats: Seat[];
  stake: number;
  betsPlaced: boolean;
  hadBots: boolean;
  state: any;
  version: number;
  deadline: number | null;
  strikes: number[];
  matchId: string | null;
  result: (GameResult & { winnerIds: string[]; payout: number | null }) | null;
  timers: NodeJS.Timeout[];
  touchedAt: number;
}

@WebSocketGateway({ cors: true })
export class ArenaGateway {
  @WebSocketServer()
  server: Server;

  private rooms = new Map<string, ArenaRoom>();
  private logger = new Logger('ArenaGateway');

  constructor(
    private prisma: PrismaService,
    private users: UsersService,
    private wallet: WalletService,
    private points: PointsService,
    private notifications: NotificationsService,
  ) {
    // Ménage : salles abandonnées depuis plus de 30 minutes.
    setInterval(() => {
      const limit = Date.now() - 30 * 60_000;
      for (const room of this.rooms.values()) {
        if (room.touchedAt < limit && room.status !== 'playing') this.dispose(room);
      }
    }, 5 * 60_000).unref();
  }

  // ——— Outils ———

  private userId(socket: Socket): string | null {
    const id = socket.data?.user?.sub as string | undefined;
    return id && !id.startsWith('guest-') ? id : null;
  }

  private async buildSeat(userId: string): Promise<Seat | null> {
    const user = await this.users.findById(userId);
    if (!user) return null;
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName ?? user.username,
      avatarColor: user.avatarColor,
      avatarImage: user.avatarImage,
      bot: false,
      left: false,
    };
  }

  private engineOf(room: ArenaRoom) {
    return ENGINES[room.game];
  }

  private seatOf(room: ArenaRoom, userId: string) {
    return room.seats.findIndex((s) => s.id === userId && !s.bot);
  }

  private humans(room: ArenaRoom) {
    return room.seats.filter((s) => !s.bot);
  }

  private serialize(room: ArenaRoom, seat: number, withView = true) {
    const engine = this.engineOf(room);
    const actors: number[] = room.state && room.status === 'playing' ? engine.actors(room.state) : [];
    return {
      id: room.id,
      game: room.game,
      name: engine.name,
      hostId: room.hostId,
      status: room.status,
      stake: room.stake,
      pot: room.stake * this.humans(room).length,
      minPlayers: engine.minPlayers,
      maxPlayers: engine.maxPlayers,
      seats: room.seats.map((s) => ({ ...s, avatarImage: s.bot ? null : s.avatarImage })),
      mySeat: seat,
      actors,
      /// Coups légaux du joueur quand c'est à lui : l'app ne fait que les surligner.
      legal: withView && seat >= 0 && actors.includes(seat) ? engine.legalMoves(room.state, seat) : [],
      deadline: room.deadline,
      serverNow: Date.now(),
      version: room.version,
      result: room.result,
      view: withView && room.state ? engine.view(room.state, seat) : null,
    };
  }

  /// Chaque joueur reçoit sa propre vue (ses cartes/dominos seulement).
  private broadcast(room: ArenaRoom) {
    room.touchedAt = Date.now();
    room.seats.forEach((s, i) => {
      if (!s.bot && !s.left) this.server.to(`user:${s.id}`).emit('arena:room', this.serialize(room, i));
    });
    this.server.to(`arena-spec:${room.id}`).emit('arena:room', this.serialize(room, -1));
  }

  private clearTimers(room: ArenaRoom) {
    room.timers.forEach((t) => clearTimeout(t));
    room.timers = [];
  }

  private dispose(room: ArenaRoom) {
    this.clearTimers(room);
    this.rooms.delete(room.id);
  }

  // ——— Déroulement ———

  /// Après chaque changement : fin de partie, sinon minuteur du tour et coups des bots.
  private async advance(room: ArenaRoom) {
    this.clearTimers(room);
    const engine = this.engineOf(room);
    const result = engine.result(room.state);
    if (result) {
      room.deadline = null;
      await this.finish(room, result);
      return;
    }
    const ms = engine.turnMs(room.state);
    room.deadline = Date.now() + ms;
    const version = room.version;
    room.timers.push(setTimeout(() => this.onTimeout(room.id, version), ms + 300));
    for (const seat of engine.actors(room.state)) {
      const s = room.seats[seat];
      if (s.bot || s.left) {
        const delay = engine.botDelayMs?.(room.state, seat) ?? 700;
        room.timers.push(setTimeout(() => this.botPlay(room.id, version, seat), delay));
      }
    }
    this.broadcast(room);
  }

  private apply(room: ArenaRoom, seat: number, move: unknown) {
    this.engineOf(room).play(room.state, seat, move);
    room.version++;
  }

  private autoMove(room: ArenaRoom, seat: number) {
    const engine = this.engineOf(room);
    const move = engine.botMove ? engine.botMove(room.state, seat) : randomItem(engine.legalMoves(room.state, seat));
    if (move !== undefined) this.apply(room, seat, move);
  }

  private async botPlay(roomId: string, version: number, seat: number) {
    const room = this.rooms.get(roomId);
    if (!room || room.status !== 'playing' || room.version !== version) return;
    try {
      this.autoMove(room, seat);
    } catch (error) {
      this.logger.warn(`bot ${room.game}: ${(error as Error).message}`);
      return;
    }
    await this.advance(room);
  }

  private async onTimeout(roomId: string, version: number) {
    const room = this.rooms.get(roomId);
    if (!room || room.status !== 'playing' || room.version !== version) return;
    const engine = this.engineOf(room);
    if (engine.onTimeout) {
      engine.onTimeout(room.state);
      room.version++;
    } else {
      for (const seat of engine.actors(room.state)) {
        const s = room.seats[seat];
        if (!s.bot && !s.left) {
          room.strikes[seat]++;
          if (room.strikes[seat] >= MAX_STRIKES) {
            const ended = await this.markLeft(room, seat, 'timeout');
            if (ended) return;
          }
        }
        try {
          this.autoMove(room, seat);
        } catch (error) {
          this.logger.warn(`auto-move ${room.game}: ${(error as Error).message}`);
        }
        if (engine.result(room.state)) break;
      }
    }
    await this.advance(room);
  }

  /// Un joueur quitte (ou ne joue plus) pendant la partie : s'il ne reste
  /// qu'un humain (partie sans bot), il gagne ; sinon un bot prend la place.
  /// Renvoie vrai si la partie est terminée.
  private async markLeft(room: ArenaRoom, seat: number, reason: string) {
    room.seats[seat].left = true;
    room.version++;
    // Partie entre humains : le dernier encore présent gagne par abandon.
    const remaining = room.seats.flatMap((s, i) => (!s.bot && !s.left ? [i] : []));
    if (!room.hadBots && remaining.length === 1) {
      this.clearTimers(room);
      await this.finish(room, { winners: remaining, reason: reason === 'timeout' ? 'timeout' : 'forfeit' });
      return true;
    }
    if (room.seats.every((s) => s.bot || s.left)) {
      this.clearTimers(room);
      await this.finish(room, { winners: [], reason: 'abandoned' });
      return true;
    }
    return false;
  }

  private async finish(room: ArenaRoom, result: GameResult) {
    if (room.status !== 'playing') return;
    room.status = 'finished';
    room.deadline = null;
    const engine = this.engineOf(room);
    const eligible = result.winners.map((i) => room.seats[i]).filter((s) => s && !s.bot && !s.left);
    const winnerIds = eligible.map((s) => s.id);
    const activeHumans = room.seats.filter((s) => !s.bot && !s.left);
    let payout: number | null = null;

    try {
      if (room.stake > 0 && room.betsPlaced) {
        const pot = room.stake * this.humans(room).length;
        if (winnerIds.length) {
          for (const id of winnerIds) {
            const r = await this.wallet.distributePayouts(id, String(pot / winnerIds.length));
            payout = Number(r.payout);
          }
        } else {
          for (const s of activeHumans) {
            await this.wallet.refundBet(s.id, String(room.stake), { roomId: room.id, reason: `${room.game}-refund` });
          }
        }
      }
      if (room.matchId) {
        await this.prisma.match.update({
          where: { id: room.matchId },
          data: {
            winnerId: winnerIds[0] ?? null,
            state: JSON.stringify({ status: 'finished', reason: result.reason, winners: winnerIds }),
          },
        });
        if (!room.hadBots && engine.progress(room.state) >= engine.minProgressForPoints) {
          this.points
            .awardGameResult(room.matchId, activeHumans.map((s) => s.id), winnerIds)
            .catch((e) => this.logger.warn(`points: ${(e as Error).message}`));
        }
      }
    } catch (error) {
      this.logger.error(`finish ${room.id}: ${(error as Error).message}`);
    }

    room.result = { ...result, winnerIds, payout };
    this.broadcast(room);
    this.server.to(room.seats.filter((s) => !s.bot).map((s) => `user:${s.id}`)).emit('arena:ended', {
      roomId: room.id,
      winners: result.winners,
      winnerIds,
      reason: result.reason,
      payout,
    });
    // Les joueurs partis libèrent leur place pour une revanche.
    room.seats = room.seats.filter((s) => !s.left);
    if (!room.seats.some((s) => s.id === room.hostId) && this.humans(room).length) room.hostId = this.humans(room)[0].id;
  }

  // ——— Messages ———

  @SubscribeMessage('arena:create')
  async create(@MessageBody() data: { game: string; stake?: number }, @ConnectedSocket() socket: Socket) {
    const userId = this.userId(socket);
    if (!userId) return { error: 'Connectez-vous pour jouer en ligne' };
    const engine = ENGINES[data?.game];
    if (!engine) return { error: 'Jeu inconnu' };
    const stake = Math.max(0, Math.round(Number(data?.stake) || 0));
    if (stake > 0 && stake < MIN_STAKE) return { error: `La mise minimale est de ${MIN_STAKE} Ar` };
    if (stake > 0 && !(await this.wallet.hasSufficientBalance(userId, String(stake)))) {
      return { error: 'Solde insuffisant pour cette mise' };
    }
    const seat = await this.buildSeat(userId);
    if (!seat) return { error: 'Compte introuvable' };
    let id: string;
    do id = Math.random().toString(36).substring(2, 8).toUpperCase();
    while (this.rooms.has(id));
    const room: ArenaRoom = {
      id, game: engine.slug, hostId: userId, status: 'waiting', seats: [seat], stake,
      betsPlaced: false, hadBots: false, state: null, version: 0, deadline: null, strikes: [],
      matchId: null, result: null, timers: [], touchedAt: Date.now(),
    };
    this.rooms.set(id, room);
    this.broadcast(room);
    return { roomId: id, room: this.serialize(room, 0) };
  }

  @SubscribeMessage('arena:join')
  async join(@MessageBody() data: { roomId: string }, @ConnectedSocket() socket: Socket) {
    const userId = this.userId(socket);
    if (!userId) return { error: 'Connectez-vous pour jouer en ligne' };
    const room = this.rooms.get(String(data?.roomId ?? '').toUpperCase());
    if (!room) return { error: 'Salle introuvable' };
    const existing = this.seatOf(room, userId);
    if (existing >= 0) return { room: this.serialize(room, existing) };
    if (room.status === 'playing') return { error: 'La partie a déjà commencé — vous pouvez la regarder' };
    const engine = this.engineOf(room);
    if (room.seats.length >= engine.maxPlayers) return { error: 'La salle est complète' };
    if (room.stake > 0 && !(await this.wallet.hasSufficientBalance(userId, String(room.stake)))) {
      return { error: `Solde insuffisant : mise de ${room.stake} Ar` };
    }
    const seat = await this.buildSeat(userId);
    if (!seat) return { error: 'Compte introuvable' };
    room.seats.push(seat);
    if (room.status === 'finished') room.status = 'waiting';
    this.broadcast(room);
    return { room: this.serialize(room, room.seats.length - 1) };
  }

  @SubscribeMessage('arena:add-bot')
  addBot(@MessageBody() data: { roomId: string }, @ConnectedSocket() socket: Socket) {
    const userId = this.userId(socket);
    const room = this.rooms.get(data?.roomId);
    if (!room || room.hostId !== userId) return { error: "Seul l'hôte peut ajouter un bot" };
    if (room.status === 'playing') return { error: 'Partie en cours' };
    if (room.stake > 0) return { error: 'Pas de bot dans une partie avec mise' };
    if (room.seats.length >= this.engineOf(room).maxPlayers) return { error: 'La salle est complète' };
    const n = room.seats.filter((s) => s.bot).length;
    room.seats.push({
      id: `bot-${room.id}-${Date.now()}`,
      username: BOT_NAMES[n % BOT_NAMES.length].toLowerCase().replace(' ', ''),
      displayName: BOT_NAMES[n % BOT_NAMES.length],
      avatarColor: BOT_COLORS[n % BOT_COLORS.length],
      avatarImage: null,
      bot: true,
      left: false,
    });
    this.broadcast(room);
    return { ok: true };
  }

  @SubscribeMessage('arena:remove-seat')
  removeSeat(@MessageBody() data: { roomId: string; seatId: string }, @ConnectedSocket() socket: Socket) {
    const userId = this.userId(socket);
    const room = this.rooms.get(data?.roomId);
    if (!room || room.hostId !== userId) return { error: "Seul l'hôte peut retirer un joueur" };
    if (room.status === 'playing') return { error: 'Partie en cours' };
    const target = room.seats.find((s) => s.id === data.seatId);
    if (!target || target.id === userId) return { error: 'Joueur introuvable' };
    room.seats = room.seats.filter((s) => s !== target);
    if (!target.bot) this.server.to(`user:${target.id}`).emit('arena:kicked', { roomId: room.id });
    this.broadcast(room);
    return { ok: true };
  }

  @SubscribeMessage('arena:start')
  async start(@MessageBody() data: { roomId: string }, @ConnectedSocket() socket: Socket) {
    const userId = this.userId(socket);
    const room = this.rooms.get(data?.roomId);
    if (!room) return { error: 'Salle introuvable' };
    if (room.hostId !== userId) return { error: "Seul l'hôte peut lancer la partie" };
    if (room.status === 'playing') return { error: 'Partie déjà lancée' };
    const engine = this.engineOf(room);
    if (room.seats.length < engine.minPlayers) {
      return { error: `Il faut ${engine.minPlayers} joueurs (ajoutez des bots ou invitez des amis)` };
    }
    const humans = this.humans(room);
    if (room.stake > 0) {
      for (const h of humans) {
        if (!(await this.wallet.hasSufficientBalance(h.id, String(room.stake)))) {
          return { error: `${h.displayName} n'a plus assez de solde pour la mise` };
        }
      }
      for (const h of humans) await this.wallet.placeBet(h.id, String(room.stake), { roomId: room.id, reason: `${room.game}-stake` });
    }
    room.betsPlaced = room.stake > 0;
    room.hadBots = room.seats.some((s) => s.bot);
    room.state = engine.init(room.seats.length);
    room.strikes = room.seats.map(() => 0);
    room.result = null;
    room.status = 'playing';
    room.version++;

    const game = await this.prisma.game.upsert({ where: { slug: engine.slug }, update: {}, create: { slug: engine.slug, name: engine.name } });
    const match = await this.prisma.match.create({
      data: {
        gameId: game.id,
        betAmount: String(room.stake),
        state: JSON.stringify({ status: 'playing', room: room.id }),
        players: { create: room.seats.flatMap((s, i) => (s.bot ? [] : [{ userId: s.id, side: String(i) }])) },
      },
    });
    room.matchId = match.id;
    await this.advance(room);
    return { ok: true };
  }

  @SubscribeMessage('arena:move')
  async move(@MessageBody() data: { roomId: string; move: unknown }, @ConnectedSocket() socket: Socket) {
    const userId = this.userId(socket);
    const room = this.rooms.get(data?.roomId);
    if (!userId || !room || room.status !== 'playing') return { error: 'Partie introuvable' };
    const seat = this.seatOf(room, userId);
    if (seat < 0 || room.seats[seat].left) return { error: "Vous ne jouez pas dans cette partie" };
    try {
      this.apply(room, seat, data.move);
    } catch (error) {
      if (error instanceof IllegalMove) return { error: error.message };
      this.logger.error(`move ${room.game}: ${(error as Error).message}`);
      return { error: 'Coup refusé' };
    }
    room.strikes[seat] = 0;
    await this.advance(room);
    return { ok: true };
  }

  @SubscribeMessage('arena:leave')
  async leave(@MessageBody() data: { roomId: string }, @ConnectedSocket() socket: Socket) {
    const userId = this.userId(socket);
    const room = this.rooms.get(data?.roomId);
    if (!userId || !room) return { ok: true };
    socket.leave(`arena-spec:${room.id}`);
    const seat = this.seatOf(room, userId);
    if (seat < 0) return { ok: true };
    if (room.status === 'playing') {
      const ended = await this.markLeft(room, seat, 'forfeit');
      if (!ended) await this.advance(room);
    } else {
      room.seats.splice(seat, 1);
      if (!this.humans(room).length) {
        this.dispose(room);
        return { ok: true };
      }
      if (room.hostId === userId) room.hostId = this.humans(room)[0].id;
      this.broadcast(room);
    }
    return { ok: true };
  }

  /// Rouvre l'écran d'une partie : renvoie l'état le plus frais.
  @SubscribeMessage('arena:sync')
  sync(@MessageBody() data: { roomId: string }, @ConnectedSocket() socket: Socket) {
    const room = this.rooms.get(String(data?.roomId ?? '').toUpperCase());
    if (!room) return { error: 'Salle introuvable' };
    const userId = this.userId(socket);
    const seat = userId ? this.seatOf(room, userId) : -1;
    if (seat < 0) socket.join(`arena-spec:${room.id}`);
    return { room: this.serialize(room, seat) };
  }

  @SubscribeMessage('arena:list')
  list(@MessageBody() data: { game?: string }) {
    const rooms = [...this.rooms.values()]
      .filter((r) => (!data?.game || r.game === data.game) && r.status !== 'finished')
      .sort((a, b) => b.touchedAt - a.touchedAt)
      .slice(0, 30)
      .map((r) => this.serialize(r, -1, false));
    return { rooms };
  }

  @SubscribeMessage('arena:my-rooms')
  myRooms(@ConnectedSocket() socket: Socket) {
    const userId = this.userId(socket);
    if (!userId) return { rooms: [] };
    const rooms = [...this.rooms.values()]
      .filter((r) => r.status !== 'finished' && r.seats.some((s) => s.id === userId && !s.left))
      .map((r) => this.serialize(r, this.seatOf(r, userId), false));
    return { rooms };
  }

  @SubscribeMessage('arena:invite')
  async invite(@MessageBody() data: { roomId: string; targetUserId: string }, @ConnectedSocket() socket: Socket) {
    const userId = this.userId(socket);
    const room = this.rooms.get(data?.roomId);
    if (!userId || !room || this.seatOf(room, userId) < 0) return { error: 'Salle introuvable' };
    const from = room.seats.find((s) => s.id === userId)!;
    const engine = this.engineOf(room);
    this.server.to(`user:${data.targetUserId}`).emit('arena:invite-received', {
      roomId: room.id,
      game: room.game,
      name: engine.name,
      from,
    });
    await this.notifications.notifyUser(data.targetUserId, {
      type: 'game',
      title: `${from.displayName} vous invite au ${engine.name}`,
      body: room.stake > 0 ? `Mise : ${room.stake} Ar par joueur` : 'Partie amicale en ligne',
      data: { screen: 'arena', roomId: room.id, game: room.game },
    });
    return { ok: true };
  }
}
