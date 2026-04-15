// Optional Supabase sync — loaded lazily from a CDN only if credentials
// are configured. Uses PostgREST via fetch (no SDK required) to stay
// dependency-free on the static site.
//
// Expected table: see supabase-schema.sql in the repo root.
//
//   create table flipcrm_properties (
//     id text primary key,
//     data jsonb not null,
//     updated_at timestamptz not null default now()
//   );
//   alter table flipcrm_properties enable row level security;
//   create policy "anon read/write" on flipcrm_properties
//     for all using (true) with check (true);

(function (global) {
  const CFG_KEY = 'flipcrm.supabase.cfg.v1';

  function loadCfg() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); }
    catch { return null; }
  }
  function saveCfg(cfg) {
    if (!cfg) localStorage.removeItem(CFG_KEY);
    else localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  }

  function makeAdapter(cfg) {
    const base = cfg.url.replace(/\/$/, '') + '/rest/v1/flipcrm_properties';
    const headers = {
      'apikey': cfg.key,
      'Authorization': `Bearer ${cfg.key}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };

    const rowToRec = r => ({ ...r.data, id: r.id, updatedAt: r.updated_at });
    const recToRow = rec => ({ id: rec.id, data: rec, updated_at: rec.updatedAt || new Date().toISOString() });

    return {
      async list() {
        const res = await fetch(`${base}?select=*&order=updated_at.desc`, { headers });
        if (!res.ok) throw new Error(`Supabase list failed: ${res.status}`);
        return (await res.json()).map(rowToRec);
      },
      async upsert(rec) {
        const res = await fetch(`${base}?on_conflict=id`, {
          method: 'POST',
          headers: { ...headers, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify([recToRow(rec)])
        });
        if (!res.ok) throw new Error(`Supabase upsert failed: ${res.status}`);
      },
      async remove(id) {
        const res = await fetch(`${base}?id=eq.${encodeURIComponent(id)}`, {
          method: 'DELETE', headers
        });
        if (!res.ok && res.status !== 404) throw new Error(`Supabase delete failed: ${res.status}`);
      },
      async ping() {
        const res = await fetch(`${base}?select=id&limit=1`, { headers });
        if (!res.ok) throw new Error(`Supabase ping failed: ${res.status}`);
        return true;
      }
    };
  }

  // Tracks whether the active connection came from the server-managed
  // config endpoint (true) vs a user's manual paste in Settings (false).
  // Used by the Settings UI to hide manual inputs when server-managed.
  let _serverManaged = false;

  const Supa = {
    config() { return loadCfg(); },
    isConfigured() { return !!loadCfg(); },
    isServerManaged() { return _serverManaged; },

    async connect(url, key, { persist = true } = {}) {
      if (!url || !key) throw new Error('Both URL and anon key are required');
      const cfg = { url: url.trim(), key: key.trim() };
      const adapter = makeAdapter(cfg);
      await adapter.ping(); // validate before saving
      if (persist) saveCfg(cfg);
      Store.setRemote(adapter);
      await Store.hydrate();
      return adapter;
    },

    reconnect() {
      const cfg = loadCfg();
      if (!cfg) return null;
      const adapter = makeAdapter(cfg);
      Store.setRemote(adapter);
      return adapter;
    },

    disconnect() {
      saveCfg(null);
      Store.setRemote(null);
      _serverManaged = false;
    },

    // Fetch the site-wide Supabase config from /.netlify/functions/config.
    // Returns null if the endpoint is unreachable or the env vars aren't set.
    async loadServerConfig() {
      try {
        const res = await fetch('/.netlify/functions/config');
        if (!res.ok) return null;
        const { supabaseUrl, supabaseAnonKey } = await res.json();
        if (supabaseUrl && supabaseAnonKey) {
          return { url: supabaseUrl, key: supabaseAnonKey };
        }
      } catch { /* offline, local dev, whatever — fall through */ }
      return null;
    },

    // Boot-time helper: prefer the server-managed config so every visitor
    // auto-connects to the same Supabase project without setup. Falls back
    // to any user-saved config from Settings. Returns 'server' | 'user' | null.
    async autoConnect() {
      const server = await this.loadServerConfig();
      if (server) {
        try {
          // Don't overwrite the user's local cfg with the server copy —
          // if admin later changes it, we want the new value to win on next load.
          await this.connect(server.url, server.key, { persist: false });
          _serverManaged = true;
          return 'server';
        } catch (err) {
          console.warn('Server-managed Supabase sync failed:', err);
        }
      }
      _serverManaged = false;
      if (this.isConfigured()) {
        this.reconnect();
        try { await Store.hydrate(); } catch (e) { console.warn(e); }
        return 'user';
      }
      return null;
    }
  };

  global.Supa = Supa;
})(window);
