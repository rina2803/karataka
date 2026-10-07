import { GameEngine, IllegalMove, randomItem } from '../engine';

/// Jeu de dames 8×8, mêmes règles que la partie locale de l'app : pions sur
/// cases sombres, prise obligatoire, rafles en chaîne, promotion en dame sur
/// la dernière rangée. Siège 0 = foncés (en bas, commencent), siège 1 = clairs.
const N = 8;
interface Piece { s: number; k: boolean }
interface DamesMove { from: number; to: number; captured?: number[] }
interface DamesState {
  board: (Piece | null)[];
  turn: number;
  chainFrom: number | null;
  plies: number;
  quietPlies: number;
  last: DamesMove | null;
  winner: number | null;
  draw: boolean;
}

const idx = (r: number, c: number) => r * N + c;
const inside = (r: number, c: number) => r >= 0 && r < N && c >= 0 && c < N;
const ALL_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

function captures(s: DamesState, from: number): DamesMove[] {
  const p = s.board[from];
  if (!p) return [];
  const r = Math.floor(from / N);
  const c = from % N;
  const out: DamesMove[] = [];
  for (const [dr, dc] of ALL_DIRS) {
    const tr = r + 2 * dr;
    const tc = c + 2 * dc;
    if (!inside(tr, tc)) continue;
    const mid = s.board[idx(r + dr, c + dc)];
    if (!mid || mid.s === p.s || s.board[idx(tr, tc)]) continue;
    out.push({ from, to: idx(tr, tc), captured: [idx(r + dr, c + dc)] });
  }
  return out;
}

function steps(s: DamesState, from: number): DamesMove[] {
  const p = s.board[from];
  if (!p) return [];
  const r = Math.floor(from / N);
  const c = from % N;
  const forward = p.s === 0 ? -1 : 1;
  const dirs = p.k ? ALL_DIRS : [[forward, -1], [forward, 1]];
  return dirs
    .filter(([dr, dc]) => inside(r + dr, c + dc) && !s.board[idx(r + dr, c + dc)])
    .map(([dr, dc]) => ({ from, to: idx(r + dr, c + dc) }));
}

function legal(s: DamesState, seat: number): DamesMove[] {
  if (s.winner !== null || s.draw) return [];
  if (s.chainFrom !== null) return captures(s, s.chainFrom);
  const caps: DamesMove[] = [];
  const quiet: DamesMove[] = [];
  s.board.forEach((p, i) => {
    if (p?.s !== seat) return;
    caps.push(...captures(s, i));
    quiet.push(...steps(s, i));
  });
  return caps.length ? caps : quiet;
}

export const dames: GameEngine<DamesState, DamesMove> = {
  slug: 'dames',
  name: 'Dames',
  minPlayers: 2,
  maxPlayers: 2,
  minProgressForPoints: 20,

  init() {
    const board: (Piece | null)[] = Array(N * N).fill(null);
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if ((r + c) % 2 === 0) continue;
        if (r < 3) board[idx(r, c)] = { s: 1, k: false };
        if (r >= N - 3) board[idx(r, c)] = { s: 0, k: false };
      }
    }
    return { board, turn: 0, chainFrom: null, plies: 0, quietPlies: 0, last: null, winner: null, draw: false };
  },

  actors: (s) => (s.winner !== null || s.draw ? [] : [s.turn]),
  legalMoves: (s, seat) => legal(s, seat),

  play(s, seat, move) {
    if (seat !== s.turn) throw new IllegalMove("Ce n'est pas votre tour");
    const m = legal(s, seat).find((x) => x.from === Number(move?.from) && x.to === Number(move?.to));
    if (!m) throw new IllegalMove('Coup interdit (la prise est obligatoire)');
    let piece = s.board[m.from]!;
    s.board[m.from] = null;
    for (const c of m.captured ?? []) s.board[c] = null;
    const row = Math.floor(m.to / N);
    if (!piece.k && (row === 0 || row === N - 1)) piece = { ...piece, k: true };
    s.board[m.to] = piece;
    s.plies++;
    s.quietPlies = m.captured?.length ? 0 : s.quietPlies + 1;
    s.last = m;

    if (m.captured?.length && captures(s, m.to).length) {
      s.chainFrom = m.to;
    } else {
      s.chainFrom = null;
      s.turn = 1 - seat;
    }
    const mover = s.chainFrom !== null ? seat : s.turn;
    if (!s.board.some((p) => p?.s === mover) || legal(s, mover).length === 0) s.winner = 1 - mover;
    else if (s.quietPlies >= 80) s.draw = true;
  },

  result(s) {
    if (s.winner !== null) return { winners: [s.winner], reason: 'no-moves' };
    if (s.draw) return { winners: [], reason: 'draw' };
    return null;
  },

  view: (s) => ({ board: s.board, turn: s.turn, chainFrom: s.chainFrom, last: s.last }),
  turnMs: () => 45_000,
  progress: (s) => s.plies,

  /// Préfère les promotions en dame, sinon au hasard parmi les coups légaux.
  botMove(s, seat) {
    const moves = legal(s, seat);
    const promoting = moves.filter((m) => {
      const row = Math.floor(m.to / N);
      return !s.board[m.from]!.k && (row === 0 || row === N - 1);
    });
    return randomItem(promoting.length ? promoting : moves);
  },
};
