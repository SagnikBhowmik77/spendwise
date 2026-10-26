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
