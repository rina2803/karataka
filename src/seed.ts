import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

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

async function main() {
  const password = process.env.SEED_PASSWORD || 'Password123';
  const hashed = await bcrypt.hash(password, 10);

  for (const p of TEST_PLAYERS) {
    const existing = await prisma.user.findUnique({ where: { email: p.email }, include: { wallet: true } });
    if (existing) {
      if (!existing.wallet) await prisma.wallet.create({ data: { userId: existing.id, balance: 1000 } });
      continue;
    }
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
  }
  console.log(`\n${TEST_PLAYERS.length} joueurs prêts. Mot de passe : ${password}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
