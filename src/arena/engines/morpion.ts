import { GameEngine, IllegalMove, randomItem } from '../engine';

/// Morpion 3×3 : aligner 3 symboles. Le siège 0 (X) commence.
interface MorpionState {
  board: (number | null)[];
  turn: number;
  moves: number;
  winLine: number[] | null;
  over: boolean;
}

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

function lineOf(board: (number | null)[], seat: number) {
  return LINES.find((l) => l.every((i) => board[i] === seat)) ?? null;
}

export const morpion: GameEngine<MorpionState, { cell: number }> = {
  slug: 'morpion',
  name: 'Morpion',
  minPlayers: 2,
  maxPlayers: 2,
  minProgressForPoints: 5,

  init: () => ({ board: Array(9).fill(null), turn: 0, moves: 0, winLine: null, over: false }),
  actors: (s) => (s.over ? [] : [s.turn]),
  legalMoves: (s) => s.board.map((v, i) => (v === null ? { cell: i } : null)).filter((m): m is { cell: number } => !!m),

  play(s, seat, move) {
    const cell = Number(move?.cell);
    if (s.over || seat !== s.turn) throw new IllegalMove("Ce n'est pas votre tour");
    if (!Number.isInteger(cell) || cell < 0 || cell > 8 || s.board[cell] !== null) throw new IllegalMove('Case invalide');
    s.board[cell] = seat;
    s.moves++;
    s.winLine = lineOf(s.board, seat);
    if (s.winLine || s.moves === 9) s.over = true;
    else s.turn = 1 - seat;
  },

  result(s) {
    if (!s.over) return null;
    if (s.winLine) return { winners: [s.board[s.winLine[0]]!], reason: 'line' };
    return { winners: [], reason: 'draw' };
  },

  view: (s) => ({ board: s.board, turn: s.turn, winLine: s.winLine }),
  turnMs: () => 30_000,
  progress: (s) => s.moves,

  /// Gagne si possible, sinon bloque, sinon centre, sinon au hasard.
  botMove(s, seat) {
    const free = morpion.legalMoves(s, seat);
    for (const who of [seat, 1 - seat]) {
      for (const m of free) {
        const b = [...s.board];
        b[m.cell] = who;
        if (lineOf(b, who)) return m;
      }
    }
    if (s.board[4] === null) return { cell: 4 };
    return randomItem(free);
  },
};
