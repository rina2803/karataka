import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const publicUserSelect = {
  id: true,
  email: true,
  phone: true,
  username: true,
  displayName: true,
  avatarColor: true,
  avatarImage: true,
  role: true,
  createdAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  toPublic(user: {
    id: string;
    email: string;
    phone?: string | null;
    username: string;
    displayName?: string | null;
    avatarColor?: string | null;
    avatarImage?: string | null;
    role?: string | null;
    createdAt?: Date;
  }) {
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      username: user.username,
      displayName: user.displayName ?? user.username,
      avatarColor: user.avatarColor ?? '#2E9BEA',
      avatarImage: user.avatarImage ?? null,
      role: user.role ?? 'user',
      createdAt: user.createdAt,
    };
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: publicUserSelect,
    });
    return user ? this.toPublic(user) : null;
  }

  /// Premier champ déjà pris par un autre compte, pour un message précis.
  async findTaken(data: { username: string; email: string; phone: string }) {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ username: data.username }, { email: data.email }, { phone: data.phone }] },
      select: { username: true, email: true, phone: true },
    });
    if (!existing) return null;
    if (existing.email === data.email) return 'email' as const;
    if (existing.phone === data.phone) return 'phone' as const;
    return 'username' as const;
  }

  async isAdmin(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { role: true } });
    return user?.role === 'admin';
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async create(data: { username: string; email: string; password: string }) {
    const user = await this.prisma.user.create({ data });
    await this.prisma.wallet.create({ data: { userId: user.id, balance: '0' } });
    return user;
  }

  async list(limit = 50) {
    const users = await this.prisma.user.findMany({
      take: limit,
      select: publicUserSelect,
      orderBy: { createdAt: 'desc' },
    });
    return users.map((u) => this.toPublic(u));
  }

  async updateProfile(
    userId: string,
    data: { displayName?: string; avatarColor?: string; avatarImage?: string | null },
  ) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.displayName !== undefined ? { displayName: data.displayName } : {}),
        ...(data.avatarColor !== undefined ? { avatarColor: data.avatarColor } : {}),
        ...(data.avatarImage !== undefined ? { avatarImage: data.avatarImage } : {}),
      },
      select: publicUserSelect,
    });
    return this.toPublic(user);
  }
}
