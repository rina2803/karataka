import { Controller, Post, Body, HttpException, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService, private users: UsersService) {}

  @Post('register')
  async register(@Body() body: { username: string; email: string; phone: string; password: string }) {
    try {
      if (!body.phone?.trim()) throw new Error('Phone is required');
      const user = await this.auth.register(body);
      const token = this.auth.signToken(user.id);
      return { ok: true, token, user: this.users.toPublic(user as any) };
    } catch (err) {
      throw new HttpException('Registration failed', HttpStatus.BAD_REQUEST);
    }
  }

  @Post('forgot-password')
  requestPasswordReset(@Body() body: { email: string }) {
    if (!body.email?.trim()) throw new HttpException('Email required', HttpStatus.BAD_REQUEST);
    return { ok: true };
  }

  @Post('login')
  async login(@Body() body: { email: string; password: string }) {
    const user = await this.auth.validateUser(body.email, body.password);
    if (!user) throw new HttpException('Invalid credentials', HttpStatus.UNAUTHORIZED);
    const token = this.auth.signToken((user as any).id);
    return { token, user: this.users.toPublic(user as any) };
  }
}
