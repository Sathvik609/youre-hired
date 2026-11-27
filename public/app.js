const socket = io();
const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const connectionStatus = document.querySelector("#connectionStatus");
const helpDialog = document.querySelector("#helpDialog");
const closeHelp = document.querySelector("#closeHelp");

let gameState = null;
let clockDelta = 0;
let countdownInterval = null;
let toastTimer = null;
let lastConfettiKey = null;
let lastScreenKey = null;
let sessionWasReplaced = false;
let rejoinToastShown = false;

const ROUND_RULES = [
  "The Interviewer sees a secret job and asks up to 5 questions.",
  "The Candidate answers as if they already have it, then guesses.",
  "Right guess: both earn Offers, more for guessing early. Then roles swap.",
];

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

function listNames(names) {
  if (names.length <= 1) return names[0] || "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
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

function setConnectionStatus(connected, label = "Reconnecting…") {
  connectionStatus.textContent = label;
  connectionStatus.classList.toggle("hidden", connected);
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
  } else if (!rejoinToastShown) {
    rejoinToastShown = true;
    showToast(`Rejoined room ${response.code} as ${response.name}`);
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

closeHelp.addEventListener("click", () => helpDialog.close());
helpDialog.addEventListener("click", (event) => {
  if (event.target === helpDialog) helpDialog.close();
});

// Header links ("Rules", "Leave") are redrawn with every sheet, so listen once on the app.
app.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "rules") helpDialog.showModal();
  if (action === "leave") leaveCurrentRoom();
});

function leaveCurrentRoom() {
  if (socket.connected) socket.emit("leaveRoom", {}, () => {});
  storage.clear();
  gameState = null;
  sessionWasReplaced = false;
  document.querySelector(".overlay")?.remove();
  renderHome();
}

/* ---------- shared pieces ---------- */

function headActions() {
  return `<span class="head-actions"><button class="l link-button" type="button" data-action="rules">Rules</button><button class="l link-button" type="button" data-action="leave">Leave</button></span>`;
}

function sheetClass(screenKey, extra = "") {
  const animate = screenKey !== lastScreenKey;
  lastScreenKey = screenKey;
  return `sheet ${extra} ${animate ? "" : "no-anim"}`.trim();
}

function roleTone(role) {
  if (role === "candidate") return "tone-applicant";
  if (role === "panel") return "tone-panel";
  return "";
}

function copyLabel(role) {
  if (role === "candidate") return "Applicant copy";
  if (role === "panel") return "Panel copy";
  return "Employer copy";
}

function activeName(id) {
  return gameState.players.find((player) => player.id === id)?.name || "A player";
}

function scoreLine() {
  return `${gameState.players.map((player) => `${escapeHtml(player.name)} ${player.score}`).join(" · ")} Offers`;
}

function gameHeader(rightLabel) {
  const { role } = gameState.self;
  const { settings, roundNumber } = gameState;
  return `
    <div class="sheet-head">
      <span class="l">Interview record · ${copyLabel(role)}</span>
      ${headActions()}
    </div>
    <div class="sheet-sub">
      <span class="l">Round ${roundNumber} of ${settings.rounds} · ${escapeHtml(settings.difficulty)}</span>
      <span class="l">${rightLabel ?? scoreLine()}</span>
    </div>`;
}

function positionStrip() {
  const { role } = gameState.self;
  const job = gameState.active?.job;
  if (role === "interviewer" && job) {
    return `
      <div class="record-strip">
        <div><div class="l">Position being filled</div><div class="t job">${escapeHtml(job.title)}</div></div>
        <div class="stamp-small">Don't say it</div>
      </div>`;
  }
  const side = role === "candidate" ? "You guess<br>it later" : "Secret<br>this round";
  return `
    <div class="record-strip">
      <div><div class="l">Position applied for</div><span class="redact" role="img" aria-label="Blacked out"></span></div>
      <span class="l" style="text-align:right">${side}</span>
    </div>`;
}

