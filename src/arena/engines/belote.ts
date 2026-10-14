import { GameEngine, IllegalMove, shuffle } from '../engine';

/// Belote à 4 joueurs, équipes sièges 0+2 contre 1+3, 32 cartes.
/// Distribution 5 cartes + carte retournée. 1er tour : prendre la couleur
/// retournée, annoncer Tout atout ou Sans atout, ou passer ; 2e tour : choisir
/// une autre couleur, Tout atout, Sans atout ou passer ; tout le monde passe →
/// redistribution. Une fois les 8 cartes en main, la défense peut contrer
/// (×2), puis le preneur surcontrer (×4).
/// Couleur : fournir, couper et monter à l'atout (sauf partenaire maître).
/// Tout atout : chaque couleur se joue comme l'atout, fournir et monter.
/// Sans atout : fournir, sinon défausse libre.
/// 162 points de cartes par donne (dix de der compris), belote-rebelote 20.
/// Le preneur doit faire plus que la défense. Score « tout ou rien » : contrat
/// réussi → le preneur marque la valeur du contrat (Couleur 16, Tout atout 26,
/// Sans atout 52, multipliée par le contre) ; contrat chuté → la défense la
/// marque. Partie en 150 points.
/// Cartes : rang (7 8 9 T J Q K A) + couleur (S H D C), ex. « JH ».
const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const TRUMP_ORDER = ['7', '8', 'Q', 'K', 'T', 'A', '9', 'J'];
const PLAIN_ORDER = ['7', '8', '9', 'J', 'Q', 'K', 'T', 'A'];
const TRUMP_POINTS: Record<string, number> = { J: 20, '9': 14, A: 11, T: 10, K: 4, Q: 3, '8': 0, '7': 0 };
const PLAIN_POINTS: Record<string, number> = { A: 11, T: 10, K: 4, Q: 3, J: 2, '9': 0, '8': 0, '7': 0 };
/// Barèmes ramenés à 152 points de cartes (+ 10 de der) comme en couleur.
const ALL_TRUMP_POINTS: Record<string, number> = { J: 14, '9': 9, A: 6, T: 5, K: 3, Q: 1, '8': 0, '7': 0 };
const NO_TRUMP_POINTS: Record<string, number> = { A: 19, T: 10, K: 4, Q: 3, J: 2, '9': 0, '8': 0, '7': 0 };
export const BELOTE_TARGET = 150;
export const CONTRACT_VALUES = { couleur: 16, TA: 26, SA: 52 } as const;

type Contract = keyof typeof CONTRACT_VALUES;
type BeloteMove =
  | { type: 'pass' }
  | { type: 'take'; suit?: string; contract?: 'TA' | 'SA' }
  | { type: 'contre' }
  | { type: 'surcontre' }
  | { type: 'card'; card: string };

interface DealSummary {
  taker: number;
  contract: Contract;
  trump: string | null;
  multiplier: number;
  value: number;
  cardPoints: [number, number];
  points: [number, number];
  made: boolean;
  capot: boolean;
  belote: number | null;
}

