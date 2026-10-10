const MAX_PLAYERS = 8;
const ANSWER_SECONDS = 30;
const GUESS_SECONDS = 30;
const ROLE_SECONDS = 3;

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeGuess(value) {
  return normalizeText(value).replace(/^(a|an|the)\s+/, "");
}

function guessMatches(job, guess) {
  const normalized = normalizeGuess(guess);
  if (!normalized) return false;
  return [job.title, ...(job.aliases || [])].some(
    (candidate) => normalizeGuess(candidate) === normalized,
  );
}

function containsForbiddenQuestionText(job, question) {
  const haystack = ` ${normalizeText(question)} `;
  const blocked = [job.title, ...(job.forbidden || [])]
    .map(normalizeText)
    .filter(Boolean);
  return blocked.some((phrase) => haystack.includes(` ${phrase} `));
}

function correctPayout(questionCount, hintUsed) {
  const base = Math.max(1, 6 - questionCount);
  return hintUsed ? Math.max(1, base - 2) : base;
}

function activePlayersForRound(players, roundIndex) {
  if (players.length < 2) return null;
  const interviewerIndex = roundIndex % players.length;
  const candidateIndex = (roundIndex + 1) % players.length;
  return {
    interviewer: players[interviewerIndex],
    candidate: players[candidateIndex],
  };
}

module.exports = {
  MAX_PLAYERS,
  ANSWER_SECONDS,
  GUESS_SECONDS,
  ROLE_SECONDS,
  normalizeText,
  normalizeGuess,
  guessMatches,
  containsForbiddenQuestionText,
  correctPayout,
  activePlayersForRound,
};
