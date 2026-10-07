import { GameEngine, IllegalMove, randomItem, shuffle } from '../engine';
import { QUIZ_QUESTIONS } from './quiz-questions';

/// Quiz culture en ligne, 2 à 8 joueurs : 10 questions, 15 s pour répondre,
/// tout le monde répond en même temps. Bonne réponse = 500 points + bonus de
/// rapidité (jusqu'à 500). Après chaque question, la réponse est affichée
/// quelques secondes. Le meilleur score gagne.
const QUESTIONS_PER_GAME = 10;
const ANSWER_MS = 15_000;
const REVEAL_MS = 4_000;

interface Asked {
  q: string;
  category: string;
  choices: string[];
  correct: number;
}

interface QuizState {
  questions: Asked[];
  index: number;
  phase: 'question' | 'reveal' | 'over';
  startedAt: number;
  answers: ({ choice: number; ms: number } | null)[];
  gains: number[];
  scores: number[];
}

function pickQuestions(): Asked[] {
  return shuffle(QUIZ_QUESTIONS)
    .slice(0, QUESTIONS_PER_GAME)
    .map((x) => {
      const choices = shuffle([x.a, ...x.w]);
      return { q: x.q, category: x.c, choices, correct: choices.indexOf(x.a) };
    });
}

function reveal(s: QuizState) {
  const correct = s.questions[s.index].correct;
  s.gains = s.answers.map((a) => (a && a.choice === correct ? 500 + Math.round((500 * Math.max(0, ANSWER_MS - a.ms)) / ANSWER_MS) : 0));
  s.scores = s.scores.map((v, i) => v + s.gains[i]);
  s.phase = 'reveal';
  s.startedAt = Date.now();
}

function next(s: QuizState) {
  if (s.index + 1 >= s.questions.length) {
    s.phase = 'over';
    return;
  }
  s.index++;
  s.phase = 'question';
  s.startedAt = Date.now();
  s.answers = s.answers.map(() => null);
  s.gains = s.gains.map(() => 0);
}

export const quiz: GameEngine<QuizState, { choice: number }> = {
  slug: 'quiz',
  name: 'Quiz culture',
  minPlayers: 2,
  maxPlayers: 8,
  minProgressForPoints: QUESTIONS_PER_GAME,

  init: (n) => ({
    questions: pickQuestions(),
    index: 0,
    phase: 'question',
    startedAt: Date.now(),
    answers: Array(n).fill(null),
    gains: Array(n).fill(0),
    scores: Array(n).fill(0),
  }),

  actors: (s) => (s.phase === 'question' ? s.answers.flatMap((a, i) => (a ? [] : [i])) : []),
  legalMoves: (s, seat) => (s.phase === 'question' && !s.answers[seat] ? [0, 1, 2, 3].map((choice) => ({ choice })) : []),

  play(s, seat, move) {
    if (s.phase !== 'question') throw new IllegalMove('Attendez la prochaine question');
    if (s.answers[seat]) throw new IllegalMove('Vous avez déjà répondu');
    const choice = Number(move?.choice);
    if (!Number.isInteger(choice) || choice < 0 || choice > 3) throw new IllegalMove('Réponse invalide');
    s.answers[seat] = { choice, ms: Date.now() - s.startedAt };
    if (s.answers.every((a) => a)) reveal(s);
  },

  /// Temps écoulé : on révèle la réponse (les absents ont 0), puis question suivante.
  onTimeout(s) {
    if (s.phase === 'question') reveal(s);
    else if (s.phase === 'reveal') next(s);
  },

  result(s) {
    if (s.phase !== 'over') return null;
    const top = Math.max(...s.scores);
    if (top === 0) return { winners: [], reason: 'draw' };
    return { winners: s.scores.flatMap((v, i) => (v === top ? [i] : [])), reason: 'score' };
  },

  view(s, seat) {
    const current = s.questions[Math.min(s.index, s.questions.length - 1)];
    const revealed = s.phase !== 'question';
    return {
      phase: s.phase,
      index: s.index,
      total: s.questions.length,
      category: current.category,
      question: current.q,
      choices: current.choices,
      correct: revealed ? current.correct : null,
      myAnswer: seat >= 0 ? s.answers[seat]?.choice ?? null : null,
      answered: s.answers.map((a) => !!a),
      answers: revealed ? s.answers.map((a) => a?.choice ?? null) : null,
      gains: revealed ? s.gains : null,
      scores: s.scores,
    };
  },

  turnMs: (s) => (s.phase === 'question' ? Math.max(0, ANSWER_MS - (Date.now() - s.startedAt)) : REVEAL_MS),
  progress: (s) => (s.phase === 'over' ? s.questions.length : s.index),
  botDelayMs: () => 2500 + Math.random() * 7000,

  /// Bonne réponse 6 fois sur 10.
  botMove(s) {
    const correct = s.questions[s.index].correct;
    return { choice: Math.random() < 0.6 ? correct : randomItem([0, 1, 2, 3].filter((c) => c !== correct)) };
  },
};
