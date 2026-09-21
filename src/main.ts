import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

const TEST_PLAYERS = [
  { username: 'seeduser', email: 'seed@lalao.test', displayName: 'Rangy (Test)', avatarColor: '#2E9BEA' },
  { username: 'rangy', email: 'rangy@lalao.test', displayName: 'Rangy', avatarColor: '#2E9BEA' },
  { username: 'tiana', email: 'tiana@lalao.test', displayName: 'Tiana', avatarColor: '#25B37A' },
  { username: 'mika', email: 'mika@lalao.test', displayName: 'Mika', avatarColor: '#7FC8FF' },
  { username: 'sandy', email: 'sandy@lalao.test', displayName: 'Sandy', avatarColor: '#E8654F' },
  { username: 'tojo', email: 'tojo@lalao.test', displayName: 'Tojo', avatarColor: '#16283A' },
  { username: 'hery', email: 'hery@lalao.test', displayName: 'Hery', avatarColor: '#9B59B6' },
  { username: 'lala', email: 'lala@lalao.test', displayName: 'Lala', avatarColor: '#F39C12' },
  { username: 'koto', email: 'koto@lalao.test', displayName: 'Koto', avatarColor: '#1ABC9C' },
];

const DEFAULT_PRODUCTS = [
  { name: 'T-shirt Lalao & Karataka', description: 'T-shirt officiel du jeu.', price: 25000, stock: 20, category: 'Vêtements', sellerName: 'Tsenabe officiel', imageUrl: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=640&q=85' },
  { name: 'Casquette L&K', description: 'Casquette officielle bleu électrique.', price: 18000, stock: 15, category: 'Accessoires', sellerName: 'Tsenabe officiel', imageUrl: 'https://images.unsplash.com/photo-1521369909029-2afed882baee?w=640&q=85' },
  { name: 'Mug Tsenabe', description: 'Mug collector pour les joueurs.', price: 12000, stock: 30, category: 'Maison', sellerName: 'Tsenabe officiel', imageUrl: 'https://images.unsplash.com/photo-1514228742587-6b1558feca88?w=640&q=85' },
];

async function ensureTestPlayers(prisma: PrismaService) {
  const password = process.env.SEED_PASSWORD || 'Password123';
  const hashed = await bcrypt.hash(password, 10);

  for (const p of TEST_PLAYERS) {
    const existing = await prisma.user.findUnique({ where: { email: p.email }, include: { wallet: true } });
    if (!existing) {
      await prisma.user.create({
        data: {
          username: p.username,
          email: p.email,
          password: hashed,
          displayName: p.displayName,
          avatarColor: p.avatarColor,
          wallet: { create: { balance: 1000 } },
        },
      });
      console.log(`Joueur test créé : ${p.username}`);
      continue;
    }
    if (!existing.wallet) {
      await prisma.wallet.create({ data: { userId: existing.id, balance: 1000 } });
    }
  }
}

async function ensureAdminUser(prisma: PrismaService) {
  const email = process.env.ADMIN_EMAIL || 'admin@lalao.test';
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'Admin123!';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.role !== 'admin') {
      await prisma.user.update({ where: { id: existing.id }, data: { role: 'admin' } });
    }
    return;
  }

  const hashed = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: {
      username,
      email,
      password: hashed,
      displayName: 'Administrateur',
      avatarColor: '#16283A',
      role: 'admin',
      wallet: { create: { balance: 0 } },
    },
  });
  console.log(`\nCompte admin créé : ${email} / ${password}\n`);
}

async function ensureDefaultProducts(prisma: PrismaService) {
  for (const product of DEFAULT_PRODUCTS) {
    const existing = await prisma.product.findFirst({ where: { name: product.name } });
    if (!existing) await prisma.product.create({ data: product });
  }
}

function parseAllowedOrigins(): string[] {
  const raw = process.env.CORS_ORIGIN || process.env.FRONTEND_URL || '*';
  if (raw === '*') return ['*'];

  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.replace(/\/+$/, ''));
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const allowedOrigins = parseAllowedOrigins();
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes('*')) {
        callback(null, true);
        return;
      }

      const originPattern = allowedOrigins.includes(origin);
      const normalizedOrigin = origin?.replace(/\/+$/, '');
      const matchesOrigin = !!normalizedOrigin && allowedOrigins.includes(normalizedOrigin);

      if (originPattern || matchesOrigin) {
        callback(null, true);
        return;
      }

      console.warn(`CORS blocked for origin: ${origin}`);
      callback(new Error(`Origin ${origin} not allowed by CORS`), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Socket-ID'],
  });

  const port = Number(process.env.PORT) || 3001;
  await app.listen(port, '0.0.0.0');

  console.log(`API running on port ${port}`);
  console.log(`CORS origin(s): ${allowedOrigins.join(', ') || '*'}`);
  console.log(`Node env: ${process.env.NODE_ENV || 'development'}`);

  try {
    const prisma = app.get(PrismaService);
    await ensureTestPlayers(prisma);
    await ensureAdminUser(prisma);
    await ensureDefaultProducts(prisma);
  } catch (error) {
    console.error('Database initialization failed; API remains available:', error);
  }
}

bootstrap().catch((error) => {
  console.error('API bootstrap failed:', error);
  process.exitCode = 1;
});
