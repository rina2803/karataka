import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check() {
    return {
      ok: true,
      status: 'up',
      timestamp: new Date().toISOString(),
      port: Number(process.env.PORT ?? process.env.APP_PORT ?? process.env.BACKEND_PORT ?? 3000) || 3000,
      host: process.env.HOST ?? '0.0.0.0',
      nodeEnv: process.env.NODE_ENV ?? 'development',
    };
  }
}
