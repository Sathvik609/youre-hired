const test = require("node:test");
const assert = require("node:assert/strict");
const { io: createClient } = require("socket.io-client");
const { httpServer, rooms } = require("./server");

function connect(url) {
  const socket = createClient(url, { transports: ["websocket"], forceNew: true, reconnection: false });
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

function ask(socket, event, ...args) {
  return new Promise((resolve) => socket.emit(event, ...args, resolve));
}

test("malformed payloads are rejected without crashing the server", async (t) => {
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${httpServer.address().port}`;
  const socket = await connect(url);
  t.after(() => socket.close());

  const badPayloads = [null, 42, "text", [], { name: { toString: "x" } }, { name: ["a", "b"] }];
  const events = ["createRoom", "joinRoom", "reconnectRoom", "updateSettings", "askQuestion",
    "submitAnswer", "submitGuess", "useHint", "nextRound", "playAgain", "endGame", "leaveRoom"];
  for (const event of events) {
    for (const payload of badPayloads) {
      const response = await ask(socket, event, payload);
      assert.equal(response.ok, false, `${event} with ${JSON.stringify(payload)} should fail`);
    }
  }
  socket.emit("updateAnswerDraft", null);
  socket.emit("updateGuessDraft", null);
  socket.emit("createRoom"); // no payload and no callback

  const health = await fetch(`${url}/health`);
  assert.equal(health.status, 200, "server is still up");
  assert.equal(rooms.size, 0, "no rooms were created from bad input");
});

test("pages are served with security headers", async (t) => {
  t.after(() => {
    httpServer.closeAllConnections();
    httpServer.close();
  });
  const response = await fetch(`http://127.0.0.1:${httpServer.address().port}/`);
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-powered-by"), null);
});
