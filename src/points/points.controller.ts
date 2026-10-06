import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { clampInt } from '../common/pagination';
import { PointsService } from './points.service';

/// Lecture seule : les points ne s'attribuent que côté serveur.
@Controller('points')
export class PointsController {
  constructor(private points: PointsService) {}

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
}
