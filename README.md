# P2P Chat

Hosted room chat built with Vue 3, Vite, TypeScript, Pinia, Vue Router, Cypress, ESLint, and Prettier.

## Available scripts

- `npm run dev` starts the Vite dev server
- `npm run build` type-checks and creates a production build
- `npm run preview` serves the production build locally
- `npm run lint` runs ESLint
- `npm run format` runs Prettier
- `npm test` runs the Cypress relay e2e flow against local frontend and backend servers
- `npm run test:e2e:open` opens Cypress for local interactive runs

## Docker local development

Run `./run.sh` to build and start the full stack with Docker.

If you want direct Compose control, `run.sh` passes arguments through to Docker Compose, so `./run.sh down` stops the stack and `./run.sh logs -f` tails logs.

If you want backend relay file transfers to work locally, set `BLOB_READ_WRITE_TOKEN` in `.env.local` before starting Docker. `run.sh` loads `.env.local` and passes the token into the backend container.

- Frontend: `http://localhost:5173`
- Backend health: `http://localhost:8787/api/health`

The compose stack mounts the source tree into both containers so frontend Vite reloads and backend nodemon restarts on local file changes.

## Deployment

- `npm run build` creates a production bundle and a GitHub Pages SPA fallback page
- GitHub Pages deployment is automated through `.github/workflows/deploy-pages.yml`
- Production config, browser support, and operating limits are documented in `docs/deployment.md`

## Environment

Copy `.env.example` to `.env.local` for local overrides or set the same `VITE_*` values as GitHub repository variables for production builds.
