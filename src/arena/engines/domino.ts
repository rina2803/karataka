import { GameEngine, IllegalMove, shuffle } from '../engine';

/// Domino double-six, 2 à 4 joueurs (classique à 3), 7 dominos chacun, le
/// reste en pioche. Le plus gros double commence la 1re manche, le gagnant
/// de la manche commence la suivante. On pose à un bout de la chaîne ; sans
/// domino jouable on pioche, et on passe quand la pioche est vide. Manche
/// gagnée par celui qui pose tout (ou, si tout le monde est bloqué, par le
/// plus petit total de points) : il marque les points restant chez les
/// autres. Partie en 100 points.
export const DOMINO_TARGET = 100;
type Tile = [number, number];
type DominoMove = { type: 'play'; tile: Tile; side: 'left' | 'right' } | { type: 'draw' } | { type: 'pass' };

interface DominoState {
  hands: Tile[][];
  boneyard: Tile[];
  chain: Tile[];
  turn: number;
  passes: number;
  scores: number[];
  lastRound: { winner: number | null; points: number; blocked: boolean } | null;
  rounds: number;
  played: number;
  over: boolean;
}

const pips = (hand: Tile[]) => hand.reduce((s, [a, b]) => s + a + b, 0);
const same = (t: Tile, u: Tile) => (t[0] === u[0] && t[1] === u[1]) || (t[0] === u[1] && t[1] === u[0]);

function ends(s: DominoState) {
  return s.chain.length ? { left: s.chain[0][0], right: s.chain[s.chain.length - 1][1] } : null;
}

function placements(s: DominoState, seat: number): { tile: Tile; side: 'left' | 'right' }[] {
  const e = ends(s);
  const out: { tile: Tile; side: 'left' | 'right' }[] = [];
  for (const tile of s.hands[seat]) {
    if (!e) {
      out.push({ tile, side: 'right' });
      continue;
    }
    if (tile.includes(e.left)) out.push({ tile, side: 'left' });
    if (tile.includes(e.right)) out.push({ tile, side: 'right' });
  }
  return out;
}

function startRound(s: DominoState, starter: number | null) {
  const set: Tile[] = [];
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) set.push([a, b]);
  const tiles = shuffle(set);
  s.hands = s.scores.map(() => tiles.splice(0, 7));
  s.boneyard = tiles;
  s.chain = [];
  s.passes = 0;
  if (starter !== null) {
    s.turn = starter;
    return;
  }
  // 1re manche : le plus gros double commence (sinon le plus gros domino).
  let best = -1;
  s.hands.forEach((hand, seat) => {
    for (const [a, b] of hand) {
      const v = a === b ? 100 + a : a + b;
      if (v > best) {
        best = v;
        s.turn = seat;
      }
    }
  });
}

function endRound(s: DominoState, winner: number | null, blocked: boolean) {
  let points = 0;
  if (winner !== null) {
    points = s.hands.reduce((sum, h, seat) => (seat === winner ? sum : sum + pips(h)), 0);
    s.scores[winner] += points;
  }
  s.lastRound = { winner, points, blocked };
  s.rounds++;
  if (Math.max(...s.scores) >= DOMINO_TARGET) {
    const top = Math.max(...s.scores);
    if (s.scores.filter((v) => v === top).length === 1) {
      s.over = true;
      return;
    }
  }
  startRound(s, winner);
}

export const domino: GameEngine<DominoState, DominoMove> = {
  slug: 'domino',
  name: 'Domino',
  minPlayers: 2,
  maxPlayers: 4,
  minProgressForPoints: 14,

  init(n) {
    const s = { hands: [], boneyard: [], chain: [], turn: 0, passes: 0, scores: Array(n).fill(0), lastRound: null, rounds: 0, played: 0, over: false } as DominoState;
    startRound(s, null);
    return s;
  },

  actors: (s) => (s.over ? [] : [s.turn]),

  legalMoves(s, seat) {
    if (s.over || seat !== s.turn) return [];
    const options = placements(s, seat);
    if (options.length) return options.map((o) => ({ type: 'play' as const, ...o }));
    return [s.boneyard.length ? { type: 'draw' } : { type: 'pass' }];
  },

  play(s, seat, move) {
    if (s.over || seat !== s.turn) throw new IllegalMove("Ce n'est pas votre tour");
    const options = placements(s, seat);
    if (move?.type === 'draw') {
      if (options.length) throw new IllegalMove('Vous avez un domino jouable');
      if (!s.boneyard.length) throw new IllegalMove('La pioche est vide');
      s.hands[seat].push(s.boneyard.pop()!);
      return;
    }
    if (move?.type === 'pass') {
      if (options.length || s.boneyard.length) throw new IllegalMove('Vous pouvez encore jouer ou piocher');
      s.passes++;
      if (s.passes >= s.hands.length) {
        const totals = s.hands.map(pips);
        const low = Math.min(...totals);
        const winners = totals.flatMap((t, i) => (t === low ? [i] : []));
        return endRound(s, winners.length === 1 ? winners[0] : null, true);
      }
      s.turn = (seat + 1) % s.hands.length;
      return;
    }
    if (move?.type !== 'play' || !Array.isArray(move.tile)) throw new IllegalMove('Coup invalide');
    const tile: Tile = [Number(move.tile[0]), Number(move.tile[1])];
    const choice = options.find((o) => same(o.tile, tile) && o.side === move.side) ?? options.find((o) => same(o.tile, tile));
    if (!choice) throw new IllegalMove('Ce domino ne se pose pas ici');
    const [a, b] = choice.tile;
    const e = ends(s);
    if (!e) s.chain.push([a, b]);
    else if (choice.side === 'left') s.chain.unshift(b === e.left ? [a, b] : [b, a]);
    else s.chain.push(a === e.right ? [a, b] : [b, a]);
    s.hands[seat] = s.hands[seat].filter((t) => !same(t, choice.tile));
    s.played++;
    s.passes = 0;
    if (!s.hands[seat].length) return endRound(s, seat, false);
    s.turn = (seat + 1) % s.hands.length;
  },

  result(s) {
    if (!s.over) return null;
    const top = Math.max(...s.scores);
    return { winners: [s.scores.indexOf(top)], reason: 'score' };
  },

  view(s, seat) {
    return {
      hand: seat >= 0 ? s.hands[seat] : [],
      handCounts: s.hands.map((h) => h.length),
      chain: s.chain,
      ends: ends(s),
      boneyard: s.boneyard.length,
      turn: s.turn,
      scores: s.scores,
      target: DOMINO_TARGET,
      lastRound: s.lastRound,
      rounds: s.rounds,
      playable: seat === s.turn ? placements(s, seat) : [],
    };
  },

  turnMs: () => 25_000,
  progress: (s) => s.played,
  botDelayMs: () => 1000,

  /// Pose le domino le plus lourd possible, sinon pioche ou passe.
  botMove(s, seat): DominoMove {
    const options = placements(s, seat);
    if (!options.length) return s.boneyard.length ? { type: 'draw' } : { type: 'pass' };
    const best = options.reduce((x, y) => (y.tile[0] + y.tile[1] > x.tile[0] + x.tile[1] ? y : x));
    return { type: 'play', ...best };
  },
};
