import { GameEngine, IllegalMove, shuffle } from '../engine';

/// Poker Texas Hold'em, 2 à 6 joueurs, jetons virtuels (1000 chacun, aucune
/// valeur réelle). Petite/grosse blinde 10/20, doublées toutes les 8 mains.
/// 2 cartes privées, flop/turn/river ; pots annexes gérés pour les tapis.
/// Partie gagnée par celui qui ramasse tous les jetons (ou qui en a le plus
/// après 40 mains).
/// Cartes : rang (2-9 T J Q K A) + couleur (S H D C), ex. « AH ».
const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = '23456789TJQKA';
export const POKER_START_CHIPS = 1000;
const BASE_BLIND = 20;
const BLIND_EVERY = 8;
const MAX_HANDS = 40;
const HAND_NAMES = ['Carte haute', 'Paire', 'Double paire', 'Brelan', 'Quinte', 'Couleur', 'Full', 'Carré', 'Quinte flush'];

type PokerMove =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'raise'; to: number }
  | { type: 'allin' };

interface HandSummary {
  hand: number;
  board: string[];
  winners: { seat: number; amount: number; label: string | null }[];
  shown: { seat: number; cards: string[]; label: string }[];
}

interface PokerState {
  chips: number[];
  hole: string[][];
  board: string[];
  deck: string[];
  dealer: number;
  street: 'preflop' | 'flop' | 'turn' | 'river';
  bets: number[];
  committed: number[];
  folded: boolean[];
  allIn: boolean[];
  acted: boolean[];
  currentBet: number;
  minRaise: number;
  bigBlind: number;
  turn: number;
  hand: number;
  lastHand: HandSummary | null;
  actions: number;
  over: boolean;
}

const rankValue = (c: string) => RANKS.indexOf(c[0]) + 2;
const suit = (c: string) => c[1];

/// Score comparable d'une main de 5 cartes : [catégorie, départages...].
function score5(cards: string[]): number[] {
  const values = cards.map(rankValue).sort((a, b) => b - a);
  const flush = cards.every((c) => suit(c) === suit(cards[0]));
  const unique = [...new Set(values)];
  let straightHigh = 0;
  if (unique.length === 5) {
    if (values[0] - values[4] === 4) straightHigh = values[0];
    else if (values[0] === 14 && values[1] === 5) straightHigh = 5; // A-2-3-4-5
  }
  const counts = new Map<number, number>();
  values.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const byGroup = groups.map((g) => g[0]);
  if (straightHigh && flush) return [8, straightHigh];
  if (groups[0][1] === 4) return [7, ...byGroup];
  if (groups[0][1] === 3 && groups[1][1] === 2) return [6, ...byGroup];
  if (flush) return [5, ...values];
  if (straightHigh) return [4, straightHigh];
  if (groups[0][1] === 3) return [3, ...byGroup];
  if (groups[0][1] === 2 && groups[1][1] === 2) return [2, ...byGroup];
  if (groups[0][1] === 2) return [1, ...byGroup];
  return [0, ...values];
}

function compare(a: number[], b: number[]) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/// Meilleure main de 5 parmi 5 à 7 cartes.
export function bestHand(cards: string[]): number[] {
  if (cards.length < 5) return [cards.length === 2 && cards[0][0] === cards[1][0] ? 1 : 0];
  let best: number[] = [-1];
  const pick = (start: number, chosen: string[]) => {
    if (chosen.length === 5) {
      const s = score5(chosen);
      if (compare(s, best) > 0) best = s;
      return;
    }
    for (let i = start; i < cards.length; i++) pick(i + 1, [...chosen, cards[i]]);
  };
  pick(0, []);
  return best;
}

const handLabel = (cards: string[]) => HAND_NAMES[bestHand(cards)[0]] ?? '';

function inHand(s: PokerState) {
  return s.chips.map((_, i) => i).filter((i) => !s.folded[i]);
}

function canAct(s: PokerState) {
  return inHand(s).filter((i) => !s.allIn[i]);
}

function nextFrom(s: PokerState, from: number, ok: (i: number) => boolean) {
  const n = s.chips.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    if (ok(i)) return i;
  }
  return -1;
}

function put(s: PokerState, seat: number, amount: number) {
  const a = Math.min(amount, s.chips[seat]);
  s.chips[seat] -= a;
  s.bets[seat] += a;
  s.committed[seat] += a;
  if (s.chips[seat] === 0) s.allIn[seat] = true;
}

