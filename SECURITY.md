# Security

You're Hired is a small game with no accounts, no database and no stored personal data. Rooms live in server memory and are deleted when they empty out.

## Reporting a problem

Please report security issues privately through GitHub: open the **Security** tab of this repository and choose **Report a vulnerability**. Don't open a public issue for anything that could be used to break or take down the live game.

Include what you did, what happened, and what you expected. You'll get a reply as soon as possible.

## What the server protects against

- Malformed or oversized Socket.IO messages (every handler checks its input; messages are capped at 16 KB)
- Floods: limits on connections per IP, new rooms per IP per minute, events per second per connection, and total rooms
- Cross-site scripting: all player text is escaped before it is rendered, and pages are served with a strict Content-Security-Policy
- Clickjacking and content sniffing: `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`
- Cheating by reading network traffic: the secret job is sent only to the Interviewer's connection