function exchangeRow(item, index) {
  const answer = item.answer?.trim()
    ? `<p class="t a">${escapeHtml(item.answer)}</p>`
    : `<p class="t a none">No answer given.</p>`;
  return `
    <div class="exchange">
      <span class="n">${index + 1}</span>
      <div class="body"><p class="t q">${escapeHtml(item.question)}</p>${answer}</div>
    </div>`;
}

function transcriptRows() {
  return (gameState.active?.transcript || []).map(exchangeRow).join("");
}

function blankRows(from) {
  let rows = "";
  for (let number = from; number <= 5; number += 1) {
    rows += `<div class="blank" aria-hidden="true"><span class="n">${number}</span></div>`;
  }
  return rows;
}

function timerMarkup(label, total = 30) {
  if (!gameState.deadline) return "";
  return `
    <div class="timer" data-countdown data-total="${total}" data-format="clock" role="timer" aria-label="${total} seconds remaining">
      <div class="timer-top"><span class="l">${label}</span><span class="t timer-value" data-timer-value>0:${String(total).padStart(2, "0")}</span></div>
      <div class="timer-track"><div class="timer-fill" data-timer-bar></div></div>
    </div>`;
}

function hintSlip(note = "") {
  const hint = gameState.active?.hint;
  if (!hint) return "";
  return `<div class="hint-slip"><span class="l">Hint used</span><span class="t word">${escapeHtml(hint)}</span>${note ? `<span class="l">${note}</span>` : ""}</div>`;
}

function hintButton() {
  return gameState.active?.canUseHint ? '<button class="btn btn-secondary grow-less" id="useHint" type="button">Use hint</button>' : "";
}

function hintNote() {
  return gameState.active?.canUseHint ? '<p class="t small">A hint is one word, once per game. It costs 2 Offers if your guess is right.</p>' : "";
}

/* ---------- home ---------- */