interface BeloteState {
  phase: 'bid1' | 'bid2' | 'contre' | 'surcontre' | 'play' | 'over';
  dealer: number;
  hands: string[][];
  deck: string[];
  turned: string | null;
  bidTurn: number;
  passes: number;
  contract: Contract | null;
  trump: string | null;
  multiplier: number;
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

/// La carte se joue-t-elle avec l'ordre de l'atout ?
function isTrump(s: BeloteState, card: string) {
  return s.contract === 'TA' || (s.contract === 'couleur' && suit(card) === s.trump);
}

function strength(s: BeloteState, card: string, led: string) {
  const order = isTrump(s, card) ? TRUMP_ORDER : PLAIN_ORDER;
  if (s.contract === 'couleur' && suit(card) === s.trump) return 100 + order.indexOf(rank(card));
  if (suit(card) === led) return order.indexOf(rank(card));
  return -1;
}

function points(s: BeloteState, card: string) {
  if (s.contract === 'TA') return ALL_TRUMP_POINTS[rank(card)];
  if (s.contract === 'SA') return NO_TRUMP_POINTS[rank(card)];
  return suit(card) === s.trump ? TRUMP_POINTS[rank(card)] : PLAIN_POINTS[rank(card)];
}

function trickWinner(s: BeloteState, trick: { seat: number; card: string }[]) {
  const led = suit(trick[0].card);
  return trick.reduce((best, e) => (strength(s, e.card, led) > strength(s, best.card, led) ? e : best)).seat;
}

function sortHand(hand: string[], trump: string | null, allTrump = false) {
  const order = trump ? [trump, ...SUITS.filter((x) => x !== trump)] : SUITS;
  return [...hand].sort((a, b) => {
    const ds = order.indexOf(suit(a)) - order.indexOf(suit(b));
    if (ds) return ds;
    const o = allTrump || suit(a) === trump ? TRUMP_ORDER : PLAIN_ORDER;
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
  s.contract = null;
  s.trump = null;
  s.multiplier = 1;
  s.taker = null;
  s.beloteHolder = null;
  s.trick = [];
  s.won = [[], []];
  s.tricks = [0, 0];
}

function take(s: BeloteState, seat: number, contract: Contract, trump: string | null) {
  s.contract = contract;
  s.trump = trump;
  s.taker = seat;
  s.hands[seat].push(s.turned!, ...s.deck.splice(0, 2));
  for (let i = 1; i <= 4; i++) {
    const p = (s.dealer + i) % 4;
    if (p !== seat) s.hands[p].push(...s.deck.splice(0, 3));
  }
  s.turned = null;
  s.hands = s.hands.map((h) => sortHand(h, trump, contract === 'TA'));
  s.beloteHolder = null;
  if (trump) {
    const holder = s.hands.findIndex((h) => h.includes('K' + trump) && h.includes('Q' + trump));
    s.beloteHolder = holder >= 0 ? holder : null;
  }
  // La défense peut contrer, en commençant par le joueur après le preneur.
  s.phase = 'contre';
  s.bidTurn = (seat + 1) % 4;
  s.passes = 0;
}

function startPlay(s: BeloteState) {
  s.phase = 'play';
  s.leader = (s.dealer + 1) % 4;
  s.turn = s.leader;
}

function legalCards(s: BeloteState, seat: number): string[] {
  const hand = s.hands[seat];
  if (s.phase !== 'play' || seat !== s.turn) return [];
  if (!s.trick.length) return hand;
  const led = suit(s.trick[0].card);
  const follow = hand.filter((c) => suit(c) === led);

  if (s.contract === 'SA') return follow.length ? follow : hand;
  if (s.contract === 'TA') {
    if (!follow.length) return hand;
    const best = Math.max(...s.trick.filter((e) => suit(e.card) === led).map((e) => TRUMP_ORDER.indexOf(rank(e.card))));
    const higher = follow.filter((c) => TRUMP_ORDER.indexOf(rank(c)) > best);
    return higher.length ? higher : follow;
  }

  const trump = s.trump!;
  const bestTrump = Math.max(-1, ...s.trick.filter((e) => suit(e.card) === trump).map((e) => TRUMP_ORDER.indexOf(rank(e.card))));
  const trumps = hand.filter((c) => suit(c) === trump);
  const higher = trumps.filter((c) => TRUMP_ORDER.indexOf(rank(c)) > bestTrump);
  if (follow.length) {
    if (led === trump) return higher.length ? higher : follow;
    return follow;
  }
  if (trickWinner(s, s.trick) === (seat + 2) % 4) return hand; // partenaire maître
  if (!trumps.length) return hand;
  return higher.length ? higher : trumps;
}

function endDeal(s: BeloteState) {
  const taker = s.taker!;
  const contract = s.contract!;
  const pts: [number, number] = [0, 0];
  for (const t of [0, 1]) pts[t] = s.won[t].reduce((sum, c) => sum + points(s, c), 0);
  pts[team(s.lastTrick!.winner)] += 10;
  const capotTeam = s.tricks[0] === 8 ? 0 : s.tricks[1] === 8 ? 1 : null;
  const beloteTeam = s.beloteHolder !== null ? team(s.beloteHolder) : null;
  if (beloteTeam !== null) pts[beloteTeam] += 20;
  const takerTeam = team(taker);
  const made = pts[takerTeam] > pts[1 - takerTeam];
  const value = CONTRACT_VALUES[contract] * s.multiplier;
  const final: [number, number] = [0, 0];
  final[made ? takerTeam : 1 - takerTeam] = value;
  s.scores = [s.scores[0] + final[0], s.scores[1] + final[1]];
  s.lastDeal = {
    taker, contract, trump: s.trump, multiplier: s.multiplier, value,
    cardPoints: pts, points: final, made, capot: capotTeam !== null, belote: beloteTeam,
  };
  s.deals++;
  if (Math.max(...s.scores) >= BELOTE_TARGET && s.scores[0] !== s.scores[1]) {
    s.phase = 'over';
    return;
  }
  s.dealer = (s.dealer + 1) % 4;
  deal(s);
}

function bidMoves(s: BeloteState): BeloteMove[] {
  const announces: BeloteMove[] = [{ type: 'take', contract: 'TA' }, { type: 'take', contract: 'SA' }];
  if (s.phase === 'bid1') return [{ type: 'pass' }, { type: 'take' }, ...announces];
  return [
    { type: 'pass' },
    ...SUITS.filter((x) => x !== suit(s.turned!)).map((x) => ({ type: 'take' as const, suit: x })),
    ...announces,
  ];
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
      bidTurn: 0, passes: 0, contract: null, trump: null, multiplier: 1, taker: null, beloteHolder: null,
      leader: 0, turn: 0, trick: [], lastTrick: null, won: [[], []], tricks: [0, 0], scores: [0, 0],
      lastDeal: null, cardsPlayed: 0, deals: 0,
    } as BeloteState;
    deal(s);
    return s;
  },

  actors(s) {
    if (s.phase === 'over') return [];
    return [s.phase === 'play' ? s.turn : s.bidTurn];
  },

  legalMoves(s, seat) {
    if (s.phase === 'play') return legalCards(s, seat).map((card) => ({ type: 'card' as const, card }));
    if (seat !== s.bidTurn) return [];
    if (s.phase === 'bid1' || s.phase === 'bid2') return bidMoves(s);
    if (s.phase === 'contre') return [{ type: 'pass' }, { type: 'contre' }];
    if (s.phase === 'surcontre') return [{ type: 'pass' }, { type: 'surcontre' }];
    return [];
  },

  play(s, seat, move) {
    if (s.phase === 'bid1' || s.phase === 'bid2') {
      if (seat !== s.bidTurn) throw new IllegalMove("Ce n'est pas votre tour");
      if (move?.type === 'take') {
        const m = move as { suit?: string; contract?: string };
        if (m.contract === 'TA' || m.contract === 'SA') return take(s, seat, m.contract, null);
        if (s.phase === 'bid1') return take(s, seat, 'couleur', suit(s.turned!));
        const chosen = String(m.suit ?? '');
        if (!SUITS.includes(chosen) || chosen === suit(s.turned!)) throw new IllegalMove('Couleur invalide');
        return take(s, seat, 'couleur', chosen);
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

    if (s.phase === 'contre') {
      if (seat !== s.bidTurn) throw new IllegalMove("Ce n'est pas votre tour");
      if (move?.type === 'contre') {
        s.multiplier = 2;
        s.phase = 'surcontre';
        s.bidTurn = s.taker!;
        return;
      }
      if (move?.type !== 'pass') throw new IllegalMove('Contrez ou passez');
      s.passes++;
      if (s.passes >= 2) return startPlay(s);
      s.bidTurn = (s.taker! + 3) % 4;
      return;
    }

    if (s.phase === 'surcontre') {
      if (seat !== s.bidTurn) throw new IllegalMove("Ce n'est pas votre tour");
      if (move?.type === 'surcontre') s.multiplier = 4;
      else if (move?.type !== 'pass') throw new IllegalMove('Surcontrez ou passez');
      return startPlay(s);
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
    const winner = trickWinner(s, s.trick);
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
      contract: s.contract,
      trump: s.trump,
      multiplier: s.multiplier,
      value: s.contract ? CONTRACT_VALUES[s.contract] * s.multiplier : null,
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

  turnMs: (s) => (s.phase === 'contre' || s.phase === 'surcontre' ? 12_000 : 25_000),
  progress: (s) => s.cardsPlayed,
  botDelayMs: () => 1100,

  botMove(s, seat): BeloteMove {
    const colorStrength = (hand: string[], trump: string) =>
      hand.reduce((v, c) => {
        if (suit(c) !== trump) return v + (rank(c) === 'A' ? 1 : 0);
        return v + (({ J: 3, '9': 2, A: 1 } as Record<string, number>)[rank(c)] ?? 0) + 0.5;
      }, 0);
    const allTrumpStrength = (hand: string[]) =>
      hand.reduce((v, c) => v + (({ J: 2, '9': 1.5, A: 0.5 } as Record<string, number>)[rank(c)] ?? 0), 0);
    const noTrumpStrength = (hand: string[]) =>
      hand.reduce((v, c) => v + (({ A: 2, T: 1 } as Record<string, number>)[rank(c)] ?? 0), 0);

    if (s.phase === 'bid1' || s.phase === 'bid2') {
      const hand = [...s.hands[seat], s.turned!];
      if (allTrumpStrength(hand) >= 6) return { type: 'take', contract: 'TA' };
      if (noTrumpStrength(hand) >= 7) return { type: 'take', contract: 'SA' };
      if (s.phase === 'bid1') {
        return colorStrength(hand, suit(s.turned!)) >= 5 ? { type: 'take' } : { type: 'pass' };
      }
      const options = SUITS.filter((x) => x !== suit(s.turned!));
      const best = options.reduce((a, b) => (colorStrength(s.hands[seat], b) > colorStrength(s.hands[seat], a) ? b : a));
      return colorStrength(s.hands[seat], best) >= 5.5 ? { type: 'take', suit: best } : { type: 'pass' };
    }
    if (s.phase === 'contre') {
      const hand = s.hands[seat];
      const strong = s.contract === 'couleur' ? colorStrength(hand, s.trump!) >= 4.5
        : s.contract === 'TA' ? allTrumpStrength(hand) >= 6 : noTrumpStrength(hand) >= 8;
      return strong ? { type: 'contre' } : { type: 'pass' };
    }
    if (s.phase === 'surcontre') return { type: 'pass' };

    const legal = legalCards(s, seat);
    const byPoints = [...legal].sort((a, b) => points(s, a) - points(s, b));
    if (!s.trick.length) {
      const master = s.contract === 'TA' ? 'J' : 'A';
      const leads = legal.filter((c) => rank(c) === master && !(s.contract === 'couleur' && suit(c) === s.trump));
      return { type: 'card', card: leads[0] ?? byPoints[0] };
    }
    const led = suit(s.trick[0].card);
    if (trickWinner(s, s.trick) === (seat + 2) % 4) {
      const gift = legal.filter((c) => !isTrump(s, c) || s.contract === 'TA').sort((a, b) => points(s, b) - points(s, a));
      return { type: 'card', card: gift[0] ?? byPoints[0] };
    }
    const best = Math.max(...s.trick.map((e) => strength(s, e.card, led)));
    const winning = legal.filter((c) => strength(s, c, led) > best).sort((a, b) => strength(s, a, led) - strength(s, b, led));
    return { type: 'card', card: winning[0] ?? byPoints[0] };
  },
};
