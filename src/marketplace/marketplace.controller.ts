import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { MarketplaceService } from './marketplace.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';

@Controller('marketplace')
export class MarketplaceController {
  constructor(private marketplace: MarketplaceService, private users: UsersService) {}

  @Get('products')
  products(@Query('category') category?: string) {
    return this.marketplace.listProducts(category);
  }

  /// Photo envoyée par le vendeur depuis son téléphone.
  @Get('products/:id/image')
  async image(@Param('id') id: string, @Res() res: Response) {
    const photo = await this.marketplace.productPhoto(id);
    if (!photo) throw new NotFoundException('Photo introuvable');
    res.setHeader('Content-Type', photo.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(photo.data, 'base64'));
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

  @UseGuards(JwtAuthGuard)
  @Get('products/mine')
  mine(@Req() req: any) {
    return this.marketplace.myProducts(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post('products')
  create(
    @Body()
    body: { name: string; description?: string; price: number; stock: number; imageUrl?: string; imageBase64?: string; category?: string },
    @Req() req: any,
  ) {
    return this.marketplace.createProduct(req.user.sub, body);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('products/:id')
  async update(
    @Param('id') id: string,
    @Body()
    body: { name?: string; description?: string; price?: number; stock?: number; imageUrl?: string; imageBase64?: string; category?: string; active?: boolean },
    @Req() req: any,
  ) {
    const isAdmin = await this.users.isAdmin(req.user.sub);
    return this.marketplace.updateProduct(id, req.user.sub, isAdmin, body);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('products/:id')
  async archive(@Param('id') id: string, @Req() req: any) {
    const isAdmin = await this.users.isAdmin(req.user.sub);
    return this.marketplace.archiveProduct(id, req.user.sub, isAdmin);
  }
}