function renderHome(errorMessage) {
  clearInterval(countdownInterval);
  document.title = "You're Hired?";
  app.innerHTML = `
    <section class="${sheetClass("home", "sheet-wide")}" aria-labelledby="homeTitle">
      <div class="sheet-head">
        <span class="l">Sign-in sheet</span>
        <span class="l"><span class="wide-only">A bluffing game for </span>2 to 8 players · No login</span>
      </div>

      <div class="home-grid">
        <div class="home-title">
          <div class="lockup">
            <h1 class="stamp" id="homeTitle">You're<br>Hired<span class="sr-only">?</span></h1>
            <span class="qmark" aria-hidden="true">?</span>
          </div>
          <p class="t lede">One player interviews. The other bluffs through an interview for a job they can't see, then guesses what it is.</p>
        </div>

        <form class="home-form" id="entryForm">
          <div class="field">
            <label class="l" for="displayName">1 · Your name</label>
            <input class="input" id="displayName" maxlength="24" autocomplete="nickname" placeholder="Type your name" required />
          </div>
          <button class="btn btn-primary" id="createButton" type="button" style="margin-top:14px">Create room</button>
          <div class="l or-rule" style="margin-top:22px">or join a friend's room</div>
          <div class="field" style="margin-top:16px">
            <label class="l" for="roomCode">2 · Room code, 4 letters</label>
            <div class="code-row">
              <input class="input comb" id="roomCode" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD" />
              <button class="btn btn-secondary" id="joinButton" type="submit">Join</button>
            </div>
          </div>
        </form>

        <div class="home-rules">
          <div class="l">How a round works</div>
          <ol class="t">${ROUND_RULES.map((rule) => `<li>${rule}</li>`).join("")}</ol>
        </div>
      </div>

      <div class="l" style="margin-top:36px;padding-bottom:6px;border-bottom:2px solid var(--navy)">Every player gets a copy. The colour tells you your role.</div>
      <div class="copies">
        <div class="copy-card"><div class="l">White · Interviewer</div><div class="t">Position: <b>Lighthouse Keeper</b></div></div>
        <div class="copy-card yellow"><div class="l">Yellow · Candidate</div><div class="t">Position: <span class="redact" role="img" aria-label="Blacked out"></span></div></div>
        <div class="copy-card pink"><div class="l">Pink · Panel, watching</div><div class="t">Position: <span class="redact" role="img" aria-label="Blacked out"></span></div></div>
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

/* ---------- router ---------- */

function render() {
  if (!gameState) return renderHome();
  const keep = captureTyping();
  if (gameState.phase === "lobby") renderLobby();
  else renderGame();
  restoreTyping(keep);
  renderReconnectOverlay();
  startCountdown();
}

// A state update (say, a player reconnecting) redraws the sheet; keep a half-typed question.
function captureTyping() {
  const input = document.querySelector("#questionInput");
  if (!input) return null;
  return {
    key: `${gameState?.roundNumber}-${gameState?.active?.questionNumber}`,
    value: input.value,
    focused: document.activeElement === input,
  };
}

function restoreTyping(keep) {
  const input = document.querySelector("#questionInput");
  if (!keep || !input || keep.key !== `${gameState.roundNumber}-${gameState.active?.questionNumber}`) return;
  input.value = keep.value;
  if (keep.focused) input.focus();
}

/* ---------- lobby ---------- */

function choiceGroup(name, legend, values, current, enabled) {
  return `
    <fieldset class="choice">
      <legend class="l">${legend}</legend>
      <div class="opts">${values.map((value) => `
        <label class="opt"><input type="radio" name="${name}" value="${value}" ${String(current) === String(value) ? "checked" : ""} ${enabled ? "" : "disabled"} /><span class="box" aria-hidden="true"></span>${value}</label>`).join("")}
      </div>
    </fieldset>`;
}

function renderLobby() {
  const { code, players, settings, self } = gameState;
  const host = players.find((player) => player.isHost);
  const connectedCount = players.filter((player) => player.connected).length;
  document.title = `Room ${code} · You're Hired?`;

  let seats = "";
  for (let index = 0; index < 8; index += 1) {
    const player = players[index];
    if (!player) {
      seats += `<div class="seat"><span class="n">${index + 1}</span></div>`;
      continue;
    }
    const isSelf = player.id === self.id;
    const tags = [];
    if (player.isHost) tags.push("Hiring Manager");
    if (isSelf) tags.push("You");
    if (!player.connected) tags.push('<span class="offline">Reconnecting</span>');
    else if (!tags.length) tags.push("Ready");
    seats += `<div class="seat"><span class="n">${index + 1}</span><span class="t name">${escapeHtml(player.name)}</span><span class="l">${tags.join(" · ")}</span></div>`;
  }

  let footNote = `${escapeHtml(host?.name || "The Hiring Manager")} picks the settings and starts the game.`;
  if (self.isHost) footNote = connectedCount < 2 ? "Send the code to a friend. You need 2 players to start." : "Only the Hiring Manager can change these.";

  app.innerHTML = `
    <section class="${sheetClass("lobby")}" aria-label="Waiting room">
      <div class="sheet-head"><span class="l">Waiting room</span>${headActions()}</div>

      <div class="code-banner">
        <div>
          <div class="l">Room code · share it</div>
          <div class="room-code" aria-label="Room code ${escapeHtml(code.split("").join(" "))}">${escapeHtml(code)}</div>
        </div>
        <button class="btn btn-secondary btn-small" id="copyCode" type="button" style="margin-bottom:8px">Copy code</button>
      </div>

      <div class="section-head"><span class="l">Players signed in</span><span class="l">${players.length} of 8 seats</span></div>
      ${seats}

      ${choiceGroup("difficulty", "Difficulty", ["Easy", "Hard", "Mixed"], settings.difficulty, self.isHost)}
      ${choiceGroup("rounds", "Rounds", [2, 4, 6, 8], settings.rounds, self.isHost)}

      <div class="lobby-rules" style="margin-top:20px;padding-top:12px;border-top:1px solid var(--navy)">
        <div class="l">How to play</div>
        <ol class="t">${ROUND_RULES.map((rule) => `<li>${rule}</li>`).join("")}</ol>
      </div>

      <div class="push" style="padding-top:20px">
        ${self.isHost
          ? `<button class="btn btn-primary" id="startGame" type="button" style="width:100%" ${connectedCount < 2 ? "disabled" : ""}>Start interviews</button>`
          : `<div class="btn btn-secondary" aria-hidden="true" style="width:100%;cursor:default">Waiting for ${escapeHtml(host?.name || "host")}<span class="dots"></span></div>`}
        <p class="t foot-note">${footNote}</p>
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
    const updateSettings = () => {
      const difficulty = document.querySelector('input[name="difficulty"]:checked')?.value;
      const rounds = Number(document.querySelector('input[name="rounds"]:checked')?.value);
      emitWithReply("updateSettings", { difficulty, rounds });
    };
    document.querySelectorAll('input[name="difficulty"], input[name="rounds"]').forEach((input) => {
      input.addEventListener("change", updateSettings);
    });
    document.querySelector("#startGame").addEventListener("click", () => emitWithReply("startGame"));
  }
}

/* ---------- game screens ---------- */

function renderGame() {
  const phase = gameState.phase;
  document.title = phase === "gameover" ? "Final scores · You're Hired?" : `Round ${gameState.roundNumber} · You're Hired?`;
  if (phase === "role") renderRole();
  else if (phase === "question") renderQuestion();
  else if (phase === "answer") renderAnswer();
  else if (phase === "guess") renderGuess();
  else if (phase === "result") renderResult();
  else if (phase === "gameover") renderGameOver();
}

