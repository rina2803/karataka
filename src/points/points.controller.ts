import { Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { clampInt } from '../common/pagination';
import { PointsService } from './points.service';
import { SettingsService } from '../settings/settings.service';

/// Lecture seule : les points ne s'attribuent que côté serveur.
@Controller('points')
export class PointsController {
  constructor(private points: PointsService, private settings: SettingsService) {}

  @Get('rules')
  rules() {
    return this.points.rules();
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: any) {
    return this.points.summary(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/history')
  history(@Req() req: any, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.points.history(req.user.sub, clampInt(page, 1, 1, 10_000), clampInt(limit, 20, 1, 50));
  }

  @UseGuards(JwtAuthGuard)
  @Get('spin')
  spinStatus(@Req() req: any) {
    return this.points.spinStatus(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post('spin')
  spin(@Req() req: any) {
    return this.points.spin(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Get('referral')
  referral(@Req() req: any) {
    const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0] || req.protocol;
    const base = this.settings.get('PUBLIC_WEB_URL').replace(/\/+$/, '') || `${proto}://${req.get('host')}`;
    return this.points.referral(req.user.sub, base);
  }
}
