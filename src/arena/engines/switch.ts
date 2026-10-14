import { GameEngine, IllegalMove, shuffle } from '../engine';

/// Switch (8 américain), 2 à 6 joueurs, 52 cartes, 7 cartes chacun (5 à
/// partir de 5 joueurs). On pose une carte de même couleur ou de même valeur
/// que celle du talon. Cartes spéciales : 8 = joker, on choisit la couleur ;
/// 2 = le suivant pioche 2 (cumulable avec un autre 2) ; valet = le suivant
/// passe son tour ; as = changement de sens (à deux : on rejoue). Sans carte
/// jouable on pioche une carte, qu'on peut poser si elle va, sinon on passe.
/// Le premier qui n'a plus de cartes gagne.
/// Cartes : rang (2-9 T J Q K A) + couleur (S H D C), ex. « 8H ».
const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = '23456789TJQKA';
const SPECIAL = ['8', '2', 'J', 'A'];

type SwitchMove = { type: 'play'; card: string; suit?: string } | { type: 'draw' } | { type: 'pass' };

interface SwitchState {
  hands: string[][];
  stock: string[];
  discard: string[];
  suit: string;
  direction: 1 | -1;
  turn: number;
  pendingDraw: number;
  drawn: string | null;
  winner: number | null;
  played: number;
  /// Pioches à vide d'affilée (talon et pioche épuisés) : partie bloquée.
  stuck: number;
  lastAction: { seat: number; text: string } | null;
}

const rank = (c: string) => c[0];
const suit = (c: string) => c[1];
const top = (s: SwitchState) => s.discard[s.discard.length - 1];

function next(s: SwitchState, from = s.turn, steps = 1) {
  const n = s.hands.length;
  return (((from + s.direction * steps) % n) + n) % n;
}

function refill(s: SwitchState) {
  if (s.stock.length || s.discard.length <= 1) return;
  const keep = s.discard.pop()!;
  s.stock = shuffle(s.discard);
  s.discard = [keep];
}

function draw(s: SwitchState, seat: number, count: number) {
  const got: string[] = [];
  for (let i = 0; i < count; i++) {
    refill(s);
    const c = s.stock.shift();
    if (!c) break;
    s.hands[seat].push(c);
    got.push(c);
  }
  return got;
}

function playable(s: SwitchState, card: string) {
  if (s.pendingDraw > 0) return rank(card) === '2';
  return rank(card) === '8' || suit(card) === s.suit || rank(card) === rank(top(s));
}

function legalCards(s: SwitchState, seat: number) {
  if (s.winner !== null || seat !== s.turn) return [];
  if (s.drawn) return playable(s, s.drawn) ? [s.drawn] : [];
  return s.hands[seat].filter((c) => playable(s, c));
}

function favouriteSuit(hand: string[]) {
  const count = (x: string) => hand.filter((c) => suit(c) === x && rank(c) !== '8').length;
  return SUITS.reduce((a, b) => (count(b) > count(a) ? b : a));
}