function gameSheet(content, keySuffix = "play") {
  const { role } = gameState.self;
  const key = `round-${gameState.roundNumber}-${role}-${keySuffix}`;
  return `<section class="${sheetClass(key, roleTone(role))}" aria-label="Interview record">${content}</section>`;
}

function renderRole() {
  const { role } = gameState.self;
  const { active } = gameState;
  const interviewer = escapeHtml(activeName(active.interviewerId));
  const candidate = escapeHtml(activeName(active.candidateId));
  let body;

  if (role === "interviewer") {
    body = `
      <div class="l" style="margin-top:30px">Your role this round</div>
      <h1 class="display role-title">You're the<br>Interviewer</h1>
      <div class="record" style="margin-top:26px">
        <div class="l">Position being filled</div>
        <div class="t record-title">${escapeHtml(active.job.title)}</div>
        <div class="t small" style="margin-top:8px">${escapeHtml(active.job.difficulty)}</div>
        <div class="stamp-big">Don't say it</div>
      </div>
      <div class="l" style="margin-top:42px">What ${candidate} sees · Applicant copy</div>
      <div class="record" style="margin-top:8px;background:var(--yellow)">
        <div class="l">Position applied for</div>
        <span class="redact" role="img" aria-label="Blacked out"></span>
      </div>
      <p class="t" style="margin-top:14px;font-size:15px">${candidate} has to answer as if they already do this job. Ask up to 5 questions without giving it away.</p>`;
  } else if (role === "candidate") {
    body = `
      <div class="l" style="margin-top:30px">Your role this round</div>
      <h1 class="display role-title">You're in the<br>hot seat</h1>
      <div class="record" style="margin-top:26px">
        <div class="l">Position applied for</div>
        <span class="redact" role="img" aria-label="Blacked out"></span>
      </div>
      <p class="t" style="margin-top:16px;font-size:15px">${interviewer} knows the job. You don't. Answer every question as if you already do it, then guess what it is. You can guess early.</p>`;
  } else {
    body = `
      <div class="l" style="margin-top:30px">Your role this round</div>
      <h1 class="display role-title">You're on<br>the Panel</h1>
      <div class="record" style="margin-top:26px">
        <div class="l">Position applied for</div>
        <span class="redact" role="img" aria-label="Blacked out"></span>
      </div>
      <p class="t" style="margin-top:16px;font-size:15px">Watch ${interviewer} interview ${candidate}. The job stays secret from you too.</p>`;
  }

  app.innerHTML = gameSheet(`
    ${gameHeader()}
    ${body}
    <div class="push" data-countdown data-total="3" data-format="seconds" style="padding-top:24px;display:flex;flex-direction:column;gap:10px">
      <span class="countdown-bar"><span data-timer-bar></span></span>
      <span class="l" data-timer-value>Interview starts in a moment</span>
    </div>`, "role");
}

