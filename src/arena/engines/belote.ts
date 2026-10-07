import { GameEngine, IllegalMove, shuffle } from '../engine';

/// Belote classique à 4 joueurs, équipes sièges 0+2 contre 1+3, 32 cartes.
/// Distribution 5 cartes + carte retournée ; 1er tour : prendre la couleur
/// retournée ou passer ; 2e tour : choisir une autre couleur ou passer ;
/// tout le monde passe → redistribution. Fournir obligatoire, couper et
/// monter à l'atout obligatoires (sauf si le partenaire est maître), on
/// sous-coupe si on ne peut pas monter. 162 points par donne (dix de der
/// compris), capot 250, belote-rebelote 20. Le preneur doit faire plus que
/// la défense, sinon il est « dedans ». Partie en 501 points.
/// Cartes : rang (7 8 9 T J Q K A) + couleur (S H D C), ex. « JH ».
const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const TRUMP_ORDER = ['7', '8', 'Q', 'K', 'T', 'A', '9', 'J'];
const PLAIN_ORDER = ['7', '8', '9', 'J', 'Q', 'K', 'T', 'A'];
const TRUMP_POINTS: Record<string, number> = { J: 20, '9': 14, A: 11, T: 10, K: 4, Q: 3, '8': 0, '7': 0 };
const PLAIN_POINTS: Record<string, number> = { A: 11, T: 10, K: 4, Q: 3, J: 2, '9': 0, '8': 0, '7': 0 };
export const BELOTE_TARGET = 501;

type BeloteMove = { type: 'pass' } | { type: 'take'; suit?: string } | { type: 'card'; card: string };

interface DealSummary {
  taker: number;
  trump: string;
  points: [number, number];
  made: boolean;
  capot: boolean;
  belote: number | null;
}

interface BeloteState {
  phase: 'bid1' | 'bid2' | 'play' | 'over';
  dealer: number;
  hands: string[][];
  deck: string[];
  turned: string | null;
  bidTurn: number;
  passes: number;
  trump: string | null;
  taker: number | null;
  beloteHolder: number | null;
  leader: number;
  turn: number;
  trick: { seat: number; card: string }[];
  lastTrick: { cards: { seat: number; card: string }[]; winner: number } | null;
  won: string[][]; // cartes ramassées par équipe
  tricks: [number, number];
  scores: [number, number];
  lastDeal: DealSummary | null;
  cardsPlayed: number;
  deals: number;
}

const rank = (c: string) => c[0];
const suit = (c: string) => c[1];
const team = (seat: number) => seat % 2;

function strength(card: string, trump: string, led: string) {
  if (suit(card) === trump) return 100 + TRUMP_ORDER.indexOf(rank(card));
  if (suit(card) === led) return PLAIN_ORDER.indexOf(rank(card));
  return -1;
}

function points(card: string, trump: string) {
  return suit(card) === trump ? TRUMP_POINTS[rank(card)] : PLAIN_POINTS[rank(card)];
}

function trickWinner(trick: { seat: number; card: string }[], trump: string) {
  const led = suit(trick[0].card);
  return trick.reduce((best, e) => (strength(e.card, trump, led) > strength(best.card, trump, led) ? e : best)).seat;
}

function sortHand(hand: string[], trump: string | null) {
  const order = trump ? [trump, ...SUITS.filter((s) => s !== trump)] : SUITS;
  return [...hand].sort((a, b) => {
    const ds = order.indexOf(suit(a)) - order.indexOf(suit(b));
    if (ds) return ds;
    const o = suit(a) === trump ? TRUMP_ORDER : PLAIN_ORDER;
    return o.indexOf(rank(b)) - o.indexOf(rank(a));
  });
}

function deal(s: BeloteState) {
  const cards = shuffle(SUITS.flatMap((su) => RANKS.map((r) => r + su)));
  s.hands = [[], [], [], []];
  for (let i = 1; i <= 4; i++) s.hands[(s.dealer + i) % 4] = cards.splice(0, 5);
  s.turned = cards.shift()!;
  s.deck = cards;
  s.phase = 'bid1';
  s.bidTurn = (s.dealer + 1) % 4;
  s.passes = 0;
  s.trump = null;
  s.taker = null;
  s.beloteHolder = null;
  s.trick = [];
  s.won = [[], []];
  s.tricks = [0, 0];
}

