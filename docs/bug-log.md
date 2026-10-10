# Bug log (for the Handshake submission description)

## Playtest 1 — 2026-10-10, Claude in Chrome, two tabs (localhost + player2.localhost)

Worked: create/join, lobby, role swap, preset + typed questions, forbidden-word rejection,
30 s answer timer with auto-submit of the draft, hint (one word, -2 payout), early guess,
alias matching ("Fitness Coach" for personal trainer), exact scoring (+4/+2, then +2/+0),
"You're Hired!" confetti, "We'll be in touch.", refresh mid-round restores role, Co-hired tie,
Play again returns both players to the lobby.

Found:
1. Opening the room in a second tab of the same browser silently takes over the player; the
   first tab shows "Live connection" but never receives updates again (host saw 1/8 seats
   and a disabled Start after the guest joined). Cause: attachPlayerToSocket replaces
   socketId without disconnecting/notifying the old socket.
2. Final scoreboard header reads "Round 3 of 2".
3. Tied players are ranked #1 and #2 under "Co-hired!".
4. On the last round the result screen button says "Next round" instead of "See final results".
5. While the Candidate answers, the Interviewer's screen hides the secret job.
6. Phone-width layout not verified in this playtest (window resize unavailable); has a 780px breakpoint.

## Fix pass 1 — 2026-10-10 (ChatGPT), re-verified in Chrome with two tabs + a same-session third tab
1. Fixed: second same-session tab now shows "This game is open in another tab" with "Use this tab instead"; control hands back and forth cleanly.
2. Fixed: final header reads "Final results".
3. Fixed: tied players both show #1 under "Co-hired!".
4. Fixed: last-round button reads "See final results".
5. Fixed: Interviewer keeps a "Secret job" chip during answer and guess phases.

## Fix pass 2 — 2026-10-10 (ChatGPT), verified in Chrome
7. Found after deploy: opening the live URL in a browser that had played before silently rejoined the old
   room, and there was no way to leave. Fixed: "Leave" button in the top bar and on the final screen
   (clears the saved session), host transfers to the next player if the host leaves the lobby, an active
   player leaving mid-game ends the game with the final scoreboard, empty rooms delete immediately, and
   auto-rejoin shows a "Rejoined room XXXX as Name" toast.
