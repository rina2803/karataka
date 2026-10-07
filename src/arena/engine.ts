/// Contrat commun des jeux en ligne arbitrés par le serveur (hors échecs,
/// qui ont leur propre passerelle). Chaque jeu fournit ses règles ; la
/// passerelle s'occupe des salles, des tours, des minuteurs, des bots, des
/// mises et des points.

export interface GameResult {
  /// Index des sièges gagnants (vide = match nul).
  winners: number[];
  reason: string;
}

export class IllegalMove extends Error {}

export interface GameEngine<S = any, M = any> {
  slug: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  /// Coups minimum avant qu'une partie rapporte des Karataka Points.
  minProgressForPoints: number;

  init(playerCount: number): S;
  /// Sièges qui peuvent jouer maintenant (plusieurs pour le quiz).
  actors(state: S): number[];
  /// Applique le coup ou lève IllegalMove.
  play(state: S, seat: number, move: M): void;
  /// Coups possibles du siège (bots et coups automatiques au temps écoulé).
  legalMoves(state: S, seat: number): M[];
  result(state: S): GameResult | null;
  /// Ce que voit le siège `seat` (-1 = spectateur) : cache les cartes et
  /// dominos des autres.
  view(state: S, seat: number): unknown;
  /// Temps accordé aux acteurs actuels.
  turnMs(state: S): number;
  /// Temps écoulé : par défaut un coup légal au hasard pour chaque acteur.
  onTimeout?(state: S): void;
  /// Nombre de coups joués (seuil anti-triche des points).
  progress(state: S): number;
  /// Coup d'un bot (par défaut : coup légal au hasard).
  botMove?(state: S, seat: number): M;
  /// Délai « humain » avant qu'un bot ne joue.
  botDelayMs?(state: S, seat: number): number;
}

export function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
