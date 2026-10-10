const socket = io();
const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const connectionStatus = document.querySelector("#connectionStatus");
const helpButton = document.querySelector("#helpButton");
const helpDialog = document.querySelector("#helpDialog");
const closeHelp = document.querySelector("#closeHelp");

let gameState = null;
let clockDelta = 0;
let countdownInterval = null;
let toastTimer = null;
let lastConfettiKey = null;
let sessionWasReplaced = false;

const storage = {
  get() {
    try {
      const value = JSON.parse(localStorage.getItem("youre-hired-session"));
      return value?.code && value?.token ? value : null;
    } catch {
      return null;
    }
  },
  set(value) {
    localStorage.setItem("youre-hired-session", JSON.stringify(value));
  },
  clear() {
    localStorage.removeItem("youre-hired-session");
  },
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  if (!message) return;
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

function emitWithReply(event, payload = {}) {
  return new Promise((resolve) => {
    socket.emit(event, payload, (response = {}) => {
      if (!response.ok && response.error) showToast(response.error);
      resolve(response);
    });
  });
}

function setConnectionStatus(connected) {
  connectionStatus.textContent = connected ? "Live connection" : "Reconnecting…";
  connectionStatus.classList.toggle("offline", !connected);
}

socket.on("connect", async () => {
  setConnectionStatus(true);
  const session = storage.get();
  if (!session) {
    if (!gameState) renderHome();
    return;
  }
  const response = await emitWithReply("reconnectRoom", session);
  if (!response.ok) {
    storage.clear();
    gameState = null;
    renderHome(response.error);
  }
});

socket.on("sessionReplaced", () => {
  sessionWasReplaced = true;
  renderSessionReplaced();
});
socket.on("disconnect", () => {
  if (!sessionWasReplaced) setConnectionStatus(false);
});
socket.on("state", (nextState) => {
  sessionWasReplaced = false;
  gameState = nextState;
  clockDelta = nextState.serverNow - Date.now();
  render();
});

helpButton.addEventListener("click", () => helpDialog.showModal());
closeHelp.addEventListener("click", () => helpDialog.close());
helpDialog.addEventListener("click", (event) => {
  if (event.target === helpDialog) helpDialog.close();
});

function renderHome(errorMessage) {
  clearInterval(countdownInterval);
  helpButton.classList.add("hidden");
  app.innerHTML = `
    <section class="hero-grid">
      <div class="hero-copy">
        <span class="eyebrow">A suspiciously qualified party game</span>
        <h1>You're<br><span class="accent">Hired?</span></h1>
        <p class="lede">You don't know the job. You do have confidence. Bluff your way through the interview, then guess what you just got hired to do.</p>
      </div>
      <div class="card entry-card">
        <span class="eyebrow">Check in</span>
        <h2>Enter the waiting room</h2>
        <p class="subtle">No résumé, login, or sensible career plan required.</p>
        <form id="entryForm">
          <div class="form-group">
            <label for="displayName">Display name</label>
            <input id="displayName" maxlength="24" autocomplete="nickname" placeholder="e.g. Very Employable Sam" required />
          </div>
          <button class="button button-primary button-block" id="createButton" type="button">Create room</button>
          <div class="divider">or join a room</div>
          <div class="form-group">
            <label for="roomCode">4-letter room code</label>
            <input class="code-input" id="roomCode" maxlength="4" autocomplete="off" autocapitalize="characters" placeholder="ABCD" />
          </div>
          <button class="button button-dark button-block" id="joinButton" type="submit">Join room</button>
        </form>
      </div>
    </section>`;

  const nameInput = document.querySelector("#displayName");
  const codeInput = document.querySelector("#roomCode");
  const entryForm = document.querySelector("#entryForm");
  codeInput.addEventListener("input", () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
  });
  document.querySelector("#createButton").addEventListener("click", async () => {
    const response = await emitWithReply("createRoom", { name: nameInput.value });
    if (response.ok) storage.set({ code: response.code, token: response.token });
  });
  entryForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const response = await emitWithReply("joinRoom", { name: nameInput.value, code: codeInput.value });
    if (response.ok) storage.set({ code: response.code, token: response.token });
  });
  if (errorMessage) showToast(errorMessage);
}

