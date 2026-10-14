import { GameEngine, IllegalMove, shuffle } from '../engine';

/// Rami, 2 à 4 joueurs, deux jeux de 52 cartes (sans joker), 13 cartes
/// chacun. À son tour : piocher (pioche ou défausse), poser des combinaisons
/// (brelan/carré de même valeur en couleurs différentes, ou suite d'au moins
/// 3 cartes de même couleur, l'as en bas ou en haut), compléter les
/// combinaisons posées sur la table, puis défausser une carte. La première
/// pose doit valoir au moins 51 points (as 11 ou 1 dans A-2-3, figures 10).
/// Le premier qui n'a plus de cartes gagne.
/// Cartes : rang (A 2-9 T J Q K) + couleur (S H D C) + numéro du jeu (0/1),
/// ex. « QH1 ».
const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = 'A23456789TJQK';
export const OPENING_POINTS = 51;

type RamiMove =
  | { type: 'draw'; from: 'stock' | 'discard' }
  | { type: 'meld'; melds: string[][] }
  | { type: 'layoff'; meld: number; cards: string[] }
  | { type: 'discard'; card: string };

interface RamiState {
  hands: string[][];
  stock: string[];
  discard: string[];
  melds: { owner: number; cards: string[] }[];
  opened: boolean[];
  turn: number;
  phase: 'draw' | 'act';
  takenFromDiscard: string | null;
  winner: number | null;
  played: number;
  lastAction: { seat: number; text: string } | null;
}

const rank = (c: string) => c[0];
const suit = (c: string) => c[1];
const rankIndex = (c: string) => RANKS.indexOf(rank(c)) + 1; // A = 1 … K = 13
const faceValue = (c: string) => (rank(c) === 'A' ? 11 : Math.min(10, rankIndex(c)));

/// Ordre d'une suite (A bas ou haut), ou null si ce n'en est pas une.
function runOrder(cards: string[]): string[] | null {
  if (cards.length < 3 || !cards.every((c) => suit(c) === suit(cards[0]))) return null;
  for (const aceHigh of [false, true]) {
    const v = (c: string) => (rank(c) === 'A' && aceHigh ? 14 : rankIndex(c));
    const sorted = [...cards].sort((a, b) => v(a) - v(b));
    if (sorted.every((c, i) => i === 0 || v(c) === v(sorted[i - 1]) + 1)) return sorted;
  }
  return null;
}

function isSet(cards: string[]) {
  return (
    cards.length >= 3 && cards.length <= 4 &&
    cards.every((c) => rank(c) === rank(cards[0])) &&
    new Set(cards.map(suit)).size === cards.length
  );
}

export function validMeld(cards: string[]) {
  return isSet(cards) || runOrder(cards) !== null;
}

function meldValue(cards: string[]) {
  const run = runOrder(cards);
  if (run && rank(run[0]) === 'A') return run.reduce((sum, c, i) => sum + (i === 0 ? 1 : faceValue(c)), 0);
  return cards.reduce((sum, c) => sum + faceValue(c), 0);
}

function sortMeld(cards: string[]) {
  return runOrder(cards) ?? [...cards].sort((a, b) => SUITS.indexOf(suit(a)) - SUITS.indexOf(suit(b)));
}

function sortHand(hand: string[]) {
  return [...hand].sort((a, b) => SUITS.indexOf(suit(a)) - SUITS.indexOf(suit(b)) || rankIndex(a) - rankIndex(b));
}

/// Combinaisons trouvées dans une main (glouton : brelans puis suites).
function findMelds(hand: string[]): string[][] {
  const left = [...hand];
  const out: string[][] = [];
  const take = (cards: string[]) => {
    cards.forEach((c) => left.splice(left.indexOf(c), 1));
    out.push(cards);
  };
  for (const su of SUITS) {
    const ofSuit = left.filter((c) => suit(c) === su);
    const byRank = new Map<number, string>();
    ofSuit.forEach((c) => byRank.has(rankIndex(c)) || byRank.set(rankIndex(c), c));
    if (byRank.has(1)) byRank.set(14, byRank.get(1)!);
    let run: string[] = [];
    for (let v = 1; v <= 14; v++) {
      const c = byRank.get(v);
      if (c && !run.includes(c)) run.push(c);
      else {
        if (run.length >= 3) take(run);
        run = c ? [c] : [];
      }
    }
    if (run.length >= 3) take(run);
  }
  for (const r of RANKS) {
    const bySuit = new Map<string, string>();
    left.filter((c) => rank(c) === r).forEach((c) => bySuit.has(suit(c)) || bySuit.set(suit(c), c));
    if (bySuit.size >= 3) take([...bySuit.values()]);
  }
  return out;
}

