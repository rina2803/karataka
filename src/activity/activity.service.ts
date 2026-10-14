import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface ActivityEntry {
  userId?: string | null;
  action: string;
  label: string;
  method?: string;
  path?: string;
  status?: number;
  ip?: string | null;
  device?: string | null;
  byAdmin?: string | null;
}

/// Durée pendant laquelle un compte est affiché « en ligne » après sa
/// dernière requête.
export const ONLINE_WINDOW_MS = 5 * 60_000;

/// Journal conservé 60 jours.
const RETENTION_MS = 60 * 24 * 3600_000;

/// Journal d'utilisation (écrit sans jamais bloquer ni faire échouer la
/// requête de l'utilisateur) et « dernière activité » des comptes.
@Injectable()
export class ActivityService implements OnModuleInit {
  private readonly log = new Logger(ActivityService.name);
  /// userId → date de la dernière écriture de `lastSeenAt`.
  private lastTouch = new Map<string, number>();
  /// userId → dernière « ouverture de l'app » journalisée.
  private lastOpen = new Map<string, number>();
  private usernames = new Map<string, { name: string; until: number }>();

  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    const purge = () =>
      this.prisma.activityLog
        .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - RETENTION_MS) } } })
        .catch(() => undefined);
    setTimeout(purge, 60_000).unref();
    setInterval(purge, 24 * 3600_000).unref();
  }

  /// Met à jour `lastSeenAt` au plus une fois par minute et par compte.
  touch(userId: string) {
    const now = Date.now();
    if ((this.lastTouch.get(userId) ?? 0) > now - 60_000) return;
    this.lastTouch.set(userId, now);
    this.prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date(now) } }).catch(() => undefined);
  }

  /// Vrai au plus une fois toutes les 15 min par compte : évite d'inonder le
  /// journal à chaque retour dans l'app.
  shouldLogOpen(userId: string) {
    const now = Date.now();
    if ((this.lastOpen.get(userId) ?? 0) > now - 15 * 60_000) return false;
    this.lastOpen.set(userId, now);
    return true;
  }

  record(entry: ActivityEntry) {
    void this.write(entry);
  }

  private async write(entry: ActivityEntry) {
    try {
      const username = entry.userId ? await this.username(entry.userId) : null;
      await this.prisma.activityLog.create({
        data: {
          userId: entry.userId ?? null,
          username,
          action: entry.action,
          label: entry.label.slice(0, 200),
          method: entry.method,
          path: entry.path?.slice(0, 200),
          status: entry.status,
          ip: entry.ip?.slice(0, 64) ?? null,
          device: entry.device?.slice(0, 120) ?? null,
          byAdmin: entry.byAdmin ? await this.username(entry.byAdmin) : null,
        },
      });
    } catch (error) {
      this.log.warn(`journal : ${(error as Error).message}`);
    }
  }

  private async username(userId: string) {
    const cached = this.usernames.get(userId);
    if (cached && cached.until > Date.now()) return cached.name;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
    const name = user?.username ?? '?';
    this.usernames.set(userId, { name, until: Date.now() + 10 * 60_000 });
    return name;
  }

  /// Après un changement de pseudo ou une suppression.
  forget(userId: string) {
    this.usernames.delete(userId);
  }

  list(opts: { userId?: string; action?: string; before?: string; limit?: number }) {
    const before = opts.before ? new Date(opts.before) : undefined;
    return this.prisma.activityLog.findMany({
      where: {
        ...(opts.userId ? { userId: opts.userId } : {}),
        ...(opts.action ? { action: opts.action } : {}),
        ...(before && !isNaN(before.getTime()) ? { createdAt: { lt: before } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(opts.limit || 100, 1), 200),
    });
  }

  online() {
    return this.prisma.user.findMany({
      where: { deletedAt: null, lastSeenAt: { gte: new Date(Date.now() - ONLINE_WINDOW_MS) } },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true, username: true, displayName: true, avatarColor: true, role: true, lastSeenAt: true },
    });
  }
}
