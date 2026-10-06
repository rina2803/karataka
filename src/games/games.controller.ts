import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { clampInt } from '../common/pagination';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GamesService } from './games.service';

@Controller('games')
export class GamesController {
  constructor(private games: GamesService) {}

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
  createTournament(@Body() body: { name: string; entryFee: number; startsAt: string }) {
    return this.games.createTournament(body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('tournaments/:id/generate-bracket')
  generateBracket(@Param('id') id: string) {
    return this.games.generateBracket(id);
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