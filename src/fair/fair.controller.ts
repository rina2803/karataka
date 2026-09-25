import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { FairService } from './fair.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('fair')
export class FairController {
  constructor(private fair: FairService) {}

  @Get('events')
  events(@Query('category') category?: string) {
    return this.fair.listEvents(category);
  }

  @UseGuards(JwtAuthGuard)
  @Post('cart/checkout')
  checkout(
    @Body()
    body: {
      items: { eventId: string; quantity: number }[];
      deliveryName: string;
      deliveryPhone: string;
      deliveryAddress: string;
      deliveryCity: string;
    },
    @Req() req: any,
  ) {
    return this.fair.checkout(req.user.sub, body);
  }
}
