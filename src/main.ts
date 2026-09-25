import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { OFFICIAL_SELLER_NAME, SEED_PRODUCTS, SEED_SELLERS } from './seed-catalog';

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

/// Anciens articles de démo remplacés par le catalogue multi-vendeurs
/// (images cassées ou vendeurs fictifs) : masqués au démarrage.
const LEGACY_DEMO_PRODUCTS = [
  'Pizza Margherita Familiale',
  'Poulet Rôti Malagasy',
  'Panier Essentiels Carrefour',
  'Crème Hydratante Malagasy',
  'Huile de Coco Bio',
  'Kit Manucure Complet',
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

async function ensureSeedSellers(prisma: PrismaService) {
  const hashed = await bcrypt.hash(process.env.SEED_PASSWORD || 'Password123', 10);
  const ids = new Map<string, { id: string; displayName: string }>();
  for (const seller of SEED_SELLERS) {
    let user = await prisma.user.findUnique({ where: { username: seller.username } });
    if (!user) {
      user = await prisma.user.create({
        data: { ...seller, password: hashed, isApprovedSeller: true, wallet: { create: { balance: 0 } } },
      });
    } else if (!user.isApprovedSeller) {
      user = await prisma.user.update({ where: { id: user.id }, data: { isApprovedSeller: true } });
    }
    ids.set(seller.username, { id: user.id, displayName: seller.displayName });
  }
  return ids;
}

async function ensureDefaultProducts(prisma: PrismaService) {
  const sellers = await ensureSeedSellers(prisma);
  for (const { seller, originalPrice, ...product } of SEED_PRODUCTS) {
    const owner = seller ? sellers.get(seller) : undefined;
    const data = {
      ...product,
      price: String(product.price),
      originalPrice: originalPrice ? String(originalPrice) : null,
      isPromo: !!originalPrice,
      sellerId: owner?.id ?? null,
      sellerName: owner?.displayName ?? OFFICIAL_SELLER_NAME,
    };
    const existing = await prisma.product.findFirst({ where: { name: product.name } });
    if (!existing) {
      await prisma.product.create({ data });
    } else if (!existing.sellerId || existing.sellerId === owner?.id) {
      // Article de démo déjà présent : on corrige photo et vendeur, sans
      // toucher au stock ni au prix éventuellement modifiés depuis.
      await prisma.product.update({
        where: { id: existing.id },
        data: { imageUrl: data.imageUrl, sellerId: data.sellerId, sellerName: data.sellerName, category: data.category },
      });
    }
  }
  await prisma.product.updateMany({
    where: { name: { in: LEGACY_DEMO_PRODUCTS }, sellerId: null },
    data: { active: false },
  });
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
