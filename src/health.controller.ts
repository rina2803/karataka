import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async check() {
    return {
      ok: true,
      status: 'up',
      timestamp: new Date().toISOString(),
      port: Number(process.env.PORT ?? process.env.APP_PORT ?? process.env.BACKEND_PORT ?? 3000) || 3000,
      host: process.env.HOST ?? '0.0.0.0',
      nodeEnv: process.env.NODE_ENV ?? 'development',
      database: await this.database(),
    };
  }

  /// État de la base, sans jamais exposer l'adresse ni le mot de passe.
  private async database() {
    const provider = /^postgres(ql)?:\/\//.test(process.env.DATABASE_URL ?? '') ? 'postgres' : 'sqlite';
    try {
      const users = await this.prisma.user.count();
      return { provider, ok: true, users };
    } catch (error) {
      const e = error as { code?: string; message?: string };
      const message = (e.message ?? '')
        .replace(/postgres(ql)?:\/\/[^\s"']+/g, 'postgres://***')
        .split('\n')
        .filter((l) => l.trim())
        .slice(-3)
        .join(' ')
        .slice(0, 300);
      return { provider, ok: false, code: e.code ?? null, error: message };
    }
  }
}