function render() {
  if (!gameState) return renderHome();
  helpButton.classList.remove("hidden");
  if (gameState.phase === "lobby") renderLobby();
  else renderGame();
  renderReconnectOverlay();
  startCountdown();
}

function playerRows(players, showScore = false) {
  return players.map((player) => `
    <div class="player-row">
      <div class="player-identity">
        <span class="avatar">${escapeHtml(player.name.slice(0, 1).toUpperCase())}</span>
        <span class="player-name">${escapeHtml(player.name)} ${player.isHost ? '<span class="role-chip">Hiring Manager</span>' : ""}</span>
      </div>
      ${showScore ? `<strong>${player.score} ${player.score === 1 ? "Offer" : "Offers"}</strong>` : player.connected ? '<span class="status-chip">Ready</span>' : '<span class="offline-dot">Reconnecting</span>'}
    </div>`).join("");
}

function howToPlayCard() {
  return `
    <aside class="card rules-card">
      <span class="eyebrow">Candidate briefing</span>
      <h2>How to play</h2>
      <ol class="rules-list">
        <li>Each round, one player interviews and one is in the hot seat.</li>
        <li>The Interviewer secretly sees a job and asks up to 5 questions. Don't say the job or give it away!</li>
        <li>The Candidate answers every question as if they already have the job, then guesses what it is.</li>
        <li>Correct guess: BOTH players earn Offers (more if you guess early). Wrong guess: only the Interviewer scores.</li>
        <li>Roles swap every round. Most Offers at the end wins.</li>
      </ol>
    </aside>`;
}

function renderLobby() {
  const { code, players, settings, self } = gameState;
  app.innerHTML = `
    <section>
      <div class="room-banner">
        <div>
          <span class="eyebrow">Waiting room</span>
          <div class="room-code">${escapeHtml(code)}</div>
        </div>
        <button class="button button-ghost" id="copyCode" type="button">Copy code</button>
      </div>
      <div class="lobby-grid">
        <div class="card">
          <div class="phase-heading">
            <div>
              <h2>${players.length === 1 ? "Waiting for candidates" : "The panel is assembling"}</h2>
              <p class="subtle">${players.length}/8 seats filled</p>
            </div>
            <span class="status-chip">Live</span>
          </div>
          <div class="player-list">${playerRows(players)}</div>
          ${self.isHost ? `
            <div class="settings-grid">
              <div class="form-group">
                <label for="difficulty">Difficulty</label>
                <select id="difficulty">
                  ${["Easy", "Hard", "Mixed"].map((value) => `<option ${settings.difficulty === value ? "selected" : ""}>${value}</option>`).join("")}
                </select>
              </div>
              <div class="form-group">
                <label for="rounds">Rounds</label>
                <select id="rounds">
                  ${[2,4,6,8].map((value) => `<option value="${value}" ${settings.rounds === value ? "selected" : ""}>${value}</option>`).join("")}
                </select>
              </div>
            </div>
            <button class="button button-primary button-block" id="startGame" type="button" ${players.filter((player) => player.connected).length < 2 ? "disabled" : ""}>Start interviews</button>
          ` : `
            <div class="waiting-note"><strong>${escapeHtml(players.find((player) => player.isHost)?.name || "The Hiring Manager")}</strong> is choosing the interview package.</div>
          `}
        </div>
        ${howToPlayCard()}
      </div>
    </section>`;

  document.querySelector("#copyCode").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code);
      showToast("Room code copied.");
    } catch {
      showToast(`Room code: ${code}`);
    }
  });
  if (self.isHost) {
    const difficulty = document.querySelector("#difficulty");
    const rounds = document.querySelector("#rounds");
    const updateSettings = () => emitWithReply("updateSettings", { difficulty: difficulty.value, rounds: Number(rounds.value) });
    difficulty.addEventListener("change", updateSettings);
    rounds.addEventListener("change", updateSettings);
    document.querySelector("#startGame").addEventListener("click", () => emitWithReply("startGame"));
  }
}

