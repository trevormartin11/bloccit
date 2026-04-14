// Simple localStorage-backed store for properties.
// Shape of a property record is documented in README.

(function (global) {
  const KEY = 'flipcrm.properties.v1';

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('Failed to load properties', e);
      return [];
    }
  }

  function save(list) {
    localStorage.setItem(KEY, JSON.stringify(list));
  }

  function uid() {
    return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  const Store = {
    all() { return load(); },
    get(id) { return load().find(p => p.id === id); },
    add(data) {
      const list = load();
      const now = new Date().toISOString();
      const rec = { id: uid(), createdAt: now, updatedAt: now, ...data };
      list.push(rec);
      save(list);
      return rec;
    },
    update(id, patch) {
      const list = load();
      const i = list.findIndex(p => p.id === id);
      if (i < 0) return null;
      list[i] = { ...list[i], ...patch, updatedAt: new Date().toISOString() };
      save(list);
      return list[i];
    },
    remove(id) {
      save(load().filter(p => p.id !== id));
    },
    bulkUpdate(updates) {
      // updates: [{ id, patch }, ...]
      const list = load();
      updates.forEach(({ id, patch }) => {
        const i = list.findIndex(p => p.id === id);
        if (i >= 0) list[i] = { ...list[i], ...patch, updatedAt: new Date().toISOString() };
      });
      save(list);
    }
  };

  global.Store = Store;
})(window);
