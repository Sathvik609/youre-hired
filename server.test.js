const test = require("node:test");
const assert = require("node:assert/strict");
const { io: createClient } = require("socket.io-client");
const { httpServer } = require("./server");

function callbackEvent(socket, event, payload = {}) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function trackedClient(url) {
  const socket = createClient(url, { transports: ["websocket"], forceNew: true });
  socket.latestState = null;
  socket.on("state", (state) => { socket.latestState = state; });
  return socket;
}

function waitForConnect(socket) {
  if (socket.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("socket connection timed out")), 3000);
    socket.once("connect", () => { clearTimeout(timer); resolve(); });
  });
}

function waitForState(socket, predicate, timeout = 5000) {
  if (socket.latestState && predicate(socket.latestState)) return Promise.resolve(socket.latestState);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("state", onState);
      reject(new Error(`state wait timed out; latest phase: ${socket.latestState?.phase}`));
    }, timeout);
    function onState(state) {
      if (!predicate(state)) return;
      clearTimeout(timer);
      socket.off("state", onState);
      resolve(state);
    }
    socket.on("state", onState);
  });
}

test("two players can complete a private, correctly scored round", async (t) => {
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  const url = `http://127.0.0.1:${address.port}`;
  const host = trackedClient(url);
  const guest = trackedClient(url);
  t.after(async () => {
    host.close();
    guest.close();
    await new Promise((resolve) => httpServer.close(resolve));
  });

  await Promise.all([waitForConnect(host), waitForConnect(guest)]);
  const created = await callbackEvent(host, "createRoom", { name: "Avery" });
  assert.equal(created.ok, true);
  const joined = await callbackEvent(guest, "joinRoom", { name: "Blake", code: created.code });
  assert.equal(joined.ok, true);
  assert.equal((await callbackEvent(host, "updateSettings", { difficulty: "Easy", rounds: 2 })).ok, true);
  assert.equal((await callbackEvent(host, "startGame")).ok, true);

  const [hostRole, guestRole] = await Promise.all([
    waitForState(host, (state) => state.phase === "role"),
    waitForState(guest, (state) => state.phase === "role"),
  ]);
  const interviewer = hostRole.self.role === "interviewer" ? host : guest;
  const candidate = interviewer === host ? guest : host;
  const interviewerState = interviewer.latestState;
  const candidateState = candidate.latestState;
  assert.ok(interviewerState.active.job.title);
  assert.equal(candidateState.active.job, undefined, "candidate must never receive the job");

  await Promise.all([
    waitForState(interviewer, (state) => state.phase === "question", 6000),
    waitForState(candidate, (state) => state.phase === "question", 6000),
  ]);
  const jobTitle = interviewer.latestState.active.job.title;
  const rejected = await callbackEvent(interviewer, "askQuestion", { question: `Is the job ${jobTitle}?` });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /gives it away/i);

  assert.equal((await callbackEvent(interviewer, "askQuestion", { question: "What does a typical day look like?" })).ok, true);
  await waitForState(candidate, (state) => state.phase === "answer");
  assert.equal((await callbackEvent(candidate, "submitAnswer", { text: "It is busy, rewarding, and surprisingly noisy." })).ok, true);
  await waitForState(candidate, (state) => state.phase === "question" && state.active.questionNumber === 2);
  assert.equal((await callbackEvent(candidate, "requestGuess")).ok, true);
  await waitForState(candidate, (state) => state.phase === "guess");
  assert.equal((await callbackEvent(candidate, "submitGuess", { guess: `the ${jobTitle}!` })).ok, true);
  const result = await waitForState(candidate, (state) => state.phase === "result");
  assert.equal(result.active.result.correct, true);
  assert.equal(result.active.result.questionCount, 1);
  assert.deepEqual(result.active.result.earnings.map((item) => item.offers), [5, 5]);
});