function renderQuestion() {
  const { role } = gameState.self;
  const { active } = gameState;
  const interviewer = escapeHtml(activeName(active.interviewerId));
  const candidate = escapeHtml(activeName(active.candidateId));
  const number = active.questionNumber;
  let sectionLabel = `Questions from ${interviewer}`;
  let activeRow;

  if (role === "interviewer") {
    sectionLabel = `Questions asked of ${candidate}`;
    activeRow = `
      <form class="active-row" id="questionForm">
        <span class="n">${number}</span>
        <div class="stack">
          <label class="l" for="questionInput">Your next question</label>
          <input class="input" id="questionInput" maxlength="240" placeholder="Type question ${number}" autocomplete="off" required />
          <button class="btn btn-primary" type="submit">Ask ${candidate}</button>
        </div>
      </form>`;
  } else if (role === "candidate") {
    activeRow = `
      <div class="active-row">
        <span class="n">${number}</span>
        <div class="stack">
          <p class="t waiting-line">Waiting for ${interviewer}'s question<span class="dots"></span></p>
          ${hintSlip()}
          <div class="btn-row">
            ${active.transcript.length ? '<button class="btn btn-primary grow" id="makeGuess" type="button">Guess now</button>' : ""}
            ${hintButton()}
          </div>
          ${active.transcript.length ? '<p class="t small">Guessing early earns more Offers if you\'re right.</p>' : ""}
          ${hintNote()}
        </div>
      </div>`;
  } else {
    sectionLabel = `${interviewer} interviews ${candidate}`;
    activeRow = `
      <div class="active-row">
        <span class="n">${number}</span>
        <div class="stack"><p class="t waiting-line">${interviewer} is choosing question ${number}<span class="dots"></span></p></div>
      </div>`;
  }

  const presets = role === "interviewer" ? `
    <div class="l" style="margin-top:18px">Stuck? Tap one to fill it in</div>
    <div class="presets">${gameState.presets.map((question) => `<button class="pre" type="button" data-preset="${escapeHtml(question)}">${escapeHtml(question)}</button>`).join("")}</div>` : "";

  app.innerHTML = gameSheet(`
    ${gameHeader()}
    ${positionStrip()}
    <div class="section-head"><span class="l">${sectionLabel}</span><span class="l">${number} of 5</span></div>
    ${transcriptRows()}
    ${activeRow}
    ${blankRows(number + 1)}
    ${presets}`);
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
  const interviewer = escapeHtml(activeName(active.interviewerId));
  const candidate = escapeHtml(activeName(active.candidateId));
  const number = active.questionNumber;
  const asked = `<p class="t asked">${escapeHtml(active.pendingQuestion)}</p>`;
  let activeRow;
  let timerLabel = `Time left for ${candidate}`;
  let sectionLabel = role === "interviewer" ? `Questions asked of ${candidate}` : `Questions from ${interviewer}`;

  if (role === "candidate") {
    timerLabel = "Time left to answer";
    activeRow = `
      <form class="active-row" id="answerForm">
        <span class="n">${number}</span>
        <div class="stack">
          ${asked}
          <label class="l" for="answerInput" style="margin-top:2px">Your answer · bluff it</label>
          <textarea class="t ruled" id="answerInput" maxlength="400" placeholder="Answer like you do this job" autofocus>${escapeHtml(active.draft || "")}</textarea>
          ${hintSlip()}
          <div class="btn-row"><button class="btn btn-primary grow" type="submit">Submit answer</button>${hintButton()}</div>
          ${hintNote()}
        </div>
      </form>`;
  } else {
    if (role === "panel") sectionLabel = `${interviewer} interviews ${candidate}`;
    activeRow = `
      <div class="active-row">
        <span class="n">${number}</span>
        <div class="stack">${asked}<p class="t waiting-line">${candidate} is answering<span class="dots"></span> It sends by itself when time runs out.</p></div>
      </div>`;
  }

  app.innerHTML = gameSheet(`
    ${gameHeader()}
    ${positionStrip()}
    ${timerMarkup(timerLabel)}
    <div class="section-head" style="margin-top:16px"><span class="l">${sectionLabel}</span><span class="l">${number} of 5</span></div>
    ${transcriptRows()}
    ${activeRow}
    ${blankRows(number + 1)}`);

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
  const candidate = escapeHtml(activeName(active.candidateId));
  const count = active.transcript.length;
  let body;

  if (role === "candidate") {
    body = `
      ${timerMarkup("Time left to guess")}
      <h1 class="display" style="margin-top:22px;font-size:48px;line-height:0.95">What's the job?</h1>
      <form class="field" id="guessForm" style="margin-top:14px">
        <label class="l" for="guessInput">Position applied for · One guess only</label>
        <input class="input guess-input" id="guessInput" maxlength="120" placeholder="Type the job title" autocomplete="off" value="${escapeHtml(active.draft || "")}" autofocus required />
        ${hintSlip("Costs 2 Offers if right")}
        <div class="btn-row" style="margin-top:6px"><button class="btn btn-primary grow" type="submit">Submit guess</button>${hintButton()}</div>
        ${hintNote()}
      </form>
      <div class="section-head" style="margin-top:22px"><span class="l">What was asked, what you said</span><span class="l">${count} of 5</span></div>`;
  } else {
    const line = role === "interviewer"
      ? "One guess. If it's right, you both earn Offers."
      : "One guess and 30 seconds.";
    body = `
      ${positionStrip()}
      ${timerMarkup(`Time left for ${candidate}`)}
      <h1 class="display" style="margin-top:22px;font-size:44px;line-height:0.95">${candidate} is guessing<span class="dots"></span></h1>
      <p class="t" style="margin-top:10px;font-size:15px">${line}</p>
      <div class="section-head" style="margin-top:22px"><span class="l">The interview so far</span><span class="l">${count} of 5</span></div>`;
  }

  app.innerHTML = gameSheet(`
    ${gameHeader()}
    ${body}
    ${transcriptRows() || '<p class="t small muted" style="padding:10px 0">No questions were asked.</p>'}`);

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
  const { active, self, players, settings, roundNumber } = gameState;
  const { result } = active;
  const interviewer = escapeHtml(activeName(active.interviewerId));
  const candidate = escapeHtml(activeName(active.candidateId));
  const canAdvance = [active.interviewerId, active.candidateId].includes(self.id);
  const isLastRound = roundNumber >= settings.rounds;
  const questions = `${result.questionCount} ${result.questionCount === 1 ? "question" : "questions"}`;

  let guessLine;
  if (result.timedOut) guessLine = `${candidate} ran out of time after ${questions}.`;
  else if (result.guess) guessLine = `${candidate} guessed “${escapeHtml(result.guess)}” after ${questions}.`;
  else guessLine = `${candidate} didn't guess.`;

  const stamp = result.correct
    ? '<div class="stamp stamp-thud" role="img" aria-label="You\'re Hired!">You\'re<br>Hired</div>'
    : '<div class="stamp stamp-red stamp-thud" role="img" aria-label="We\'ll be in touch.">We\'ll be<br>in touch</div>';

  const earnings = result.earnings.map((earning) => {
    const total = players.find((player) => player.id === earning.id)?.score ?? earning.offers;
    const label = earning.id === active.interviewerId ? "Interviewer" : "Candidate";
    return `<div class="earn-row t"><span class="who">${escapeHtml(earning.name)} <span class="l">${label}</span></span><span class="nums"><b>+${earning.offers}</b><span>${total}</span></span></div>`;
  }).join("");

  let footNote = "That was the last round.";
  if (!isLastRound) footNote = players.length === 2 ? `Roles swap. ${candidate} interviews ${interviewer} next.` : "Roles swap next round.";

  app.innerHTML = gameSheet(`
    ${gameHeader("Round over")}
    <div class="record" style="margin-top:18px">
      <div class="l">The job was · Now on file</div>
      <div class="t record-title">${escapeHtml(result.jobTitle)}</div>
      <div class="t" style="margin-top:10px;font-size:15px">${guessLine}</div>
    </div>
    <div class="result-stage">${stamp}</div>
    <div class="section-head" style="margin-top:0"><span class="l">Offers earned this round</span><span class="l">Total</span></div>
    ${earnings}
    <div class="push" style="padding-top:24px">
      ${canAdvance
        ? `<button class="btn btn-primary" id="nextRound" type="button" style="width:100%">${isLastRound ? "See final scores" : "Next round"}</button>`
        : `<div class="btn btn-secondary" aria-hidden="true" style="width:100%;cursor:default">Waiting for ${interviewer} or ${candidate}</div>`}
      <p class="t foot-note">${footNote}</p>
    </div>`, "result");

  document.querySelector("#nextRound")?.addEventListener("click", () => emitWithReply("nextRound"));
  const confettiKey = `${roundNumber}-${result.jobTitle}`;
  if (result.correct && lastConfettiKey !== confettiKey) {
    lastConfettiKey = confettiKey;
    launchConfetti();
  }
}