function takeTrump(s: BeloteState, seat: number, trump: string) {
  s.trump = trump;
  s.taker = seat;
  s.hands[seat].push(s.turned!, ...s.deck.splice(0, 2));
  for (let i = 1; i <= 4; i++) {
    const p = (s.dealer + i) % 4;
    if (p !== seat) s.hands[p].push(...s.deck.splice(0, 3));
  }
  s.turned = null;
  s.hands = s.hands.map((h) => sortHand(h, trump));
  s.beloteHolder = s.hands.findIndex((h) => h.includes('K' + trump) && h.includes('Q' + trump));
  if (s.beloteHolder < 0) s.beloteHolder = null;
  s.phase = 'play';
  s.leader = (s.dealer + 1) % 4;
  s.turn = s.leader;
}

function legalCards(s: BeloteState, seat: number): string[] {
  const hand = s.hands[seat];
  if (s.phase !== 'play' || seat !== s.turn) return [];
  if (!s.trick.length) return hand;
  const trump = s.trump!;
  const led = suit(s.trick[0].card);
  const bestTrump = Math.max(-1, ...s.trick.filter((e) => suit(e.card) === trump).map((e) => TRUMP_ORDER.indexOf(rank(e.card))));
  const trumps = hand.filter((c) => suit(c) === trump);
  const higher = trumps.filter((c) => TRUMP_ORDER.indexOf(rank(c)) > bestTrump);

  const follow = hand.filter((c) => suit(c) === led);
  if (follow.length) {
    if (led === trump) return higher.length ? higher : follow;
    return follow;
  }
  if (trickWinner(s.trick, trump) === (seat + 2) % 4) return hand; // partenaire maître
  if (!trumps.length) return hand;
  return higher.length ? higher : trumps;
}

function endDeal(s: BeloteState) {
  const trump = s.trump!;
  const taker = s.taker!;
  const pts: [number, number] = [0, 0];
  for (const t of [0, 1]) pts[t] = s.won[t].reduce((sum, c) => sum + points(c, trump), 0);
  pts[team(s.lastTrick!.winner)] += 10;
  const capotTeam = s.tricks[0] === 8 ? 0 : s.tricks[1] === 8 ? 1 : null;
  if (capotTeam !== null) {
    pts[capotTeam] = 250;
    pts[1 - capotTeam] = 0;
  }
  const beloteTeam = s.beloteHolder !== null ? team(s.beloteHolder) : null;
  const takerTeam = team(taker);
  const withBelote = (t: number) => pts[t] + (beloteTeam === t ? 20 : 0);
  const made = withBelote(takerTeam) > withBelote(1 - takerTeam);
  const final: [number, number] = made
    ? [withBelote(0), withBelote(1)]
    : (() => {
        const f: [number, number] = [0, 0];
        f[1 - takerTeam] = (capotTeam === 1 - takerTeam ? 250 : 162) + (beloteTeam === 1 - takerTeam ? 20 : 0);
        f[takerTeam] = beloteTeam === takerTeam ? 20 : 0;
        return f;
      })();
  s.scores = [s.scores[0] + final[0], s.scores[1] + final[1]];
  s.lastDeal = { taker, trump, points: final, made, capot: capotTeam !== null, belote: beloteTeam };
  s.deals++;
  if (Math.max(...s.scores) >= BELOTE_TARGET && s.scores[0] !== s.scores[1]) {
    s.phase = 'over';
    return;
  }
  s.dealer = (s.dealer + 1) % 4;
  deal(s);
}

