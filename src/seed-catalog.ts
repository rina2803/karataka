/// Catalogue de démonstration de la boutique multi-vendeurs : quelques
/// vendeurs validés et leurs articles, tous avec une photo (Unsplash, vérifiée).
/// Les articles sans `seller` appartiennent à la boutique officielle.

const img = (id: string) => `https://images.unsplash.com/photo-${id}?w=640&q=80&auto=format&fit=crop`;

export const OFFICIAL_SELLER_NAME = 'Tsenabe officiel';

export type SeedSeller = {
  username: string;
  email: string;
  displayName: string;
  avatarColor: string;
};

export type SeedProduct = {
  name: string;
  description: string;
  price: number;
  originalPrice?: number;
  stock: number;
  category: string;
  imageUrl: string;
  /** username du vendeur ; absent = boutique officielle. */
  seller?: string;
};

export const SEED_SELLERS: SeedSeller[] = [
  { username: 'echecsmada', email: 'echecsmada@lalao.test', displayName: 'Échecs Mada', avatarColor: '#16283A' },
  { username: 'modetana', email: 'modetana@lalao.test', displayName: 'Mode Tana', avatarColor: '#E8654F' },
  { username: 'gastrotana', email: 'gastrotana@lalao.test', displayName: 'Gastronomie Tana', avatarColor: '#F39C12' },
  { username: 'marchebio', email: 'marchebio@lalao.test', displayName: 'Marché Bio Analakely', avatarColor: '#25B37A' },
  { username: 'cafemada', email: 'cafemada@lalao.test', displayName: 'Café & Épices Mada', avatarColor: '#7B4A2D' },
  { username: 'beautetana', email: 'beautetana@lalao.test', displayName: 'Beauté Naturelle Tana', avatarColor: '#C0569E' },
  { username: 'techanalakely', email: 'techanalakely@lalao.test', displayName: 'Tech Analakely', avatarColor: '#2E9BEA' },
  { username: 'maisonzen', email: 'maisonzen@lalao.test', displayName: 'Maison Zen', avatarColor: '#9B59B6' },
];