function scoreStrip() {
  return `<div class="score-strip">${gameState.players.map((player) => `<span class="score-pill">${escapeHtml(player.name)} · <strong>${player.score}</strong></span>`).join("")}</div>`;
}

function activeName(id) {
  return gameState.players.find((player) => player.id === id)?.name || "A player";
}

function transcriptMarkup() {
  const active = gameState.active;
  if (!active?.transcript?.length) return '<div class="transcript-empty">The interview transcript will appear here.</div>';
  return `<div class="transcript">${active.transcript.map((item, index) => `
    <div class="qa-item">
      <p class="q">Q${index + 1}. ${escapeHtml(item.question)}</p>
      <p class="a">${escapeHtml(item.answer)}</p>
    </div>`).join("")}</div>`;
}

function timerMarkup() {
  return gameState.deadline ? '<div class="timer" data-countdown>30</div>' : "";
}

function stageShell(content, sidebar = true) {
  const role = gameState.self.role;
  const panelNote = role === "panel" ? '<div class="panel-note">Panel view · The job stays secret</div>' : "";
  const progressLabel = gameState.phase === "gameover"
    ? "Final results"
    : `Round ${gameState.roundNumber} of ${gameState.settings.rounds} · ${escapeHtml(gameState.settings.difficulty)}`;
  return `
    <div class="game-header">
      <div>
        <span class="eyebrow">Live interview</span>
        <div class="round-label">${progressLabel}</div>
      </div>
      ${scoreStrip()}
    </div>
    <div class="game-grid">
      <section class="card stage-card">${panelNote}${content}</section>
      ${sidebar ? `<aside class="side-stack"><div class="card compact-card"><h3>Offers</h3><div class="player-list">${playerRows(gameState.players, true)}</div></div><div class="card compact-card"><h3>Interview transcript</h3><div class="question-count">Question ${gameState.active?.questionNumber || 1} of 5</div>${transcriptMarkup()}</div></aside>` : ""}
    </div>`;
}

function secretJobChip() {
  if (gameState.self.role !== "interviewer" || !gameState.active?.job) return "";
  return `<div class="secret-job-chip"><span>Secret job</span><strong>${escapeHtml(gameState.active.job.title)}</strong></div>`;
}

function renderGame() {
  const phase = gameState.phase;
  if (phase === "role") renderRole();
  else if (phase === "question") renderQuestion();
  else if (phase === "answer") renderAnswer();
  else if (phase === "guess") renderGuess();
  else if (phase === "result") renderResult();
  else if (phase === "gameover") renderGameOver();
}

function renderRole() {
  const { role } = gameState.self;
  const active = gameState.active;
  let title = "You're on the Panel";
  let body = `Watch ${escapeHtml(activeName(active.interviewerId))} interview ${escapeHtml(activeName(active.candidateId))}. The job stays secret.`;
  if (role === "interviewer") {
    title = "You're the Interviewer";
    body = `<div class="secret-card"><span class="label">Your secret opening</span><div class="secret-job">${escapeHtml(active.job.title)}</div><span>${escapeHtml(active.job.difficulty)} · Don't say it out loud.</span></div>`;
  } else if (role === "candidate") {
    title = "You're in the hot seat";
    body = "Answer with confidence. You don't know the job yet—and that's the point.";
  }
  app.innerHTML = stageShell(`<div class="stage-center"><span class="eyebrow">Roles assigned</span><h1 class="role-title">${title}</h1><div class="lede">${body}</div><p class="subtle">Interview starts in a moment…</p></div>`);
}

