# You're Hired? — project context

## What this is
A 2-player (2–8 supported) real-time multiplayer guessing game built for the Handshake
"Create a Multiplayer Game" challenge. Deadline: submit on Handshake by **October 31, 2026**
(chance to win $1,000; must check "Share to Showcase" on the submit form).

Mission page: https://app.joinhandshake.com/learn/create-a-multiplayer-game-8d7d59b5/mission_step_cmssgy0di000y1ztkbjrpbt5r

## Hard requirements (from Handshake)
1. At least two players can join from separate devices (room code, no login, no install).
2. The game has real rules a new player can follow without explanation (show a "How to play" card in the lobby).
3. It is live at a public URL anyone can reach.

Reviewers will test with exactly 2 devices, so the game must be fun and complete with 2 players.

## Game design: "You're Hired?"
- Roles: one player is the **Interviewer**, the other is the **Candidate**. Roles swap every round.
- The Interviewer secretly sees a job (e.g. "wedding DJ", "cruise ship magician", "night-shift nurse").
  The Candidate's screen just says "You're in the hot seat".
- The Interviewer asks up to **5 questions** (typed, or tap from a menu of ~15 preset questions).
  They may not say the job name or obvious keywords.
- The Candidate answers each as if they already have the job (bluffing), then makes **one guess** at the end
  (may guess early).
- Scoring (shared, so the Interviewer is motivated to ask good questions):
  - Correct guess: both players score. Guessing early (fewer questions used) gives a bonus.
  - Wrong guess: Interviewer scores.
  - Optional "Job Hint" button: Candidate gets a one-word clue once per game at a point cost.
- Round result screens: correct = **"You're Hired!"** (confetti); wrong = **"We'll be in touch."**
- Scoreboard label: "Offers" instead of points. Lobby styled as a waiting room; host = "Hiring Manager".
- Difficulty picker: Easy (common jobs), Hard (weird jobs like "professional mattress tester").
  Include career-themed jobs too (software engineer at a startup, UX designer, high school math teacher, TA for a discrete math class).
- 30-second timer per answer. Best of N rounds (default 6, so each player interviews 3 times).
- Handle refresh/reconnect: a player who reloads rejoins the same room and role.

## Naming
- On-screen title: **You're Hired?** (with the question mark).
- URLs, package name, repo, file names: `youre-hired` (no punctuation).

## Build workflow (agreed with Sathvik)
- Per the Handshake mission, **ChatGPT Work mode** does the design conversation and the build
  (newest full-size model; standard thinking for design, extended/heavy thinking for build and debug; one conversation for the whole project).
- Claude Code's role: write the rules spec Sathvik pastes into ChatGPT, review ChatGPT's design summary
  before approval, turn bugs found in testing into precise fix prompts (format: "When I did X in window Y,
  I expected Z, but instead W. Fix it, keep the change small."), manage git, and deploy to Railway.
- Testing: two browser windows (one normal, one Incognito) or laptop + phone, as host and player.
- If ChatGPT gets stuck or the user asks, Claude Code may build or fix code directly in this repo.

## Hosting
- Code lives in this folder. GitHub: https://github.com/Sathvik609/youre-hired (private; gh CLI logged in as Sathvik609).
- Deploy target: **Railway** from the GitHub repo (real server, websockets OK). Prefer Node + Express + Socket.IO
  (or ws) with an in-memory room store. Server must read `PORT` from env and bind 0.0.0.0.
- Netlify is a fallback only (Handshake's Netlify Functions + Blobs prompt exists if ever needed).
- Railway: project "youre-hired" (id 79751b7e-79c0-40f5-9823-e8fe73b3ec3a) in workspace "Sathvik Projects", service "youre-hired", auto-deploys from GitHub main.
- Live URL: https://youre-hired-production.up.railway.app

## Submission checklist (Handshake submit page)
- Project title, live link, cover screenshot (3:2, at least 1200px wide), description (max 500 chars:
  what was challenging, fun, learned, next steps), check "Share to Showcase".
- Keep a running list of bugs hit and how they were described/fixed, for the description.

## Git
- Repo-local identity is set. Commit messages end with: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`
- Commit after each working milestone; push to main.

## Status (as of 2026-10-10)
- Game is complete and LIVE at https://youre-hired-production.up.railway.app (Railway auto-deploys from GitHub main; last deploy = commit 2b6fc4c).
- Built by ChatGPT Work in this folder: `server.js` (Express + Socket.IO, in-memory rooms), `gameLogic.js`, `jobs.js` (40 Easy + 40 Hard), `public/` (plain HTML/CSS/JS). `npm start` / `npm test` (6 tests pass).
- Done and verified by Claude in Chrome (two tabs): full 2-round games locally and on the live URL; scoring, hint, forbidden-word check, timers, reconnect, tab-takeover handoff, Leave room, host transfer, final/tie screens, Play again. See `docs/bug-log.md` for every bug found and fixed (use it for the Handshake description).
- Restyled as a dark game-show stage; copy simplified (no hype wording). Prompts used with ChatGPT are in `docs/chatgpt-prompts.md`.
- Testing trick: in Claude in Chrome open player 2 at http://player2.localhost:3000 (separate localStorage); on the live URL load the second tab before the first creates a room.

## Next steps
1. Sathvik: play once on phone + laptop with a friend at the live URL (phone layout is the only thing not verified by Claude).
2. Optional polish: preset question chips are a single horizontal scroll row on desktop; wrap them on wide screens.
3. Handshake submission (deadline Oct 31, 2026): title "You're Hired?", live link above, cover screenshot 3:2 ≥1200px wide (final "You're Hired!" confetti screen or the lobby works well), description ≤500 chars drafted from docs/bug-log.md, check "Share to Showcase".
