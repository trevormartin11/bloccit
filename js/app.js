// FlipCRM main app — wires up UI, table, modals, and sold-price refresh.

(function () {
  'use strict';

  // ---- DOM refs ---------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const tbody = $('#props-body');
  const emptyState = $('#empty-state');
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

  let sortKey = 'updatedAt';
  let sortDir = -1;

  // ---- Utilities --------------------------------------------------------
  const fmtMoney = n => {
    if (n === null || n === undefined || n === '' || isNaN(n)) return '—';
    const v = Number(n);
    return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  };
  const num = v => (v === '' || v === null || v === undefined ? null : Number(v));

  function potentialProfit(p) {
    const arv = Number(p.arv) || 0;
    const maxOffer = Number(p.maxOffer) || 0;
    const rehab = Number(p.rehabEstimate) || 0;
    if (!arv || !maxOffer) return null;
    // ARV - Max Offer - Rehab - ~10% closing/holding
    return Math.round(arv - maxOffer - rehab - arv * 0.1);
  }

  function seventyPercentRule(arv, rehab) {
    const a = Number(arv) || 0;
    const r = Number(rehab) || 0;
    if (!a) return null;
    return Math.max(0, Math.round(a * 0.7 - r));
  }

  function showToast(msg, kind = '') {
    toast.textContent = msg;
    toast.className = 'toast ' + kind;
    setTimeout(() => toast.classList.add('hidden'), 10);
    requestAnimationFrame(() => toast.classList.remove('hidden'));
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.add('hidden'), 3000);
  }

  // ---- Render -----------------------------------------------------------
  function render() {
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

    items.sort((a, b) => {
      let av, bv;
      if (sortKey === 'profit') { av = potentialProfit(a) || -Infinity; bv = potentialProfit(b) || -Infinity; }
      else { av = a[sortKey]; bv = b[sortKey]; }
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * sortDir;
      return (av - bv) * sortDir;
    });

    // KPIs (use all items, not filtered, for the top-line metrics)
    const all = Store.all();
    $('#kpi-count').textContent = all.length;
    $('#kpi-hot').textContent = all.filter(p => p.status === 'Hot').length;
    $('#kpi-arv').textContent = fmtMoney(
      all.filter(p => p.status !== 'Sold' && p.status !== 'Archived')
         .reduce((s, p) => s + (Number(p.arv) || 0), 0)
    );
    $('#kpi-profit').textContent = fmtMoney(
      all.filter(p => p.status !== 'Sold' && p.status !== 'Archived')
         .reduce((s, p) => s + (potentialProfit(p) || 0), 0)
    );
    $('#kpi-sold').textContent = all.filter(p => p.status === 'Sold' || p.soldPrice).length;

    // Rows
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
            ${meta ? `<div class="addr-meta">${meta}</div>` : ''}
          </td>
          <td><span class="badge ${statusClass}">${p.status || 'New'}</span></td>
          <td>${p.strategy || '—'}</td>
          <td class="num">${fmtMoney(p.askingPrice)}</td>
          <td class="num">${fmtMoney(p.arv)}</td>
          <td class="num">${fmtMoney(p.rehabEstimate)}</td>
          <td class="num">${fmtMoney(p.maxOffer)}</td>
          <td class="num">${fmtMoney(p.soldPrice)}</td>
          <td class="num ${profit == null ? '' : profit >= 0 ? 'profit-positive' : 'profit-negative'}">
            ${profit == null ? '—' : fmtMoney(profit)}
          </td>
          <td class="actions">
            <div class="row-actions">
              <button class="icon-btn" data-action="edit" title="Edit">✎</button>
              ${p.listingUrl ? `<a class="icon-btn" href="${escapeAttr(p.listingUrl)}" target="_blank" rel="noopener" title="Open listing">↗</a>` : ''}
              <button class="icon-btn danger" data-action="delete" title="Delete">🗑</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

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

  function prefillFormFromImport(data) {
    openModal(null);
    Object.entries(data).forEach(([k, v]) => {
      if (k.startsWith('_')) return;
      const el = form.elements.namedItem(k);
      if (el && v !== null && v !== undefined && v !== '') el.value = v;
    });
    // Suggest max offer using 70% rule when we have ARV
    if (data.arv) {
      const m = seventyPercentRule(data.arv, data.rehabEstimate || 0);
      const maxEl = form.elements.namedItem('maxOffer');
      if (!maxEl.value) maxEl.value = m;
      calcNote.hidden = false;
      calcNote.innerHTML = `Auto-suggested Max Offer using the <strong>70% rule</strong>: ARV × 0.70 − Rehab = ${fmtMoney(m)}.`;
    }
    if (data._warning) showToast(data._warning, 'error');
  }

  // ---- Event wiring -----------------------------------------------------
  $('#btn-add').addEventListener('click', () => openModal(null));
  $('#btn-import').addEventListener('click', () => {
    importInput.value = '';
    importStatus.hidden = true;
    importModal.classList.remove('hidden');
    setTimeout(() => importInput.focus(), 50);
  });

  // Close modal (delegated to data-close attrs)
  document.addEventListener('click', (e) => {
    if (e.target.matches('[data-close]')) closeModal();
    if (e.target.matches('[data-close-import]')) importModal.classList.add('hidden');
    // Click on modal backdrop
    if (e.target === modal) closeModal();
    if (e.target === importModal) importModal.classList.add('hidden');
  });

  // ESC closes modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
      importModal.classList.add('hidden');
    }
  });

  // Form submit
  form.addEventListener('submit', (e) => {
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
      Store.update(id, data);
      showToast('Property updated', 'success');
    } else {
      Store.add(data);
      showToast('Property added', 'success');
    }
    closeModal();
    render();
  });

  // Row actions
  tbody.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = e.target.closest('tr')?.dataset.id;
    if (!id) return;
    if (btn.dataset.action === 'edit') openModal(Store.get(id));
    if (btn.dataset.action === 'delete') {
      if (confirm('Delete this property? This cannot be undone.')) {
        Store.remove(id);
        showToast('Property deleted');
        render();
      }
    }
  });

  // Sort headers
  $$('.props thead th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const k = th.dataset.sort;
      if (sortKey === k) sortDir *= -1;
      else { sortKey = k; sortDir = 1; }
      render();
    });
  });

  // Filters
  [searchInput, filterStatus, filterStrategy].forEach(el => {
    el.addEventListener('input', render);
    el.addEventListener('change', render);
  });

  // Export CSV
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

  // Manual sold-price refresh
  $('#btn-check-sold').addEventListener('click', async () => {
    showToast('Checking sold prices...');
    try {
      const res = await fetch('/.netlify/functions/check-sold', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { updated = [] } = await res.json();
      if (updated.length) {
        Store.bulkUpdate(updated.map(u => ({ id: u.id, patch: { soldPrice: u.soldPrice, status: 'Sold' } })));
        render();
        showToast(`${updated.length} propert${updated.length === 1 ? 'y' : 'ies'} marked sold`, 'success');
      } else {
        showToast('No new sold listings found', 'success');
      }
    } catch (err) {
      showToast('Sold check unavailable (deploy to Netlify with API key)', 'error');
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
      prefillFormFromImport(data);
    } catch (err) {
      importStatus.className = 'import-status error';
      importStatus.textContent = err.message || 'Import failed.';
    }
  });

  // ---- Boot -------------------------------------------------------------
  render();
})();