function renderQuestion() {
  const { role } = gameState.self;
  const { active } = gameState;
  let content;
  if (role === "interviewer") {
    content = `
      <div class="phase-heading"><div><span class="question-count">Question ${active.questionNumber} of 5</span><h2>Ask your next question</h2></div></div>
      <div class="secret-card"><span class="label">Secret job</span><div class="secret-job">${escapeHtml(active.job.title)}</div><span>${escapeHtml(active.job.difficulty)}</span></div>
      <form id="questionForm" style="margin-top:22px">
        <div class="form-group"><label for="questionInput">Your question</label><input id="questionInput" maxlength="240" placeholder="Ask something revealing—but not too revealing" required /></div>
        <div class="preset-list">${gameState.presets.map((question) => `<button class="preset-button" type="button" data-preset="${escapeHtml(question)}">${escapeHtml(question)}</button>`).join("")}</div>
        <button class="button button-primary" type="submit">Ask question</button>
      </form>`;
  } else if (role === "candidate") {
    content = `
      <div class="phase-heading"><div><span class="question-count">Question ${active.questionNumber} of 5</span><h2>The Interviewer is thinking</h2></div></div>
      <p class="lede">Prepare a confident answer. Accuracy is optional; commitment is not.</p>
      ${active.hint ? `<div class="hint-box">Your one-word hint: <span class="hint-word">${escapeHtml(active.hint)}</span></div>` : ""}
      <div class="button-row" style="margin-top:18px">
        ${active.transcript.length ? '<button class="button button-primary" id="makeGuess" type="button">Make my guess</button>' : ""}
        ${active.canUseHint ? '<button class="button button-ghost" id="useHint" type="button">Use my one-time Job Hint</button>' : ""}
      </div>
      <p class="subtle" style="margin-top:12px">A hint reduces your payout by 2 only if your guess is correct, with a minimum of 1.</p>`;
  } else {
    content = `<div class="phase-heading"><div><span class="question-count">Question ${active.questionNumber} of 5</span><h2>${escapeHtml(activeName(active.interviewerId))} is choosing a question</h2></div></div><p class="lede">Watch the interview unfold. The Panel never sees the secret job.</p>`;
  }
  app.innerHTML = stageShell(content);
  if (role === "interviewer") bindQuestionForm();
  if (role === "candidate") bindCandidateActions();
}

function bindQuestionForm() {
  const form = document.querySelector("#questionForm");
  const input = document.querySelector("#questionInput");
  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      input.value = button.dataset.preset;
      input.focus();
    });
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const response = await emitWithReply("askQuestion", { question: input.value });
    if (!response.ok) input.focus();
  });
}

function bindCandidateActions() {
  document.querySelector("#makeGuess")?.addEventListener("click", () => emitWithReply("requestGuess"));
  document.querySelector("#useHint")?.addEventListener("click", async () => {
    const answerInput = document.querySelector("#answerInput");
    const guessInput = document.querySelector("#guessInput");
    if (answerInput) socket.emit("updateAnswerDraft", { text: answerInput.value });
    if (guessInput) socket.emit("updateGuessDraft", { text: guessInput.value });
    await emitWithReply("useHint");
  });
}

function renderAnswer() {
  const { role } = gameState.self;
  const { active } = gameState;
  let content = `
    <div class="phase-heading"><div><span class="question-count">Question ${active.questionNumber} of 5</span><h2>${role === "candidate" ? "Answer like you belong here" : `${escapeHtml(activeName(active.candidateId))} is answering`}</h2></div>${timerMarkup()}</div>
    ${secretJobChip()}
    <div class="current-question">${escapeHtml(active.pendingQuestion)}</div>`;
  if (role === "candidate") {
    content += `
      ${active.hint ? `<div class="hint-box">Your one-word hint: <span class="hint-word">${escapeHtml(active.hint)}</span></div>` : ""}
      <form id="answerForm">
        <div class="form-group"><label for="answerInput">Your answer</label><textarea id="answerInput" maxlength="400" placeholder="Sound confident. Make it plausible. Or don't." autofocus>${escapeHtml(active.draft || "")}</textarea></div>
        <div class="button-row"><button class="button button-primary" type="submit">Submit answer</button>${active.canUseHint ? '<button class="button button-ghost" id="useHint" type="button">Use Job Hint</button>' : ""}</div>
      </form>`;
  } else {
    content += `<p class="waiting-note">Their answer will be submitted automatically when the timer reaches zero.</p>`;
  }
  app.innerHTML = stageShell(content);
  if (role === "candidate") {
    const input = document.querySelector("#answerInput");
    let draftTimer;
    input.addEventListener("input", () => {
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => socket.emit("updateAnswerDraft", { text: input.value }), 80);
    });
    document.querySelector("#answerForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      socket.emit("updateAnswerDraft", { text: input.value });
      await emitWithReply("submitAnswer", { text: input.value });
    });
    bindCandidateActions();
  }
}

