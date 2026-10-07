import { GameEngine, IllegalMove, randomItem } from '../engine';

/// Ludo (petits chevaux), 2 à 4 joueurs, 4 pions chacun.
/// Progression d'un pion : -1 = maison, 0..50 = tour du plateau (52 cases,
/// départ propre à chaque couleur), 51..55 = couloir final, 56 = arrivé.
/// Il faut un 6 pour sortir, le score exact pour arriver. Tomber sur un pion
/// adverse hors case refuge le renvoie à la maison. Un 6, une prise ou une
/// arrivée font rejouer ; trois 6 de suite font perdre la main.
const TRACK = 52;
const HOME = 56;
const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

type LudoMove = { type: 'roll' } | { type: 'move'; pawn: number };

interface LudoState {
  colors: number[];
  pawns: number[][];
  turn: number;
  phase: 'roll' | 'move';
  dice: number | null;
  sixes: number;
  rolls: number;
  lastRoll: { seat: number; value: number } | null;
  lastMove: { seat: number; pawn: number; from: number; to: number; captured: { seat: number; pawn: number }[] } | null;
  winner: number | null;
}

const cell = (color: number, progress: number) => (color * 13 + progress) % TRACK;

function target(s: LudoState, seat: number, pawn: number): number | null {
  const p = s.pawns[seat][pawn];
  const d = s.dice ?? 0;
  if (p === HOME) return null;
  if (p === -1) return d === 6 ? 0 : null;
  return p + d <= HOME ? p + d : null;
}

function movablePawns(s: LudoState, seat: number) {
  return [0, 1, 2, 3].filter((i) => target(s, seat, i) !== null);
}

function nextTurn(s: LudoState) {
  s.turn = (s.turn + 1) % s.pawns.length;
  s.phase = 'roll';
  s.dice = null;
  s.sixes = 0;
}

export const ludo: GameEngine<LudoState, LudoMove> = {
  slug: 'ludo',
  name: 'Ludo',
  minPlayers: 2,
  maxPlayers: 4,
  minProgressForPoints: 30,

  init(n) {
    const colors = n === 2 ? [0, 2] : n === 3 ? [0, 1, 2] : [0, 1, 2, 3];
    return {
      colors,
      pawns: colors.map(() => [-1, -1, -1, -1]),
      turn: 0,
      phase: 'roll',
      dice: null,
      sixes: 0,
      rolls: 0,
      lastRoll: null,
      lastMove: null,
      winner: null,
    };
  },

  actors: (s) => (s.winner !== null ? [] : [s.turn]),

  legalMoves(s, seat) {
    if (s.winner !== null || seat !== s.turn) return [];
    if (s.phase === 'roll') return [{ type: 'roll' }];
    return movablePawns(s, seat).map((pawn) => ({ type: 'move' as const, pawn }));
  },

  play(s, seat, move) {
    if (s.winner !== null || seat !== s.turn) throw new IllegalMove("Ce n'est pas votre tour");
    if (move?.type === 'roll') {
      if (s.phase !== 'roll') throw new IllegalMove('Choisissez un pion à avancer');
      const value = 1 + Math.floor(Math.random() * 6);
      s.dice = value;
      s.rolls++;
      s.lastRoll = { seat, value };
      s.sixes = value === 6 ? s.sixes + 1 : 0;
      if (s.sixes === 3) return nextTurn(s);
      if (movablePawns(s, seat).length === 0) {
        if (value === 6) {
          s.phase = 'roll';
          s.dice = null;
        } else {
          nextTurn(s);
        }
        return;
      }
      s.phase = 'move';
      return;
    }

    if (move?.type !== 'move' || s.phase !== 'move') throw new IllegalMove('Lancez le dé');
    const pawn = Number(move.pawn);
    const to = Number.isInteger(pawn) && pawn >= 0 && pawn < 4 ? target(s, seat, pawn) : null;
    if (to === null) throw new IllegalMove('Ce pion ne peut pas avancer');
    const from = s.pawns[seat][pawn];
    s.pawns[seat][pawn] = to;

    const captured: { seat: number; pawn: number }[] = [];
    if (to <= 50) {
      const here = cell(s.colors[seat], to);
      if (!SAFE.has(here)) {
        s.pawns.forEach((pawns, other) => {
          if (other === seat) return;
          pawns.forEach((p, i) => {
            if (p >= 0 && p <= 50 && cell(s.colors[other], p) === here) {
              pawns[i] = -1;
              captured.push({ seat: other, pawn: i });
            }
          });
        });
      }
    }
    s.lastMove = { seat, pawn, from, to, captured };

    if (s.pawns[seat].every((p) => p === HOME)) {
      s.winner = seat;
      return;
    }
    if (s.dice === 6 || captured.length || to === HOME) {
      s.phase = 'roll';
      s.dice = null;
    } else {
      nextTurn(s);
    }
  },

  result: (s) => (s.winner !== null ? { winners: [s.winner], reason: 'home' } : null),

  view: (s) => ({
    colors: s.colors,
    pawns: s.pawns,
    turn: s.turn,
    phase: s.phase,
    dice: s.dice,
    lastRoll: s.lastRoll,
    lastMove: s.lastMove,
    movable: s.phase === 'move' ? movablePawns(s, s.turn) : [],
  }),
  turnMs: (s) => (s.phase === 'roll' ? 15_000 : 20_000),
  progress: (s) => s.rolls,
  botDelayMs: () => 900,

  /// Arriver > prendre > sortir > avancer le pion le plus avancé.
  botMove(s, seat) {
    if (s.phase === 'roll') return { type: 'roll' };
    const pawns = movablePawns(s, seat);
    const score = (pawn: number) => {
      const to = target(s, seat, pawn)!;
      let v = to;
      if (to === HOME) v += 200;
      if (to <= 50) {
        const here = cell(s.colors[seat], to);
        const hits = s.pawns.some((ps, o) => o !== seat && ps.some((p) => p >= 0 && p <= 50 && cell(s.colors[o], p) === here));
        if (hits && !SAFE.has(here)) v += 150;
        if (SAFE.has(here)) v += 20;
      }
      if (s.pawns[seat][pawn] === -1) v += 100;
      return v + Math.random() * 5;
    };
    if (!pawns.length) return { type: 'move', pawn: 0 };
    const best = pawns.reduce((a, b) => (score(b) > score(a) ? b : a));
    return Math.random() < 0.85 ? { type: 'move', pawn: best } : { type: 'move', pawn: randomItem(pawns) };
  },
};
