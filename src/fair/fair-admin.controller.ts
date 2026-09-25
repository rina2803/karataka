import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { FairService } from './fair.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Controller('admin/fair-events')
@UseGuards(JwtAuthGuard, AdminGuard)
export class FairAdminController {
  constructor(private fair: FairService) {}

  @Get()
  list() {
    return this.fair.adminListEvents();
  }

  @Post()
  create(
    @Body()
    body: {
      title: string;
      description?: string;
      imageUrl?: string;
      price: number;
      originalPrice?: number;
      stock: number;
      category?: string;
      startsAt?: string;
      endsAt?: string;
    },
  ) {
    return this.fair.adminCreateEvent(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.fair.adminUpdateEvent(id, body as any);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.fair.adminDeleteEvent(id);
  }
}
