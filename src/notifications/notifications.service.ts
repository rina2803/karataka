import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import type { Server } from 'socket.io';
import * as admin from 'firebase-admin';
import { PrismaService } from '../prisma/prisma.service';

export type NotificationType =
  | 'order'
  | 'seller'
  | 'payment'
  | 'tournament'
  | 'game'
  | 'follow'
  | 'admin'
  | 'system';

export type NotificationInput = {
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
};

/**
 * Notifications Karataka : enregistrées en base (cloche de l'app), poussées
 * en temps réel par socket (`notification:new` dans le salon `user:<id>`)
 * et envoyées sur le téléphone par Firebase Cloud Messaging si configuré.
 *
 * Firebase est facultatif : sans FIREBASE_SERVICE_ACCOUNT (JSON) ni
 * FCM_SERVICE_ACCOUNT_PATH, seules la cloche et le temps réel fonctionnent.
 * Ne lève jamais : une notification ratée ne doit pas casser l'action
 * principale (commande, validation…).
 */
@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);
  private server: Server | null = null;
  private messaging: admin.messaging.Messaging | null = null;

  constructor(private prisma: PrismaService) {
    this.initFirebase();
  }

  /// Appelé par la passerelle temps réel à son démarrage.
  attachServer(server: Server) {
    this.server = server;
  }

  get pushEnabled() {
    return this.messaging !== null;
  }

  private initFirebase() {
    try {
      let raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
      const path = process.env.FCM_SERVICE_ACCOUNT_PATH?.trim();
      if (!raw && path && fs.existsSync(path)) raw = fs.readFileSync(path, 'utf8');
      if (!raw) {
        this.log.log('Firebase non configuré : notifications push désactivées');
        return;
      }
      const app = admin.apps.length
        ? admin.app()
        : admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
      this.messaging = app.messaging();
      this.log.log('Firebase Cloud Messaging activé');
    } catch (error) {
      this.log.warn(`Firebase invalide, push désactivé : ${(error as Error).message}`);
    }
  }

  async notifyUser(userId: string, input: NotificationInput) {
    await this.notifyUsers([userId], input);
  }

  async notifyUsers(userIds: string[], input: NotificationInput) {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (ids.length === 0) return 0;
    try {
      const data = input.data ? JSON.stringify(input.data) : null;
      await this.prisma.notification.createMany({
        data: ids.map((userId) => ({ userId, type: input.type, title: input.title, body: input.body, data })),
      });
      if (this.server) {
        for (const userId of ids) {
          this.server.to(`user:${userId}`).emit('notification:new', {
            type: input.type,
            title: input.title,
            body: input.body,
            data: input.data ?? null,
          });
        }
      }
      await this.push(ids, input);
    } catch (error) {
      this.log.warn(`notify failed: ${(error as Error).message}`);
    }
    return ids.length;
  }

  async notifyAdmins(input: NotificationInput) {
    const admins = await this.prisma.user.findMany({ where: { role: 'admin' }, select: { id: true } });
    return this.notifyUsers(admins.map((a) => a.id), input);
  }

  async notifyAll(input: NotificationInput) {
    const users = await this.prisma.user.findMany({ select: { id: true } });
    return this.notifyUsers(users.map((u) => u.id), input);
  }

  private async push(userIds: string[], input: NotificationInput) {
    if (!this.messaging) return;
    const devices = await this.prisma.deviceToken.findMany({ where: { userId: { in: userIds } }, select: { token: true } });
    const tokens = devices.map((d) => d.token);
    for (let i = 0; i < tokens.length; i += 500) {
      const batch = tokens.slice(i, i + 500);
      const res = await this.messaging.sendEachForMulticast({
        tokens: batch,
        notification: { title: input.title, body: input.body },
        data: { type: input.type, ...(input.data ?? {}) },
        android: { priority: 'high', notification: { channelId: 'karataka_default' } },
      });
      // Jetons expirés / app désinstallée : on les oublie.
      const dead = res.responses
        .map((r, j) => (!r.success && /registration-token-not-registered|invalid-registration-token|invalid-argument/.test(r.error?.code ?? '') ? batch[j] : null))
        .filter((t): t is string => !!t);
      if (dead.length) await this.prisma.deviceToken.deleteMany({ where: { token: { in: dead } } });
    }
  }

  async list(userId: string, page: number, limit: number) {
    const [total, items, unread] = await Promise.all([
      this.prisma.notification.count({ where: { userId } }),
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where: { userId, read: false } }),
    ]);
    return {
      items: items.map((n) => ({ ...n, data: n.data ? safeJson(n.data) : null })),
      page,
      limit,
      total,
      hasMore: page * limit < total,
      unread,
    };
  }

  unreadCount(userId: string) {
    return this.prisma.notification.count({ where: { userId, read: false } }).then((unread) => ({ unread }));
  }

  async markRead(userId: string, id: string) {
    const res = await this.prisma.notification.updateMany({ where: { id, userId }, data: { read: true } });
    if (res.count === 0) throw new NotFoundException('Notification introuvable');
    return { ok: true };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({ where: { userId, read: false }, data: { read: true } });
    return { ok: true };
  }

  async registerDevice(userId: string, token: string, platform: string) {
    const clean = token.trim();
    if (clean.length < 20 || clean.length > 4096) return { ok: false };
    await this.prisma.deviceToken.upsert({
      where: { token: clean },
      create: { userId, token: clean, platform },
      update: { userId, platform },
    });
    return { ok: true, push: this.pushEnabled };
  }

  async removeDevice(userId: string, token: string) {
    await this.prisma.deviceToken.deleteMany({ where: { userId, token } });
    return { ok: true };
  }
}

function safeJson(raw: string) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
