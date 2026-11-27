# ChatGPT Work prompts for "You're Hired"

The game was called "You're Hired?" when these were sent; the prompts below are kept word for word.

Source of the starter prompt: Handshake mission page, Option B, step
"Use the starter prompt to kick off the conversation" (copied verbatim 2026-10-10).

## Message 1 — Handshake starter prompt (paste verbatim, in Work mode)

```
Design and build a real-time party game for 2–8 players joining by room code from their own device. Before building, talk me through:
- The overall game concept. Ask me if I have any initial ideas for favorite game types and work from there.
- Rules and scoring. How the gameplay happens, how it's scored, and when it's over.

Summarize the rules before building anything, so I can approve.
```

## Message 2 — rules spec (paste when ChatGPT asks for your game ideas)

```
I already have the full design worked out below. Please skip the open-ended brainstorming, read this spec, and reply with ONE summary of the rules and tech plan for me to approve. Ask at most 3 clarifying questions, only if something here is contradictory. Then we build.

=== YOU'RE HIRED? — GAME SPEC ===

CONCEPT
A 2-player bluffing/guessing game (2–8 supported, but designed and tested for exactly 2). Each round one player is the INTERVIEWER and the other is the CANDIDATE. The Interviewer secretly sees a job title. The Candidate does not know the job, but must answer interview questions as if they already have it. After the questions, the Candidate guesses the job. Roles swap every round. Points are called "Offers".
On-screen title: "You're Hired?" (with the question mark). Package/repo/URL name: youre-hired.

LOBBY ("Waiting Room")
- Home screen: enter a display name, then "Create room" or "Join room" with a 4-letter room code. No login, no install.
- The room creator is the host, labeled "Hiring Manager". The host picks: Difficulty (Easy / Hard / Mixed) and Rounds (2, 4, 6, 8; default 6). Start is enabled only with 2+ players.
- A "How to play" card is always visible in the lobby and reachable via a "?" button during the game. Text:
  1. Each round, one player interviews and one is in the hot seat.
  2. The Interviewer secretly sees a job and asks up to 5 questions. Don't say the job or give it away!
  3. The Candidate answers every question as if they already have the job, then guesses what it is.
  4. Correct guess: BOTH players earn Offers (more if you guess early). Wrong guess: only the Interviewer scores.
  5. Roles swap every round. Most Offers at the end wins.
- With 3–8 players: each round still has exactly one Interviewer and one Candidate; everyone else is the "Panel" and watches the round live (they see questions and answers but never the job). Rotate so every player gets both roles as evenly as possible. No extra Panel mechanics in v1.

ROUND FLOW
1. Role screen (3 s): "You're the Interviewer" / "You're in the hot seat". Interviewer also sees the job card (title + difficulty). The job is sent ONLY to the Interviewer's connection, never to anyone else.
2. Interviewer asks question 1 of 5: either type it, or tap one from a preset menu of ~15. The server rejects any question containing the job title or any of the job's forbidden keywords (case-insensitive) with "That gives it away — rephrase."
3. Candidate sees the question and types an answer with a 30-second timer. When the timer hits 0, whatever is typed is submitted (empty becomes "…").
4. Both players see the running transcript (Q&A list) and "Question X of 5".
5. After any answer, the Candidate may tap "Make my guess" (early guess). After the 5th answer the Candidate must guess. Guess is free text with a 30-second timer; timeout counts as wrong.
6. Optional "Job Hint" button on the Candidate's screen: reveals the job's one-word hint. Usable once per player per game. Using it reduces that player's payout for the round by 2 (minimum 1).
7. Guess checking: normalize (lowercase, strip punctuation and leading articles) and compare against the job title and its alias list. Match = correct.
8. Result screen, shown to everyone:
   - Correct: big "You're Hired!" with confetti; reveals the job and Offers earned.
   - Wrong: "We'll be in touch."; reveals the job and the guess.
   Either player taps "Next round" to continue (one tap advances everyone).
9. After the last round: "Final Offers" scoreboard with a winner banner; a tie shows "Co-hired!". "Play again" returns everyone to the same room's lobby.

SCORING ("Offers")
- Correct guess after Q questions (Q = 1..5): both Interviewer and Candidate earn (6 − Q) Offers. So a guess after 1 question = 5 each, after 5 = 1 each.
- Wrong guess or guess timeout: Interviewer earns 2 Offers, Candidate earns 0.
- Hint used: Candidate's payout that round is reduced by 2 (minimum 1). Interviewer's payout is unaffected.
- Scoreboard is visible during the game, labeled "Offers".

PRESET QUESTIONS (Interviewer tap-to-ask menu, ~15)
What does a typical day look like? / What's the hardest part of this job? / What tools or equipment do you use most? / Who do you interact with most? / What hours do you work? / What would get you fired? / What's your proudest moment in this role? / What do you wear to work? / Where do you physically do this job? / What skill matters most here? / How did you train for this? / What's the biggest misconception about your job? / What's the worst thing that can go wrong? / What do you do when things get busy? / Why should we hire you?

JOB POOL
Each job has: title, difficulty, aliases (accepted alternate guesses), forbidden keywords (words the Interviewer can't use), hint (one word). No job repeats within a match. Provide at least 40 Easy and 40 Hard. Include career-themed jobs. Seed examples:
- Easy: firefighter, dentist, high school math teacher, software engineer at a startup, UX designer, barista, airline pilot, wedding DJ, night-shift nurse, real estate agent, chef, librarian, mail carrier, lifeguard, veterinarian, taxi driver, personal trainer.
- Hard: cruise ship magician, professional mattress tester, TA for a discrete math class, zookeeper for penguins, crime scene cleaner, professional line-stander, food stylist, golf ball diver, voice actor for cartoons, escape room designer, wind turbine technician, ethical hacker, snake milker, fortune cookie writer, court sketch artist, ice sculptor.

TIMERS AND EDGE CASES
- All timers are server-authoritative; clients just display the countdown.
- Reconnect: the client stores the room code and a player token in localStorage. On refresh or reconnect, it rejoins the same room with the same name, role, and score, and the server resends the full current state. The server keeps a disconnected player's slot for 60 seconds, pauses the active timer, and shows the others "Waiting for <name> to reconnect…". If they don't return in 60 s the host can tap "End game", which shows the scoreboard.
- Empty rooms are deleted after 10 minutes. Room codes avoid ambiguous letters (no I, O, 0, 1).
- The server validates every action (correct role, correct phase, question count, timer) and ignores invalid ones. Clients never decide game outcomes.

TECH REQUIREMENTS (non-negotiable)
- Node.js server: Express serving static files + Socket.IO for real-time. In-memory room store, no database, no API keys, no required env vars other than PORT.
- The server must read process.env.PORT (fallback 3000) and bind to 0.0.0.0. It will be deployed to Railway from a GitHub repo, so: `npm start` must run the server, and if there is any build step, `npm run build` must exist and `npm start` must serve the built output.
- Do NOT convert this to Netlify Functions / Blobs or ChatGPT Sites. Keep the single long-running server.
- Keep the project in one folder with a standard layout (package.json at root, server file, public/ or client/ for the frontend). Plain HTML/CSS/JS is fine; keep dependencies minimal.
- Mobile-first layout: every screen must be usable at phone width with big tap targets; two players will test on a laptop and a phone.
- Style: a "waiting room / corporate interview" mood with playful copy, but game logic first; we'll restyle later.

BUILD ORDER
1. Rooms + lobby + reconnect. 2. Full round loop with scoring for 2 players. 3. Job pool, hint, forbidden-word check, result screens with confetti. 4. 3–8 player rotation + Panel view. 5. Polish.
Get it running locally and give me the localhost URL to test in two browser windows.
=== END SPEC ===
```

## Message 3 — first build (mission's own prompt, use after approving the summary)

```
Go ahead and build the game we designed. Get the core loop working first so that I can test it locally, then we'll polish.

Get the game running at a local address and give me the URL I can paste into my browser to test.
```

## Bug report template (mission's own format)

```
When I did [what you did, and in which window], I expected [what should have happened], but instead [what happened]. Can you fix that? Keep the change small.
```