function renderGameOver() {
  const { players, settings, self } = gameState;
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const topScore = sorted[0]?.score ?? 0;
  const winners = sorted.filter((player) => player.score === topScore);
  const others = sorted.filter((player) => player.score !== topScore);
  const winnerNames = winners.map((player) => escapeHtml(player.name));
  const tied = winners.length > 1;

  let letter = tied
    ? `You tied for the most Offers after ${settings.rounds} rounds.`
    : `Most Offers after ${settings.rounds} rounds.`;
  if (others.length) letter += ` ${listNames(others.map((player) => escapeHtml(player.name)))}, we'll keep your details on file.`;

  const standings = sorted.map((player, index) => {
    const rank = sorted.findIndex((entry) => entry.score === player.score) + 1;
    const isSelf = player.id === self.id ? ' <span class="sr-only">(you)</span>' : "";
    return `<div class="standing ${player.score === topScore ? "winner" : ""}" style="--i:${index}"><span class="rank">${rank}</span><span class="t name">${escapeHtml(player.name)}${isSelf}</span><span class="t score">${player.score}</span></div>`;
  }).join("");

  const key = `gameover-${settings.rounds}`;
  app.innerHTML = `
    <section class="${sheetClass(key)}" aria-label="Final scores">
      <div class="sheet-head">
        <span class="l">Hiring decision · Final</span>
        <span class="l">${settings.rounds} rounds · ${escapeHtml(settings.difficulty)}</span>
      </div>
      <div class="t dear">Dear ${listNames(winnerNames)},</div>
      <div class="final-stage"><h1 class="stamp stamp-thud">You're<br>Hired</h1></div>
      <p class="t" style="font-size:15px">${letter}</p>

      <div class="section-head" style="margin-top:26px"><span class="l">Final standings</span><span class="l">Offers</span></div>
      ${standings}

      <div class="push" style="padding-top:24px">
        <div class="btn-row">
          <button class="btn btn-primary grow" id="playAgain" type="button">Play again</button>
          <button class="btn btn-secondary grow-less" id="leaveGame" type="button">Leave</button>
        </div>
        <p class="t foot-note">Play again keeps the room and the same players.</p>
      </div>
    </section>`;

  document.querySelector("#playAgain").addEventListener("click", () => emitWithReply("playAgain"));
  document.querySelector("#leaveGame").addEventListener("click", leaveCurrentRoom);
}