function renderGuess() {
  const { role } = gameState.self;
  const { active } = gameState;
  let content = `
    <div class="phase-heading"><div><span class="question-count">Question ${active.questionNumber} of 5</span><h2>${role === "candidate" ? "Make your final guess" : `${escapeHtml(activeName(active.candidateId))} is making a guess`}</h2></div>${timerMarkup()}</div>
    ${secretJobChip()}`;
  if (role === "candidate") {
    content += `
      ${active.hint ? `<div class="hint-box">Your one-word hint: <span class="hint-word">${escapeHtml(active.hint)}</span></div>` : ""}
      <form id="guessForm">
        <div class="form-group"><label for="guessInput">What is the job?</label><input id="guessInput" maxlength="120" placeholder="Enter the job title" autocomplete="off" value="${escapeHtml(active.draft || "")}" autofocus required /></div>
        <div class="button-row"><button class="button button-primary" type="submit">Submit guess</button>${active.canUseHint ? '<button class="button button-ghost" id="useHint" type="button">Use Job Hint</button>' : ""}</div>
      </form>`;
  } else {
    content += `<p class="lede">One guess. Thirty seconds. A career hangs in the balance.</p>`;
  }
  app.innerHTML = stageShell(content);
  if (role === "candidate") {
    const input = document.querySelector("#guessInput");
    let draftTimer;
    input.addEventListener("input", () => {
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => socket.emit("updateGuessDraft", { text: input.value }), 80);
    });
    document.querySelector("#guessForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      socket.emit("updateGuessDraft", { text: input.value });
      await emitWithReply("submitGuess", { guess: input.value });
    });
    bindCandidateActions();
  }
}

function renderResult() {
  const result = gameState.active.result;
  const canAdvance = [gameState.active.interviewerId, gameState.active.candidateId].includes(gameState.self.id);
  const isLastRound = gameState.roundNumber >= gameState.settings.rounds;
  const advanceLabel = isLastRound ? "See final results" : "Next round";
  const message = result.correct ? "You're Hired!" : "We'll be in touch.";
  const guessLine = result.timedOut ? "The guess timed out." : result.guess ? `The guess was “${escapeHtml(result.guess)}”.` : "No guess was submitted.";
  const content = `
    <div class="stage-center">
      <span class="eyebrow">Interview complete</span>
      <div class="result-badge ${result.correct ? "success" : "fail"}">${message}</div>
      <div class="reveal"><span>The job was</span><strong>${escapeHtml(result.jobTitle)}</strong><p class="subtle" style="margin:8px 0 0">${guessLine}</p></div>
      <h3>Offers earned this round</h3>
      <div class="earnings">${result.earnings.map((earning) => `<div class="earning-row"><span>${escapeHtml(earning.name)}</span><strong>+${earning.offers} ${earning.offers === 1 ? "Offer" : "Offers"}</strong></div>`).join("")}</div>
      ${canAdvance ? `<button class="button button-primary" id="nextRound" type="button">${advanceLabel}</button>` : '<p class="subtle">Waiting for an active player to continue…</p>'}
    </div>`;
  app.innerHTML = stageShell(content);
  document.querySelector("#nextRound")?.addEventListener("click", () => emitWithReply("nextRound"));
  const confettiKey = `${gameState.roundNumber}-${result.jobTitle}`;
  if (result.correct && lastConfettiKey !== confettiKey) {
    lastConfettiKey = confettiKey;
    launchConfetti();
  }
}

