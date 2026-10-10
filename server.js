const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const { createServer } = require("node:http");
const { Server } = require("socket.io");
const { jobs } = require("./jobs");
const {
  MAX_PLAYERS,
  ANSWER_SECONDS,
  GUESS_SECONDS,
  ROLE_SECONDS,
  guessMatches,
  containsForbiddenQuestionText,
  correctPayout,
  activePlayersForRound,
} = require("./gameLogic");

const PORT = Number(process.env.PORT) || 3000;
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const ROOM_CODE_LENGTH = 4;
const RECONNECT_GRACE_MS = 60_000;
const EMPTY_ROOM_TTL_MS = 10 * 60_000;
const VALID_DIFFICULTIES = new Set(["Easy", "Hard", "Mixed"]);
const VALID_ROUNDS = new Set([2, 4, 6, 8]);

const PRESET_QUESTIONS = [
  "What does a typical day look like?",
  "What's the hardest part of this job?",
  "What tools or equipment do you use most?",
  "Who do you interact with most?",
  "What hours do you work?",
  "What would get you fired?",
  "What's your proudest moment in this role?",
  "What do you wear to work?",
  "Where do you physically do this job?",
  "What skill matters most here?",
  "How did you train for this?",
  "What's the biggest misconception about your job?",
  "What's the worst thing that can go wrong?",
  "What do you do when things get busy?",
  "Why should we hire you?",
];

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
const rooms = new Map();

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_request, response) => {
  response.json({ ok: true, rooms: rooms.size });
});

function randomToken() {
  return crypto.randomBytes(24).toString("hex");
}

function makeRoomCode() {
  let code;
  do {
    code = Array.from({ length: ROOM_CODE_LENGTH }, () =>
      ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)],
    ).join("");
  } while (rooms.has(code));
  return code;
}

function cleanName(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 24);
}

function cleanText(value, maxLength = 400) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function reply(callback, payload) {
  if (typeof callback === "function") callback(payload);
}

function connectedPlayers(room) {
  return room.playerOrder
    .map((token) => room.players.get(token))
    .filter((player) => player && player.connected);
}

function playerById(room, id) {
  return [...room.players.values()].find((player) => player.id === id);
}

function publicPlayers(room) {
  return room.playerOrder
    .map((token) => room.players.get(token))
    .filter(Boolean)
    .map((player) => ({
      id: player.id,
      name: player.name,
      score: player.score,
      connected: player.connected,
      isHost: player.token === room.hostToken,
    }));
}

function roleFor(room, player) {
  if (!room.active) return null;
  if (room.active.interviewerId === player.id) return "interviewer";
  if (room.active.candidateId === player.id) return "candidate";
  return "panel";
}

function stateFor(room, player) {
  const active = room.active;
  const role = roleFor(room, player);
  const state = {
    code: room.code,
    phase: room.phase,
    serverNow: Date.now(),
    deadline: room.deadline,
    self: { id: player.id, name: player.name, role, isHost: player.token === room.hostToken },
    settings: { ...room.settings },
    players: publicPlayers(room),
    roundNumber: room.roundIndex + 1,
    waitingForNames: [...room.waitingTokens]
      .map((token) => room.players.get(token)?.name)
      .filter(Boolean),
    canEndGame: player.token === room.hostToken && room.waitingExpired,
    presets: PRESET_QUESTIONS,
  };

  if (active) {
    state.active = {
      interviewerId: active.interviewerId,
      candidateId: active.candidateId,
      questionNumber: active.questionNumber,
      transcript: active.transcript,
      pendingQuestion: active.pendingQuestion,
      result: active.result,
    };
    if (role === "interviewer" && room.phase !== "gameover") {
      state.active.job = {
        title: active.job.title,
        difficulty: active.job.difficulty,
      };
    }
    if (role === "candidate" && active.hintUsed) {
      state.active.hint = active.job.hint;
    }
    if (role === "candidate") {
      state.active.canUseHint = player.hintAvailable && !active.hintUsed;
      if (room.phase === "answer") state.active.draft = active.answerDraft;
      if (room.phase === "guess") state.active.draft = active.guessDraft;
    }
  }

  return state;
}