/* ---------- overlays ---------- */

function renderSessionReplaced() {
  clearInterval(countdownInterval);
  setConnectionStatus(false, "Opened in another tab");
  document.querySelector(".overlay")?.remove();
  const overlay = document.createElement("div");
  overlay.className = "overlay session-replaced-overlay";
  overlay.innerHTML = `
    <div class="overlay-card" role="alertdialog" aria-labelledby="movedTitle">
      <div class="sheet-head"><span class="l">Session moved</span></div>
      <h2 class="display" id="movedTitle">This game is open in another tab</h2>
      <p class="t">Only one tab can control this player at a time.</p>
      <button class="btn btn-primary" id="useThisTab" type="button">Use this tab instead</button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#useThisTab").addEventListener("click", async () => {
    const session = storage.get();
    if (!session) {
      sessionWasReplaced = false;
      gameState = null;
      overlay.remove();
      setConnectionStatus(true);
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
      setConnectionStatus(true);
      renderHome(response.error);
    } else {
      setConnectionStatus(true);
    }
  });
}

function renderReconnectOverlay() {
  document.querySelector(".overlay")?.remove();
  if (!gameState.waitingForNames?.length || gameState.phase === "gameover") return;
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="overlay-card" role="alertdialog" aria-labelledby="waitTitle">
      <div class="sheet-head"><span class="l">Interview paused</span></div>
      <h2 class="display" id="waitTitle">Waiting for ${escapeHtml(listNames(gameState.waitingForNames))} to reconnect<span class="dots"></span></h2>
      <p class="t">The timer is paused and their seat is saved for 60 seconds.</p>
      ${gameState.canEndGame ? '<button class="btn btn-primary" id="endGame" type="button">End game and show scores</button>' : ""}
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#endGame")?.addEventListener("click", () => emitWithReply("endGame"));
}

/* ---------- timers & confetti ---------- */

function startCountdown() {
  clearInterval(countdownInterval);
  const update = () => {
    const timer = document.querySelector("[data-countdown]");
    if (!timer || !gameState?.deadline) return;
    const totalMs = Number(timer.dataset.total || 30) * 1000;
    const remainingMs = Math.max(0, gameState.deadline - (Date.now() + clockDelta));
    const remaining = Math.ceil(remainingMs / 1000);
    const progress = Math.min(1, remainingMs / totalMs);
    const value = timer.querySelector("[data-timer-value]");
    const bar = timer.querySelector("[data-timer-bar]");
    if (timer.dataset.format === "clock") {
      if (value) value.textContent = `0:${String(remaining).padStart(2, "0")}`;
      timer.classList.toggle("urgent", remaining < 10);
      timer.setAttribute("aria-label", `${remaining} seconds remaining`);
    } else if (value) {
      value.textContent = remaining > 0 ? `Interview starts in ${remaining} ${remaining === 1 ? "second" : "seconds"}` : "Interview starting";
    }
    if (bar) bar.style.width = `${progress * 100}%`;
  };
  update();
  countdownInterval = setInterval(update, 250);
}

function launchConfetti() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const layer = document.createElement("div");
  const colors = ["#1B2B6F", "#C8281C", "#FFF3A3", "#F8D3DA", "#FFFFFF"];
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
