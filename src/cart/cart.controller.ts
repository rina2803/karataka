import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { CartService } from './cart.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('cart')
@UseGuards(JwtAuthGuard)
export class CartController {
  constructor(private cart: CartService) {}

  @Post('checkout')
  checkout(
    @Body()
    body: {
      items: { productId: string; quantity: number }[];
      deliveryName: string;
      deliveryPhone: string;
      deliveryAddress: string;
      deliveryCity: string;
    },
    @Req() req: any,
  ) {
    return this.cart.checkout(req.user.sub, body);
  }

  @Get('orders/mine')
  mine(@Req() req: any) {
    return this.cart.myOrders(req.user.sub);
  }

  @Post('orders/:id/review')
  review(
    @Param('id') id: string,
    @Body() body: { sellerId?: string; rating?: number; comment?: string },
    @Req() req: any,
  ) {
    return this.cart.review(req.user.sub, id, body);
  }
}
