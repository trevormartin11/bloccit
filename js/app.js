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
  const searchInput = $('#search');
  const filterStatus = $('#filter-status');
  const filterStrategy = $('#filter-strategy');
  const demoBanner = $('#demo-banner');

  let sortKey = 'updatedAt';
  let sortDir = -1;
  let currentView = 'dashboard';

  const STAGES = ['New', 'Analyzed', 'Property Visit', 'Offer Submitted', 'Accepted Contract', 'Offer Lost', 'Bad Deal'];
  const STAGE_COLORS = {
    'New':               '#64748b',
    'Analyzed':          '#0ea5e9',
    'Property Visit':    '#f59e0b',
    'Offer Submitted':   '#7c3aed',
    'Accepted Contract': '#10b981',
    'Offer Lost':        '#94a3b8',
    'Bad Deal':          '#e11d48'
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

  // Financing assumptions are user-configurable in Settings → Financing defaults.
  // Stored as a single object in localStorage; callers read via financeCfg().
  //
  // Math (self-referential because the interest itself is financed):
  //   Base  = Purchase + Rehab
  //   Loan  = Base / (1 − rate × days/365)
  //   Intr  = Loan − Base
  //   Orig  = Loan × origination
  //   Total = Intr + Orig
  const FINANCE_CFG_KEY = 'flipcrm.finance.cfg.v1';
  const FINANCE_DEFAULTS = Object.freeze({
    annualRate:       0.10,     // 10% hard-money interest
    origination:      0.01,     // 1% points
    buyCC:            0.005,    // 0.5% buy-side closing costs (% of purchase)
    sellCC:           0.03,     // 3% all-in sell-side closing (% of ARV)
    defaultTaxRate:   0.011,    // 1.1% annual property tax (US avg; used when MLS data unknown)
    insuranceAnnual:  0.005,    // 0.5% of purchase per year (vacant-dwelling/builder's risk for a 6-mo flip)
    utilitiesMonthly: 300,      // $300/mo vacant-rehab utilities
    targetProfit:     50000,    // back-solve Max Offer to hit this profit
    daysHeld:         180
  });

  function financeCfg() {
    try {
      const raw = localStorage.getItem(FINANCE_CFG_KEY);
      const saved = raw ? JSON.parse(raw) : {};
      return { ...FINANCE_DEFAULTS, ...saved };
    } catch {
      return { ...FINANCE_DEFAULTS };
    }
  }
  function saveFinanceCfg(cfg) {
    const merged = { ...FINANCE_DEFAULTS, ...cfg };
    localStorage.setItem(FINANCE_CFG_KEY, JSON.stringify(merged));
    return merged;
  }
  function resetFinanceCfg() {
    localStorage.removeItem(FINANCE_CFG_KEY);
    return { ...FINANCE_DEFAULTS };
  }

  function financing(p) {
    const cfg = financeCfg();
    const purchase = Number(p.offerAmount) || Number(p.maxOffer) || 0;
    const rehab = Number(p.rehabEstimate) || 0;
    const days = Number(p.daysHeld) || cfg.daysHeld;
    const base = purchase + rehab;
    if (!base) return null;
    const iFrac = cfg.annualRate * (days / 365);
    if (iFrac >= 1) return null;
    const loan = base / (1 - iFrac);
    const interest = loan - base;
    const origination = loan * cfg.origination;
    return {
      purchase, rehab, days, base,
      loan: Math.round(loan),
      interest: Math.round(interest),
      origination: Math.round(origination),
      total: Math.round(interest + origination)
    };
  }

  // Detailed holding-cost breakdown, supporting per-property overrides and
  // falling back to the Settings defaults otherwise. Returns each component
  // prorated to the hold period.
  function holdingBreakdown(p) {
    const cfg = financeCfg();
    const purchase = Number(p.offerAmount) || Number(p.maxOffer) || 0;
    const days = Number(p.daysHeld) || cfg.daysHeld;
    if (!purchase || !days) return null;

    const explicitTax  = Number(p.annualPropertyTax);
    const explicitHOA  = Number(p.monthlyHOA);
    const explicitIns  = Number(p.insuranceAnnual);
    const explicitUtil = Number(p.utilitiesMonthly);

    const annualTax   = explicitTax  || purchase * cfg.defaultTaxRate;
    const monthlyHOA  = explicitHOA  || 0;
    const annualIns   = explicitIns  || purchase * cfg.insuranceAnnual;
    const monthlyUtil = explicitUtil || cfg.utilitiesMonthly;

    return {
      tax:       Math.round(annualTax   * days / 365),
      hoa:       Math.round(monthlyHOA  * days / 30),
      insurance: Math.round(annualIns   * days / 365),
      utilities: Math.round(monthlyUtil * days / 30),
      taxSource:       explicitTax  ? 'actual' : 'est',
      hoaSource:       explicitHOA  ? 'actual' : (monthlyHOA ? 'est' : 'none'),
      insuranceSource: explicitIns  ? 'actual' : 'est',
      utilitiesSource: explicitUtil ? 'actual' : 'est',
      annualTax, monthlyHOA, annualIns, monthlyUtil, days
    };
  }
  function holdingTotal(p) {
    const b = holdingBreakdown(p);
    if (!b) return 0;
    return b.tax + b.hoa + b.insurance + b.utilities;
  }

  // Back-solve for the Max Offer that yields cfg.targetProfit, given an ARV,
  // Rehab, Days Held, and any per-property overrides. Returns null if the
  // ARV doesn't support the target profit (i.e. P would be ≤ 0).
  //
  // Derivation: Profit = ARV(1-s) − P − P·a − R(1+k) − H(P) − target
  //   where k = financing factor (P+R)·k = total financing cost
  //         H(P) = hvr·P + hf  (variable holding scales with P, fixed doesn't)
  //   Solve for P → P = [ARV(1-s) − R(1+k) − hf − target] / (1 + a + hvr + k)
  function backsolveMaxOffer(p) {
    const cfg = financeCfg();
    const arv = Number(p.arv) || 0;
    const rehab = Number(p.rehabEstimate) || 0;
    const days = Number(p.daysHeld) || cfg.daysHeld;
    const target = cfg.targetProfit;
    if (!arv || !days) return null;

    const explicitTax = Number(p.annualPropertyTax) || 0;
    const explicitIns = Number(p.insuranceAnnual)   || 0;
    const monthlyHOA  = Number(p.monthlyHOA)        || 0;
    const monthlyUtil = Number(p.utilitiesMonthly)  || cfg.utilitiesMonthly;

    // Variable holding rate: portion of holding cost that scales with P.
    let hvr = 0;
    if (!explicitTax) hvr += cfg.defaultTaxRate  * days / 365;
    if (!explicitIns) hvr += cfg.insuranceAnnual * days / 365;

    // Fixed holding cost (independent of P).
    let hf = monthlyHOA * days / 30 + monthlyUtil * days / 30;
    if (explicitTax) hf += explicitTax * days / 365;
    if (explicitIns) hf += explicitIns * days / 365;

    const iFrac = cfg.annualRate * days / 365;
    if (iFrac >= 1) return null;
    const k = (iFrac + cfg.origination) / (1 - iFrac);

    const numerator   = arv * (1 - cfg.sellCC) - rehab * (1 + k) - hf - target;
    const denominator = 1 + cfg.buyCC + hvr + k;
    const P = numerator / denominator;
    if (!isFinite(P) || P <= 0) return null;
    return Math.round(P / 500) * 500; // round to nearest $500
  }

  function potentialProfit(p) {
    const arv = Number(p.arv) || 0;
    const fin = financing(p);
    if (!arv || !fin) return null;
    const cfg = financeCfg();
    const buyCC   = fin.purchase * cfg.buyCC;
    const holding = holdingTotal(p);
    const sellCC  = arv * cfg.sellCC;
    return Math.round(arv - fin.purchase - buyCC - fin.rehab - holding - fin.total - sellCC);
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
    const terminalStates = new Set(['Offer Lost', 'Bad Deal']);
    const active = all.filter(p => !terminalStates.has(p.status));
    $('#kpi-count').textContent = all.length;
    $('#kpi-count-sub').textContent = `${active.length} active · ${all.length - active.length} dropped`;
    $('#kpi-hot').textContent = all.filter(p => p.status === 'Offer Submitted').length;
    $('#kpi-arv').textContent = fmtMoney(active.reduce((s, p) => s + (Number(p.arv) || 0), 0));
    $('#kpi-profit').textContent = fmtMoney(active.reduce((s, p) => s + (potentialProfit(p) || 0), 0));
    $('#kpi-sold').textContent = all.filter(p => p.status === 'Accepted Contract').length;

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
    // All 7 stages appear as columns; terminal ones (Offer Lost / Bad Deal)
    // are still draggable but positioned at the far right.
    const boardStages = STAGES;
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
      renderFinanceCfgForm();
    }
  }

  // ---- Modal (add/edit) -------------------------------------------------
  function openModal(prop) {
    form.reset();
    // Reset Max Offer auto-state for the fresh open.
    const maxEl = form.elements.namedItem('maxOffer');
    delete maxEl.dataset.userEdited;
    delete maxEl.dataset.auto;
    $('#max-offer-hint').hidden = true;

    if (prop) {
      modalTitle.textContent = 'Edit Property';
      Object.entries(prop).forEach(([k, v]) => {
        const el = form.elements.namedItem(k);
        if (el) el.value = v ?? '';
      });
      if (!form.elements.namedItem('daysHeld').value) {
        form.elements.namedItem('daysHeld').value = financeCfg().daysHeld;
      }
      // If editing and Max Offer already has a saved value, treat it as
      // user-owned (don't overwrite their decision).
      if (maxEl.value) maxEl.dataset.userEdited = '1';
    } else {
      modalTitle.textContent = 'Add Property';
      form.elements.namedItem('id').value = '';
      form.elements.namedItem('status').value = 'New';
      form.elements.namedItem('daysHeld').value = financeCfg().daysHeld;
    }
    tryAutoPopulateMaxOffer();
    updateFinancePanel();
    modal.classList.remove('hidden');
    setTimeout(() => form.elements.namedItem('address').focus(), 50);
  }
  function closeModal() { modal.classList.add('hidden'); }

  // Reads current form values and renders the Financing & Profit panel.
  function updateFinancePanel() {
    const el = $('#finance-panel');
    const read = name => {
      const v = form.elements.namedItem(name)?.value;
      return v === '' || v == null ? null : Number(v);
    };
    const p = {
      arv: read('arv'),
      rehabEstimate: read('rehabEstimate'),
      maxOffer: read('maxOffer'),
      offerAmount: read('offerAmount'),
      daysHeld: read('daysHeld')
    };
    const fin = financing(p);
    const arv = Number(p.arv) || 0;
    if (!fin) {
      el.innerHTML = `<p class="finance-empty">Enter a Purchase (Max Offer or Offer Submitted) and Rehab to see financing costs.</p>`;
      return;
    }
    const cfg = financeCfg();
    const buyCC  = Math.round(fin.purchase * cfg.buyCC);
    const hold   = holdingBreakdown(p);
    const holdTot = hold ? hold.tax + hold.hoa + hold.insurance + hold.utilities : 0;
    const sellCC = Math.round(arv * cfg.sellCC);
    const profit = arv
      ? arv - fin.purchase - buyCC - fin.rehab - holdTot - fin.total - sellCC
      : null;
    const profitClass = profit == null ? '' : profit >= 0 ? 'positive' : 'negative';
    const pct = x => (x * 100).toFixed(2).replace(/\.?0+$/, '');
    const tag = src => src === 'actual' ? '<span class="src-tag src-actual">actual</span>'
                    : src === 'est'    ? '<span class="src-tag src-est">est</span>'
                    : '';

    const hoaRow = hold && hold.hoaSource !== 'none'
      ? `<div class="finance-row muted-row"><span>HOA ($${hold.monthlyHOA}/mo × ${(hold.days/30).toFixed(1)}) ${tag(hold.hoaSource)}</span><span>${fmtMoneyFull(hold.hoa)}</span></div>`
      : '';

    // Monthly burn rate: every recurring carrying cost normalized to /mo.
    // Includes loan interest (averaged over the hold) + tax + insurance +
    // HOA + utilities. Excludes one-time fees (origination, buy/sell CC).
    let monthlyCarry = null;
    if (hold && fin.days) {
      const months = fin.days / 30;
      monthlyCarry = Math.round(
        (fin.interest / months) +
        (hold.annualTax / 12) +
        (hold.annualIns / 12) +
        hold.monthlyHOA +
        hold.monthlyUtil
      );
    }

    el.innerHTML = `
      <div class="finance-grid">
        <div class="finance-row"><span>Purchase price</span><span>${fmtMoneyFull(fin.purchase)}</span></div>
        <div class="finance-row muted-row"><span>Buy-side closing (${pct(cfg.buyCC)}% of purchase)</span><span>${fmtMoneyFull(buyCC)}</span></div>
        <div class="finance-row"><span>Rehab</span><span>${fmtMoneyFull(fin.rehab)}</span></div>
        <div class="finance-row"><span>Days held</span><span>${fin.days}</span></div>
        <div class="finance-divider"></div>
        <div class="finance-row"><span>Loan amount <small>(Purchase + Rehab + Interest)</small></span><span>${fmtMoneyFull(fin.loan)}</span></div>
        <div class="finance-row muted-row"><span>Interest (${pct(cfg.annualRate)}% annual, capitalized)</span><span>${fmtMoneyFull(fin.interest)}</span></div>
        <div class="finance-row muted-row"><span>Origination (${pct(cfg.origination)}% of loan)</span><span>${fmtMoneyFull(fin.origination)}</span></div>
        <div class="finance-row total-row"><span>Total financing cost</span><span>${fmtMoneyFull(fin.total)}</span></div>
        <div class="finance-divider"></div>
        ${hold ? `
        <div class="finance-row muted-row"><span>Property tax ($${Math.round(hold.annualTax).toLocaleString()}/yr × ${hold.days}/365) ${tag(hold.taxSource)}</span><span>${fmtMoneyFull(hold.tax)}</span></div>
        ${hoaRow}
        <div class="finance-row muted-row"><span>Insurance ($${Math.round(hold.annualIns).toLocaleString()}/yr × ${hold.days}/365) ${tag(hold.insuranceSource)}</span><span>${fmtMoneyFull(hold.insurance)}</span></div>
        <div class="finance-row muted-row"><span>Utilities ($${hold.monthlyUtil}/mo × ${(hold.days/30).toFixed(1)}) ${tag(hold.utilitiesSource)}</span><span>${fmtMoneyFull(hold.utilities)}</span></div>
        <div class="finance-row total-row"><span>Total holding costs</span><span>${fmtMoneyFull(holdTot)}</span></div>
        ` : ''}
        ${monthlyCarry != null ? `
        <div class="finance-row info-row">
          <span>Carrying cost per month <small>(interest + tax + ins + HOA + util)</small></span>
          <span>${fmtMoneyFull(monthlyCarry)} / mo</span>
        </div>
        ` : ''}
        <div class="finance-divider"></div>
        <div class="finance-row"><span>Est. ARV</span><span>${fmtMoneyFull(arv || null)}</span></div>
        <div class="finance-row muted-row"><span>Sell-side closing all-in (${pct(cfg.sellCC)}% of ARV)</span><span>${fmtMoneyFull(sellCC || null)}</span></div>
        <div class="finance-row profit-row ${profitClass}">
          <span>Projected profit</span>
          <span>${profit == null ? '—' : fmtMoneyFull(profit)}</span>
        </div>
      </div>
    `;
  }

  function prefillFromImport(data) {
    openModal(null);
    Object.entries(data).forEach(([k, v]) => {
      if (k.startsWith('_') || k === 'source') return;
      const el = form.elements.namedItem(k);
      if (el && v !== null && v !== undefined && v !== '') el.value = v;
    });
    // ARV and Max Offer are never auto-filled — they're deal-specific judgment
    // calls that depend on the investor's rehab scope and market take.
    if (data._warning) showToast(data._warning, 'error');
  }

  // ---- Settings / financing defaults ------------------------------------
  function renderFinanceCfgForm() {
    const cfg = financeCfg();
    $('#cfg-rate').value          = (cfg.annualRate       * 100);
    $('#cfg-origination').value   = (cfg.origination      * 100);
    $('#cfg-buy-cc').value        = (cfg.buyCC            * 100);
    $('#cfg-sell-cc').value       = (cfg.sellCC           * 100);
    $('#cfg-tax-rate').value      = (cfg.defaultTaxRate   * 100);
    $('#cfg-insurance').value     = (cfg.insuranceAnnual  * 100);
    $('#cfg-utilities').value     = cfg.utilitiesMonthly;
    $('#cfg-target-profit').value = cfg.targetProfit;
    $('#cfg-days').value          = cfg.daysHeld;
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

  // ---- Max Offer auto-populate ------------------------------------------
  // The Max Offer field auto-fills with a back-solved value once ARV and
  // Rehab are present, targeting cfg.targetProfit (default $50k). It stops
  // auto-updating the moment the user types into Max Offer manually.
  function tryAutoPopulateMaxOffer() {
    const maxEl = form.elements.namedItem('maxOffer');
    const hint = $('#max-offer-hint');
    if (!maxEl) return;
    if (maxEl.dataset.userEdited === '1') return; // user took control

    const read = name => {
      const v = form.elements.namedItem(name)?.value;
      return v === '' || v == null ? null : Number(v);
    };
    const candidate = backsolveMaxOffer({
      arv: read('arv'),
      rehabEstimate: read('rehabEstimate'),
      daysHeld: read('daysHeld'),
      annualPropertyTax: read('annualPropertyTax'),
      monthlyHOA: read('monthlyHOA'),
      insuranceAnnual: read('insuranceAnnual'),
      utilitiesMonthly: read('utilitiesMonthly')
    });
    if (candidate == null) {
      // Not enough data yet — only clear if WE put something there
      if (maxEl.dataset.auto === '1') { maxEl.value = ''; }
      hint.hidden = true;
      return;
    }
    maxEl.value = candidate;
    maxEl.dataset.auto = '1';
    const target = financeCfg().targetProfit;
    hint.hidden = false;
    hint.textContent = `Auto-calculated for $${target.toLocaleString()} target profit — editable.`;
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
        <strong>Static-only host detected.</strong> Automatic MLS data import and weekly
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

  // Live-update the Financing panel whenever any of its inputs change.
  ['arv', 'rehabEstimate', 'maxOffer', 'offerAmount', 'daysHeld',
   'annualPropertyTax', 'monthlyHOA', 'insuranceAnnual', 'utilitiesMonthly'].forEach(name => {
    form.elements.namedItem(name)?.addEventListener('input', updateFinancePanel);
  });

  // Auto-populate Max Offer when the inputs that feed the back-solve change.
  ['arv', 'rehabEstimate', 'daysHeld',
   'annualPropertyTax', 'monthlyHOA', 'insuranceAnnual', 'utilitiesMonthly'].forEach(name => {
    form.elements.namedItem(name)?.addEventListener('input', tryAutoPopulateMaxOffer);
  });

  // User typing in Max Offer takes ownership — stop auto-populating.
  form.elements.namedItem('maxOffer')?.addEventListener('input', () => {
    const el = form.elements.namedItem('maxOffer');
    el.dataset.userEdited = '1';
    el.dataset.auto = '0';
    $('#max-offer-hint').hidden = true;
  });

  // Form submit
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {};
    const numericFields = new Set([
      'beds', 'baths', 'sqft', 'yearBuilt',
      'askingPrice', 'arv', 'rehabEstimate', 'maxOffer', 'offerAmount', 'daysHeld', 'soldPrice',
      'annualPropertyTax', 'monthlyHOA', 'insuranceAnnual', 'utilitiesMonthly'
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
        // Only populate the soldPrice — don't change the user's pipeline
        // status. They decide whether to move the card to Accepted Contract
        // (we bought it) or Offer Lost (someone else bought it).
        await Store.bulkUpdate(updated.map(u => ({ id: u.id, patch: { soldPrice: u.soldPrice } })));
        showToast(`Sold price found for ${updated.length} propert${updated.length === 1 ? 'y' : 'ies'}`, 'success');
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

  // Financing defaults
  $('#btn-save-finance').addEventListener('click', () => {
    const pct = id => {
      const v = $(id).value;
      if (v === '') return null;
      const n = Number(v);
      return isNaN(n) ? null : n / 100;
    };
    const int = id => {
      const v = $(id).value;
      if (v === '') return null;
      const n = parseInt(v, 10);
      return isNaN(n) ? null : n;
    };
    const next = {
      annualRate:       pct('#cfg-rate')          ?? FINANCE_DEFAULTS.annualRate,
      origination:      pct('#cfg-origination')   ?? FINANCE_DEFAULTS.origination,
      buyCC:            pct('#cfg-buy-cc')        ?? FINANCE_DEFAULTS.buyCC,
      sellCC:           pct('#cfg-sell-cc')       ?? FINANCE_DEFAULTS.sellCC,
      defaultTaxRate:   pct('#cfg-tax-rate')      ?? FINANCE_DEFAULTS.defaultTaxRate,
      insuranceAnnual:  pct('#cfg-insurance')     ?? FINANCE_DEFAULTS.insuranceAnnual,
      utilitiesMonthly: int('#cfg-utilities')     ?? FINANCE_DEFAULTS.utilitiesMonthly,
      targetProfit:     int('#cfg-target-profit') ?? FINANCE_DEFAULTS.targetProfit,
      daysHeld:         int('#cfg-days')          ?? FINANCE_DEFAULTS.daysHeld
    };
    saveFinanceCfg(next);
    const fmt = x => (x * 100).toFixed(2).replace(/\.?0+$/, '');
    const status = $('#finance-cfg-status');
    status.className = 'sync-status ok';
    status.textContent = `Saved — ${fmt(next.annualRate)}% rate · ${fmt(next.buyCC)}% buy · ${fmt(next.sellCC)}% sell · tax ${fmt(next.defaultTaxRate)}% · ins ${fmt(next.insuranceAnnual)}% · util $${next.utilitiesMonthly}/mo · ${next.daysHeld}d default.`;
    renderFinanceCfgForm();
    renderAll();
    showToast('Financing defaults saved', 'success');
  });

  $('#btn-reset-finance').addEventListener('click', () => {
    resetFinanceCfg();
    renderFinanceCfgForm();
    renderAll();
    const status = $('#finance-cfg-status');
    status.className = 'sync-status';
    status.textContent = 'Reset to defaults (10% rate, 1% orig, 0.5% buy, 3% sell, 1.1% tax, 0.35% ins, $300 util, 180d).';
    showToast('Financing defaults reset');
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
