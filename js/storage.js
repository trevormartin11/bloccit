// Pluggable property store.
//
// Default backend = localStorage. If Supabase credentials are configured
// (via the Settings UI), the same API transparently syncs to a shared
// Postgres table. Reads are always served from an in-memory cache so the
// UI stays instant.
//
// Event model: any mutation broadcasts a 'store:change' event on window
// so the UI can re-render without explicit wiring.

(function (global) {
  const LS_KEY = 'flipcrm.properties.v1';
  const ACTIVITY_KEY = 'flipcrm.activity.v1';
  const MAX_ACTIVITY = 50;

  let cache = loadLocal();
  let activityCache = loadActivity();
  let backend = 'local';           // 'local' | 'supabase'
  let remoteAdapter = null;        // set by Supabase module when configured

  function loadLocal() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); }
    catch { return []; }
  }
  function saveLocal(list) { localStorage.setItem(LS_KEY, JSON.stringify(list)); }

  function loadActivity() {
    try { return JSON.parse(localStorage.getItem(ACTIVITY_KEY) || '[]'); }
    catch { return []; }
  }
  function saveActivity(list) { localStorage.setItem(ACTIVITY_KEY, JSON.stringify(list)); }

  function uid() {
    return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function emit(type, detail) {
    window.dispatchEvent(new CustomEvent('store:change', { detail: { type, ...detail } }));
  }

  function logActivity(title) {
    activityCache.unshift({ id: uid(), title, at: new Date().toISOString() });
    activityCache = activityCache.slice(0, MAX_ACTIVITY);
    saveActivity(activityCache);
  }

  const Store = {
    // ---- Backend plumbing ----
    setRemote(adapter) {
      remoteAdapter = adapter;
      backend = adapter ? 'supabase' : 'local';
    },
    backend() { return backend; },

    async hydrate() {
      // Reconcile local cache with the remote Supabase table. Rules:
      //   - Remote empty, local has data   → push local up (first-time sync)
      //   - Remote has data, local empty   → pull remote down
      //   - Both have data                 → merge by updatedAt per id
      //                                       (newer-wins; push locally-only
      //                                        records up)
      // Never blindly overwrite local with an empty remote — that was the
      // v1 behavior and it caused silent data loss on first connect.
      if (!remoteAdapter) return cache;
      try {
        const remote = await remoteAdapter.list();

        if (remote.length === 0 && cache.length > 0) {
          // First-time sync: push everything up.
          await Promise.all(cache.map(rec => remoteAdapter.upsert(rec)));
          emit('hydrated');
          return cache;
        }

        if (cache.length === 0) {
          // Local empty, pull down as-is.
          cache = remote;
          saveLocal(remote);
          emit('hydrated');
          return remote;
        }

        // Both have data — merge by updatedAt (newer wins per id) and
        // push any local-only records up so Supabase becomes canonical.
        const byId = new Map();
        for (const r of remote) byId.set(r.id, r);
        const localOnly = [];
        for (const l of cache) {
          const r = byId.get(l.id);
          if (!r) {
            byId.set(l.id, l);
            localOnly.push(l);
          } else if (new Date(l.updatedAt || 0) > new Date(r.updatedAt || 0)) {
            byId.set(l.id, l);
            localOnly.push(l); // newer local version should be pushed
          }
        }
        const merged = Array.from(byId.values());
        cache = merged;
        saveLocal(merged);
        if (localOnly.length) {
          await Promise.all(localOnly.map(rec => remoteAdapter.upsert(rec)));
        }
        emit('hydrated');
        return merged;
      } catch (err) {
        console.warn('Remote hydrate failed, using local cache:', err);
      }
      return cache;
    },

    // ---- Queries ----
    all() { return [...cache]; },
    get(id) { return cache.find(p => p.id === id); },
    activity() { return [...activityCache]; },

    // ---- Mutations ----
    async add(data) {
      const now = new Date().toISOString();
      const rec = { id: uid(), createdAt: now, updatedAt: now, ...data };
      cache.push(rec);
      saveLocal(cache);
      logActivity(`Added ${rec.address || 'a property'}`);
      if (remoteAdapter) { try { await remoteAdapter.upsert(rec); } catch (e) { console.warn(e); } }
      emit('add', { record: rec });
      return rec;
    },

    async update(id, patch) {
      const i = cache.findIndex(p => p.id === id);
      if (i < 0) return null;
      const prev = cache[i];
      cache[i] = { ...prev, ...patch, updatedAt: new Date().toISOString() };
      saveLocal(cache);
      if (patch.status && patch.status !== prev.status) {
        logActivity(`Moved ${prev.address || 'property'} → ${patch.status}`);
      } else if (patch.soldPrice && !prev.soldPrice) {
        logActivity(`${prev.address || 'Property'} sold for $${Number(patch.soldPrice).toLocaleString()}`);
      } else {
        logActivity(`Updated ${prev.address || 'a property'}`);
      }
      if (remoteAdapter) { try { await remoteAdapter.upsert(cache[i]); } catch (e) { console.warn(e); } }
      emit('update', { record: cache[i] });
      return cache[i];
    },

    async remove(id) {
      const rec = cache.find(p => p.id === id);
      cache = cache.filter(p => p.id !== id);
      saveLocal(cache);
      if (rec) logActivity(`Deleted ${rec.address || 'a property'}`);
      if (remoteAdapter) { try { await remoteAdapter.remove(id); } catch (e) { console.warn(e); } }
      emit('remove', { id });
    },

    async bulkUpdate(updates) {
      updates.forEach(({ id, patch }) => {
        const i = cache.findIndex(p => p.id === id);
        if (i >= 0) cache[i] = { ...cache[i], ...patch, updatedAt: new Date().toISOString() };
      });
      saveLocal(cache);
      if (remoteAdapter) {
        try { await Promise.all(updates.map(u => remoteAdapter.upsert(Store.get(u.id)))); }
        catch (e) { console.warn(e); }
      }
      emit('bulk');
    },

    clearAll() {
      cache = [];
      activityCache = [];
      saveLocal(cache);
      saveActivity(activityCache);
      emit('clear');
    },

    exportJSON() {
      return JSON.stringify({ properties: cache, activity: activityCache, exportedAt: new Date().toISOString() }, null, 2);
    },
    importJSON(text) {
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.properties)) throw new Error('Invalid backup file');
      cache = parsed.properties;
      activityCache = Array.isArray(parsed.activity) ? parsed.activity : [];
      saveLocal(cache);
      saveActivity(activityCache);
      emit('import');
    }
  };

  global.Store = Store;
})(window);
