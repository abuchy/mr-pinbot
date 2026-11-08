# Mr. Pinbot

Personal Pinterest content management and automation dashboard.

## Local development

Use Node.js 22, then run:

```sh
npm ci
npm run dev
```

Open http://localhost:3000.

## Checks

```sh
npm run lint
npm run typecheck
npm run build
```

## Deployment

Import `abuchy/mr-pinbot` into Vercel using the Next.js preset. The repository root is the app root. Use Node.js 22. No environment variables are needed for this initial starter.

## Project status

This is a deployment starter. The dashboard, authentication, Supabase, Pinterest, ShopMy, and scheduled publishing are not implemented yet. Add authentication before exposing any private data or integration controls.

## Credentials

Copy `.env.example` to `.env.local` when integrations are added. Environment files are ignored by Git except the placeholder example. Keep server credentials out of frontend code and variables prefixed with `NEXT_PUBLIC_`. Configure production credentials separately in Vercel.

## Dependency review

The initial dependency audit reported moderate issues in development lint tooling through `minimatch`. Production dependencies had no reported advisories at setup. Review upstream fixes before expanding the tooling; avoid forced major-version downgrades.
