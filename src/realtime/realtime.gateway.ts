import { Injectable, Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  WebSocketServer,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { AuthService } from '../auth/auth.service';
import { WalletService } from '../wallet/wallet.service';
import { PointsService } from '../points/points.service';
import { Chess } from 'chess.js';

const MIN_STAKE = 2000; // Ar — mise minimale imposée.
const ALLOWED_TIME_CONTROLS_MIN = [0, 10, 20, 30]; // 0 = sans limite.

interface ChessPlayer {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
  avatarImage: string | null;
  side?: 'white' | 'black' | null;
  ready: boolean;
}

interface ChessRoom {
  id: string;
  hostId: string;
  status: 'waiting' | 'ready' | 'playing' | 'finished';
  players: Map<string, ChessPlayer>;
  fen: string;
  whiteId: string | null;
  blackId: string | null;
  turn: 'w' | 'b';
  startedAt: number | null;
  /** Mise par joueur, en Ar. 0 = partie amicale, sans argent. */
  stake: number;
  /** Les mises ont déjà été débitées (évite un double débit). */
  betsPlaced: boolean;
  /** Minuteur — 0 = sans limite de temps. */
  timeControlSeconds: number;
  whiteTimeMs: number;
  blackTimeMs: number;
  /** Horodatage (ms) du début du trait en cours — le serveur fait autorité. */
  turnStartedAt: number | null;
  matchId: string | null;
}

@WebSocketGateway({ cors: true })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private chessRooms = new Map<string, ChessRoom>();
  private socketToRoom = new Map<string, string>();
  private logger = new Logger('RealtimeGateway');
  // Présence générique par salon (chat / défis) — roomId -> userId -> joueur.
  private roomPresence = new Map<string, Map<string, ChessPlayer>>();
  private socketToPresenceRooms = new Map<string, Set<string>>();

  constructor(
    private prisma: PrismaService,
    private users: UsersService,
    private auth: AuthService,
    private wallet: WalletService,
    private points: PointsService,
  ) {}

  handleConnection(socket: Socket) {
    const token = this.extractToken(socket);
    if (token) {
      const payload = this.auth.verifyToken(token);
      if (payload) {
        socket.data.user = payload;
        socket.join(`user:${payload.sub}`);
        return;
      }
    }
    // Mode invité — pas de blocage, pas d'erreur
    const guestId = `guest-${socket.id}`;
    socket.data.user = { sub: guestId, guest: true };
  }

  handleDisconnect(socket: Socket) {
    // A lost connection or navigation away is not an abandonment.
    this.socketToRoom.delete(socket.id);
    this.handlePresenceLeaveAll(socket);
  }

  private extractToken(socket: Socket): string | null {
    if (socket.handshake?.auth?.token) return socket.handshake.auth.token as string;
    const query = socket.handshake?.query;
    if (query && typeof query === 'object' && 'token' in query) {
      const q = query.token;
      return Array.isArray(q) ? q[0] : (q as string);
    }
    const authHeader = socket.handshake?.headers?.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }
    return null;
  }

  private userId(socket: Socket): string | null {
    return (socket.data.user?.sub as string) ?? null;
  }

  // ————————————————————————————————————————————————————————————
  // Salons génériques (chat + présence "qui a rejoint")
  // ————————————————————————————————————————————————————————————

  @SubscribeMessage('join-room')
  async handleJoin(@MessageBody() data: { room: string }, @ConnectedSocket() socket: Socket) {
    socket.join(data.room);
    const userId = this.userId(socket);
    if (userId) {
      const player = await this.buildPlayer(userId);
      if (player) {
        if (!this.roomPresence.has(data.room)) this.roomPresence.set(data.room, new Map());
        this.roomPresence.get(data.room)!.set(userId, player);

        if (!this.socketToPresenceRooms.has(socket.id)) this.socketToPresenceRooms.set(socket.id, new Set());
        this.socketToPresenceRooms.get(socket.id)!.add(data.room);

        this.server.to(data.room).emit('room-presence', {
          room: data.room,
          players: Array.from(this.roomPresence.get(data.room)!.values()),
        });
      }
    }
    this.server.to(data.room).emit('system', { message: `Un joueur a rejoint le salon` });
  }

  @SubscribeMessage('room-presence-get')
  handlePresenceGet(@MessageBody() data: { room: string }) {
    const presence = this.roomPresence.get(data.room);
    return { room: data.room, players: presence ? Array.from(presence.values()) : [] };
  }

  private handlePresenceLeaveAll(socket: Socket) {
    const rooms = this.socketToPresenceRooms.get(socket.id);
    if (!rooms) return;
    const userId = this.userId(socket);
    for (const room of rooms) {
      const presence = this.roomPresence.get(room);
      if (presence && userId) {
        presence.delete(userId);
        this.server.to(room).emit('room-presence', { room, players: Array.from(presence.values()) });
      }
    }
    this.socketToPresenceRooms.delete(socket.id);
  }

  @SubscribeMessage('move')
  handleMove(@MessageBody() data: any, @ConnectedSocket() socket: Socket) {
    if (!data.room) return;
    socket.to(data.room).emit('move', data);
  }

  @SubscribeMessage('chat')
  async handleChat(@MessageBody() data: { room: string; userId: string; content: string }) {
    try {
      await this.prisma.message.create({
        data: { roomId: data.room, userId: data.userId, content: data.content },
      });
    } catch (e) {
      console.error('persist chat failed', e);
    }
    this.server.to(data.room).emit('chat', data);
  }

  // ————————————————————————————————————————————————————————————
  // Échecs
  // ————————————————————————————————————————————————————————————

  private roomChannel(roomId: string) {
    return `chess:${roomId}`;
  }

  private async buildPlayer(userId: string): Promise<ChessPlayer | null> {
    if (userId.startsWith('guest-')) {
      return {
        id: userId,
        username: 'invite',
        displayName: 'Invité',
        avatarColor: '#7FC8FF',
        avatarImage: null,
        ready: false,
        side: null,
      };
    }
    const user = await this.users.findById(userId);
    if (!user) return null;
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName ?? user.username,
      avatarColor: user.avatarColor,
      avatarImage: user.avatarImage,
      ready: false,
      side: null,
    };
  }

  private serializeRoom(room: ChessRoom) {
    return {
      id: room.id,
      hostId: room.hostId,
      status: room.status,
      fen: room.fen,
      whiteId: room.whiteId,
      blackId: room.blackId,
      turn: room.turn,
      startedAt: room.startedAt,
      stake: room.stake,
      pot: room.stake * 2,
      timeControlSeconds: room.timeControlSeconds,
      whiteTimeMs: room.whiteTimeMs,
      blackTimeMs: room.blackTimeMs,
      turnStartedAt: room.turnStartedAt,
      matchId: room.matchId,
      players: Array.from(room.players.values()),
    };
  }

  private broadcastRoom(room: ChessRoom) {
    this.server.to(this.roomChannel(room.id)).emit('chess:room-state', this.serializeRoom(room));
  }

  @SubscribeMessage('chess:create-room')
  async handleChessCreate(
    @MessageBody() data: { stake?: number; timeControlMinutes?: number },
    @ConnectedSocket() socket: Socket,
  ) {
    this.logger.log(`[chess:create-room] START - Socket: ${socket.id}, Auth: ${!!socket.handshake.auth?.token}, Query: ${!!socket.handshake.query?.token}`);
    this.logger.debug(`[chess:create-room] DATA: ${JSON.stringify(data)}`);

    const userId = this.userId(socket);
    if (!userId) {
      this.logger.warn(`[chess:create-room] Unauthorized - userId not extracted`);
      return { error: 'Unauthorized' };
    }
    this.logger.debug(`[chess:create-room] userId: ${userId}`);

    const player = await this.buildPlayer(userId);
    if (!player) {
      this.logger.warn(`[chess:create-room] User not found: ${userId}`);
      return { error: 'User not found' };
    }

    // Validation des paramètres
    const rawStake = Number(data?.stake) || 0;
    this.logger.debug(`[chess:create-room] Stake: rawInput=${data?.stake}, parsed=${rawStake}, type=${typeof data?.stake}, isNaN=${isNaN(rawStake)}`);

    if (rawStake !== 0 && rawStake < MIN_STAKE) {
      this.logger.warn(`[chess:create-room] Stake too low: ${rawStake} < ${MIN_STAKE}`);
      return { error: `La mise minimale est de ${MIN_STAKE} Ar` };
    }

    if (rawStake > 0) {
      const hasBalance = await this.wallet.hasSufficientBalance(userId, String(rawStake));
      if (!hasBalance) {
        this.logger.warn(`[chess:create-room] Insufficient balance for ${userId}: ${rawStake}`);
        return { error: 'Solde insuffisant pour cette mise' };
      }
    }

    // Validation time control
    const timeControlMinutes = ALLOWED_TIME_CONTROLS_MIN.includes(Number(data?.timeControlMinutes))
      ? Number(data!.timeControlMinutes)
      : 0;
    this.logger.debug(`[chess:create-room] TimeControl: rawInput=${data?.timeControlMinutes}, parsed=${timeControlMinutes}, allowed=${ALLOWED_TIME_CONTROLS_MIN.join(',')}`);

    const timeControlSeconds = timeControlMinutes * 60;

    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    this.logger.log(`[chess:create-room] Creating room: ${roomId} for user ${userId}`);

    const room: ChessRoom = {
      id: roomId,
      hostId: userId,
      status: 'waiting',
      players: new Map([[userId, player]]),
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      whiteId: null,
      blackId: null,
      turn: 'w',
      startedAt: null,
      stake: rawStake,
      betsPlaced: false,
      timeControlSeconds,
      whiteTimeMs: timeControlSeconds * 1000,
      blackTimeMs: timeControlSeconds * 1000,
      turnStartedAt: null,
      matchId: null,
    };

    this.chessRooms.set(roomId, room);
    this.socketToRoom.set(socket.id, roomId);
    socket.join(this.roomChannel(roomId));
    this.broadcastRoom(room);
    
    this.logger.log(`[chess:create-room] SUCCESS - Room created: ${roomId}`);
    return { roomId };
  }

  @SubscribeMessage('chess:join-room')
  async handleChessJoin(@MessageBody() data: { roomId: string }, @ConnectedSocket() socket: Socket) {
    const userId = this.userId(socket);
    if (!userId) return { error: 'Unauthorized' };
    const room = this.chessRooms.get(data.roomId);
    if (!room) return { error: 'Room not found' };
    if (room.status === 'playing') return { error: 'Game already started' };
    if (room.players.size >= 2 && !room.players.has(userId)) return { error: 'Room is full' };
    if (room.stake > 0 && !(await this.wallet.hasSufficientBalance(userId, String(room.stake)))) {
      return { error: `Solde insuffisant : cette salle demande une mise de ${room.stake} Ar` };
    }

    const player = await this.buildPlayer(userId);
    if (!player) return { error: 'User not found' };

    room.players.set(userId, player);
    this.socketToRoom.set(socket.id, room.id);
    socket.join(this.roomChannel(room.id));

    if (room.players.size >= 2) room.status = 'ready';
    this.broadcastRoom(room);
    return { ok: true };
  }

  /** Rejoindre en spectateur : reçoit les mises à jour, ne devient pas joueur. */
  @SubscribeMessage('chess:spectate')
  handleChessSpectate(@MessageBody() data: { roomId: string }, @ConnectedSocket() socket: Socket) {
    const room = this.chessRooms.get(data.roomId);
    if (!room) return { error: 'Room not found' };
    socket.join(this.roomChannel(room.id));
    return { ok: true, room: this.serializeRoom(room) };
  }

  /**
   * Re-synchronise avec une salle : réabonne le socket au canal (au cas où
   * l'abonnement aurait été perdu — ex: reconnexion réseau) ET renvoie l'état
   * le plus frais. À appeler chaque fois que l'écran de jeu s'ouvre/se rouvre.
   */
  @SubscribeMessage('chess:room-sync')
  handleRoomSync(@MessageBody() data: { roomId: string }, @ConnectedSocket() socket: Socket) {
    const room = this.chessRooms.get(data.roomId);
    if (!room) return { error: 'Room not found' };
    socket.join(this.roomChannel(room.id));
    // Ne trace que les vrais joueurs pour le nettoyage à la déconnexion — un
    // spectateur qui repart ne doit jamais faire passer la partie en "finished".
    const userId = this.userId(socket);
    if (userId && room.players.has(userId)) {
      this.socketToRoom.set(socket.id, room.id);
    }
    return { room: this.serializeRoom(room) };
  }

  /** La salle où je joue actuellement, pour proposer de la reprendre. */
  @SubscribeMessage('chess:my-room')
  handleMyRoom(@ConnectedSocket() socket: Socket) {
    const userId = this.userId(socket);
    if (!userId) return { room: null };
    for (const room of this.chessRooms.values()) {
      if (room.players.has(userId) && room.status !== 'finished') {
        return { room: this.serializeRoom(room) };
      }
    }
    return { room: null };
  }

  /** Parties en cours ou en attente, pour les regarder en direct. */
  @SubscribeMessage('chess:list-rooms')
  handleListRooms() {
    const rooms = Array.from(this.chessRooms.values())
      .filter((r) => r.status === 'playing' || r.status === 'waiting' || r.status === 'ready')
      .map((r) => this.serializeRoom(r));
    return { rooms };
  }

  @SubscribeMessage('chess:invite')
  async handleChessInvite(
    @MessageBody() data: { targetUserId: string; roomId: string },
    @ConnectedSocket() socket: Socket,
  ) {
    const userId = this.userId(socket);
    if (!userId) return { error: 'Unauthorized' };
    const room = this.chessRooms.get(data.roomId);
    if (!room || room.hostId !== userId) return { error: 'Not allowed' };

    const host = room.players.get(userId);
    this.server.to(`user:${data.targetUserId}`).emit('chess:invite-received', {
      roomId: room.id,
      from: host,
    });
    return { ok: true };
  }

  @SubscribeMessage('chess:set-ready')
  handleChessReady(@MessageBody() data: { roomId: string; ready: boolean }, @ConnectedSocket() socket: Socket) {
    const userId = this.userId(socket);
    if (!userId) return { error: 'Unauthorized' };
    const room = this.chessRooms.get(data.roomId);
    if (!room) return { error: 'Room not found' };

    const player = room.players.get(userId);
    if (!player) return { error: 'Not in room' };
    player.ready = data.ready;

    if (room.players.size >= 2 && Array.from(room.players.values()).every((p) => p.ready)) {
      room.status = 'ready';
    }
    this.broadcastRoom(room);
    return { ok: true };
  }

  @SubscribeMessage('chess:start-game')
  async handleChessStart(@MessageBody() data: { roomId: string }, @ConnectedSocket() socket: Socket) {
    const userId = this.userId(socket);
    if (!userId) return { error: 'Unauthorized' };
    const room = this.chessRooms.get(data.roomId);
    if (!room) return { error: 'Room not found' };
    if (room.hostId !== userId) return { error: 'Only host can start' };
    if (room.players.size < 2) return { error: 'Need 2 players' };
    if (!Array.from(room.players.values()).every((player) => player.ready)) {
      return { error: 'Both players must be ready' };
    }

    const ids = Array.from(room.players.keys());
    if (ids.some((id) => id.startsWith('guest-'))) return { error: 'Authentication required' };

    const game = await this.prisma.game.upsert({
      where: { slug: 'chess' },
      update: {},
      create: { slug: 'chess', name: 'Echecs' },
    });
    const match = await this.prisma.match.create({
      data: {
        gameId: game.id,
        state: JSON.stringify({ fen: room.fen, turn: room.turn, status: 'playing' }),
        betAmount: String(room.stake),
        players: {
          create: [
            { userId: ids[0], side: 'white' },
            { userId: ids[1], side: 'black' },
          ],
        },
      },
    });
    room.matchId = match.id;

    // Séquestre des mises : débitées des deux portefeuilles au lancement, une
    // seule fois. Si l'un des deux n'a plus les fonds, on annule proprement.
    if (room.stake > 0 && !room.betsPlaced) {
      for (const id of ids) {
        const ok = await this.wallet.hasSufficientBalance(id, String(room.stake));
        if (!ok) return { error: 'Un des joueurs n\'a plus assez de solde pour cette mise' };
      }
      for (const id of ids) {
        await this.wallet.placeBet(id, String(room.stake), { roomId: room.id, reason: 'chess-stake' });
      }
      room.betsPlaced = true;
    }

    room.whiteId = ids[0];
    room.blackId = ids[1];
    const white = room.players.get(room.whiteId)!;
    const black = room.players.get(room.blackId)!;
    white.side = 'white';
    black.side = 'black';
    room.status = 'playing';
    room.fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    room.turn = 'w';
    room.startedAt = Date.now();
    room.whiteTimeMs = room.timeControlSeconds * 1000;
    room.blackTimeMs = room.timeControlSeconds * 1000;
    room.turnStartedAt = room.timeControlSeconds > 0 ? Date.now() : null;

    this.broadcastRoom(room);
    this.server.to(this.roomChannel(room.id)).emit('chess:game-started', this.serializeRoom(room));
    return { ok: true };
  }

  /** Un client signale la fin de partie (échec et mat détecté localement). */
  @SubscribeMessage('chess:game-over')
  async handleGameOver(
    @MessageBody() data: { roomId: string; winnerId: string | null; reason: string },
    @ConnectedSocket() socket: Socket,
  ) {
    const userId = this.userId(socket);
    if (!userId) return { error: 'Unauthorized' };
    const room = this.chessRooms.get(data.roomId);
    if (!room || room.status !== 'playing') return { ok: true }; // déjà traité, on ignore poliment
    if (!room.players.has(userId)) return { error: 'Not a player' };
    if (data.winnerId && !room.players.has(data.winnerId)) return { error: 'Invalid winner' };
    if (data.winnerId === userId) return { error: 'Winner cannot be the reporter' };

    await this.finishGame(room, data.winnerId, data.reason);
    return { ok: true };
  }

  /// Karataka Points de fin de partie — en tâche de fond, n'affecte jamais
  /// le résultat ni les mises.
  private awardChessPoints(room: ChessRoom, winnerId: string | null) {
    if (!room.matchId || !room.whiteId || !room.blackId) return;
    const fullMoves = Number(room.fen.split(' ')[5]) || 0;
    this.points
      .awardChessResult(room.matchId, [room.whiteId, room.blackId], winnerId, fullMoves)
      .catch((error) => this.logger.warn(`points: ${(error as Error).message}`));
  }

  /**
   * Clôture une partie (une seule fois) : enregistre le résultat, règle les
   * mises et prévient les deux joueurs.
   */
  private async finishGame(room: ChessRoom, winnerId: string | null, reason: string) {
    if (room.status !== 'playing') return;
    room.status = 'finished';
    if (room.matchId) {
      await this.prisma.match.update({
        where: { id: room.matchId },
        data: {
          state: JSON.stringify({ fen: room.fen, turn: room.turn, status: 'finished', reason }),
          winnerId,
        },
      });
    }
    this.awardChessPoints(room, winnerId);

    let payout: { fee: string; payout: string } | null = null;

    if (room.stake > 0 && room.betsPlaced) {
      if (winnerId) {
        payout = await this.wallet.distributePayouts(winnerId, String(room.stake * 2));
      } else {
        // Nulle : chacun récupère sa mise, sans commission.
        for (const id of [room.whiteId, room.blackId]) {
          if (id) await this.wallet.refundBet(id, String(room.stake), { roomId: room.id, reason: 'draw-refund' });
        }
      }
    }

    this.server.to(this.roomChannel(room.id)).emit('chess:game-ended', {
      winnerId,
      reason,
      stake: room.stake,
      payout: payout ? Number(payout.payout) : null,
    });
  }

  @SubscribeMessage('chess:move')
  async handleChessMove(
    @MessageBody() data: { roomId: string; fen: string; from: string; to: string; turn: 'w' | 'b'; promotion?: string },
    @ConnectedSocket() socket: Socket,
  ) {
    const userId = this.userId(socket);
    if (!userId) return { error: 'Unauthorized' };
    const room = this.chessRooms.get(data.roomId);
    if (!room || room.status !== 'playing') return { error: 'Invalid room' };

    const isWhite = room.whiteId === userId;
    const isBlack = room.blackId === userId;
    if (!isWhite && !isBlack) return { error: 'Not a player' };
    if (data.turn !== room.turn || (data.turn === 'w' && !isWhite) || (data.turn === 'b' && !isBlack)) {
      return { error: 'Not your turn' };
    }

    // Drapeau tombé : le serveur fait foi, le coup joué trop tard ne compte pas.
    if (room.timeControlSeconds > 0 && room.turnStartedAt) {
      const remaining = data.turn === 'w' ? room.whiteTimeMs : room.blackTimeMs;
      if (Date.now() - room.turnStartedAt > remaining + 1000) {
        await this.finishGame(room, isWhite ? room.blackId : room.whiteId, 'timeout');
        return { error: 'Time out' };
      }
    }

    const game = new Chess(room.fen);
    try {
      game.move({ from: data.from, to: data.to, promotion: data.promotion });
    } catch (_) {
      return { error: 'Illegal move' };
    }

    // Minuteur : décompte le temps du joueur qui vient de jouer, sur la base
    // du serveur (source de vérité), puis relance l'horloge pour l'autre.
    if (room.timeControlSeconds > 0 && room.turnStartedAt) {
      const elapsed = Date.now() - room.turnStartedAt;
      if (data.turn === 'w') {
        room.whiteTimeMs = Math.max(0, room.whiteTimeMs - elapsed);
      } else {
        room.blackTimeMs = Math.max(0, room.blackTimeMs - elapsed);
      }
      room.turnStartedAt = Date.now();
    }

    room.fen = game.fen();
    room.turn = data.turn === 'w' ? 'b' : 'w';
    if (room.matchId) {
      await this.prisma.match.update({
        where: { id: room.matchId },
        data: { state: JSON.stringify({ fen: room.fen, turn: room.turn, status: 'playing' }) },
      });
    }
    this.server.to(this.roomChannel(room.id)).emit('chess:move-sync', {
      fen: room.fen,
      from: data.from,
      to: data.to,
      turn: room.turn,
      movedBy: userId,
      whiteTimeMs: room.whiteTimeMs,
      blackTimeMs: room.blackTimeMs,
      turnStartedAt: room.turnStartedAt,
    });

    // Fin de partie détectée par le serveur : ne dépend plus du client (le
    // vainqueur ne peut pas se déclarer lui-même via chess:game-over).
    if (game.isCheckmate()) {
      await this.finishGame(room, userId, 'checkmate');
    } else if (game.isGameOver()) {
      await this.finishGame(room, null, 'draw');
    }
    return { ok: true };
  }

  /** Quitte la salle en cours : n'est appelé que sur un abandon volontaire. */
  private async handleChessLeave(socket: Socket) {
    const roomId = this.socketToRoom.get(socket.id);
    if (!roomId) return;

    const room = this.chessRooms.get(roomId);
    if (!room) return;

    const userId = this.userId(socket);
    const wasPlaying = room.status === 'playing';
    room.players.delete(userId ?? '');
    this.socketToRoom.delete(socket.id);

    if (room.players.size === 0) {
      this.chessRooms.delete(roomId);
      return;
    }

    if (room.hostId === userId) room.hostId = Array.from(room.players.keys())[0];

    if (wasPlaying) {
      room.status = 'finished';
      const winnerId = room.whiteId === userId ? room.blackId : room.whiteId;
      if (room.matchId) {
        await this.prisma.match.update({
          where: { id: room.matchId },
          data: {
            state: JSON.stringify({ fen: room.fen, turn: room.turn, status: 'finished', reason: 'forfeit' }),
            winnerId,
          },
        });
      }
      this.awardChessPoints(room, winnerId);
      // Partie payante abandonnée : l'adversaire encore présent remporte la mise.
      if (room.stake > 0 && room.betsPlaced) {
        if (winnerId) {
          this.wallet.distributePayouts(winnerId, String(room.stake * 2)).then((payout) => {
            this.server.to(this.roomChannel(roomId)).emit('chess:game-ended', {
              winnerId,
              reason: 'forfeit',
              stake: room.stake,
              payout: Number(payout.payout),
            });
          });
        }
      } else {
        this.server.to(this.roomChannel(roomId)).emit('chess:game-ended', {
          winnerId,
          reason: 'forfeit',
          stake: room.stake,
          payout: null,
        });
      }
      this.server.to(this.roomChannel(roomId)).emit('chess:opponent-left', { userId });
    } else {
      room.status = 'waiting';
      this.broadcastRoom(room);
    }
  }

  @SubscribeMessage('chess:leave-room')
  async handleChessLeaveMsg(@ConnectedSocket() socket: Socket) {
    await this.handleChessLeave(socket);
    return { ok: true };
  }
}
