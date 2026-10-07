import { BadRequestException, Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SettingsService } from './settings.service';

@Controller('admin/settings')
@UseGuards(JwtAuthGuard, AdminGuard)
export class SettingsController {
  constructor(private settings: SettingsService) {}

  /// Réglages + état de la base : sans Postgres, la base (et donc ces
  /// réglages) est effacée à chaque redémarrage du serveur gratuit.
  @Get()
  list() {
    const url = process.env.DATABASE_URL ?? '';
    return {
      settings: this.settings.list(),
      database: /^postgres(ql)?:\/\//.test(url) ? 'postgres' : 'temporary',
    };
  }

  @Put(':key')
  async update(@Param('key') key: string, @Body() body: { value?: string }) {
    const ok = await this.settings.set(key, String(body?.value ?? '').slice(0, 500));
    if (!ok) throw new BadRequestException('Réglage inconnu');
    return { ok: true, settings: this.settings.list() };
  }
}