function emitState(room) {
  room.updatedAt = Date.now();
  for (const player of room.players.values()) {
    if (!player.connected || !player.socketId) continue;
    io.to(player.socketId).emit("state", stateFor(room, player));
  }
}

function clearPhaseTimer(room) {
  if (room.timerHandle) clearTimeout(room.timerHandle);
  room.timerHandle = null;
  room.deadline = null;
}

function startPhaseTimer(room, seconds, onTimeout) {
  clearPhaseTimer(room);
  room.deadline = Date.now() + seconds * 1000;
  room.timerHandle = setTimeout(() => {
    room.timerHandle = null;
    room.deadline = null;
    onTimeout();
  }, seconds * 1000);
}

function chooseJob(room) {
  const difficulty = room.settings.difficulty;
  let pool = jobs.filter(
    (item) => difficulty === "Mixed" || item.difficulty === difficulty,
  );
  let available = pool.filter((item) => !room.usedJobs.has(item.title));
  if (!available.length) available = pool;
  const selected = available[Math.floor(Math.random() * available.length)];
  room.usedJobs.add(selected.title);
  return selected;
}

function beginQuestionPhase(room) {
  if (!rooms.has(room.code) || room.waitingTokens.size) return;
  clearPhaseTimer(room);
  room.phase = "question";
  emitState(room);
}

function beginRound(room) {
  clearPhaseTimer(room);
  const orderedPlayers = room.matchPlayerTokens
    .map((token) => room.players.get(token))
    .filter(Boolean);
  const roles = activePlayersForRound(orderedPlayers, room.roundIndex);
  if (!roles) return endGame(room);

  room.phase = "role";
  room.active = {
    interviewerId: roles.interviewer.id,
    candidateId: roles.candidate.id,
    job: chooseJob(room),
    questionNumber: 1,
    transcript: [],
    pendingQuestion: null,
    answerDraft: "",
    guessDraft: "",
    hintUsed: false,
    result: null,
  };
  startPhaseTimer(room, ROLE_SECONDS, () => beginQuestionPhase(room));
  emitState(room);
}

function finishAnswer(room, rawAnswer) {
  if (room.phase !== "answer" || !room.active) return;
  clearPhaseTimer(room);
  const answer = cleanText(rawAnswer) || "…";
  room.active.transcript.push({
    question: room.active.pendingQuestion,
    answer,
  });
  room.active.pendingQuestion = null;
  room.active.answerDraft = "";

  if (room.active.questionNumber >= 5) {
    room.phase = "guess";
    startPhaseTimer(room, GUESS_SECONDS, () => finishGuess(room, "", true));
  } else {
    room.active.questionNumber += 1;
    room.phase = "question";
  }
  emitState(room);
}

function finishGuess(room, rawGuess, timedOut = false) {
  if (room.phase !== "guess" || !room.active) return;
  clearPhaseTimer(room);
  const guess = timedOut ? "" : cleanText(rawGuess, 120);
  const correct = !timedOut && guessMatches(room.active.job, guess);
  const interviewer = playerById(room, room.active.interviewerId);
  const candidate = playerById(room, room.active.candidateId);
  const questionCount = room.active.transcript.length;
  let interviewerEarned = 2;
  let candidateEarned = 0;

  if (correct) {
    interviewerEarned = correctPayout(questionCount, false);
    candidateEarned = correctPayout(questionCount, room.active.hintUsed);
  }
  interviewer.score += interviewerEarned;
  candidate.score += candidateEarned;
  room.active.result = {
    correct,
    timedOut,
    guess: guess || null,
    jobTitle: room.active.job.title,
    questionCount,
    earnings: [
      { id: interviewer.id, name: interviewer.name, offers: interviewerEarned },
      { id: candidate.id, name: candidate.name, offers: candidateEarned },
    ],
  };
  room.phase = "result";
  emitState(room);
}

function endGame(room) {
  clearPhaseTimer(room);
  room.phase = "gameover";
  emitState(room);
}

