# Video Timeline Editor

React + TypeScript + Vite frontend for the browser-based video editor.

## Local development

```bash
npm ci
cp .env.example .env   # fill in Supabase + Akool keys
npm run dev
```

Open **http://localhost:5173** (Chromium recommended for export).

### Akool text-to-speech (dev)

Set `AKOOL_API_KEY` in `.env`. The dev server proxies `/api/akool/*` so the key never ships to the browser. Get the key from [Akool](https://akool.com) → API icon → **API Credentials**.

## Deploy

See the root [README](../README.md#deploy-to-github-pages) for GitHub Pages deployment instructions.
