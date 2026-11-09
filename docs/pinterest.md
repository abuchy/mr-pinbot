# Pinterest connection

1. In Pinterest Developers → My apps → Mr. Pinbot, register the exact redirect URI:
   `https://pinbot.annabuchy.com/api/pinterest/oauth/callback`.
2. Apply `supabase/migrations/202611090001_pinterest_connection.sql` to the existing Supabase project.
3. In Vercel → mr-pinbot → Environment Variables, add the following for Production:
   - `PINTEREST_APP_ID`: App ID from Pinterest Developers.
   - `PINTEREST_APP_SECRET`: App secret from Pinterest Developers.
   - `PINTEREST_REDIRECT_URI`: The exact URI registered above.
   - `PINTEREST_TOKEN_ENCRYPTION_KEY`: A unique base64 key generated with `openssl rand -base64 32`. Preserve this key across redeploys. Changing it requires disconnecting and reconnecting.
   - `SUPABASE_SECRET_KEY`: Server-only secret API key for the existing Supabase project, from Settings → API Keys.
   - `PINTEREST_ACCESS_TIER`: `trial` (the default); set `standard` after approval. This controls the UI label only.
4. Redeploy. Sign in to the Content Library, open Publishing Queue, and choose Connect Pinterest. Review the Pinterest consent screen. The connection panel should show the Pinterest username and public boards. Verify that refreshing the page keeps the connection and that Disconnect clears it.
5. To revoke Pinterest-side consent, remove Mr. Pinbot from your connected apps in Pinterest settings. Disconnect in Mr. Pinbot deletes its stored credentials.

Keep credentials in server-only variables. The migration denies direct access to the credentials table from browser roles. The server encrypts the token payload before storing it and returns account and board summaries only. This phase uses the existing owner sign-in and has no publishing worker.