function scheduleCurrentTimer(room, remainingMs) {
  const seconds = Math.max(0.05, remainingMs / 1000);
  if (room.phase === "role") {
    startPhaseTimer(room, seconds, () => beginQuestionPhase(room));
  } else if (room.phase === "answer") {
    startPhaseTimer(room, seconds, () => finishAnswer(room, room.active.answerDraft));
  } else if (room.phase === "guess") {
    startPhaseTimer(room, seconds, () => finishGuess(room, "", true));
  }
}

function pauseForDisconnect(room, player) {
  if (!room.active || ![room.active.interviewerId, room.active.candidateId].includes(player.id)) {
    return;
  }
  const remainingMs = room.deadline ? Math.max(0, room.deadline - Date.now()) : null;
  if (!room.waitingTokens.size) room.pausedRemainingMs = remainingMs;
  room.waitingTokens.add(player.token);
  if (room.timerHandle) clearTimeout(room.timerHandle);
  room.timerHandle = null;
  room.deadline = null;
}

function resumeAfterReconnect(room, token) {
  room.waitingTokens.delete(token);
  if (room.waitingTokens.size) return;
  room.waitingExpired = false;
  if (room.pausedRemainingMs !== null) {
    scheduleCurrentTimer(room, room.pausedRemainingMs);
  }
  room.pausedRemainingMs = null;
}

function removeLobbyPlayer(room, token) {
  const player = room.players.get(token);
  if (!player || player.connected || room.phase !== "lobby") return;
  room.players.delete(token);
  room.playerOrder = room.playerOrder.filter((item) => item !== token);
  if (room.hostToken === token) room.hostToken = room.playerOrder[0] || null;
  if (!room.playerOrder.length) room.emptySince = Date.now();
  emitState(room);
}

function roomAndPlayer(socket) {
  const room = rooms.get(socket.data.roomCode);
  const player = room?.players.get(socket.data.playerToken);
  if (!room || !player) return {};
  return { room, player };
}

function attachPlayerToSocket(socket, room, player) {
  player.socketId = socket.id;
  player.connected = true;
  player.disconnectedAt = null;
  if (player.reconnectTimer) clearTimeout(player.reconnectTimer);
  player.reconnectTimer = null;
  socket.data.roomCode = room.code;
  socket.data.playerToken = player.token;
  socket.join(room.code);
  room.emptySince = null;
}

