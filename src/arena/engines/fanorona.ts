import { GameEngine, IllegalMove, randomItem } from '../engine';

/// Fanorona (jeu malgache), mêmes règles que la partie locale de l'app :
/// plateau 5×9, diagonales sur les points pairs, capture par approche ou par
/// éloignement obligatoire, captures en chaîne sans reprendre la même ligne.
/// Siège 0 = blancs (lignes du haut, commencent), siège 1 = noirs.
const ROWS = 5;
const COLS = 9;
const SIZE = ROWS * COLS;
const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];

interface FMove { from: number; to: number; dr: number; dc: number; captured: number[]; withdrawal: boolean }
interface FState {
  board: (number | null)[];
  turn: number;
  chainFrom: number | null;
  forbidden: [number, number] | null;
  plies: number;
  quietPlies: number;
  last: FMove | null;
  winner: number | null;
  draw: boolean;
}

const idx = (r: number, c: number) => r * COLS + c;
const inside = (r: number, c: number) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
const edge = (r: number, c: number, dr: number, dc: number) => dr === 0 || dc === 0 || (r + c) % 2 === 0;

function line(s: FState, sr: number, sc: number, dr: number, dc: number, mover: number) {
  const out: number[] = [];
  let r = sr;
  let c = sc;
  let pr = sr - dr;
  let pc = sc - dc;
  while (inside(r, c) && edge(pr, pc, dr, dc) && s.board[idx(r, c)] === 1 - mover) {
    out.push(idx(r, c));
    pr = r;
    pc = c;
    r += dr;
    c += dc;
  }
  return out;
}

function movesFrom(s: FState, from: number, who: number, chainOnly: boolean): FMove[] {
  const r = Math.floor(from / COLS);
  const c = from % COLS;
  const out: FMove[] = [];
  for (const [dr, dc] of DIRS) {
    if (chainOnly && s.forbidden) {
      const [fr, fc] = s.forbidden;
      if ((dr === fr && dc === fc) || (dr === -fr && dc === -fc)) continue;
    }
    const tr = r + dr;
    const tc = c + dc;
    if (!inside(tr, tc) || !edge(r, c, dr, dc)) continue;
    const to = idx(tr, tc);
    if (s.board[to] !== null) continue;
    const approach = line(s, tr + dr, tc + dc, dr, dc, who);
    const withdrawal = line(s, r - dr, c - dc, -dr, -dc, who);
    if (approach.length) out.push({ from, to, dr, dc, captured: approach, withdrawal: false });
    if (withdrawal.length) out.push({ from, to, dr, dc, captured: withdrawal, withdrawal: true });
    if (!approach.length && !withdrawal.length && !chainOnly) out.push({ from, to, dr, dc, captured: [], withdrawal: false });
  }
  return out;
}

function legal(s: FState, who: number): FMove[] {
  if (s.winner !== null || s.draw) return [];
  if (s.chainFrom !== null) return movesFrom(s, s.chainFrom, who, true);
  const caps: FMove[] = [];
  const paika: FMove[] = [];
  for (let i = 0; i < SIZE; i++) {
    if (s.board[i] !== who) continue;
    for (const m of movesFrom(s, i, who, false)) (m.captured.length ? caps : paika).push(m);
  }
  return caps.length ? caps : paika;
}

export const fanorona: GameEngine<FState, { from: number; to: number; withdrawal?: boolean }> = {
  slug: 'fanorona',
  name: 'Fanorona',
  minPlayers: 2,
  maxPlayers: 2,
  minProgressForPoints: 15,

  init() {
    const board: (number | null)[] = Array(SIZE).fill(null);
    for (let c = 0; c < COLS; c++) {
      board[idx(0, c)] = 0;
      board[idx(1, c)] = 0;
      board[idx(3, c)] = 1;
      board[idx(4, c)] = 1;
      if (c === 4) continue;
      board[idx(2, c)] = c < 4 ? 0 : 1;
    }
    return { board, turn: 0, chainFrom: null, forbidden: null, plies: 0, quietPlies: 0, last: null, winner: null, draw: false };
  },

  actors: (s) => (s.winner !== null || s.draw ? [] : [s.turn]),
  legalMoves: (s, seat) => legal(s, seat).map((m) => ({ from: m.from, to: m.to, withdrawal: m.withdrawal })),

  play(s, seat, move) {
    if (seat !== s.turn) throw new IllegalMove("Ce n'est pas votre tour");
    const options = legal(s, seat).filter((x) => x.from === Number(move?.from) && x.to === Number(move?.to));
    if (!options.length) throw new IllegalMove('Coup interdit (la capture est obligatoire)');
    // Approche et éloignement possibles sur le même coup : le joueur choisit.
    const m = options.find((x) => x.withdrawal === !!move?.withdrawal) ?? options[0];
    s.board[m.from] = null;
    s.board[m.to] = seat;
    for (const c of m.captured) s.board[c] = null;
    s.plies++;
    s.quietPlies = m.captured.length ? 0 : s.quietPlies + 1;
    s.last = m;

    if (m.captured.length) {
      s.forbidden = [m.dr, m.dc];
      if (movesFrom(s, m.to, seat, true).some((x) => x.captured.length)) {
        s.chainFrom = m.to;
        return;
      }
    }
    s.chainFrom = null;
    s.forbidden = null;
    s.turn = 1 - seat;
    if (!s.board.includes(s.turn) || legal(s, s.turn).length === 0) s.winner = seat;
    else if (s.quietPlies >= 100) s.draw = true;
  },

  result(s) {
    if (s.winner !== null) return { winners: [s.winner], reason: 'no-moves' };
    if (s.draw) return { winners: [], reason: 'draw' };
    return null;
  },

  view: (s) => ({
    board: s.board,
    turn: s.turn,
    chainFrom: s.chainFrom,
    last: s.last && { from: s.last.from, to: s.last.to, captured: s.last.captured },
  }),
  turnMs: () => 45_000,
  progress: (s) => s.plies,

  /// Prend le coup qui capture le plus.
  botMove(s, seat) {
    const moves = legal(s, seat);
    const best = Math.max(...moves.map((m) => m.captured.length));
    const m = randomItem(moves.filter((x) => x.captured.length === best));
    return { from: m.from, to: m.to, withdrawal: m.withdrawal };
  },
};
