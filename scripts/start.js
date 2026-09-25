// Démarrage production : crée/met à jour les tables puis lance l'API.
// Utile sur Render où la base peut être vide au démarrage.
const { execSync } = require('child_process');

try {
  execSync('node scripts/prisma-provider.js', { stdio: 'inherit' });
  execSync('npx prisma db push --skip-generate', { stdio: 'inherit' });
} catch (error) {
  console.error('prisma db push a échoué ; démarrage quand même pour garder /health :', error.message);
}

require('../dist/main.js');