io.on("connection", (socket) => {
  socket.on("createRoom", ({ name } = {}, callback) => {
    if (socket.data.roomCode) return reply(callback, { ok: false, error: "Already in a room." });
    const playerName = cleanName(name);
    if (!playerName) return reply(callback, { ok: false, error: "Enter a display name." });

    const code = makeRoomCode();
    const token = randomToken();
    const player = {
      id: crypto.randomUUID(),
      token,
      name: playerName,
      score: 0,
      connected: true,
      socketId: socket.id,
      hintAvailable: true,
    };
    const room = {
      code,
      hostToken: token,
      players: new Map([[token, player]]),
      playerOrder: [token],
      matchPlayerTokens: [],
      settings: { difficulty: "Mixed", rounds: 6 },
      phase: "lobby",
      roundIndex: 0,
      active: null,
      usedJobs: new Set(),
      deadline: null,
      timerHandle: null,
      waitingTokens: new Set(),
      waitingExpired: false,
      pausedRemainingMs: null,
      emptySince: null,
      updatedAt: Date.now(),
    };
    rooms.set(code, room);
    attachPlayerToSocket(socket, room, player);
    reply(callback, { ok: true, code, token });
    emitState(room);
  });

  socket.on("joinRoom", ({ name, code } = {}, callback) => {
    if (socket.data.roomCode) return reply(callback, { ok: false, error: "Already in a room." });
    const normalizedCode = String(code || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
    const room = rooms.get(normalizedCode);
    const playerName = cleanName(name);
    if (!playerName) return reply(callback, { ok: false, error: "Enter a display name." });
    if (!room) return reply(callback, { ok: false, error: "Room not found. Check the code." });
    if (room.phase !== "lobby") return reply(callback, { ok: false, error: "That game is already in progress." });
    if (room.playerOrder.length >= MAX_PLAYERS) return reply(callback, { ok: false, error: "That room is full." });
    if ([...room.players.values()].some((item) => item.name.toLowerCase() === playerName.toLowerCase())) {
      return reply(callback, { ok: false, error: "That display name is already in the room." });
    }

    const token = randomToken();
    const player = {
      id: crypto.randomUUID(),
      token,
      name: playerName,
      score: 0,
      connected: true,
      socketId: socket.id,
      hintAvailable: true,
    };
    room.players.set(token, player);
    room.playerOrder.push(token);
    attachPlayerToSocket(socket, room, player);
    reply(callback, { ok: true, code: room.code, token });
    emitState(room);
  });

  socket.on("reconnectRoom", ({ code, token } = {}, callback) => {
    const room = rooms.get(String(code || "").toUpperCase());
    const player = room?.players.get(String(token || ""));
    if (!room || !player) return reply(callback, { ok: false, error: "Your saved room is no longer available." });
    attachPlayerToSocket(socket, room, player);
    resumeAfterReconnect(room, player.token);
    reply(callback, { ok: true, code: room.code, token: player.token });
    emitState(room);
  });

  socket.on("updateSettings", ({ difficulty, rounds } = {}, callback) => {
    const { room, player } = roomAndPlayer(socket);
    if (!room || player.token !== room.hostToken || room.phase !== "lobby") {
      return reply(callback, { ok: false, error: "Only the Hiring Manager can change settings." });
    }
    if (!VALID_DIFFICULTIES.has(difficulty) || !VALID_ROUNDS.has(Number(rounds))) {
      return reply(callback, { ok: false, error: "Choose valid game settings." });
    }
    room.settings = { difficulty, rounds: Number(rounds) };
    reply(callback, { ok: true });
    emitState(room);
  });

  socket.on("startGame", (_payload, callback) => {
    const { room, player } = roomAndPlayer(socket);
    if (!room || player.token !== room.hostToken || room.phase !== "lobby") {
      return reply(callback, { ok: false, error: "Only the Hiring Manager can start the game." });
    }
    const players = connectedPlayers(room);
    if (players.length < 2) return reply(callback, { ok: false, error: "At least 2 players are required." });
    room.matchPlayerTokens = players.map((item) => item.token);
    room.roundIndex = 0;
    room.usedJobs = new Set();
    for (const item of players) {
      item.score = 0;
      item.hintAvailable = true;
    }
    reply(callback, { ok: true });
    beginRound(room);
  });

  socket.on("askQuestion", ({ question } = {}, callback) => {
    const { room, player } = roomAndPlayer(socket);
    if (!room || room.phase !== "question" || player.id !== room.active?.interviewerId) {
      return reply(callback, { ok: false, error: "It isn't your turn to ask." });
    }
    const text = cleanText(question, 240);
    if (!text) return reply(callback, { ok: false, error: "Ask a question first." });
    if (containsForbiddenQuestionText(room.active.job, text)) {
      return reply(callback, { ok: false, error: "That gives it away — rephrase." });
    }
    room.active.pendingQuestion = text;
    room.active.answerDraft = "";
    room.phase = "answer";
    startPhaseTimer(room, ANSWER_SECONDS, () => finishAnswer(room, room.active.answerDraft));
    reply(callback, { ok: true });
    emitState(room);
  });

  socket.on("updateAnswerDraft", ({ text } = {}) => {
    const { room, player } = roomAndPlayer(socket);
    if (room?.phase === "answer" && player.id === room.active?.candidateId) {
      room.active.answerDraft = String(text || "").slice(0, 400);
    }
  });

  socket.on("submitAnswer", ({ text } = {}, callback) => {
    const { room, player } = roomAndPlayer(socket);
    if (!room || room.phase !== "answer" || player.id !== room.active?.candidateId) {
      return reply(callback, { ok: false, error: "It isn't your turn to answer." });
    }
    reply(callback, { ok: true });
    finishAnswer(room, text);
  });

  socket.on("requestGuess", (_payload, callback) => {
    const { room, player } = roomAndPlayer(socket);
    if (!room || room.phase !== "question" || player.id !== room.active?.candidateId || !room.active.transcript.length) {
      return reply(callback, { ok: false, error: "You can guess after an answer." });
    }
    room.phase = "guess";
    room.active.guessDraft = "";
    startPhaseTimer(room, GUESS_SECONDS, () => finishGuess(room, "", true));
    reply(callback, { ok: true });
    emitState(room);
  });

  socket.on("useHint", (_payload, callback) => {
    const { room, player } = roomAndPlayer(socket);
    if (!room || !["question", "answer", "guess"].includes(room.phase) || player.id !== room.active?.candidateId) {
      return reply(callback, { ok: false, error: "The hint is only available to the Candidate." });
    }
    if (!player.hintAvailable || room.active.hintUsed) {
      return reply(callback, { ok: false, error: "You already used your hint this game." });
    }
    player.hintAvailable = false;
    room.active.hintUsed = true;
    reply(callback, { ok: true, hint: room.active.job.hint });
    emitState(room);
  });

  socket.on("updateGuessDraft", ({ text } = {}) => {
    const { room, player } = roomAndPlayer(socket);
    if (room?.phase === "guess" && player.id === room.active?.candidateId) {
      room.active.guessDraft = String(text || "").slice(0, 120);
    }
  });

  socket.on("submitGuess", ({ guess } = {}, callback) => {
    const { room, player } = roomAndPlayer(socket);
    if (!room || room.phase !== "guess" || player.id !== room.active?.candidateId) {
      return reply(callback, { ok: false, error: "It isn't your turn to guess." });
    }
    const text = cleanText(guess, 120);
    if (!text) return reply(callback, { ok: false, error: "Enter your best guess." });
    reply(callback, { ok: true });
    finishGuess(room, text, false);
  });

  socket.on("nextRound", (_payload, callback) => {
    const { room, player } = roomAndPlayer(socket);
    if (!room || room.phase !== "result" || ![room.active?.interviewerId, room.active?.candidateId].includes(player.id)) {
      return reply(callback, { ok: false, error: "An active player advances the round." });
    }
    room.roundIndex += 1;
    reply(callback, { ok: true });
    if (room.roundIndex >= room.settings.rounds) endGame(room);
    else beginRound(room);
  });

  socket.on("playAgain", (_payload, callback) => {
    const { room } = roomAndPlayer(socket);
    if (!room || room.phase !== "gameover") return reply(callback, { ok: false, error: "The game is still running." });
    clearPhaseTimer(room);
    room.phase = "lobby";
    room.roundIndex = 0;
    room.active = null;
    room.matchPlayerTokens = [];
    room.usedJobs = new Set();
    room.waitingTokens.clear();
    room.waitingExpired = false;
    for (const item of room.players.values()) {
      item.score = 0;
      item.hintAvailable = true;
    }
    reply(callback, { ok: true });
    emitState(room);
  });

  socket.on("endGame", (_payload, callback) => {
    const { room, player } = roomAndPlayer(socket);
    if (!room || player.token !== room.hostToken || !room.waitingExpired) {
      return reply(callback, { ok: false, error: "The reconnect window is still open." });
    }
    reply(callback, { ok: true });
    endGame(room);
  });

  socket.on("disconnect", () => {
    const { room, player } = roomAndPlayer(socket);
    if (!room || !player || player.socketId !== socket.id) return;
    player.connected = false;
    player.socketId = null;
    player.disconnectedAt = Date.now();
    if (!connectedPlayers(room).length) room.emptySince = Date.now();

    if (room.phase === "lobby") {
      player.reconnectTimer = setTimeout(() => removeLobbyPlayer(room, player.token), RECONNECT_GRACE_MS);
    } else if (!["gameover", "result"].includes(room.phase)) {
      pauseForDisconnect(room, player);
      player.reconnectTimer = setTimeout(() => {
        if (!player.connected) {
          room.waitingExpired = true;
          emitState(room);
        }
      }, RECONNECT_GRACE_MS);
    }
    emitState(room);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.emptySince && now - room.emptySince >= EMPTY_ROOM_TTL_MS) {
      clearPhaseTimer(room);
      rooms.delete(code);
    }
  }
}, 60_000).unref();

if (require.main === module) {
  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`You're Hired? is running at http://localhost:${PORT}`);
  });
}

module.exports = { app, httpServer, rooms, PRESET_QUESTIONS };
