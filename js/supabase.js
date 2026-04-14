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

  const Supa = {
    config() { return loadCfg(); },
    isConfigured() { return !!loadCfg(); },

    async connect(url, key) {
      if (!url || !key) throw new Error('Both URL and anon key are required');
      const cfg = { url: url.trim(), key: key.trim() };
      const adapter = makeAdapter(cfg);
      await adapter.ping(); // validate before saving
      saveCfg(cfg);
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
    }
  };

  global.Supa = Supa;
})(window);