export const SEED_PRODUCTS: SeedProduct[] = [
  // Boutique officielle
  { name: 'T-shirt Lalao & Karataka', description: 'T-shirt officiel du jeu, coton doux.', price: 25000, stock: 20, category: 'Vêtements', imageUrl: img('1521572163474-6864f9cf17ab') },
  { name: 'Casquette L&K', description: 'Casquette officielle délavée, taille réglable.', price: 18000, stock: 15, category: 'Accessoires', imageUrl: img('1521369909029-2afed882baee') },
  { name: 'Mug Tsenabe', description: 'Mug collector pour les joueurs, 33 cl.', price: 12000, stock: 30, category: 'Maison', imageUrl: img('1544787219-7f47ccb76574') },
  { name: 'Sac à dos Karataka Sport', description: 'Sac à dos résistant, compartiment ordinateur.', price: 32000, stock: 25, category: 'Accessoires', imageUrl: img('1553062407-98eeb64c6a62') },
  { name: 'Gourde isotherme L&K', description: 'Garde au frais 24 h, 500 ml.', price: 16000, originalPrice: 22000, stock: 40, category: 'Accessoires', imageUrl: img('1602143407151-7111542de6e8') },

  // Échecs Mada
  { name: 'Échiquier en bois massif', description: 'Plateau 45 cm et pièces Staunton en bois.', price: 85000, stock: 8, category: 'Jeux', imageUrl: img('1529699211952-734e80c4d42b'), seller: 'echecsmada' },
  { name: 'Jeu d\'échecs de voyage', description: 'Set pliable magnétique, idéal en déplacement.', price: 28000, originalPrice: 38000, stock: 18, category: 'Jeux', imageUrl: img('1580541832626-2a7131ee809f'), seller: 'echecsmada' },
  { name: 'Pièces Staunton lestées', description: 'Jeu de 32 pièces lestées, roi 9,5 cm.', price: 45000, stock: 12, category: 'Jeux', imageUrl: img('1586165368502-1bad197a6461'), seller: 'echecsmada' },
  { name: 'Échiquier de compétition', description: 'Plateau vinyle roulable + pièces tournoi.', price: 52000, stock: 10, category: 'Jeux', imageUrl: img('1610633389918-7d5b62977dc3'), seller: 'echecsmada' },
  { name: 'Manuel de stratégie aux échecs', description: 'Ouvertures, milieu de partie et finales.', price: 22000, stock: 20, category: 'Livres', imageUrl: img('1543002588-bfa74002ed7e'), seller: 'echecsmada' },
  { name: 'Jeu de dominos', description: 'Coffret 28 dominos, pour jouer en famille.', price: 15000, stock: 25, category: 'Jeux', imageUrl: img('1566694271453-390536dd1f0d'), seller: 'echecsmada' },
  { name: 'Jeu de plateau stratégie', description: 'Jeu de société de conquête, 2 à 4 joueurs.', price: 65000, stock: 6, category: 'Jeux', imageUrl: img('1610890716171-6b1bb98ffd09'), seller: 'echecsmada' },

  // Mode Tana
  { name: 'Veste bomber camel', description: 'Veste légère doublée, coupe droite.', price: 78000, originalPrice: 95000, stock: 9, category: 'Vêtements', imageUrl: img('1591047139829-d91aecb6caea'), seller: 'modetana' },
  { name: 'Top en maille crochet', description: 'Maille ajourée faite main.', price: 35000, stock: 14, category: 'Vêtements', imageUrl: img('1434389677669-e08b4cac3105'), seller: 'modetana' },
  { name: 'Ensemble jogging jaune', description: 'Sweat + pantalon, molleton doux.', price: 58000, stock: 11, category: 'Vêtements', imageUrl: img('1515886657613-9f3515b0c78f'), seller: 'modetana' },
  { name: 'Collection sweats colorés', description: 'Sweat à capuche, 6 coloris au choix.', price: 42000, stock: 30, category: 'Vêtements', imageUrl: img('1601924994987-69e26d50dc26'), seller: 'modetana' },

  // Gastronomie Tana
  { name: 'Pizza Margherita familiale', description: 'Pâte fine, mozzarella, basilic frais.', price: 25000, stock: 40, category: 'Repas', imageUrl: img('1565299624946-b28f40a0ae38'), seller: 'gastrotana' },
  { name: 'Burger Deluxe Karataka', description: 'Bœuf, cheddar, sauce maison.', price: 15000, stock: 35, category: 'Repas', imageUrl: img('1571091718767-18b5b1457add'), seller: 'gastrotana' },
  { name: 'Double cheeseburger', description: 'Deux steaks, double cheddar, oignons.', price: 19000, stock: 30, category: 'Repas', imageUrl: img('1568901346375-23c9450c58cd'), seller: 'gastrotana' },
  { name: 'Poulet rôti malagasy', description: 'Poulet fermier mariné aux épices locales.', price: 20000, stock: 20, category: 'Repas', imageUrl: img('1598103442097-8b74394b95c6'), seller: 'gastrotana' },
  { name: 'Bowl végétarien', description: 'Avocat, pois chiches, crudités.', price: 14000, stock: 25, category: 'Repas', imageUrl: img('1512621776951-a57141f2eefd'), seller: 'gastrotana' },
  { name: 'Pancakes au miel', description: 'Pile de pancakes, miel de Madagascar.', price: 9000, stock: 30, category: 'Repas', imageUrl: img('1567620905732-2d1ec7ab7445'), seller: 'gastrotana' },

  // Marché Bio Analakely
  { name: 'Panier fruits tropicaux', description: 'Mangue, ananas, raisin, kiwi — 3 kg.', price: 18000, stock: 20, category: 'Épicerie', imageUrl: img('1619566636858-adf3ef46400b'), seller: 'marchebio' },
  { name: 'Oranges d\'Ambanja 5 kg', description: 'Oranges juteuses du nord.', price: 12000, stock: 30, category: 'Épicerie', imageUrl: img('1611080626919-7cf5a9dbab5b'), seller: 'marchebio' },
  { name: 'Panier légumes frais', description: 'Légumes de saison du marché.', price: 15000, originalPrice: 19000, stock: 25, category: 'Épicerie', imageUrl: img('1542838132-92c53300491e'), seller: 'marchebio' },
  { name: 'Panier courses famille', description: 'Essentiels de la semaine.', price: 45000, stock: 15, category: 'Épicerie', imageUrl: img('1543168256-418811576931'), seller: 'marchebio' },

  // Café & Épices Mada
  { name: 'Café arabica en grains 1 kg', description: 'Torréfaction artisanale, hauts plateaux.', price: 28000, stock: 22, category: 'Épicerie', imageUrl: img('1447933601403-0c6688de566e'), seller: 'cafemada' },
  { name: 'Coffret cappuccino', description: 'Café moulu + tasses, idéal à offrir.', price: 35000, stock: 12, category: 'Maison', imageUrl: img('1509042239860-f550ce710b93'), seller: 'cafemada' },
  { name: 'Duo latte à emporter', description: 'Deux lattes et leurs gobelets réutilisables.', price: 11000, stock: 40, category: 'Repas', imageUrl: img('1495474472287-4d71bcdd2085'), seller: 'cafemada' },

  // Beauté Naturelle Tana
  { name: 'Kit pinceaux maquillage', description: 'Set de 8 pinceaux avec trousse.', price: 20000, stock: 15, category: 'Beauté', imageUrl: img('1596462502278-27bfdc403348'), seller: 'beautetana' },
  { name: 'Crème hydratante karité', description: 'Beurre de karité et huiles locales.', price: 18000, stock: 22, category: 'Beauté', imageUrl: img('1556228720-195a672e8a03'), seller: 'beautetana' },
  { name: 'Collier de perles', description: 'Perles d\'eau douce, fermoir argent.', price: 60000, stock: 5, category: 'Bijoux', imageUrl: img('1515562141207-7a88fb7ce338'), seller: 'beautetana' },
  { name: 'Boucles d\'oreilles saphir', description: 'Pierres bleues serties, style vintage.', price: 48000, stock: 7, category: 'Bijoux', imageUrl: img('1535632066927-ab7c9ab60908'), seller: 'beautetana' },

  // Tech Analakely
  { name: 'Casque audio sans fil', description: 'Bluetooth, 30 h d\'autonomie.', price: 75000, originalPrice: 90000, stock: 10, category: 'Électronique', imageUrl: img('1505740420928-5e560c06d30e'), seller: 'techanalakely' },
  { name: 'Casque studio filaire', description: 'Son précis pour le jeu et la musique.', price: 55000, stock: 12, category: 'Électronique', imageUrl: img('1583394838336-acd977736f90'), seller: 'techanalakely' },
  { name: 'Montre connectée', description: 'Suivi d\'activité, notifications, étanche.', price: 95000, stock: 8, category: 'Électronique', imageUrl: img('1523275335684-37898b6baf30'), seller: 'techanalakely' },
  { name: 'Manette de jeu sans fil', description: 'Compatible PC et mobile.', price: 65000, stock: 14, category: 'Électronique', imageUrl: img('1612287230202-1ff1d85d1bdf'), seller: 'techanalakely' },

  // Maison Zen
  { name: 'Fauteuil scandinave gris', description: 'Tissu doux, pieds en hêtre.', price: 240000, stock: 4, category: 'Maison', imageUrl: img('1598300042247-d088f8ab3a91'), seller: 'maisonzen' },
  { name: 'Fauteuil velours moutarde', description: 'Assise confortable, style rétro.', price: 280000, originalPrice: 320000, stock: 3, category: 'Maison', imageUrl: img('1586023492125-27b2c045efd7'), seller: 'maisonzen' },
  { name: 'Plante succulente en pot', description: 'Facile d\'entretien, pot céramique.', price: 12000, stock: 30, category: 'Maison', imageUrl: img('1485955900006-10f4d324d411'), seller: 'maisonzen' },
  { name: 'Mini cactus décoratif', description: 'Pot terre cuite, parfait pour un bureau.', price: 8000, stock: 35, category: 'Maison', imageUrl: img('1459411552884-841db9b3cc2a'), seller: 'maisonzen' },
  { name: 'Tapis tissé motif oriental', description: 'Tapis 160 × 230 cm.', price: 150000, stock: 5, category: 'Maison', imageUrl: img('1600166898405-da9535204843'), seller: 'maisonzen' },
];

/// Image par défaut selon la catégorie — utilisée quand un ancien produit
/// n'a pas de photo, pour qu'aucune carte de la boutique ne reste vide.
const CATEGORY_IMAGES: Record<string, string> = {
  'Vêtements': img('1601924994987-69e26d50dc26'),
  Accessoires: img('1553062407-98eeb64c6a62'),
  Maison: img('1586023492125-27b2c045efd7'),
  Jeux: img('1529699211952-734e80c4d42b'),
  Livres: img('1512820790803-83ca734da794'),
  Repas: img('1504674900247-0877df9cc836'),
  'Épicerie': img('1542838132-92c53300491e'),
  'Beauté': img('1596462502278-27bfdc403348'),
  Bijoux: img('1515562141207-7a88fb7ce338'),
  'Électronique': img('1505740420928-5e560c06d30e'),
};
const DEFAULT_PRODUCT_IMAGE = img('1441986300917-64674bd600d8');

export function fallbackProductImage(category?: string | null) {
  return (category && CATEGORY_IMAGES[category]) || DEFAULT_PRODUCT_IMAGE;
}
