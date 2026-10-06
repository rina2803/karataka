import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { clampInt } from '../common/pagination';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GamesService } from './games.service';
import { UsersService } from '../users/users.service';

@Controller('games')
export class GamesController {
  constructor(private games: GamesService, private users: UsersService) {}

  @Get('stats')
  stats() {
    return this.games.stats();
  }

  @Get(':slug/leaderboard')
  leaderboard(@Param('slug') slug: string, @Query('limit') limit?: string) {
    return this.games.leaderboard(slug, clampInt(limit, 20, 1, 100));
  }

  @Get('tournaments')
  listTournaments() {
    return this.games.listTournaments();
  }

  @UseGuards(JwtAuthGuard)
  @Post('tournaments/:id/join')
  joinTournament(@Param('id') id: string, @Req() req: any) {
    return this.games.joinTournament(id, req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Get('tournaments/:id/participants')
  participants(@Param('id') id: string) {
    return this.games.listParticipants(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('tournaments')
  createTournament(
    @Body() body: { name: string; entryFee: number; startsAt: string; maxParticipants?: number; game?: string },
    @Req() req: any,
  ) {
    return this.games.createTournament(req.user.sub, body);
  }

  /// « Lancer le tournoi » : créateur uniquement, tournoi complet.
  @UseGuards(JwtAuthGuard)
  @Post('tournaments/:id/generate-bracket')
  async generateBracket(@Param('id') id: string, @Req() req: any) {
    return this.games.generateBracket(id, req.user.sub, await this.users.isAdmin(req.user.sub));
  }

  @Get('tournaments/:id/bracket')
  bracket(@Param('id') id: string) {
    return this.games.getBracket(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('tournaments/:id/matches/:matchId/result')
  reportMatchResult(
    @Param('id') id: string,
    @Param('matchId') matchId: string,
    @Body() body: { winnerId: string },
    @Req() req: any,
  ) {
    return this.games.reportMatchResult(id, matchId, body.winnerId, req.user.sub);
  }
}