function startHand(s: PokerState) {
  const alive = s.chips.map((c, i) => (c > 0 ? i : -1)).filter((i) => i >= 0);
  if (alive.length <= 1 || s.hand >= MAX_HANDS) {
    s.over = true;
    return;
  }
  const n = s.chips.length;
  s.hand++;
  s.bigBlind = BASE_BLIND * 2 ** Math.floor((s.hand - 1) / BLIND_EVERY);
  s.deck = shuffle(SUITS.flatMap((su) => [...RANKS].map((r) => r + su)));
  s.board = [];
  s.street = 'preflop';
  s.bets = Array(n).fill(0);
  s.committed = Array(n).fill(0);
  s.folded = s.chips.map((c) => c === 0);
  s.allIn = Array(n).fill(false);
  s.acted = Array(n).fill(false);
  s.hole = s.chips.map(() => []);
  s.dealer = nextFrom(s, s.dealer, (i) => s.chips[i] > 0);
  for (let r = 0; r < 2; r++) for (const i of alive) s.hole[i].push(s.deck.shift()!);
  // À deux, le donneur est petite blinde et parle en premier avant le flop.
  const sb = alive.length === 2 ? s.dealer : nextFrom(s, s.dealer, (i) => !s.folded[i]);
  const bb = nextFrom(s, sb, (i) => !s.folded[i]);
  put(s, sb, s.bigBlind / 2);
  put(s, bb, s.bigBlind);
  s.currentBet = s.bigBlind;
  s.minRaise = s.bigBlind;
  s.turn = nextFrom(s, bb, (i) => !s.folded[i] && !s.allIn[i]);
  if (s.turn < 0 || canAct(s).length === 0) runOut(s);
}

function award(s: PokerState, shown: boolean) {
  const players = inHand(s);
  const summary: HandSummary = { hand: s.hand, board: [...s.board], winners: [], shown: [] };
  const scores = new Map(players.map((i) => [i, bestHand([...s.hole[i], ...s.board])]));
  const won = new Map<number, number>();
  if (players.length === 1) {
    const total = s.committed.reduce((a, b) => a + b, 0);
    won.set(players[0], total);
  } else {
    const levels = [...new Set(players.map((i) => s.committed[i]))].sort((a, b) => a - b);
    let prev = 0;
    let leftover = 0;
    for (const level of levels) {
      const pot = s.committed.reduce((sum, c) => sum + Math.max(0, Math.min(c, level) - prev), 0) + leftover;
      const eligible = players.filter((i) => s.committed[i] >= level);
      const top = eligible.reduce((best, i) => (compare(scores.get(i)!, scores.get(best)!) > 0 ? i : best));
      const winners = eligible.filter((i) => compare(scores.get(i)!, scores.get(top)!) === 0);
      const share = Math.floor(pot / winners.length);
      winners.forEach((i) => won.set(i, (won.get(i) ?? 0) + share));
      // Jeton impair : au premier gagnant après le donneur.
      const odd = pot - share * winners.length;
      if (odd) {
        const first = nextFrom(s, s.dealer, (i) => winners.includes(i));
        won.set(first, (won.get(first) ?? 0) + odd);
      }
      leftover = 0;
      prev = level;
    }
    // Mises au-delà du dernier niveau (joueur couché) : au meilleur restant.
    const rest = s.committed.reduce((sum, c) => sum + Math.max(0, c - prev), 0);
    if (rest) {
      const top = players.reduce((best, i) => (compare(scores.get(i)!, scores.get(best)!) > 0 ? i : best));
      won.set(top, (won.get(top) ?? 0) + rest);
    }
  }
  for (const [seat, amount] of won) {
    s.chips[seat] += amount;
    summary.winners.push({ seat, amount, label: shown ? HAND_NAMES[scores.get(seat)![0]] : null });
  }
  if (shown) {
    summary.shown = players.map((i) => ({ seat: i, cards: s.hole[i], label: HAND_NAMES[scores.get(i)![0]] }));
  }
  s.lastHand = summary;
  startHand(s);
}

function runOut(s: PokerState) {
  while (s.board.length < 5) s.board.push(s.deck.shift()!);
  award(s, true);
}

function nextStreet(s: PokerState) {
  if (canAct(s).length <= 1) return runOut(s);
  if (s.street === 'river') return award(s, true);
  s.street = s.street === 'preflop' ? 'flop' : s.street === 'flop' ? 'turn' : 'river';
  s.board.push(...s.deck.splice(0, s.street === 'flop' ? 3 : 1));
  s.bets = s.bets.map(() => 0);
  s.acted = s.acted.map(() => false);
  s.currentBet = 0;
  s.minRaise = s.bigBlind;
  s.turn = nextFrom(s, s.dealer, (i) => !s.folded[i] && !s.allIn[i]);
}

function raiseTo(s: PokerState, seat: number, to: number) {
  const raise = to - s.currentBet;
  if (raise >= s.minRaise) s.minRaise = raise;
  s.currentBet = to;
  put(s, seat, to - s.bets[seat]);
  s.acted = s.acted.map((a, i) => (i === seat ? a : false));
}

function options(s: PokerState, seat: number) {
  const toCall = Math.max(0, s.currentBet - s.bets[seat]);
  const maxTo = s.bets[seat] + s.chips[seat];
  const minTo = Math.min(maxTo, s.currentBet + s.minRaise);
  return { toCall: Math.min(toCall, s.chips[seat]), minTo, maxTo };
}

