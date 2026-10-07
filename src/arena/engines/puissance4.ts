import { GameEngine, IllegalMove, randomItem } from '../engine';

/// Puissance 4 : grille 7 colonnes × 6 lignes (ligne 0 en haut), aligner 4
/// jetons. Le siège 0 (rouge) commence.
const COLS = 7;
const ROWS = 6;

interface P4State {
  grid: (number | null)[][];
  turn: number;
  moves: number;
  last: { row: number; col: number } | null;
  winLine: [number, number][] | null;
  over: boolean;
}

function dropRow(grid: (number | null)[][], col: number) {
  for (let r = ROWS - 1; r >= 0; r--) if (grid[r][col] === null) return r;
  return -1;
}

function findLine(grid: (number | null)[][], row: number, col: number): [number, number][] | null {
  const who = grid[row][col];
  if (who === null) return null;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const cells: [number, number][] = [[row, col]];
    for (const sign of [1, -1]) {
      let r = row + dr * sign;
      let c = col + dc * sign;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && grid[r][c] === who) {
        cells.push([r, c]);
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (cells.length >= 4) return cells;
  }
  return null;
}

export const puissance4: GameEngine<P4State, { col: number }> = {
  slug: 'puissance4',
  name: 'Puissance 4',
  minPlayers: 2,
  maxPlayers: 2,
  minProgressForPoints: 8,

  init: () => ({
    grid: Array.from({ length: ROWS }, () => Array(COLS).fill(null)),
    turn: 0,
    moves: 0,
    last: null,
    winLine: null,
    over: false,
  }),
  actors: (s) => (s.over ? [] : [s.turn]),
  legalMoves: (s) =>
    Array.from({ length: COLS }, (_, c) => c).filter((c) => s.grid[0][c] === null).map((col) => ({ col })),

  play(s, seat, move) {
    const col = Number(move?.col);
    if (s.over || seat !== s.turn) throw new IllegalMove("Ce n'est pas votre tour");
    if (!Number.isInteger(col) || col < 0 || col >= COLS) throw new IllegalMove('Colonne invalide');
    const row = dropRow(s.grid, col);
    if (row < 0) throw new IllegalMove('Colonne pleine');
    s.grid[row][col] = seat;
    s.moves++;
    s.last = { row, col };
    s.winLine = findLine(s.grid, row, col);
    if (s.winLine || s.moves === ROWS * COLS) s.over = true;
    else s.turn = 1 - seat;
  },

  result(s) {
    if (!s.over) return null;
    if (s.winLine) return { winners: [s.grid[s.winLine[0][0]][s.winLine[0][1]]!], reason: 'line' };
    return { winners: [], reason: 'draw' };
  },

  view: (s) => ({ grid: s.grid, turn: s.turn, last: s.last, winLine: s.winLine }),
  turnMs: () => 30_000,
  progress: (s) => s.moves,

  /// Gagne si possible, sinon bloque, évite d'offrir la victoire, préfère le centre.
  botMove(s, seat) {
    const moves = puissance4.legalMoves(s, seat);
    const wins = (who: number, col: number) => {
      const g = s.grid.map((r) => [...r]);
      const row = dropRow(g, col);
      g[row][col] = who;
      return !!findLine(g, row, col);
    };
    for (const who of [seat, 1 - seat]) {
      const m = moves.find((mv) => wins(who, mv.col));
      if (m) return m;
    }
    const safe = moves.filter((mv) => {
      const g = s.grid.map((r) => [...r]);
      const row = dropRow(g, mv.col);
      g[row][mv.col] = seat;
      if (row === 0) return true;
      g[row - 1][mv.col] = 1 - seat;
      return !findLine(g, row - 1, mv.col);
    });
    const pool = safe.length ? safe : moves;
    pool.sort((a, b) => Math.abs(a.col - 3) - Math.abs(b.col - 3));
    return Math.random() < 0.6 ? pool[0] : randomItem(pool);
  },
};
