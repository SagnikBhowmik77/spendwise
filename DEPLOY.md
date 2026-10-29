# Deploying Spendwise

Live since 26 October 2026. Pushing `main` redeploys both halves.

| Part | Where | Address |
|---|---|---|
| Web app | Vercel, project `spendwise` (team Profff, Hobby), root `client/` | https://spendwise-tau-ruddy.vercel.app |
| API | Render, service `spendwise-api` (free, Singapore), from `render.yaml` | https://spendwise-api-ur0f.onrender.com |
| Database | MongoDB Atlas M0 (AWS Mumbai), Project 0 | access list includes `0.0.0.0/0` for Render |

## Settings

**Render** (Environment): `NODE_ENV`, `NODE_VERSION`, `TRUST_PROXY` come from `render.yaml`. Set in the dashboard:
`APP_URL` and `CLIENT_ORIGIN` = the Vercel address; `API_URL` and `TELEGRAM_WEBHOOK_URL` = the Render address; and the secrets,
the same values as `server/.env`: `MONGODB_URI`, `JWT_SECRET`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TELEGRAM_BOT_TOKEN`.
Keep `JWT_SECRET` the same as before: two-step login secrets are encrypted with it. Don't set `PORT` (Render picks it) or
`DNS_SERVERS` (that was only for one PC's DNS).

**Vercel** (Environment Variables): `VITE_API_URL` = the Render address, `VITE_SITE_URL` = the Vercel address (link
previews), optionally `VITE_CONTACT_EMAIL` (contact on the privacy page). `VITE_` values end up in the public JavaScript,
so they must never be secrets. Changing one needs a redeploy.

**Google Cloud** (OAuth client "Spendwise Local"): redirect URIs include
`https://spendwise-api-ur0f.onrender.com/api/integrations/google/callback` (and the localhost one for development).

**Telegram**: with `TELEGRAM_WEBHOOK_URL` set, the API registers the webhook itself on start-up. Telegram then sends
messages to Render, so a local API must run with polling off (`TELEGRAM_POLLING=false`), or it would take the bot back.

## Free-tier limits

Render's free service sleeps after 15 minutes without requests; the first request after that takes up to a minute, and
scheduled jobs (reminders, reports) only run while it is awake. A Telegram message or opening the app wakes it.

`.github/workflows/keep-awake.yml` pings `/api/health` every 10 minutes from 05:30 to about 00:20 India time, so it is
awake for the 9 pm reminder, bill alerts and reports. It doesn't run all night because Render's 750 free hours a month are
shared by every free service in the workspace (hopin, wardline, roomies too). GitHub stops scheduled workflows after 60
days without a commit; re-enable it under the repo's Actions tab if pings stop.

## Email goes through a relay on Vercel

Render's free services block outgoing SMTP (ports 25, 465 and 587, since September 2025), so the live API can't reach
Gmail itself. Instead it signs each email (HMAC-SHA256 with `MAIL_RELAY_SECRET`, valid for 5 minutes) and posts it over
HTTPS to `client/api/send-mail.js`, a Vercel Function, which sends it through Gmail from its own address.

- **Render** has `MAIL_RELAY_URL` = `https://spendwise-tau-ruddy.vercel.app/api/send-mail` and `MAIL_RELAY_SECRET`.
- **Vercel** has only `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and the same `MAIL_RELAY_SECRET`.
- `MAIL_RELAY_SECRET` lives in `server/.env`. Changing it means updating both, then redeploying Vercel.
- `GET /api/send-mail` answers `{"configured": true}` when the relay is set up; it never shows any value.
- Locally, leave `MAIL_RELAY_URL` unset and the API uses SMTP directly. Checked live 29 October 2026: a confirmation
  email reached the inbox.
