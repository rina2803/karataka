import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CartService } from './cart.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Controller('admin/cart-orders')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminCartController {
  constructor(private cart: CartService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.cart.listOrders(status);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string) {
    return this.cart.approve(id);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() body: { reviewNote?: string }) {
    return this.cart.reject(id, body.reviewNote);
  }
}
