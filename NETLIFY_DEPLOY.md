# Netlify Deploy

## Important Architecture Note
- `Public/` is static and can be hosted on Netlify.
- `server/` (Express + SQLite + uploads) is **not** suitable to run directly on Netlify static hosting.
- Deploy backend separately (Render, Railway, Fly.io, VPS), then point frontend to that API URL.

## 1. Deploy Frontend to Netlify
1. Push this repo to GitHub.
2. In Netlify, create a new site from your repo.
3. Build settings:
   - Publish directory: `Public`
   - Build command: leave empty (or use default from `netlify.toml`)
4. Deploy.

## 2. Configure API URL in App
1. Open your deployed app.
2. Go to `Settings`.
3. Set `API Base URL` to your backend, for example:
   - `https://your-backend.example.com`
4. Save settings.
5. Reload the app once.

## 3. Push Notifications Setup (Backend)
On your backend host set:
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT` (example: `mailto:you@domain.com`)

Install dependencies on backend:
- `cd server && npm install`

## 4. iPhone and Android Notes
- Android: install PWA + allow notifications.
- iPhone/iPad: add to Home Screen first, open installed app, then enable notifications.
