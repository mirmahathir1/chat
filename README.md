# Hosted P2P Chat

Hosted room chat built with Vue 3, Vite, TypeScript, Pinia, Vue Router, Cypress, ESLint, and Prettier.

## Available scripts

- `npm run dev` starts the Vite dev server
- `npm run build` type-checks and creates a production build
- `npm run preview` serves the production build locally
- `npm run lint` runs ESLint
- `npm run format` runs Prettier
- `npm test` runs the Cypress relay e2e flow against local frontend and backend servers
- `npm run test:e2e:open` opens Cypress for local interactive runs

## Deployment

- `npm run build` creates a production bundle and a GitHub Pages SPA fallback page
- GitHub Pages deployment is automated through `.github/workflows/deploy-pages.yml`
- Production config, browser support, and operating limits are documented in `docs/deployment.md`

## Environment

Copy `.env.example` to `.env.local` for local overrides or set the same `VITE_*` values as GitHub repository variables for production builds.
