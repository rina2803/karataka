import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuctionService } from './auction.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Controller('auctions')
export class AuctionController {
  constructor(private auctions: AuctionService) {}

  @Get()
  list() {
    return this.auctions.listActive();
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.auctions.getOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/bid')
  bid(@Param('id') id: string, @Body() body: { amount: number }, @Req() req: any) {
    return this.auctions.placeBid(id, req.user.sub, Number(body.amount));
  }
}

@Controller('admin/auctions')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminAuctionController {
  constructor(private auctions: AuctionService) {}

  @Get()
  list() {
    return this.auctions.adminList();
  }

  @Post()
  create(
    @Body() body: { title: string; description?: string; imageUrl?: string; startingBid: number; endsAt: string },
  ) {
    return this.auctions.adminCreate(body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: { title?: string; description?: string; imageUrl?: string; endsAt?: string },
  ) {
    return this.auctions.adminUpdate(id, body);
  }

  @Post(':id/end')
  end(@Param('id') id: string) {
    return this.auctions.adminEnd(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.auctions.adminDelete(id);
  }
}
