# Mr. Pinbot

Use Next.js App Router, TypeScript, Tailwind CSS, Vercel, and Supabase.

Build incrementally. Establish deployment before expanding the dashboard or integrations.
Never commit credentials or expose server secrets in frontend code. Add authentication before private data or publishing controls are enabled.
Only publish reviewed, approved content. Design future jobs for duplicate prevention, retry visibility, and Pinterest policy compliance. Do not scrape ShopMy without a permitted integration.
Run lint, typecheck, and a production build for application changes.
The dashboard shell has four routes: /, /library, /queue, /analytics. Preserve the portfolio design: Domine headings, Space Grotesk body, predominantly white/black, restrained #61203B, #DFEAF7, and #F3E8B2 accents. Use the supplied public/pinbot.png mascot. Metrics are empty placeholders; do not invent connected accounts, successful publishing, or performance data.

The library now has a Supabase-backed paste import implementation. Do not deploy it as configured until the migration, owner membership, email-link redirect configuration, and environment variables have been applied and verified. Import never retrieves ShopMy content. No enrichment provider is enabled. Preserve per-user RLS and database-level duplicate prevention.