export const switchGame: GameEngine<SwitchState, SwitchMove> = {
  slug: 'switch',
  name: 'Switch',
  minPlayers: 2,
  maxPlayers: 6,
  minProgressForPoints: 12,

  init(playerCount) {
    const deck = shuffle(SUITS.flatMap((su) => [...RANKS].map((r) => r + su)));
    const size = playerCount >= 5 ? 5 : 7;
    const hands = Array.from({ length: playerCount }, () => deck.splice(0, size));
    // Première carte du talon : jamais une carte spéciale.
    const first = deck.findIndex((c) => !SPECIAL.includes(rank(c)));
    const [start] = deck.splice(first, 1);
    return {
      hands, stock: deck, discard: [start], suit: suit(start), direction: 1,
      turn: Math.floor(Math.random() * playerCount), pendingDraw: 0, drawn: null,
      winner: null, played: 0, stuck: 0, lastAction: null,
    } as SwitchState;
  },

  actors: (s) => (s.winner !== null ? [] : [s.turn]),

  legalMoves(s, seat) {
    if (s.winner !== null || seat !== s.turn) return [];
    const moves: SwitchMove[] = legalCards(s, seat).map((card) =>
      rank(card) === '8' ? { type: 'play', card, suit: favouriteSuit(s.hands[seat]) } : { type: 'play', card },
    );
    moves.push(s.drawn ? { type: 'pass' } : { type: 'draw' });
    return moves;
  },

  play(s, seat, move) {
    if (s.winner !== null || seat !== s.turn) throw new IllegalMove("Ce n'est pas votre tour");
    if (move?.type === 'draw') {
      if (s.drawn) throw new IllegalMove('Vous avez déjà pioché');
      if (s.pendingDraw > 0) {
        const n = draw(s, seat, s.pendingDraw).length;
        s.lastAction = { seat, text: `pioche ${n} cartes` };
        s.pendingDraw = 0;
        s.turn = next(s);
        return;
      }
      const [card] = draw(s, seat, 1);
      s.lastAction = { seat, text: card ? 'pioche' : 'passe (pioche vide)' };
      s.stuck = card ? 0 : s.stuck + 1;
      if (s.stuck >= s.hands.length) {
        // Plus personne ne peut jouer : le moins de cartes gagne.
        const min = Math.min(...s.hands.map((h) => h.length));
        s.winner = s.hands.findIndex((h) => h.length === min);
        return;
      }
      if (card && playable(s, card)) {
        s.drawn = card;
        return;
      }
      s.turn = next(s);
      return;
    }
    if (move?.type === 'pass') {
      if (!s.drawn) throw new IllegalMove('Piochez avant de passer');
      s.drawn = null;
      s.lastAction = { seat, text: 'passe' };
      s.turn = next(s);
      return;
    }
    if (move?.type !== 'play') throw new IllegalMove('Coup inconnu');
    const card = String(move.card);
    if (!s.hands[seat].includes(card) || !legalCards(s, seat).includes(card)) {
      throw new IllegalMove(s.pendingDraw > 0 ? `Posez un 2 ou piochez ${s.pendingDraw}` : 'Même couleur ou même valeur');
    }
    s.hands[seat] = s.hands[seat].filter((c) => c !== card);
    s.discard.push(card);
    s.drawn = null;
    s.played++;
    s.stuck = 0;
    s.suit = suit(card);
    let text = 'pose';
    let steps = 1;
    switch (rank(card)) {
      case '8': {
        const chosen = String((move as { suit?: string }).suit ?? '');
        s.suit = SUITS.includes(chosen) ? chosen : favouriteSuit(s.hands[seat]);
        text = 'change la couleur';
        break;
      }
      case '2':
        s.pendingDraw += 2;
        text = `+${s.pendingDraw}`;
        break;
      case 'J':
        steps = 2;
        text = 'saute le suivant';
        break;
      case 'A':
        if (s.hands.length === 2) steps = 2;
        else s.direction = s.direction === 1 ? -1 : 1;
        text = 'change le sens';
        break;
    }
    s.lastAction = { seat, text };
    if (!s.hands[seat].length) {
      s.winner = seat;
      return;
    }
    s.turn = next(s, seat, steps);
  },

  result: (s) => (s.winner === null ? null : { winners: [s.winner], reason: 'empty-hand' }),

  view(s, seat) {
    return {
      hand: seat >= 0 ? s.hands[seat] : [],
      handCounts: s.hands.map((h) => h.length),
      top: top(s),
      suit: s.suit,
      direction: s.direction,
      turn: s.turn,
      pendingDraw: s.pendingDraw,
      drawn: seat === s.turn ? s.drawn : null,
      stockCount: s.stock.length,
      lastAction: s.lastAction,
      legal: seat >= 0 ? legalCards(s, seat) : [],
    };
  },

  turnMs: () => 20_000,
  progress: (s) => s.played,
  botDelayMs: () => 1000,

  botMove(s, seat): SwitchMove {
    const legal = legalCards(s, seat);
    if (!legal.length) return s.drawn ? { type: 'pass' } : { type: 'draw' };
    const hand = s.hands[seat];
    // On garde les 8 pour la fin et on joue d'abord la couleur la plus fournie.
    const ranked = [...legal].sort((a, b) => {
      const eightA = rank(a) === '8' ? 1 : 0;
      const eightB = rank(b) === '8' ? 1 : 0;
      if (eightA !== eightB) return eightA - eightB;
      return hand.filter((c) => suit(c) === suit(b)).length - hand.filter((c) => suit(c) === suit(a)).length;
    });
    const card = ranked[0];
    const rest = hand.filter((c) => c !== card);
    return rank(card) === '8' ? { type: 'play', card, suit: favouriteSuit(rest.length ? rest : hand) } : { type: 'play', card };
  },
};