export const poker: GameEngine<PokerState, PokerMove> = {
  slug: 'poker',
  name: 'Poker',
  minPlayers: 2,
  maxPlayers: 6,
  minProgressForPoints: 12,

  init(playerCount) {
    const s = {
      chips: Array(playerCount).fill(POKER_START_CHIPS), hole: [], board: [], deck: [],
      dealer: Math.floor(Math.random() * playerCount), street: 'preflop', bets: [], committed: [],
      folded: [], allIn: [], acted: [], currentBet: 0, minRaise: BASE_BLIND, bigBlind: BASE_BLIND,
      turn: 0, hand: 0, lastHand: null, actions: 0, over: false,
    } as PokerState;
    startHand(s);
    return s;
  },

  actors: (s) => (s.over ? [] : [s.turn]),

  legalMoves(s, seat) {
    if (s.over || seat !== s.turn) return [];
    const { toCall, minTo, maxTo } = options(s, seat);
    const moves: PokerMove[] = [];
    if (toCall > 0) moves.push({ type: 'fold' }, { type: 'call' });
    else moves.push({ type: 'check' });
    if (maxTo > s.currentBet) {
      if (minTo < maxTo) moves.push({ type: 'raise', to: minTo });
      moves.push({ type: 'allin' });
    }
    return moves;
  },

  play(s, seat, move) {
    if (s.over || seat !== s.turn) throw new IllegalMove("Ce n'est pas votre tour");
    const { toCall, minTo, maxTo } = options(s, seat);
    switch (move?.type) {
      case 'fold':
        s.folded[seat] = true;
        break;
      case 'check':
        if (toCall > 0) throw new IllegalMove('Il faut suivre ou se coucher');
        break;
      case 'call':
        if (toCall === 0) throw new IllegalMove('Rien à suivre : checkez');
        put(s, seat, toCall);
        break;
      case 'raise': {
        const to = Math.round(Number((move as { to: number }).to));
        if (!(to > s.currentBet) || to > maxTo) throw new IllegalMove('Relance impossible');
        if (to < minTo && to !== maxTo) throw new IllegalMove(`Relance minimale : ${minTo}`);
        raiseTo(s, seat, to);
        break;
      }
      case 'allin':
        if (maxTo > s.currentBet) raiseTo(s, seat, maxTo);
        else put(s, seat, s.chips[seat]);
        break;
      default:
        throw new IllegalMove('Coup inconnu');
    }
    s.acted[seat] = true;
    s.actions++;

    if (inHand(s).length === 1) return award(s, false);
    const active = canAct(s);
    if (active.every((i) => s.acted[i] && s.bets[i] === s.currentBet)) return nextStreet(s);
    s.turn = nextFrom(s, seat, (i) => !s.folded[i] && !s.allIn[i]);
  },

  result(s) {
    if (!s.over) return null;
    const max = Math.max(...s.chips);
    return { winners: s.chips.map((c, i) => (c === max ? i : -1)).filter((i) => i >= 0), reason: 'chips' };
  },

  view(s, seat) {
    const opts = seat >= 0 && seat === s.turn && !s.over ? options(s, seat) : null;
    return {
      hand: s.hand,
      street: s.street,
      dealer: s.dealer,
      turn: s.turn,
      chips: s.chips,
      bets: s.bets,
      pot: s.committed.reduce((a, b) => a + b, 0),
      folded: s.folded,
      allIn: s.allIn,
      out: s.chips.map((c, i) => c === 0 && s.committed[i] === 0),
      board: s.board,
      hole: seat >= 0 ? s.hole[seat] ?? [] : [],
      myLabel: seat >= 0 && s.hole[seat]?.length && s.board.length ? handLabel([...s.hole[seat], ...s.board]) : null,
      currentBet: s.currentBet,
      bigBlind: s.bigBlind,
      toCall: opts?.toCall ?? 0,
      minRaiseTo: opts?.minTo ?? 0,
      maxRaiseTo: opts?.maxTo ?? 0,
      lastHand: s.lastHand,
      maxHands: MAX_HANDS,
    };
  },

  turnMs: () => 30_000,
  progress: (s) => s.actions,
  botDelayMs: () => 1300,

  botMove(s, seat): PokerMove {
    const { toCall, minTo, maxTo } = options(s, seat);
    const hole = s.hole[seat];
    let strength: number;
    if (!s.board.length) {
      const [a, b] = hole.map(rankValue).sort((x, y) => y - x);
      strength = (a === b ? 0.5 + a / 28 : (a + b) / 40) + (suit(hole[0]) === suit(hole[1]) ? 0.05 : 0);
    } else {
      strength = Math.min(1, bestHand([...hole, ...s.board])[0] / 4 + 0.15);
    }
    strength += (Math.random() - 0.5) * 0.15;
    const pot = s.committed.reduce((x, y) => x + y, 0);
    if (toCall === 0) {
      if (strength > 0.7 && maxTo > s.currentBet) {
        const to = Math.min(maxTo, Math.max(minTo, s.currentBet + Math.round(pot / 2)));
        return to >= maxTo ? { type: 'allin' } : { type: 'raise', to };
      }
      return { type: 'check' };
    }
    const priceRatio = toCall / Math.max(1, pot + toCall);
    if (strength > 0.85 && maxTo > s.currentBet && minTo < maxTo) return { type: 'raise', to: minTo };
    if (strength > priceRatio + 0.3 || toCall <= s.bigBlind / 2) return { type: 'call' };
    return { type: 'fold' };
  },
};
