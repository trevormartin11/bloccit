// Weekly sold-price checker.
//
// Runs on a schedule (see exports.config below) to look up every tracked
// property and mark it "Sold" when a recent sale is detected. Runs weekly
// (Monday 07:00 UTC) rather than nightly to stay within RentCast's 50-call
// free tier — a ~10-property pipeline costs ~40 calls/mo this way.
//
// Architecture note: this function is stateless — Netlify scheduled functions
// can't reach the user's browser-localStorage data directly. Two modes:
//
//   1. SCHEDULED mode (no request body): reads the property list from a
//      server-side store if configured (e.g. Netlify Blobs, set via the
//      FLIPCRM_BLOB_STORE env var). If not configured, exits quietly.
//
//   2. ON-DEMAND mode (POST with {properties: [...]}): the browser pushes
//      its current list and receives back any sold-price updates. This is
//      what the "Check Sold Prices" button uses.
//
// Both modes ultimately call the same lookupSoldPrice() implementation.

const { getStore } = (() => {
  try { return require('@netlify/blobs'); } catch { return {}; }
})();

exports.handler = async (event) => {
  const apiKey = process.env.RENTCAST_API_KEY;

  // On-demand: browser-supplied list of properties.
  if (event.httpMethod === 'POST' && event.body) {
    let properties = [];
    try { properties = JSON.parse(event.body).properties || []; } catch {}

    // If no body payload, fall through to scheduled-mode (blob store).
    if (properties.length) {
      const updated = await findSoldUpdates(properties, apiKey);
      return json(200, { updated, checked: properties.length });
    }
  }

  // Scheduled mode — read from Netlify Blobs if available.
  if (!getStore) {
    return json(200, { updated: [], note: 'Scheduled mode requires @netlify/blobs + synced property list.' });
  }
  try {
    const store = getStore('flipcrm');
    const list = (await store.get('properties', { type: 'json' })) || [];
    const updated = await findSoldUpdates(list, apiKey);
    if (updated.length) {
      const patched = list.map(p => {
        const u = updated.find(x => x.id === p.id);
        return u ? { ...p, soldPrice: u.soldPrice, soldCheckedAt: new Date().toISOString() } : p;
      });
      await store.setJSON('properties', patched);
    }
    return json(200, { updated, checked: list.length });
  } catch (err) {
    console.error('Scheduled sold-check failed:', err);
    return json(500, { error: err.message });
  }
};

// Config for Netlify scheduled function.
// Runs every Monday at 07:00 UTC (~2-3 AM US). Cron: min hr dom mon dow.
exports.config = { schedule: '0 7 * * 1' };

// ---- Core logic -------------------------------------------------------

async function findSoldUpdates(properties, apiKey) {
  const updated = [];
  // Only check ones that are still in the pipeline, not already sold/archived.
  const candidates = properties.filter(p =>
    p && p.address && !p.soldPrice &&
    !['Offer Lost', 'Bad Deal', 'Accepted Contract'].includes(p.status)
  );

  // Throttle — at most N concurrent lookups.
  const CONCURRENCY = 3;
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const slice = candidates.slice(i, i + CONCURRENCY);
    const results = await Promise.all(slice.map(p =>
      lookupSoldPrice(p.address, apiKey)
        .then(price => price ? { id: p.id, soldPrice: price } : null)
        .catch(() => null)
    ));
    results.filter(Boolean).forEach(r => updated.push(r));
  }
  return updated;
}

async function lookupSoldPrice(address, apiKey) {
  if (!apiKey) return null;
  // RentCast /listings/sale returns the most recent listing for the address.
  // When status === 'Inactive' and the removedDate is recent, the listing
  // was de-listed (typically because it sold). The free API doesn't expose
  // the actual closing price, so we use the final list price as the best
  // available proxy.
  try {
    const url = 'https://api.rentcast.io/v1/listings/sale?' +
                new URLSearchParams({ address, limit: '1' });
    const res = await fetch(url, {
      headers: { 'X-Api-Key': apiKey, 'Accept': 'application/json' }
    });
    if (!res.ok) return null;
    const arr = await res.json();
    const hit = Array.isArray(arr) ? arr[0] : null;
    if (!hit) return null;
    // Only treat as "sold" if inactive AND removed in the last 180 days.
    if (hit.status !== 'Inactive') return null;
    const endDate = hit.removedDate || hit.lastSeenDate;
    if (!endDate) return null;
    const days = (Date.now() - new Date(endDate).getTime()) / 86400000;
    if (days < 0 || days > 180) return null;
    return hit.price || null;
  } catch {
    return null;
  }
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}
