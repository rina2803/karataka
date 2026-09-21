import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { MarketplaceService } from './marketplace.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('marketplace')
export class MarketplaceController {
  constructor(private marketplace: MarketplaceService) {}

  @Get('products')
  products(@Query('category') category?: string) {
    return this.marketplace.listProducts(category);
  }

  @Get('categories')
  categories() {
    return this.marketplace.listCategories();
  }

  @UseGuards(JwtAuthGuard)
  @Get('orders')
  orders(@Req() req: any) { return this.marketplace.listOrders(req.user.sub); }

  @UseGuards(JwtAuthGuard)
  @Post('buy')
  buy(@Body() body: { productId: string }, @Req() req: any) { return this.marketplace.buy(body.productId, req.user.sub); }
}