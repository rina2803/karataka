import { Body, Controller, Get, Param, Patch, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private users: UsersService) {}

  @Get('me')
  async me(@Req() req: any) {
    const userId = req.user?.sub;
    if (!userId) throw new UnauthorizedException();
    return this.users.findById(userId);
  }

  @Patch('me')
  async updateMe(
    @Req() req: any,
    @Body() body: { displayName?: string; avatarColor?: string; avatarImage?: string | null },
  ) {
    const userId = req.user?.sub;
    if (!userId) throw new UnauthorizedException();
    return this.users.updateProfile(userId, body);
  }

  @Get(':id/public')
  async getPublic(@Param('id') id: string) {
    return this.users.findById(id);
  }

  @Get(':id')
  async get(@Param('id') id: string, @Req() req: any) {
    const userIdFromToken = req.user?.sub;
    if (userIdFromToken !== id) throw new UnauthorizedException('Access denied');
    return this.users.findById(id);
  }

  @Get()
  async list() {
    return this.users.list();
  }
}
