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
  { name: 'Mug Tsenabe', description: 'Mug collector pour les joueurs.', price: 12000, stock: 30, category: 'Maison', sellerName: 'Tsenabe officiel', imageUrl: 'https://images.unsplash.com/photo-1514228569937-3a99e9862c94?w=640&q=85' },
  { name: 'Sac à dos Karataka Sport', description: 'Sac à dos résistant, compartiment laptop.', price: 32000, stock: 25, category: 'Accessoires', sellerName: 'Tsenabe officiel', imageUrl: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=640&q=85' },
  { name: 'Jeu d\'échecs de voyage', description: 'Set pliable magnétique, idéal en déplacement.', price: 28000, originalPrice: 38000, isPromo: true, stock: 18, category: 'Accessoires', sellerName: 'Tsenabe officiel', imageUrl: 'https://images.unsplash.com/photo-1528819622765-d6bcf132ac11?w=640&q=85' },
  { name: 'Pizza Margherita Familiale', description: 'Pâte fine, mozzarella, basilic frais — grand format.', price: 25000, stock: 40, category: 'Repas', sellerName: 'Gastronomie Pizza', imageUrl: 'https://images.unsplash.com/photo-1548365328-9f547fb0953b?w=640&q=85' },
  { name: 'Burger Deluxe Karataka', description: 'Bœuf, cheddar, sauce maison, frites incluses.', price: 15000, stock: 35, category: 'Repas', sellerName: 'Burger House Tana', imageUrl: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=640&q=85' },
  { name: 'Poulet Rôti Malagasy', description: 'Poulet fermier mariné aux épices locales, riz inclus.', price: 20000, stock: 20, category: 'Repas', sellerName: 'Chicken Tana', imageUrl: 'https://images.unsplash.com/photo-1598103442097-8b74394b95c6?w=640&q=85' },
  { name: 'Panier Essentiels Carrefour', description: 'Riz, huile, sucre et conserves — panier famille.', price: 45000, originalPrice: 55000, isPromo: true, stock: 30, category: 'Épicerie', sellerName: 'Carrefour Madagascar', imageUrl: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=640&q=85' },
  { name: 'Crème Hydratante Malagasy', description: 'Beurre de karité et huiles locales, tous types de peau.', price: 18000, stock: 22, category: 'Beauté', sellerName: 'Beauté Naturelle Tana', imageUrl: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=640&q=85' },
  { name: 'Huile de Coco Bio', description: 'Pressée à froid, cheveux et peau.', price: 12000, stock: 28, category: 'Beauté', sellerName: 'Sambatra Cosmetics', imageUrl: 'https://images.unsplash.com/photo-1611080626919-7cf5a9dbab5b?w=640&q=85' },
  { name: 'Kit Manucure Complet', description: 'Set professionnel 12 pièces avec étui.', price: 20000, stock: 15, category: 'Beauté', sellerName: 'Glam Studio', imageUrl: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=640&q=85' },
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
