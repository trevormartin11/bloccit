// Serves public site config read from Netlify env vars so every visitor
// auto-connects to the shared Supabase instance without pasting anything
// into Settings.
//
// Values exposed:
//   - SUPABASE_URL        : the project URL (e.g. https://xxxx.supabase.co)
//   - SUPABASE_ANON_KEY   : the legacy "anon public" JWT
//
// Both are safe to serve client-side by design:
//   - Supabase's anon key is explicitly meant for browser use
//   - The URL is already baked into every outbound request the app makes
//
// If the env vars aren't set, this endpoint returns nulls and the app
// falls back to the existing Settings → Team sync manual-paste flow.

exports.handler = async () => {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      // 5-minute cache so every page navigation doesn't hit the function.
      'Cache-Control': 'public, max-age=300'
    },
    body: JSON.stringify({
      supabaseUrl: process.env.SUPABASE_URL || null,
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null
    })
  };
};