function renderGameOver() {
  const sorted = [...gameState.players].sort((a, b) => b.score - a.score);
  const topScore = sorted[0]?.score ?? 0;
  const winners = sorted.filter((player) => player.score === topScore);
  const winnerText = winners.length > 1 ? "Co-hired!" : `${winners[0]?.name || "Nobody"} is hired!`;
  const content = `
    <div class="stage-center">
      <span class="eyebrow">Final Offers</span>
      <div class="result-badge success">${escapeHtml(winnerText)}</div>
      <div class="final-board">${sorted.map((player) => {
        const rank = sorted.findIndex((entry) => entry.score === player.score) + 1;
        return `<div class="final-row ${player.score === topScore ? "winner" : ""}"><span class="rank">#${rank}</span><span class="player-name">${escapeHtml(player.name)}</span><span class="offers">${player.score} ${player.score === 1 ? "Offer" : "Offers"}</span></div>`;
      }).join("")}</div>
      <button class="button button-primary" id="playAgain" type="button">Play again</button>
    </div>`;
  app.innerHTML = stageShell(content, false);
  document.querySelector("#playAgain").addEventListener("click", () => emitWithReply("playAgain"));
}

function renderSessionReplaced() {
  clearInterval(countdownInterval);
  helpButton.classList.add("hidden");
  connectionStatus.textContent = "Opened elsewhere";
  connectionStatus.classList.add("offline");
  document.querySelector(".reconnect-overlay")?.remove();
  const overlay = document.createElement("div");
  overlay.className = "reconnect-overlay session-replaced-overlay";
  overlay.innerHTML = `
    <div class="card reconnect-card">
      <span class="eyebrow">Session moved</span>
      <h2>This game is open in another tab</h2>
      <p class="subtle">Only one tab can control this player at a time.</p>
      <button class="button button-primary" id="useThisTab" type="button">Use this tab instead</button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#useThisTab").addEventListener("click", async () => {
    const session = storage.get();
    if (!session) {
      sessionWasReplaced = false;
      gameState = null;
      overlay.remove();
      renderHome("Your saved room is no longer available.");
      return;
    }
    sessionWasReplaced = false;
    setConnectionStatus(false);
    if (!socket.connected) {
      socket.connect();
      return;
    }
    const response = await emitWithReply("reconnectRoom", session);
    if (!response.ok) {
      storage.clear();
      gameState = null;
      overlay.remove();
      renderHome(response.error);
    }
  });
}

function renderReconnectOverlay() {
  document.querySelector(".reconnect-overlay")?.remove();
  if (!gameState.waitingForNames?.length || gameState.phase === "gameover") return;
  const overlay = document.createElement("div");
  overlay.className = "reconnect-overlay";
  overlay.innerHTML = `<div class="card reconnect-card"><div class="pulse"></div><h2>Waiting for ${escapeHtml(gameState.waitingForNames.join(" and "))} to reconnect…</h2><p class="subtle">The game timer is paused and their seat is saved for 60 seconds.</p>${gameState.canEndGame ? '<button class="button button-dark" id="endGame" type="button">End game & show scores</button>' : ""}</div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#endGame")?.addEventListener("click", () => emitWithReply("endGame"));
}

function startCountdown() {
  clearInterval(countdownInterval);
  const update = () => {
    const timer = document.querySelector("[data-countdown]");
    if (!timer || !gameState?.deadline) return;
    const remaining = Math.max(0, Math.ceil((gameState.deadline - (Date.now() + clockDelta)) / 1000));
    timer.textContent = remaining;
    timer.classList.toggle("urgent", remaining <= 8);
  };
  update();
  countdownInterval = setInterval(update, 250);
}

function launchConfetti() {
  const layer = document.createElement("div");
  const colors = ["#e9684d", "#20314b", "#b9dfcf", "#efc55d", "#fffdf8"];
  layer.className = "confetti";
  for (let index = 0; index < 70; index += 1) {
    const piece = document.createElement("span");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[index % colors.length];
    piece.style.animationDelay = `${Math.random() * 0.5}s`;
    piece.style.setProperty("--drift", `${(Math.random() - 0.5) * 220}px`);
    layer.appendChild(piece);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 3400);
}

if (!storage.get()) renderHome();
