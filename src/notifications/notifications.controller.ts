import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { clampInt } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  @Get()
  list(@Req() req: any, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.notifications.list(req.user.sub, clampInt(page, 1, 1, 10_000), clampInt(limit, 20, 1, 50));
  }

  @Get('unread-count')
  unread(@Req() req: any) {
    return this.notifications.unreadCount(req.user.sub);
  }

  @Post('read-all')
  readAll(@Req() req: any) {
    return this.notifications.markAllRead(req.user.sub);
  }

  @Post(':id/read')
  read(@Param('id') id: string, @Req() req: any) {
    return this.notifications.markRead(req.user.sub, id);
  }

  /// Jeton Firebase du téléphone (envoyé par l'app après connexion).
  @Post('devices')
  register(@Body() body: { token?: string; platform?: string }, @Req() req: any) {
    if (!body?.token) throw new BadRequestException('Jeton manquant');
    const platform = body.platform === 'ios' ? 'ios' : body.platform === 'web' ? 'web' : 'android';
    return this.notifications.registerDevice(req.user.sub, body.token, platform);
  }

  @Delete('devices')
  unregister(@Body() body: { token?: string }, @Req() req: any) {
    return this.notifications.removeDevice(req.user.sub, body?.token ?? '');
  }
}

/// Envoi manuel par l'admin : à un utilisateur précis ou à tout le monde.
@Controller('admin/notifications')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminNotificationsController {
  constructor(private notifications: NotificationsService, private prisma: PrismaService) {}

  /// État de l'envoi sur téléphone (Firebase) pour l'écran admin.
  @Get('status')
  status() {
    return this.notifications.status();
  }

  @Post()
  async send(@Body() body: { title?: string; body?: string; target?: 'all' | 'user'; userId?: string }) {
    const title = body?.title?.trim() ?? '';
    const text = body?.body?.trim() ?? '';
    if (!title || !text) throw new BadRequestException('Titre et message requis');
    if (title.length > 80 || text.length > 500) throw new BadRequestException('Titre (80) ou message (500) trop long');
    const input = { type: 'admin' as const, title, body: text };
    if (body.target === 'user') {
      const user = body.userId ? await this.prisma.user.findUnique({ where: { id: body.userId }, select: { id: true } }) : null;
      if (!user) throw new BadRequestException('Utilisateur introuvable');
      await this.notifications.notifyUser(user.id, input);
      return { ok: true, sent: 1, push: this.notifications.pushEnabled };
    }
    const sent = await this.notifications.notifyAll(input);
    return { ok: true, sent, push: this.notifications.pushEnabled };
  }
}
