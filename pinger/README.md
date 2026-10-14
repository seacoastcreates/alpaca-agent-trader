# Pinger

A Netlify scheduled function that calls the Vercel app's `/api/tick` every minute on weekdays (13:00-20:59 UTC).

Environment variables (Netlify, scope: Functions):
- `TICK_URL` - `https://<your-app>.vercel.app/api/tick`
- `CRON_SECRET` - same value as the Vercel app

Deploy from this folder: `npx netlify-cli deploy --prod --dir public --functions netlify/functions`.
Logs: Netlify dashboard → the site → Logs → Functions → `tick`.
