// Aligne le provider Prisma sur DATABASE_URL : SQLite en local (file:...),
// PostgreSQL en production (postgres://... ex: Neon gratuit). Prisma n'accepte
// pas de provider dynamique, on réécrit donc schema.prisma avant generate/push.
require('dotenv/config');
const fs = require('fs');
const path = require('path');

const url = process.env.DATABASE_URL || '';
const provider = /^postgres(ql)?:\/\//.test(url) ? 'postgresql' : 'sqlite';
const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');
const schema = fs.readFileSync(schemaPath, 'utf8');
const updated = schema.replace(
  /(datasource db \{[^}]*provider\s*=\s*)"[^"]+"/,
  `$1"${provider}"`,
);
if (updated !== schema) fs.writeFileSync(schemaPath, updated);
console.log(`Prisma provider: ${provider}`);
