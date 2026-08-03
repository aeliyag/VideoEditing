# Video Editing Toolkit

Browser-based video timeline editor with Supabase auth, cloud project storage, and Akool AI tools (TTS, image generation, image-to-video). Also includes Python CLI tools for tutorial video segmentation and highlight editing.

**Live demo:** [https://aeliyag.github.io/VideoEditing/](https://aeliyag.github.io/VideoEditing/)

## Video Timeline Editor (React)

Import media, arrange clips on a multi-track timeline, add red-box highlight effects, preview in the browser, and export with FFmpeg.wasm. Sign in with Supabase to save projects to the cloud and use Akool features.

Chromium is recommended for export — FFmpeg runs in the browser via WebAssembly.

### Local development

```bash
cd frontend
npm ci
cp .env.example .env   # fill in Supabase + Akool keys
npm run dev
```

Open **http://localhost:5173**.

### Environment variables

| Variable | Scope | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | Client (build) | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Client (build) | Supabase anon key |
| `VITE_AKOOL_API_BASE` | Client (build) | Akool proxy URL (production); defaults to `/api/akool` in dev |
| `AKOOL_API_KEY` | Server (dev only) | Akool OpenAPI key — proxied by Vite dev server, never shipped to browser |
| `SUPABASE_URL` | Server (dev only) | Used by Vite dev proxy for JWT verification |
| `SUPABASE_ANON_KEY` | Server (dev only) | Used by Vite dev proxy for JWT verification |

See [`frontend/.env.example`](frontend/.env.example) for a template.

### Deploy to GitHub Pages

The frontend deploys automatically on push to `main` via [`.github/workflows/deploy-frontend.yml`](.github/workflows/deploy-frontend.yml).

**One-time setup:**

1. **Enable Pages** — Repo → Settings → Pages → Source: **GitHub Actions**
2. **Add repository variables** (Settings → Secrets and variables → Actions → Variables):
   - `VITE_SUPABASE_URL` — your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` — your Supabase anon key
   - `VITE_AKOOL_API_BASE` — e.g. `https://<project-ref>.supabase.co/functions/v1/akool-proxy`
3. **Configure Supabase Auth** — add `https://aeliyag.github.io/VideoEditing` to Site URL and Redirect URLs
4. **Deploy the Akool proxy** — ensure `supabase/functions/akool-proxy` is deployed with `AKOOL_API_KEY` set as a Supabase secret
5. Push to `main` (or trigger the workflow manually from the Actions tab)

The build sets `VITE_BASE_PATH=/VideoEditing/` so assets resolve correctly on the project Pages URL.

---

## Python Tools

### Video Highlight Editor

Draw red rectangle outlines on a video, edit them on a timeline, and export a new video with the boxes burned in.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install -e .
streamlit run app.py
```

### Video Segmentation Engine

CLI pipeline for scene detection, transcription, OCR, and semantic timeline export.

```bash
video-segment process tutorial.mp4
```

See [`config.yaml`](config.yaml) for pipeline options. Output is a semantic timeline JSON — see [`examples/timeline.example.json`](examples/timeline.example.json).

### Requirements

- Python 3.11+
- FFmpeg (required by Whisper and PySceneDetect)

## Project Structure

```
frontend/                   # React video timeline editor (GitHub Pages)
├── src/
│   ├── components/         # UI: Timeline, Preview, Toolbar, Materials
│   ├── export/             # FFmpeg.wasm export engine
│   ├── state/              # Project + auth providers
│   └── storage/            # Cloud project library (Supabase)
supabase/functions/         # Edge functions (Akool proxy)
effects/                    # Python video effects
video_segmentation/         # Python CLI segmentation pipeline
app.py                      # Streamlit highlight editor
```
