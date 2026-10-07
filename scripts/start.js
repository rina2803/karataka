// Démarrage production : crée/met à jour les tables puis lance l'API.
// Utile sur Render où la base peut être vide au démarrage.
const { execSync } = require('child_process');

/// Adapte l'adresse Neon pour Prisma :
/// - retire `channel_binding` (option récente de Neon que Prisma ne gère pas) ;
/// - adresse « pooler » : les tables sont créées via l'adresse directe, et
///   l'API passe en mode pgbouncer (pas de requêtes préparées partagées).
function prepareDatabaseUrl() {
  const raw = process.env.DATABASE_URL || '';
  if (!/^postgres(ql)?:\/\//.test(raw)) return { runtime: raw, push: raw };
  const url = new URL(raw);
  url.searchParams.delete('channel_binding');
  if (!url.searchParams.has('sslmode')) url.searchParams.set('sslmode', 'require');
  if (!url.searchParams.has('connect_timeout')) url.searchParams.set('connect_timeout', '30');
  const direct = new URL(url.toString());
  const pooled = url.hostname.includes('-pooler');
  if (pooled) {
    direct.hostname = url.hostname.replace('-pooler', '');
    url.searchParams.set('pgbouncer', 'true');
  }
  console.log(`Base PostgreSQL : ${url.hostname} (${pooled ? 'pooler' : 'directe'})`);
  return { runtime: url.toString(), push: direct.toString() };
}

const { runtime, push } = prepareDatabaseUrl();

try {
  execSync('node scripts/prisma-provider.js', { stdio: 'inherit' });
  execSync('npx prisma db push --skip-generate', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: push } });
} catch (error) {
  console.error('prisma db push a échoué ; démarrage quand même pour garder /health :', error.message);
}

process.env.DATABASE_URL = runtime;
require('../dist/main.js');
