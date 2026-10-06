import { Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
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
  list(@Query('sort') sort?: string, @Query('limit') limit?: string) {
    return this.sellers.list(sort === 'popular' ? 'popular' : 'name', clampInt(limit, 50, 1, 100));
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/following')
  following(@Req() req: any) {
    return this.sellers.following(req.user.sub);
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
