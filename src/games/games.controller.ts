import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GamesService } from './games.service';

@Controller('games')
export class GamesController {
  constructor(private games: GamesService) {}

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
}