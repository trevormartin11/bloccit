// FlipCRM — main UI controller.
// Views: dashboard, pipeline (kanban), properties (table), settings.

(function () {
  'use strict';

  // ---- DOM refs ---------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const modal = $('#modal');
  const modalTitle = $('#modal-title');
  const form = $('#prop-form');
  const importModal = $('#import-modal');
  const importInput = $('#import-input');
  const importStatus = $('#import-status');
  const toast = $('#toast');
  const calcNote = $('#calc-note');
  const searchInput = $('#search');
  const filterStatus = $('#filter-status');
  const filterStrategy = $('#filter-strategy');
  const demoBanner = $('#demo-banner');

  let sortKey = 'updatedAt';
  let sortDir = -1;
  let currentView = 'dashboard';

  const STAGES = ['New', 'Cold', 'Warm', 'Hot', 'Follow Up', 'Under Contract', 'Sold', 'Archived'];
  const STAGE_COLORS = {
    'New': '#64748b',
    'Cold': '#0ea5e9',
    'Warm': '#f97316',
    'Hot': '#ef4444',
    'Follow Up': '#f59e0b',
    'Under Contract': '#7c3aed',
    'Sold': '#10b981',
    'Archived': '#94a3b8'
  };

  // ---- Utilities --------------------------------------------------------
  const fmtMoney = n => {
    if (n === null || n === undefined || n === '' || isNaN(n)) return '—';
    const v = Number(n);
    if (Math.abs(v) >= 1_000_000) return '$' + (v / 1_000_000).toFixed(2) + 'M';
    if (Math.abs(v) >= 10_000) return '$' + Math.round(v / 1000) + 'k';
    return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  };
  const fmtMoneyFull = n => {
    if (n === null || n === undefined || n === '' || isNaN(n)) return '—';
    return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  };
  const num = v => (v === '' || v === null || v === undefined ? null : Number(v));

  function potentialProfit(p) {
    const arv = Number(p.arv) || 0;
    const maxOffer = Number(p.maxOffer) || 0;
    const rehab = Number(p.rehabEstimate) || 0;
    if (!arv || !maxOffer) return null;
    return Math.round(arv - maxOffer - rehab - arv * 0.1);
  }

  function seventyPercentRule(arv, rehab) {
    const a = Number(arv) || 0;
    const r = Number(rehab) || 0;
    if (!a) return null;
    return Math.max(0, Math.round(a * 0.7 - r));
  }

  function timeAgo(iso) {
    const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day}d ago`;
    return new Date(iso).toLocaleDateString();
  }

  function showToast(msg, kind = '') {
    toast.textContent = msg;
    toast.className = 'toast ' + kind;
    requestAnimationFrame(() => toast.classList.remove('hidden'));
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.add('hidden'), 3000);
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // ---- View switching ---------------------------------------------------
  function switchView(name) {
    currentView = name;
    $$('.view').forEach(v => v.classList.toggle('hidden', v.dataset.view !== name));
    $$('.nav-item').forEach(a => a.classList.toggle('active', a.dataset.view === name));
    // Allow links inside content to trigger view switches
    if (window.location.hash.slice(1) !== name) {
      history.replaceState(null, '', '#' + name);
    }
    renderAll();
  }

  // ---- Render -----------------------------------------------------------
  function getFilteredProps() {
    const q = searchInput.value.trim().toLowerCase();
    const st = filterStatus.value;
    const str = filterStrategy.value;
    let items = Store.all();
    if (q) {
      items = items.filter(p =>
        [p.address, p.ownerName, p.notes].some(v => v && v.toLowerCase().includes(q))
      );
    }
    if (st) items = items.filter(p => p.status === st);
    if (str) items = items.filter(p => p.strategy === str);
    return items;
  }

  function renderKpis() {
    const all = Store.all();
    const active = all.filter(p => p.status !== 'Sold' && p.status !== 'Archived');
    $('#kpi-count').textContent = all.length;
    $('#kpi-count-sub').textContent = `${active.length} active · ${all.length - active.length} closed/archived`;
    $('#kpi-hot').textContent = all.filter(p => p.status === 'Hot').length;
    $('#kpi-arv').textContent = fmtMoney(active.reduce((s, p) => s + (Number(p.arv) || 0), 0));
    $('#kpi-profit').textContent = fmtMoney(active.reduce((s, p) => s + (potentialProfit(p) || 0), 0));
    $('#kpi-sold').textContent = all.filter(p => p.status === 'Sold' || p.soldPrice).length;

    // Sidebar counts
    $('#nav-count-pipeline').textContent = active.length;
    $('#nav-count-properties').textContent = all.length;
  }

  function renderFunnel() {
    const el = $('#funnel');
    const all = Store.all();
    const counts = STAGES.map(s => ({ stage: s, count: all.filter(p => p.status === s).length }));
    const max = Math.max(1, ...counts.map(c => c.count));
    el.innerHTML = counts.map(c => {
      const pct = (c.count / max) * 100;
      return `
        <div class="funnel-row">
          <span class="funnel-label">
            <span class="badge badge-${c.stage.replace(/\s+/g, '-')}">${c.stage}</span>
          </span>
          <div class="funnel-bar">
            <div class="funnel-bar-fill" style="width: ${pct}%; background: ${STAGE_COLORS[c.stage]};"></div>
          </div>
          <span class="funnel-count">${c.count}</span>
        </div>
      `;
    }).join('');
  }

  function renderActivity() {
    const el = $('#activity');
    const list = Store.activity();
    if (!list.length) {
      el.innerHTML = '<li class="activity-empty">No activity yet — add a property to get started.</li>';
      return;
    }
    el.innerHTML = list.slice(0, 12).map(a => `
      <li>
        <span class="activity-dot"></span>
        <div class="activity-body">
          <div class="activity-title">${escapeHtml(a.title)}</div>
          <div class="activity-time">${timeAgo(a.at)}</div>
        </div>
      </li>
    `).join('');
  }

  function propCardHtml(p) {
    const profit = potentialProfit(p);
    const meta = [p.beds && `${p.beds}bd`, p.baths && `${p.baths}ba`, p.sqft && `${Number(p.sqft).toLocaleString()} sqft`]
      .filter(Boolean).map(x => `<span>${x}</span>`).join('');
    return `
      <div class="prop-card" draggable="true" data-id="${p.id}">
        <div class="prop-card-addr">${escapeHtml(p.address || '—')}</div>
        ${meta ? `<div class="prop-card-meta">${meta}</div>` : ''}
        <div class="prop-card-numbers">
          <div>
            <div class="prop-card-num-label">ARV</div>
            <div class="prop-card-num-value">${fmtMoney(p.arv)}</div>
          </div>
          <div>
            <div class="prop-card-num-label">Max Offer</div>
            <div class="prop-card-num-value">${fmtMoney(p.maxOffer)}</div>
          </div>
          <div>
            <div class="prop-card-num-label">Rehab</div>
            <div class="prop-card-num-value">${fmtMoney(p.rehabEstimate)}</div>
          </div>
          <div>
            <div class="prop-card-num-label">Profit</div>
            <div class="prop-card-num-value ${profit == null ? '' : profit >= 0 ? 'positive' : 'negative'}">${profit == null ? '—' : fmtMoney(profit)}</div>
          </div>
        </div>
        ${(p.strategy || p.dealType) ? `
          <div class="prop-card-footer">
            ${p.strategy ? `<span class="tag">${p.strategy}</span>` : '<span></span>'}
            ${p.dealType ? `<span class="tag">${p.dealType}</span>` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderKanban() {
    const el = $('#kanban');
    // Apply search filter; ignore status filter since that's what the columns represent.
    const q = searchInput.value.trim().toLowerCase();
    let source = Store.all();
    if (q) {
      source = source.filter(p => [p.address, p.ownerName, p.notes]
        .some(v => v && v.toLowerCase().includes(q)));
    }
    // Show 5 most-used stages in the board; leave Sold + Archived for list view.
    const boardStages = ['New', 'Warm', 'Hot', 'Under Contract', 'Sold'];
    el.innerHTML = boardStages.map(stage => {
      const items = source.filter(p => p.status === stage);
      return `
        <div class="kanban-col" data-stage="${stage}">
          <div class="kanban-col-head">
            <span class="col-dot" style="background: ${STAGE_COLORS[stage]};"></span>
            <span>${stage}</span>
            <span class="col-count">${items.length}</span>
          </div>
          <div class="kanban-col-body">
            ${items.length ? items.map(propCardHtml).join('') : '<div style="padding: 20px; text-align: center; color: var(--text-subtle); font-size: 12px;">Drop here</div>'}
          </div>
        </div>
      `;
    }).join('');
    wireKanbanDnD();
  }

  function wireKanbanDnD() {
    let dragId = null;
    $$('.prop-card').forEach(card => {
      card.addEventListener('dragstart', e => {
        dragId = card.dataset.id;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        dragId = null;
      });
      card.addEventListener('click', () => openModal(Store.get(card.dataset.id)));
    });
    $$('.kanban-col').forEach(col => {
      col.addEventListener('dragover', e => {
        e.preventDefault();
        col.classList.add('drag-over');
      });
      col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
      col.addEventListener('drop', async e => {
        e.preventDefault();
        col.classList.remove('drag-over');
        if (!dragId) return;
        const newStage = col.dataset.stage;
        const rec = Store.get(dragId);
        if (!rec || rec.status === newStage) return;
        await Store.update(dragId, { status: newStage });
        showToast(`Moved to ${newStage}`, 'success');
      });
    });
  }

  function renderTable() {
    const tbody = $('#props-body');
    const emptyState = $('#empty-state');
    let items = getFilteredProps();

    items.sort((a, b) => {
      let av, bv;
      if (sortKey === 'profit') { av = potentialProfit(a) ?? -Infinity; bv = potentialProfit(b) ?? -Infinity; }
      else { av = a[sortKey]; bv = b[sortKey]; }
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * sortDir;
      return (av - bv) * sortDir;
    });

    if (!items.length) {
      tbody.innerHTML = '';
      emptyState.style.display = 'block';
      return;
    }
    emptyState.style.display = 'none';

    tbody.innerHTML = items.map(p => {
      const profit = potentialProfit(p);
      const statusClass = 'badge-' + (p.status || 'New').replace(/\s+/g, '-');
      const meta = [p.beds && `${p.beds}bd`, p.baths && `${p.baths}ba`, p.sqft && `${Number(p.sqft).toLocaleString()} sqft`]
        .filter(Boolean).join(' · ');
      return `
        <tr data-id="${p.id}">
          <td class="addr-cell">
            <div class="addr-primary">${escapeHtml(p.address || '—')}</div>
            ${meta ? `<div class="addr-meta">${escapeHtml(meta)}</div>` : ''}
          </td>
          <td><span class="badge ${statusClass}">${p.status || 'New'}</span></td>
          <td>${p.strategy || '—'}</td>
          <td class="num">${fmtMoneyFull(p.askingPrice)}</td>
          <td class="num">${fmtMoneyFull(p.arv)}</td>
          <td class="num">${fmtMoneyFull(p.rehabEstimate)}</td>
          <td class="num">${fmtMoneyFull(p.maxOffer)}</td>
          <td class="num">${fmtMoneyFull(p.soldPrice)}</td>
          <td class="num ${profit == null ? '' : profit >= 0 ? 'profit-positive' : 'profit-negative'}">
            ${profit == null ? '—' : fmtMoneyFull(profit)}
          </td>
          <td class="actions">
            <div class="row-actions" onclick="event.stopPropagation()">
              <button class="icon-btn" data-action="edit" title="Edit">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>
              </button>
              ${p.listingUrl ? `<a class="icon-btn" href="${escapeHtml(p.listingUrl)}" target="_blank" rel="noopener" title="Open listing">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              </a>` : ''}
              <button class="icon-btn danger" data-action="delete" title="Delete">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderAll() {
    renderKpis();
    if (currentView === 'dashboard') {
      renderFunnel();
      renderActivity();
    } else if (currentView === 'pipeline') {
      renderKanban();
    } else if (currentView === 'properties') {
      renderTable();
    } else if (currentView === 'settings') {
      renderSyncStatus();
    }
  }

  // ---- Modal (add/edit) -------------------------------------------------
  function openModal(prop) {
    form.reset();
    calcNote.hidden = true;
    if (prop) {
      modalTitle.textContent = 'Edit Property';
      Object.entries(prop).forEach(([k, v]) => {
        const el = form.elements.namedItem(k);
        if (el) el.value = v ?? '';
      });
    } else {
      modalTitle.textContent = 'Add Property';
      form.elements.namedItem('id').value = '';
      form.elements.namedItem('status').value = 'New';
    }
    modal.classList.remove('hidden');
    setTimeout(() => form.elements.namedItem('address').focus(), 50);
  }
  function closeModal() { modal.classList.add('hidden'); }

  function prefillFromImport(data) {
    openModal(null);
    Object.entries(data).forEach(([k, v]) => {
      if (k.startsWith('_') || k === 'source') return;
      const el = form.elements.namedItem(k);
      if (el && v !== null && v !== undefined && v !== '') el.value = v;
    });
    if (data.arv) {
      const m = seventyPercentRule(data.arv, data.rehabEstimate || 0);
      const maxEl = form.elements.namedItem('maxOffer');
      if (!maxEl.value) maxEl.value = m;
      calcNote.hidden = false;
      calcNote.innerHTML = `Auto-suggested Max Offer using the <strong>70% rule</strong>: ARV × 0.70 − Rehab = ${fmtMoneyFull(m)}.`;
    }
    if (data._warning) showToast(data._warning, 'error');
  }

  // ---- Settings / sync --------------------------------------------------
  function renderSyncStatus() {
    const pill = $('#sync-pill');
    const label = $('#sync-label');
    const status = $('#sync-status');
    if (Supa.isConfigured()) {
      pill.classList.add('synced');
      label.textContent = 'Team sync on';
      const cfg = Supa.config();
      $('#cfg-supabase-url').value = cfg.url;
      $('#cfg-supabase-key').value = cfg.key;
      status.className = 'sync-status ok';
      status.textContent = `Connected to ${cfg.url}`;
    } else {
      pill.classList.remove('synced');
      label.textContent = 'Local only';
      status.textContent = 'Not connected — data lives in this browser only.';
      status.className = 'sync-status';
    }
  }

  // ---- Demo banner ------------------------------------------------------
  async function maybeShowDemoBanner() {
    if (sessionStorage.getItem('flipcrm.dismissBanner') === '1') return;
    const body = $('#demo-banner-body');

    // Probe the serverless function. Three possible states:
    //   - reachable + API key configured    => don't show banner
    //   - reachable + no API key (demo)     => show "add RENTCAST_API_KEY" banner
    //   - unreachable (GH Pages / file://)  => show "static-only host" banner
    let state = 'static';
    try {
      const res = await fetch('/.netlify/functions/mls-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '__probe__' })
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        state = data.source === 'demo' || data._warning ? 'no-api-key' : 'ok';
      } else if (res.status < 500) {
        state = 'no-api-key'; // function alive but complained
      }
    } catch { state = 'static'; }

    if (state === 'ok') return;

    if (state === 'no-api-key') {
      body.innerHTML = `
        <strong>Almost there.</strong> Netlify is running, but no
        <code>RENTCAST_API_KEY</code> is set — MLS Import will only return the address.
        Add the env var in <strong>Netlify → Site configuration → Environment variables</strong>,
        then redeploy.
      `;
    } else {
      body.innerHTML = `
        <strong>Static-only host detected.</strong> Automatic MLS data import and nightly
        Sold-Price checks need a serverless backend — deploy to Netlify to enable them.
        <a href="#settings" data-view="settings">Open Settings</a> if you just want to wire up Supabase team sync.
      `;
    }
    demoBanner.classList.remove('hidden');
  }

  // ---- Event wiring -----------------------------------------------------
  $('#btn-add').addEventListener('click', () => openModal(null));

  $('#btn-import').addEventListener('click', () => {
    importInput.value = '';
    importStatus.hidden = true;
    importModal.classList.remove('hidden');
    setTimeout(() => importInput.focus(), 50);
  });

  // Sidebar + hash navigation
  $$('[data-view]').forEach(el => {
    if (el.matches('.view')) return; // skip the view sections themselves
    el.addEventListener('click', e => {
      const name = el.dataset.view;
      if (!name) return;
      if (el.tagName === 'A' || el.closest('a')) e.preventDefault();
      switchView(name);
    });
  });

  // Close modals
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeModal();
    if (e.target.closest('[data-close-import]')) importModal.classList.add('hidden');
    if (e.target === modal) closeModal();
    if (e.target === importModal) importModal.classList.add('hidden');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeModal(); importModal.classList.add('hidden'); }
  });

  // Form submit
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {};
    const numericFields = new Set([
      'beds', 'baths', 'sqft', 'yearBuilt',
      'askingPrice', 'arv', 'rehabEstimate', 'maxOffer', 'offerAmount', 'soldPrice'
    ]);
    new FormData(form).forEach((v, k) => {
      if (numericFields.has(k)) data[k] = v === '' ? null : Number(v);
      else data[k] = v;
    });
    const id = data.id;
    delete data.id;
    if (id) {
      await Store.update(id, data);
      showToast('Property updated', 'success');
    } else {
      await Store.add(data);
      showToast('Property added', 'success');
    }
    closeModal();
  });

  // Table row click opens edit; action buttons handle their own
  document.addEventListener('click', (e) => {
    const actionBtn = e.target.closest('[data-action]');
    if (actionBtn) {
      e.stopPropagation();
      const id = actionBtn.closest('tr')?.dataset.id;
      if (!id) return;
      if (actionBtn.dataset.action === 'edit') openModal(Store.get(id));
      if (actionBtn.dataset.action === 'delete') {
        if (confirm('Delete this property? This cannot be undone.')) {
          Store.remove(id);
          showToast('Property deleted');
        }
      }
      return;
    }
    const row = e.target.closest('#props-body tr');
    if (row && !e.target.closest('a')) openModal(Store.get(row.dataset.id));
  });

  // Table sort
  $$('.props thead th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const k = th.dataset.sort;
      if (sortKey === k) sortDir *= -1;
      else { sortKey = k; sortDir = 1; }
      renderTable();
    });
  });

  [searchInput, filterStatus, filterStrategy].forEach(el => {
    el.addEventListener('input', () => renderAll());
    el.addEventListener('change', () => renderAll());
  });

  // CSV export
  $('#btn-export').addEventListener('click', () => {
    const all = Store.all();
    if (!all.length) { showToast('Nothing to export'); return; }
    const cols = ['address','status','strategy','propertyType','dealType','beds','baths','sqft','yearBuilt',
      'askingPrice','arv','rehabEstimate','maxOffer','offerAmount','soldPrice',
      'ownerName','ownerPhone','ownerEmail','lastContact','listingUrl','notes','createdAt','updatedAt'];
    const rows = [cols.join(',')].concat(
      all.map(p => cols.map(c => {
        const v = p[c] ?? '';
        const s = String(v).replace(/"/g, '""');
        return /[",\n]/.test(s) ? `"${s}"` : s;
      }).join(','))
    );
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `flipcrm-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  });

  // Manual sold-price check
  $('#btn-check-sold').addEventListener('click', async () => {
    showToast('Checking sold prices...');
    try {
      const res = await fetch('/.netlify/functions/check-sold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: Store.all() })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { updated = [] } = await res.json();
      if (updated.length) {
        await Store.bulkUpdate(updated.map(u => ({ id: u.id, patch: { soldPrice: u.soldPrice, status: 'Sold' } })));
        showToast(`${updated.length} propert${updated.length === 1 ? 'y' : 'ies'} marked sold`, 'success');
      } else {
        showToast('No new sold listings found', 'success');
      }
    } catch {
      showToast('Sold-price check unavailable — deploy to Netlify with an API key', 'error');
    }
  });

  // MLS Import
  $('#btn-do-import').addEventListener('click', async () => {
    const q = importInput.value.trim();
    if (!q) { showToast('Enter an address or listing URL', 'error'); return; }
    importStatus.hidden = false;
    importStatus.className = 'import-status loading';
    importStatus.textContent = 'Fetching listing data...';
    try {
      const data = await MLS.importListing(q);
      importStatus.className = 'import-status success';
      importStatus.textContent = 'Imported! Review the details and save.';
      importModal.classList.add('hidden');
      prefillFromImport(data);
    } catch (err) {
      importStatus.className = 'import-status error';
      importStatus.textContent = err.message || 'Import failed.';
    }
  });

  // Demo banner dismiss
  $('#dismiss-banner').addEventListener('click', () => {
    demoBanner.classList.add('hidden');
    sessionStorage.setItem('flipcrm.dismissBanner', '1');
  });

  // ---- Settings handlers ------------------------------------------------
  $('#btn-save-sync').addEventListener('click', async () => {
    const url = $('#cfg-supabase-url').value.trim();
    const key = $('#cfg-supabase-key').value.trim();
    const status = $('#sync-status');
    status.className = 'sync-status';
    status.textContent = 'Connecting...';
    try {
      await Supa.connect(url, key);
      status.className = 'sync-status ok';
      status.textContent = 'Connected. Data will now sync across devices.';
      renderSyncStatus();
      renderAll();
      showToast('Team sync enabled', 'success');
    } catch (err) {
      status.className = 'sync-status err';
      status.textContent = `Connection failed: ${err.message}`;
      showToast('Sync connection failed', 'error');
    }
  });

  $('#btn-disable-sync').addEventListener('click', () => {
    if (!confirm('Disable team sync? Your local data will remain intact.')) return;
    Supa.disconnect();
    renderSyncStatus();
    showToast('Team sync disabled');
  });

  $('#btn-settings-export').addEventListener('click', () => {
    const json = Store.exportJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `flipcrm-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  });

  $('#btn-settings-import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      if (!confirm('Importing will replace all current properties. Continue?')) return;
      Store.importJSON(text);
      showToast('Data imported', 'success');
    } catch (err) {
      showToast(`Import failed: ${err.message}`, 'error');
    }
  });

  $('#btn-settings-clear').addEventListener('click', () => {
    if (!confirm('Delete ALL local properties and activity? This cannot be undone.')) return;
    if (!confirm('Are you absolutely sure?')) return;
    Store.clearAll();
    showToast('All local data cleared');
  });

  // ---- Store change listener --------------------------------------------
  window.addEventListener('store:change', () => renderAll());

  // ---- Boot -------------------------------------------------------------
  (async function boot() {
    // Reconnect Supabase if it was previously configured.
    if (Supa.isConfigured()) {
      Supa.reconnect();
      try { await Store.hydrate(); } catch (e) { console.warn(e); }
    }
    // Show banner if backend unavailable.
    maybeShowDemoBanner();
    // Initial view from hash.
    const initial = (window.location.hash.slice(1) || 'dashboard').toLowerCase();
    switchView(['dashboard', 'pipeline', 'properties', 'settings'].includes(initial) ? initial : 'dashboard');
  })();
})();
