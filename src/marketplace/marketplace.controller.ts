import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { MarketplaceService, ProductPageQuery } from './marketplace.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtGuard } from '../auth/optional-jwt.guard';
import { UsersService } from '../users/users.service';

@Controller('marketplace')
export class MarketplaceController {
  constructor(private marketplace: MarketplaceService, private users: UsersService) {}

  /// Sans `page`/`limit` : ancien format (tableau complet) pour les versions
  /// déjà installées de l'app. Avec : `{ items, page, limit, total, hasMore }`.
  @Get('products')
  products(@Query() query: Record<string, string | undefined>) {
    const paged = ['page', 'limit', 'q', 'sort', 'sellerId', 'sellerName', 'promo'].some((k) => query[k] !== undefined);
    if (!paged) return this.marketplace.listProducts(query.category);
    const sort = ['newest', 'price_asc', 'price_desc', 'popular'].includes(query.sort ?? '')
      ? (query.sort as ProductPageQuery['sort'])
      : 'newest';
    return this.marketplace.listProductsPage({
      page: query.page,
      limit: query.limit,
      q: query.q?.slice(0, 80),
      category: query.category || undefined,
      sellerId: query.sellerId || undefined,
      sellerName: query.sellerName || undefined,
      promo: query.promo === 'true' || query.promo === '1',
      sort,
    });
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

  @UseGuards(JwtAuthGuard)
  @Post('products/:id/promo')
  async promo(@Param('id') id: string, @Body() body: { promoPrice?: number }, @Req() req: any) {
    const isAdmin = await this.users.isAdmin(req.user.sub);
    return this.marketplace.setPromo(id, req.user.sub, isAdmin, Number(body?.promoPrice));
  }

  @UseGuards(JwtAuthGuard)
  @Delete('products/:id/promo')
  async endPromo(@Param('id') id: string, @Req() req: any) {
    const isAdmin = await this.users.isAdmin(req.user.sub);
    return this.marketplace.endPromo(id, req.user.sub, isAdmin);
  }

  @UseGuards(OptionalJwtGuard)
  @Post('products/:id/share')
  share(@Param('id') id: string, @Body() body: { channel?: string }, @Req() req: any) {
    return this.marketplace.recordShare(id, req.user?.sub, String(body?.channel ?? 'native'));
  }

  /// Déclaré en dernier : `products/mine` doit être résolu avant `:id`.
  @Get('products/:id')
  product(@Param('id') id: string) {
    return this.marketplace.getProduct(id);
  }
}
