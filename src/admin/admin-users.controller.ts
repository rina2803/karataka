import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { ActivityService, ONLINE_WINDOW_MS } from '../activity/activity.service';
import { clientIp, deviceLabel } from '../activity/activity.interceptor';
import { AdminGuard } from '../auth/admin.guard';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';

/// `mode: insensitive` n'existe qu'en PostgreSQL (SQLite compare déjà sans casse).
const INSENSITIVE = /^postgres(ql)?:///.test(process.env.DATABASE_URL || '') ? { mode: 'insensitive' as const } : {};

const ADMIN_USER_SELECT = {
  id: true,
  username: true,
  email: true,
  phone: true,
  displayName: true,
  avatarColor: true,
  role: true,
  createdAt: true,
  lastSeenAt: true,
  isApprovedSeller: true,
  isPartner: true,
  points: true,
  wallet: { select: { balance: true } },
} as const;

type AdminUserRow = { lastSeenAt: Date | null; wallet: { balance: unknown } | null };

function withStatus<T extends AdminUserRow>(u: T) {
  return {
    ...u,
    balance: u.wallet?.balance ?? '0',
    online: !!u.lastSeenAt && u.lastSeenAt.getTime() > Date.now() - ONLINE_WINDOW_MS,
  };
}

/// Gestion des comptes par l'admin : recherche, modification, suppression,
/// accès au compte (« se connecter en tant que »), journal d'utilisation.
@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminUsersController {
  constructor(
    private prisma: PrismaService,
    private auth: AuthService,
    private users: UsersService,
    private activity: ActivityService,
  ) {}

  @Get('users')
  async list(@Query('q') q?: string) {
    const term = q?.trim().slice(0, 60);
    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        ...(term
          ? {
              OR: [
                { username: { contains: term, ...INSENSITIVE } },
                { email: { contains: term, ...INSENSITIVE } },
                { phone: { contains: term.replace(/\s+/g, '') } },
                { displayName: { contains: term, ...INSENSITIVE } },
              ],
            }
          : {}),
      },
      orderBy: [{ lastSeenAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 300,
      select: ADMIN_USER_SELECT,
    });
    return users.map(withStatus);
  }

  @Get('users/:id')
  async detail(@Param('id') id: string) {
    const user = await this.prisma.user.findFirst({ where: { id, deletedAt: null }, select: ADMIN_USER_SELECT });
    if (!user) throw new NotFoundException('Compte introuvable');
    const [orders, products, activity] = await Promise.all([
      this.prisma.cartOrder.count({ where: { userId: id } }),
      this.prisma.product.count({ where: { sellerId: id, active: true } }),
      this.activity.list({ userId: id, limit: 50 }),
    ]);
    return { ...withStatus(user), orderCount: orders, productCount: products, activity };
  }

  @Patch('users/:id')
  async update(
    @Param('id') id: string,
    @Req() req: any,
    @Body()
    body: {
      displayName?: string;
      username?: string;
      email?: string;
      phone?: string | null;
      role?: string;
      isApprovedSeller?: boolean;
      newPassword?: string;
    },
  ) {
    const user = await this.prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!user) throw new NotFoundException('Compte introuvable');
    const data: Record<string, unknown> = {};

    if (body.displayName !== undefined) data.displayName = body.displayName.trim().slice(0, 40) || null;
    if (body.username !== undefined) {
      const username = body.username.trim();
      if (!/^[\p{L}\d_.-]{3,20}$/u.test(username)) throw new BadRequestException('Pseudo : 3 à 20 lettres ou chiffres, sans espace.');
      data.username = username;
    }
    if (body.email !== undefined) {
      const email = body.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('Adresse email invalide.');
      data.email = email;
    }
    if (body.phone !== undefined) {
      const phone = (body.phone ?? '').replace(/\s+/g, '');
      if (phone && !/^(\+261|0)3[2-9]\d{7}$/.test(phone)) throw new BadRequestException('Numéro invalide (ex : 034 12 345 67).');
      data.phone = phone || null;
    }
    if (body.role !== undefined) {
      if (!['user', 'admin'].includes(body.role)) throw new BadRequestException('Rôle inconnu');
      if (id === req.user.sub && body.role !== 'admin') throw new BadRequestException('Vous ne pouvez pas retirer votre propre rôle admin');
      data.role = body.role;
    }
    if (body.isApprovedSeller !== undefined) data.isApprovedSeller = !!body.isApprovedSeller;
    if (body.newPassword) {
      if (body.newPassword.length < 6) throw new BadRequestException('Mot de passe : 6 caractères minimum.');
      data.password = await bcrypt.hash(body.newPassword, 10);
    }

    const clash = await this.prisma.user.findFirst({
      where: {
        id: { not: id },
        OR: [
          ...(data.username ? [{ username: data.username as string }] : []),
          ...(data.email ? [{ email: data.email as string }] : []),
          ...(data.phone ? [{ phone: data.phone as string }] : []),
        ],
      },
      select: { username: true, email: true, phone: true },
    });
    if (clash && (data.username || data.email || data.phone)) {
      const field = clash.email === data.email ? 'Cet email' : clash.phone === data.phone ? 'Ce numéro' : 'Ce pseudo';
      throw new BadRequestException(`${field} est déjà utilisé par un autre compte.`);
    }

    const updated = await this.prisma.user.update({ where: { id }, data, select: ADMIN_USER_SELECT });
    this.activity.forget(id);
    this.auth.forgetUser(id);
    return withStatus(updated);
  }

  /// Suppression : le compte est anonymisé et désactivé (ses commandes,
  /// parties et transactions restent pour la comptabilité), ses annonces
  /// sont retirées de la boutique. L'app se déconnecte à la requête suivante.
  @Delete('users/:id')
  async remove(@Param('id') id: string, @Req() req: any) {
    if (id === req.user.sub) throw new BadRequestException('Vous ne pouvez pas supprimer votre propre compte');
    const user = await this.prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!user) throw new NotFoundException('Compte introuvable');
    if (user.role === 'admin') throw new ForbiddenException('Retirez d’abord le rôle admin de ce compte');

    const tag = id.slice(-8);
    await this.prisma.$transaction([
      this.prisma.product.updateMany({ where: { sellerId: id }, data: { active: false } }),
      this.prisma.deviceToken.deleteMany({ where: { userId: id } }),
      this.prisma.user.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          email: `supprime-${tag}-${Date.now()}@deleted.local`,
          username: `supprime_${tag}_${Date.now().toString(36)}`.slice(0, 40),
          phone: null,
          displayName: 'Compte supprimé',
          avatarImage: null,
          referralCode: null,
          isPartner: false,
          isApprovedSeller: false,
          password: await bcrypt.hash(randomBytes(24).toString('hex'), 10),
        },
      }),
    ]);
    this.activity.forget(id);
    this.auth.forgetUser(id);
    return { ok: true, previousUsername: user.username };
  }

  /// « Entrer dans le compte » : jeton de 4 h au nom de l'utilisateur, qui
  /// garde la trace de l'admin. Impossible sur un autre compte admin.
  @Post('users/:id/impersonate')
  async impersonate(@Param('id') id: string, @Req() req: any) {
    const user = await this.prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!user) throw new NotFoundException('Compte introuvable');
    if (user.role === 'admin') throw new ForbiddenException('Impossible d’entrer dans le compte d’un autre admin');
    const token = this.auth.signImpersonationToken(id, req.user.sub);
    this.activity.record({
      userId: req.user.sub,
      action: 'admin',
      label: `Admin : accès au compte de ${user.username}`,
      ip: clientIp(req),
      device: deviceLabel(req),
    });
    this.activity.record({ userId: id, action: 'impersonate', label: 'Un admin est entré dans le compte', byAdmin: req.user.sub });
    return { token, user: this.users.toPublic(user) };
  }

  /// Journal d'utilisation (le plus récent d'abord) ; `before` = date du
  /// dernier élément reçu pour charger la suite.
  @Get('activity')
  activityLog(@Query('userId') userId?: string, @Query('action') action?: string, @Query('before') before?: string, @Query('limit') limit?: string) {
    return this.activity.list({ userId: userId || undefined, action: action || undefined, before, limit: Number(limit) || 100 });
  }

  @Get('online')
  online() {
    return this.activity.online();
  }
}