function removeFromHand(hand: string[], cards: string[]) {
  const rest = [...hand];
  for (const c of cards) {
    const i = rest.indexOf(c);
    if (i < 0) throw new IllegalMove('Carte absente de votre main');
    rest.splice(i, 1);
  }
  return rest;
}

function endTurn(s: RamiState, seat: number) {
  s.takenFromDiscard = null;
  if (!s.hands[seat].length) {
    s.winner = seat;
    return;
  }
  s.turn = (seat + 1) % s.hands.length;
  s.phase = 'draw';
}

export const rami: GameEngine<RamiState, RamiMove> = {
  slug: 'rami',
  name: 'Rami',
  minPlayers: 2,
  maxPlayers: 4,
  minProgressForPoints: 10,

  init(playerCount) {
    const deck = shuffle([0, 1].flatMap((d) => SUITS.flatMap((su) => [...RANKS].map((r) => r + su + d))));
    const hands = Array.from({ length: playerCount }, () => sortHand(deck.splice(0, 13)));
    const discard = [deck.shift()!];
    return {
      hands, stock: deck, discard, melds: [], opened: Array(playerCount).fill(false),
      turn: Math.floor(Math.random() * playerCount), phase: 'draw', takenFromDiscard: null,
      winner: null, played: 0, lastAction: null,
    } as RamiState;
  },

  actors: (s) => (s.winner !== null ? [] : [s.turn]),

  legalMoves(s, seat) {
    if (s.winner !== null || seat !== s.turn) return [];
    if (s.phase === 'draw') {
      const moves: RamiMove[] = [{ type: 'draw', from: 'stock' }];
      if (s.discard.length) moves.push({ type: 'draw', from: 'discard' });
      return moves;
    }
    const hand = s.hands[seat];
    const discards = hand.length > 1 ? hand.filter((c) => c !== s.takenFromDiscard) : hand;
    return discards.map((card) => ({ type: 'discard' as const, card }));
  },

  play(s, seat, move) {
    if (s.winner !== null || seat !== s.turn) throw new IllegalMove("Ce n'est pas votre tour");
    if (s.phase === 'draw') {
      if (move?.type !== 'draw') throw new IllegalMove("Piochez d'abord");
      if ((move as { from: string }).from === 'discard') {
        const card = s.discard.pop();
        if (!card) throw new IllegalMove('La défausse est vide');
        s.takenFromDiscard = card;
        s.hands[seat].push(card);
        s.lastAction = { seat, text: 'prend la défausse' };
      } else {
        if (!s.stock.length) {
          const keep = s.discard.pop()!;
          s.stock = shuffle(s.discard);
          s.discard = keep ? [keep] : [];
        }
        const card = s.stock.shift();
        if (!card) {
          // Plus aucune carte : le plus petit total en main gagne.
          const totals = s.hands.map((h) => h.reduce((sum, c) => sum + faceValue(c), 0));
          s.winner = totals.indexOf(Math.min(...totals));
          return;
        }
        s.hands[seat].push(card);
        s.lastAction = { seat, text: 'pioche' };
      }
      s.hands[seat] = sortHand(s.hands[seat]);
      s.phase = 'act';
      return;
    }

    switch (move?.type) {
      case 'meld': {
        const melds = Array.isArray(move.melds) ? move.melds.map((m) => (Array.isArray(m) ? m.map(String) : [])) : [];
        if (!melds.length) throw new IllegalMove('Aucune combinaison');
        const rest = removeFromHand(s.hands[seat], melds.flat());
        for (const m of melds) if (!validMeld(m)) throw new IllegalMove('Combinaison invalide : brelan, carré ou suite de 3+');
        const total = melds.reduce((sum, m) => sum + meldValue(m), 0);
        if (!s.opened[seat] && total < OPENING_POINTS) {
          throw new IllegalMove(`Première pose : ${OPENING_POINTS} points minimum (vous avez ${total})`);
        }
        s.opened[seat] = true;
        s.hands[seat] = rest;
        melds.forEach((m) => s.melds.push({ owner: seat, cards: sortMeld(m) }));
        s.played++;
        s.lastAction = { seat, text: `pose ${total} points` };
        if (!rest.length) endTurn(s, seat);
        return;
      }
      case 'layoff': {
        if (!s.opened[seat]) throw new IllegalMove(`Faites d'abord votre première pose (${OPENING_POINTS} points)`);
        const target = s.melds[Number(move.meld)];
        if (!target) throw new IllegalMove('Combinaison introuvable');
        const cards = Array.isArray(move.cards) ? move.cards.map(String) : [];
        if (!cards.length) throw new IllegalMove('Choisissez des cartes');
        const rest = removeFromHand(s.hands[seat], cards);
        const combined = [...target.cards, ...cards];
        if (!validMeld(combined)) throw new IllegalMove('Ces cartes ne complètent pas la combinaison');
        target.cards = sortMeld(combined);
        s.hands[seat] = rest;
        s.played++;
        s.lastAction = { seat, text: 'complète une combinaison' };
        if (!rest.length) endTurn(s, seat);
        return;
      }
      case 'discard': {
        const card = String(move.card);
        const hand = s.hands[seat];
        if (!hand.includes(card)) throw new IllegalMove('Carte absente de votre main');
        if (card === s.takenFromDiscard && hand.length > 1) throw new IllegalMove('Vous ne pouvez pas rejeter la carte prise à la défausse');
        s.hands[seat] = removeFromHand(hand, [card]);
        s.discard.push(card);
        s.played++;
        s.lastAction = { seat, text: 'défausse' };
        endTurn(s, seat);
        return;
      }
      default:
        throw new IllegalMove('Posez, complétez ou défaussez');
    }
  },

  result: (s) => (s.winner === null ? null : { winners: [s.winner], reason: 'empty-hand' }),

  view(s, seat) {
    return {
      hand: seat >= 0 ? s.hands[seat] : [],
      handCounts: s.hands.map((h) => h.length),
      discardTop: s.discard[s.discard.length - 1] ?? null,
      discardCount: s.discard.length,
      stockCount: s.stock.length,
      melds: s.melds,
      opened: s.opened,
      turn: s.turn,
      phase: s.phase,
      takenFromDiscard: seat === s.turn ? s.takenFromDiscard : null,
      openingPoints: OPENING_POINTS,
      lastAction: s.lastAction,
    };
  },

  turnMs: (s) => (s.phase === 'draw' ? 30_000 : 60_000),
  progress: (s) => s.played,
  botDelayMs: () => 1200,

  botMove(s, seat): RamiMove {
    const hand = s.hands[seat];
    if (s.phase === 'draw') {
      const top = s.discard[s.discard.length - 1];
      if (top && s.opened[seat] && findMelds([...hand, top]).flat().includes(top)) return { type: 'draw', from: 'discard' };
      return { type: 'draw', from: 'stock' };
    }
    const melds = findMelds(hand);
    const total = melds.reduce((sum, m) => sum + meldValue(m), 0);
    // Garder au moins une carte à défausser, sauf si tout part.
    if (melds.length && (s.opened[seat] || total >= OPENING_POINTS) && melds.flat().length <= hand.length) {
      return { type: 'meld', melds };
    }
    if (s.opened[seat]) {
      for (const card of hand) {
        const i = s.melds.findIndex((m) => validMeld([...m.cards, card]));
        if (i >= 0 && hand.length > 1) return { type: 'layoff', meld: i, cards: [card] };
      }
    }
    // Défausse : la carte la plus isolée, puis la plus chère.
    const neighbours = (c: string) =>
      hand.filter((o) => o !== c && (rank(o) === rank(c) || (suit(o) === suit(c) && Math.abs(rankIndex(o) - rankIndex(c)) <= 2))).length;
    const candidates = hand.filter((c) => c !== s.takenFromDiscard || hand.length === 1);
    const card = candidates.sort((a, b) => neighbours(a) - neighbours(b) || faceValue(b) - faceValue(a))[0];
    return { type: 'discard', card };
  },
};
