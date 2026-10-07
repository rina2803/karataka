import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SellerService } from './seller.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('seller')
@UseGuards(JwtAuthGuard)
export class SellerController {
  constructor(private seller: SellerService) {}

  @Post('apply')
  apply(
    @Body() body: { cinNumber: string; cinPhotoBase64: string; selfieBase64: string; mvolaNumber: string },
    @Req() req: any,
  ) {
    return this.seller.apply(req.user.sub, body);
  }

  @Get('status')
  status(@Req() req: any) {
    return this.seller.status(req.user.sub);
  }

  /// Commandes contenant mes produits (?status=pending|approved|delivered|rejected).
  @Get('orders')
  orders(@Req() req: any, @Query('status') status?: string) {
    return this.seller.orders(req.user.sub, status);
  }

  @Get('summary')
  summary(@Req() req: any) {
    return this.seller.summary(req.user.sub);
  }
}
