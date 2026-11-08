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

Import `abuchy/mr-pinbot` into Vercel using the Next.js preset. The repository root is the app root. Use Node.js 22. Configure the environment variables listed in `.env.example` before deploying the private library.

## Project status

The responsive dashboard shell includes Overview, Content Library (empty status filters and search), Publishing Queue, and Analytics. Fonts and colors follow Anna’s portfolio and use the supplied Mr. Pinbot mascot. Supabase-backed private link imports and email-link sign-in are implemented. Pinterest, automatic ShopMy retrieval, and scheduled publishing are not implemented. Add authentication before exposing any private data or integration controls.

## Routes

- `/`: overview and setup guidance
- `/library`: content library shell
- `/queue`: publishing queue shell
- `/analytics`: unavailable performance metrics

The public shell contains no private library data. The signed-in library count comes from saved content; publishing metrics remain unavailable and publishing controls are not enabled.

## Credentials

Copy `.env.example` to `.env.local` when integrations are added. Environment files are ignored by Git except the placeholder example. Keep server credentials out of frontend code and variables prefixed with `NEXT_PUBLIC_`. Configure production credentials separately in Vercel.

## Dependency review

The initial dependency audit reported moderate issues in development lint tooling through `minimatch`. Production dependencies had no reported advisories at setup. Review upstream fixes before expanding the tooling; avoid forced major-version downgrades.


## Paste-first private imports

The library accepts up to 100 documented `https://go.shopmy.us/p-NUMBER` affiliate links per paste. Product IDs deduplicate within a batch and across saved imports, with a database unique constraint to handle concurrent imports. Original affiliate query attribution is preserved; deduplication ignores query parameters and fragments.

Authentication uses Supabase one-time email sign-in links in the browser. Server routes validate the bearer token with Supabase `getUser`, restrict the owner email, and use that user's token for database requests. No service-role key is used. Row-level security and an administrator-provisioned membership protect the database even when addressed directly. Private responses use `no-store`. Sign-out removes library data from the UI; data is not stored in application localStorage.

### Supabase setup

1. Create the Supabase project and apply `supabase/migrations/202611080001_content_library.sql` in its SQL editor.
2. In Auth, provision the owner through an invitation. Disable public sign-ups. Set the Site URL to `https://pinbot.annabuchy.com/library`; keep the default one-time sign-in-link template. Use custom SMTP for reliable production email delivery (the default sender has recipient restrictions and limits).
3. Add that user's UUID to membership using `insert into public.workspace_members (user_id) values ('OWNER_UUID');` as an administrator. No frontend membership writes are allowed.
4. Configure `.env.local` and Vercel from `.env.example`: project URL, publishable key, and server-only owner email. Redeploy after configuring variables.
5. Verify owner email-link sign-in, reload persistence, duplicate imports, manual edits, and sign-out. Verify unauthenticated and non-member access is rejected before importing real content.

No production cloud setup is implied by the presence of these files. The UI disables saving until configured.

### Enrichment boundary

`src/lib/enrichment.ts` has no enabled providers. Importing never fetches ShopMy pages, follows affiliate redirects, scrapes retailer pages, calls undocumented APIs, or loads external product imagery. Optional manual product/image URLs are stored as data; image permission must be confirmed. Automatic image previews are deliberately absent so saving a URL cannot silently contact an external host. Enrichment failure must not discard a saved affiliate link.

Future approved API or explicitly authorized browser adapters must document their authorization and field provenance, retain stable source IDs, and pass through the same validation and deduplication boundary. Receiving permission for one workflow must not enable unattended retrieval.

Run `npm test` for link canonicalization, duplicate detection, unsafe URL rejection, batch limits, partial drafts, and image permission checks.


## Modular enrichment update

See `docs/enrichment.md` for current behavior, source configuration, status codes, provider research, and operating boundaries. Apply migration `202611080002_modular_enrichment.sql` before deploying the new preview endpoints. Single-link preview returns editable suggestions before save. External resolver/retailer access is configuration-bound; no default network grants or Awin/CJ accounts are configured.
