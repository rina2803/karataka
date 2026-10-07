import { Controller, Post, Body, HttpException, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService, private users: UsersService) {}

  @Post('register')
  async register(@Body() body: { username: string; email: string; phone: string; password: string; referralCode?: string }) {
    const username = body.username?.trim() ?? '';
    const email = body.email?.trim().toLowerCase() ?? '';
    const phone = (body.phone ?? '').replace(/\s+/g, '');
    const password = body.password ?? '';
    const invalid = (message: string) => new HttpException(message, HttpStatus.BAD_REQUEST);

    if (!/^[\p{L}\d_.-]{3,20}$/u.test(username)) throw invalid('Pseudo : 3 à 20 lettres ou chiffres, sans espace.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalid('Adresse email invalide.');
    if (!/^(\+261|0)3[2-9]\d{7}$/.test(phone)) throw invalid('Numéro invalide (ex : 034 12 345 67).');
    if (password.length < 6) throw invalid('Mot de passe : 6 caractères minimum.');

    const taken = await this.users.findTaken({ username, email, phone });
    if (taken) {
      const label = { username: 'Ce pseudo', email: 'Cet email', phone: 'Ce numéro' }[taken];
      throw new HttpException(`${label} est déjà utilisé.`, HttpStatus.CONFLICT);
    }

    const user = await this.auth.register({ username, email, phone, password, referralCode: body.referralCode });
    const token = this.auth.signToken(user.id);
    return { ok: true, token, user: this.users.toPublic(user as any) };
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
