import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { HomeService } from './home.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Controller()
export class HomeController {
  constructor(private home: HomeService) {}

  /// Bannière(s) publicitaires actives de l'accueil — vide tant qu'aucune
  /// n'a été ajoutée par un admin (aucune donnée fictive).
  @Get('home/banners')
  banners() {
    return this.home.listActiveBanners();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('admin/home-banners')
  adminList() {
    return this.home.listAllBanners();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('admin/home-banners')
  adminCreate(@Body() body: { title: string; imageUrl: string; linkType?: string; linkValue?: string; sortOrder?: number }) {
    return this.home.createBanner(body);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch('admin/home-banners/:id')
  adminUpdate(
    @Param('id') id: string,
    @Body() body: { title?: string; imageUrl?: string; linkType?: string; linkValue?: string; sortOrder?: number; active?: boolean },
  ) {
    return this.home.updateBanner(id, body);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Delete('admin/home-banners/:id')
  adminDelete(@Param('id') id: string) {
    return this.home.deleteBanner(id);
  }
}
