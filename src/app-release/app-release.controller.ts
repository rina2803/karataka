import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AppReleaseService } from './app-release.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Controller()
export class AppReleaseController {
  constructor(private releases: AppReleaseService) {}

  /// Dernière version publiée pour la plateforme — utilisée par l'app pour
  /// se comparer et proposer une mise à jour. `null` tant qu'aucune n'existe.
  @Get('app/latest-release')
  latest(@Query('platform') platform = 'android') {
    return this.releases.latest(platform);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('admin/app-releases')
  list() {
    return this.releases.listAll();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('admin/app-releases')
  create(@Body() body: { platform?: string; version: string; buildNumber: number; apkUrl: string; notes?: string; mandatory?: boolean }) {
    return this.releases.create(body);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Delete('admin/app-releases/:id')
  remove(@Param('id') id: string) {
    return this.releases.delete(id);
  }
}
