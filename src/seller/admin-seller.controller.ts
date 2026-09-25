import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { SellerService } from './seller.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Controller('admin/seller-applications')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminSellerController {
  constructor(private seller: SellerService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.seller.listApplications(status);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string) {
    return this.seller.approve(id);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() body: { reviewNote?: string }) {
    return this.seller.reject(id, body.reviewNote);
  }
}
