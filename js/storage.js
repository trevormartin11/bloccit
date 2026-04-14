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
      // Pull from remote if configured, else return local.
      if (remoteAdapter) {
        try {
          const remote = await remoteAdapter.list();
          cache = remote;
          saveLocal(remote); // keep a local mirror for offline
          emit('hydrated');
          return remote;
        } catch (err) {
          console.warn('Remote hydrate failed, using local cache:', err);
        }
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
