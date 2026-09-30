import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService) {}

  async register(data: { username: string; email: string; phone: string; password: string }) {
    const hashed = await bcrypt.hash(data.password, 10);
    const user = await this.prisma.user.create({
      data: {
        username: data.username,
        email: data.email,
        phone: data.phone,
        password: hashed,
        wallet: { create: { balance: 0 } },
      },
    });
    return user;
  }

  /// `identifier` accepte un email ou un numéro de téléphone — la connexion
  /// fonctionne avec l'un ou l'autre sans changer le contrat de l'API.
  async validateUser(identifier: string, pass: string) {
    const value = identifier.trim();
    const user = await this.prisma.user.findFirst({
      where: value.includes('@')
        ? { OR: [{ email: value }, { email: value.toLowerCase() }] }
        : { phone: value.replace(/\s+/g, '') },
    });
    if (!user) return null;
    const match = await bcrypt.compare(pass, user.password);
    if (!match) return null;
    const { password, ...rest } = user as any;
    return rest;
  }

  signToken(userId: string) {
    const secret = process.env.JWT_SECRET || 'dev_secret';
    return jwt.sign({ sub: userId }, secret, { expiresIn: '30d' });
  }

  verifyToken(token: string) {
    const secret = process.env.JWT_SECRET || 'dev_secret';
    try {
      return jwt.verify(token, secret) as { sub: string; iat?: number; exp?: number };
    } catch {
      return null;
    }
  }
}