export const belote: GameEngine<BeloteState, BeloteMove> = {
  slug: 'belote',
  name: 'Belote',
  minPlayers: 4,
  maxPlayers: 4,
  minProgressForPoints: 32,

  init() {
    const s = {
      phase: 'bid1', dealer: Math.floor(Math.random() * 4), hands: [], deck: [], turned: null,
      bidTurn: 0, passes: 0, trump: null, taker: null, beloteHolder: null, leader: 0, turn: 0,
      trick: [], lastTrick: null, won: [[], []], tricks: [0, 0], scores: [0, 0], lastDeal: null,
      cardsPlayed: 0, deals: 0,
    } as BeloteState;
    deal(s);
    return s;
  },

  actors(s) {
    if (s.phase === 'over') return [];
    return [s.phase === 'play' ? s.turn : s.bidTurn];
  },

  legalMoves(s, seat) {
    if (s.phase === 'bid1' && seat === s.bidTurn) return [{ type: 'pass' }, { type: 'take' }];
    if (s.phase === 'bid2' && seat === s.bidTurn) {
      return [{ type: 'pass' }, ...SUITS.filter((x) => x !== suit(s.turned!)).map((x) => ({ type: 'take' as const, suit: x }))];
    }
    return legalCards(s, seat).map((card) => ({ type: 'card' as const, card }));
  },

  play(s, seat, move) {
    if (s.phase === 'bid1' || s.phase === 'bid2') {
      if (seat !== s.bidTurn) throw new IllegalMove("Ce n'est pas votre tour");
      if (move?.type === 'take') {
        if (s.phase === 'bid1') return takeTrump(s, seat, suit(s.turned!));
        const chosen = String((move as { suit?: string }).suit ?? '');
        if (!SUITS.includes(chosen) || chosen === suit(s.turned!)) throw new IllegalMove('Couleur invalide');
        return takeTrump(s, seat, chosen);
      }
      if (move?.type !== 'pass') throw new IllegalMove('Prenez ou passez');
      s.passes++;
      s.bidTurn = (s.bidTurn + 1) % 4;
      if (s.passes === 4) {
        if (s.phase === 'bid1') {
          s.phase = 'bid2';
          s.passes = 0;
        } else {
          s.dealer = (s.dealer + 1) % 4;
          deal(s);
        }
      }
      return;
    }

    if (s.phase !== 'play' || seat !== s.turn) throw new IllegalMove("Ce n'est pas votre tour");
    const card = move?.type === 'card' ? String(move.card) : '';
    if (!legalCards(s, seat).includes(card)) throw new IllegalMove('Carte interdite : fournir, couper ou monter');
    s.hands[seat] = s.hands[seat].filter((c) => c !== card);
    s.trick.push({ seat, card });
    s.cardsPlayed++;
    if (s.trick.length < 4) {
      s.turn = (seat + 1) % 4;
      return;
    }
    const winner = trickWinner(s.trick, s.trump!);
    s.won[team(winner)].push(...s.trick.map((e) => e.card));
    s.tricks[team(winner)]++;
    s.lastTrick = { cards: s.trick, winner };
    s.trick = [];
    s.leader = winner;
    s.turn = winner;
    if (s.hands.every((h) => h.length === 0)) endDeal(s);
  },

  result(s) {
    if (s.phase !== 'over') return null;
    const t = s.scores[0] > s.scores[1] ? 0 : 1;
    return { winners: [t, t + 2], reason: 'score' };
  },

  view(s, seat) {
    return {
      phase: s.phase,
      dealer: s.dealer,
      hand: seat >= 0 ? s.hands[seat] : [],
      handCounts: s.hands.map((h) => h.length),
      turned: s.turned,
      bidTurn: s.bidTurn,
      trump: s.trump,
      taker: s.taker,
      turn: s.turn,
      trick: s.trick,
      lastTrick: s.lastTrick,
      tricks: s.tricks,
      scores: s.scores,
      target: BELOTE_TARGET,
      lastDeal: s.lastDeal,
      deals: s.deals,
      legal: seat >= 0 ? legalCards(s, seat) : [],
    };
  },

  turnMs: () => 25_000,
  progress: (s) => s.cardsPlayed,
  botDelayMs: () => 1100,

  botMove(s, seat): BeloteMove {
    const strengthIn = (hand: string[], trump: string) =>
      hand.reduce((v, c) => {
        if (suit(c) !== trump) return v + (rank(c) === 'A' ? 1 : 0);
        return v + (({ J: 3, '9': 2, A: 1 } as Record<string, number>)[rank(c)] ?? 0) + 0.5;
      }, 0);
    if (s.phase === 'bid1') {
      const t = suit(s.turned!);
      return strengthIn([...s.hands[seat], s.turned!], t) >= 5 ? { type: 'take' } : { type: 'pass' };
    }
    if (s.phase === 'bid2') {
      const options = SUITS.filter((x) => x !== suit(s.turned!));
      const best = options.reduce((a, b) => (strengthIn(s.hands[seat], b) > strengthIn(s.hands[seat], a) ? b : a));
      return strengthIn(s.hands[seat], best) >= 5.5 ? { type: 'take', suit: best } : { type: 'pass' };
    }
    const trump = s.trump!;
    const legal = legalCards(s, seat);
    const byPoints = [...legal].sort((a, b) => points(a, trump) - points(b, trump));
    if (!s.trick.length) {
      const aces = legal.filter((c) => rank(c) === 'A' && suit(c) !== trump);
      return { type: 'card', card: aces[0] ?? byPoints[0] };
    }
    const led = suit(s.trick[0].card);
    if (trickWinner(s.trick, trump) === (seat + 2) % 4) {
      const gift = [...legal].filter((c) => suit(c) !== trump).sort((a, b) => points(b, trump) - points(a, trump));
      return { type: 'card', card: gift[0] ?? byPoints[0] };
    }
    const best = Math.max(...s.trick.map((e) => strength(e.card, trump, led)));
    const winning = legal.filter((c) => strength(c, trump, led) > best).sort((a, b) => strength(a, trump, led) - strength(b, trump, led));
    return { type: 'card', card: winning[0] ?? byPoints[0] };
  },
};
