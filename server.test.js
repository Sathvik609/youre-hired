const test = require("node:test");
const assert = require("node:assert/strict");
const { io: createClient } = require("socket.io-client");
const { httpServer, rooms } = require("./server");

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

function waitForSocketEvent(socket, event, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`${event} timed out`));
    }, timeout);
    function onEvent(...args) {
      clearTimeout(timer);
      resolve(args);
    }
    socket.once(event, onEvent);
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
  let host = trackedClient(url);
  const guest = trackedClient(url);
  t.after(async () => {
    host.close();
    guest.close();
    await new Promise((resolve) => httpServer.close(resolve));
  });

  await Promise.all([waitForConnect(host), waitForConnect(guest)]);

  const transferHost = trackedClient(url);
  const transferGuest = trackedClient(url);
  await Promise.all([waitForConnect(transferHost), waitForConnect(transferGuest)]);
  const transferRoom = await callbackEvent(transferHost, "createRoom", { name: "First Host" });
  assert.equal((await callbackEvent(transferGuest, "joinRoom", { name: "Next Host", code: transferRoom.code })).ok, true);
  assert.equal((await callbackEvent(transferHost, "leaveRoom")).ok, true);
  const transferredState = await waitForState(transferGuest, (state) => state.players.length === 1);
  assert.equal(transferredState.self.isHost, true, "the next lobby player should become Hiring Manager");
  assert.equal((await callbackEvent(transferGuest, "leaveRoom")).ok, true);
  assert.equal(rooms.has(transferRoom.code), false, "an explicitly emptied room should be deleted immediately");
  transferHost.close();
  transferGuest.close();

  const created = await callbackEvent(host, "createRoom", { name: "Avery" });
  assert.equal(created.ok, true);

  const originalHost = host;
  const replacementHost = trackedClient(url);
  await waitForConnect(replacementHost);
  const sessionReplaced = waitForSocketEvent(originalHost, "sessionReplaced");
  const originalDisconnected = waitForSocketEvent(originalHost, "disconnect");
  assert.equal((await callbackEvent(replacementHost, "reconnectRoom", created)).ok, true);
  await Promise.all([sessionReplaced, originalDisconnected]);
  assert.equal(originalHost.connected, false, "the replaced socket should be disconnected");
  host = replacementHost;

  const joined = await callbackEvent(guest, "joinRoom", { name: "Blake", code: created.code });
  assert.equal(joined.ok, true);
  const replacementState = await waitForState(host, (state) => state.players.length === 2);
  assert.equal(replacementState.players.find((player) => player.name === "Avery").connected, true,
    "the stale disconnect must not mark the replacement socket offline");
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

  assert.equal((await callbackEvent(candidate, "leaveRoom")).ok, true);
  const finalState = await waitForState(interviewer, (state) => state.phase === "gameover");
  assert.deepEqual(finalState.players.map((player) => player.name), ["Avery"],
    "an active departure should end the game for the remaining player");
  assert.equal((await callbackEvent(interviewer, "leaveRoom")).ok, true);
  assert.equal(rooms.has(created.code), false);
});
