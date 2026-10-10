const test = require("node:test");
const assert = require("node:assert/strict");
const { jobs } = require("./jobs");
const {
  normalizeGuess,
  guessMatches,
  containsForbiddenQuestionText,
  correctPayout,
  activePlayersForRound,
} = require("./gameLogic");

test("job pool contains the required 40 Easy and 40 Hard jobs", () => {
  assert.equal(jobs.filter((job) => job.difficulty === "Easy").length, 40);
  assert.equal(jobs.filter((job) => job.difficulty === "Hard").length, 40);
  assert.equal(new Set(jobs.map((job) => job.title)).size, 80);
});

test("guess normalization accepts aliases and leading articles", () => {
  const dentist = jobs.find((job) => job.title === "dentist");
  assert.equal(normalizeGuess("  A Dentist!!! "), "dentist");
  assert.equal(guessMatches(dentist, "the dental doctor"), true);
  assert.equal(guessMatches(dentist, "orthodontist"), false);
});

test("questions reject full titles and forbidden phrases without partial-word false positives", () => {
  const chef = jobs.find((job) => job.title === "chef");
  assert.equal(containsForbiddenQuestionText(chef, "What does a chef do?"), true);
  assert.equal(containsForbiddenQuestionText(chef, "Are you the chief decision maker?"), false);
});

test("hint deduction applies only to correct payout and never drops below one", () => {
  assert.equal(correctPayout(1, false), 5);
  assert.equal(correctPayout(1, true), 3);
  assert.equal(correctPayout(5, true), 1);
});

test("round rotation swaps two players and balances larger groups", () => {
  const players = [{ id: "A" }, { id: "B" }, { id: "C" }];
  assert.deepEqual(activePlayersForRound(players, 0), { interviewer: players[0], candidate: players[1] });
  assert.deepEqual(activePlayersForRound(players, 1), { interviewer: players[1], candidate: players[2] });
  assert.deepEqual(activePlayersForRound(players, 2), { interviewer: players[2], candidate: players[0] });
});
