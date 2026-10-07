import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GeminiService } from './gemini.service';
import { AiService } from './ai.service';

@Controller('ai')
export class AiController {
  constructor(private ai: AiService, private gemini: GeminiService) {}

  @Get('status')
  status() {
    return this.ai.status();
  }

  @UseGuards(JwtAuthGuard)
  @Post('product-description')
  description(@Req() req: any, @Body() body: { name?: string; category?: string; price?: number; notes?: string; imageBase64?: string }) {
    return this.ai.productDescription(req.user.sub, body ?? {});
  }

  @UseGuards(JwtAuthGuard)
  @Post('product-image')
  image(@Req() req: any, @Body() body: { name?: string; prompt?: string; style?: string; imageBase64?: string }) {
    return this.ai.productImage(req.user.sub, body ?? {});
  }

  @UseGuards(JwtAuthGuard)
  @Post('assistant')
  assistant(@Req() req: any, @Body() body: { message?: string; history?: { role: string; text: string }[] }) {
    return this.ai.assistant(req.user.sub, body ?? {});
  }

  @UseGuards(JwtAuthGuard)
  @Post('social-caption')
  caption(@Req() req: any, @Body() body: { productId: string; platform?: string }) {
    return this.ai.socialCaption(req.user.sub, body?.productId, body?.platform ?? 'facebook');
  }

  /// Admin : vérifie que la clé Gemini enregistrée fonctionne.
  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('test')
  async test() {
    return { ok: await this.gemini.ping() };
  }
}
