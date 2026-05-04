# platformer

## Platform: FreeGameStore
- Hosted on Cloudflare Pages (static SPA only)
- ONE environment only (production). No dev/staging. Fix forward, no rollbacks.
- Push to `main` auto-deploys to production via CF Pages
- Domain: platformer.freegamestore.online

## Tech Stack
- TypeScript, React 19, Vite 6, Tailwind CSS 4.1, pnpm
- Kaplay for 2D game development
- No backend (standalone app) — all data in localStorage
- Must work offline (PWA)

## Brand Guidelines
- Fonts: Manrope (body) + Fraunces (display)
- Follow CSS variables in index.css for colors
- Sidebar on desktop (17rem), bottom dock on mobile
- Dark mode via prefers-color-scheme (no toggle)
- Border radius: 1.25rem cards, 0.75rem buttons

## Development
- `pnpm dev` — start dev server
- `pnpm build` — production build
- `pnpm typecheck` — verify types

## Rules
- No analytics, no tracking, no cookies
- All user data in localStorage only
- App must work offline after first load
- Include "Part of FreeGameStore" link in settings/sidebar
- MIT license
