# You're Hired?

A 2-player multiplayer guessing game. One player interviews the other for a secret job. The candidate must guess the job within 5 questions.

Built for the Handshake "Create a Multiplayer Game" challenge.

## Play

Live: https://youre-hired-production.up.railway.app

One player creates a room and shares the 4-letter code; the other joins from their own device. Rules are shown in the lobby.

## Run locally

```
npm install
npm start
```

Open http://localhost:3000 in two browser windows (one normal, one Incognito) to play as two people. `npm test` runs the test suite.

## Deploy

Node + Express + Socket.IO with in-memory rooms. The server reads `PORT` from the environment and binds `0.0.0.0`. Deployed on Railway from the GitHub `main` branch.
