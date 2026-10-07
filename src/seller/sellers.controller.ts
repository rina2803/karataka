import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtGuard } from '../auth/optional-jwt.guard';
import { clampInt } from '../common/pagination';
import { SellersService } from './sellers.service';

/// Pages vendeur publiques (`/sellers`) — distinct de `/seller` (candidature
/// du vendeur connecté).
@Controller('sellers')
export class SellersController {
  constructor(private sellers: SellersService) {}

  @Get()
  list(@Query('sort') sort?: string, @Query('limit') limit?: string, @Query('partner') partner?: string) {
    return this.sellers.list(
      sort === 'popular' ? 'popular' : 'name',
      clampInt(limit, 50, 1, 100),
      partner === 'true' || partner === '1',
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/following')
  following(@Req() req: any) {
    return this.sellers.following(req.user.sub);
  }

  @Get(':id/reviews')
  reviews(@Param('id') id: string) {
    return this.sellers.reviews(id);
  }

  @UseGuards(OptionalJwtGuard)
  @Get(':id')
  profile(@Param('id') id: string, @Req() req: any) {
    return this.sellers.profile(id, req.user?.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/follow')
  follow(@Param('id') id: string, @Req() req: any) {
    return this.sellers.follow(req.user.sub, id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id/follow')
  unfollow(@Param('id') id: string, @Req() req: any) {
    return this.sellers.unfollow(req.user.sub, id);
  }
}

/// Admin : magasins partenaires / vendeurs mis en avant.
@Controller('admin/partners')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminPartnersController {
  constructor(private sellers: SellersService) {}

  @Get()
  list() {
    return this.sellers.adminList();
  }

  /// Recherche d'un compte (pseudo, nom, email, téléphone) à ajouter comme partenaire.
  @Get('search')
  search(@Query('q') q?: string) {
    return this.sellers.adminSearch(q ?? '');
  }

  /// Ajoute/retire un partenaire et/ou modifie sa fiche (nom affiché,
  /// présentation, logo en base64).
  @Patch(':id')
  set(
    @Param('id') id: string,
    @Body() body: { isPartner?: boolean; displayName?: string; partnerDescription?: string; logo?: string | null },
  ) {
    return this.sellers.updatePartner(id, body ?? {});
  }
}
