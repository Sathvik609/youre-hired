<p align="center"><img src="docs/img/banner.png" alt="You're Hired: a 2-player game. One player interviews the other, who has 5 questions to guess their secret job."></p>

<p align="center">
  <img alt="Node.js 20+" src="https://img.shields.io/badge/Node.js-20%2B-1B2B6F?logo=nodedotjs&logoColor=white">
  <img alt="Express 5" src="https://img.shields.io/badge/Express-5-1B2B6F?logo=express&logoColor=white">
  <img alt="Socket.IO 4" src="https://img.shields.io/badge/Socket.IO-4-1B2B6F?logo=socketdotio&logoColor=white">
  <img alt="Hosted on Railway" src="https://img.shields.io/badge/hosted%20on-Railway-1B2B6F?logo=railway&logoColor=white">
  <img alt="2 to 8 players" src="https://img.shields.io/badge/players-2%20to%208-C8281C">
  <img alt="No login, no install" src="https://img.shields.io/badge/no%20login-no%20install-C8281C">
</p>

<p align="center">
  <a href="#how-to-play">How to play</a> ·
  <a href="#scoring">Scoring</a> ·
  <a href="#screens">Screens</a> ·
  <a href="#run-it-yourself">Run it yourself</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#security">Security</a>
</p>

You're Hired is a real-time party game for two or more people on their own phones or laptops. One player is the **Interviewer** and can see a secret job, like *wedding DJ* or *TA for a discrete math class*. The other player is the **Candidate**, who can't see it. The Candidate answers every question as if they already have the job, then guesses what the job is. Roles swap every round.

Built for the Handshake "Create a Multiplayer Game" challenge. Play it at **<https://youre-hired-production.up.railway.app>**: one person creates a room and the other joins with the 4-letter code.

<p align="center"><img src="docs/img/home.png" width="860" alt="The sign-in sheet: type your name, create a room or join one with a 4-letter code, and read how a round works."></p>

## How to play

1. One player creates a room and becomes the **Hiring Manager** (the host). Everyone else joins with the 4-letter room code. No accounts, nothing to install.
2. Each round, one player is the **Interviewer** and one is the **Candidate**. With more than two players, everyone else sits on the **Panel** and watches.
3. The Interviewer sees the secret job and asks up to **5 questions**, either typed or picked from a list of 15. A question that names the job or an obvious keyword is blocked.
4. The Candidate has **30 seconds** per answer and bluffs as if they already have the job. They can guess at any point after the first answer.
5. Roles swap every round. After the last round, whoever has the most **Offers** wins.

Every player's screen is a paper copy in a different colour: **white** for the Interviewer, **yellow** for the Candidate, **pink** for the Panel.

## Scoring

| Outcome | Interviewer | Candidate |
| --- | --- | --- |
| Right guess after *n* questions | 6 − *n* Offers (at least 1) | 6 − *n* Offers (at least 1) |
| Right guess after using the hint | same as above | 2 fewer (at least 1) |
| Wrong guess, or time runs out | 2 Offers | 0 |

Because a right guess pays both players, the Interviewer wants to ask good questions. The **hint** is a one-word clue the Candidate can use once per game.

## Screens

<table>
  <tr>
    <td width="50%"><img src="docs/img/interviewer.png" alt="Interviewer's white copy: the secret job with a 'Don't say it' stamp, the questions so far, and a box for the next question."></td>
    <td width="50%"><img src="docs/img/candidate.png" alt="Candidate's yellow copy: the job is blacked out, a 30-second timer, the question, and a box for the answer."></td>
  </tr>
  <tr>
    <td align="center"><b>Interviewer</b> sees the job and asks</td>
    <td align="center"><b>Candidate</b> bluffs against the clock</td>
  </tr>
</table>

<p align="center"><img src="docs/img/hired.png" width="860" alt="Round result: the job was LEGO model builder, guessed after 2 questions, stamped 'You're Hired' with confetti and Offers for both players."></p>

## Game options

- **Difficulty:** Easy (40 everyday jobs such as firefighter or barista), Hard (40 odd ones such as professional mattress tester) or Mixed.
- **Rounds:** 2, 4, 6 or 8. The default is 6, so in a 2-player game each person interviews 3 times.
- **Reconnects:** reload the page or lose signal and you rejoin the same room and role. The timer pauses while an active player is away.

## Run it yourself

You need Node.js 20 or newer.

```bash
git clone https://github.com/Sathvik609/youre-hired.git
cd youre-hired
npm install
npm start          # http://localhost:3000
npm test           # game rules, a full 2-player round, and malformed-input checks
```

To play both sides on one computer, open `http://localhost:3000` in a normal window and in a private window. Each window keeps its own session.

## How it works

```
public/        index.html, app.js, styles.css   plain HTML, CSS and JS, no build step
server.js      Express + Socket.IO              rooms, turns, timers and reconnects, all in memory
gameLogic.js   rules                            guess matching, banned words, payouts, role rotation
jobs.js        content                          80 jobs, each with aliases, banned words and a hint
```

- The **server is the referee**. It holds the secret job, runs every timer and scores each round. Each player is sent only what their role may see, so the Candidate's browser never receives the job title.
- Each player gets a random session token, saved in the browser. On reload, the token puts them back in the same seat.
- There is no database. Empty rooms are cleared after 10 minutes.
- Deployed on Railway from `main`. The server reads `PORT` from the environment and binds `0.0.0.0`.

## Security

The game has no accounts, stores no personal data and keeps nothing on disk. It still runs on a public URL, so the server:

- checks every message it receives: anything that isn't the expected shape is rejected, and an error in one event can't crash the server
- caps messages at 16 KB, connections per IP, new rooms per IP per minute, events per second per connection, and the total number of rooms
- escapes all player text before showing it, and sends a strict Content-Security-Policy plus `nosniff`, `frame-ancestors 'none'` and `no-referrer` headers

Found a problem? See [SECURITY.md](SECURITY.md).

## Behind the build

The rules were written first, the game was built with ChatGPT and finished with Claude Code, and every bug found in two-browser playtests is in [docs/bug-log.md](docs/bug-log.md). The prompts used are in [docs/chatgpt-prompts.md](docs/chatgpt-prompts.md).
