// MLS / Zillow import client.
//
// Calls the Netlify serverless function at /.netlify/functions/mls-import
// which proxies to a real estate data API (RentCast). If the function
// is unavailable (e.g. GitHub Pages deploy), falls back to extracting an
// address from the pasted URL so the user still gets something.

(function (global) {
  const ENDPOINT = '/.netlify/functions/mls-import';

  async function probeBackend() {
    try {
      const res = await fetch(ENDPOINT, { method: 'OPTIONS' });
      return res.status < 500;
    } catch { return false; }
  }

  async function fetchFromServer(query) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Import failed (${res.status}): ${text || res.statusText}`);
    }
    return res.json();
  }

  function parseListingUrl(url) {
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      let slug = '';
      if (host.includes('zillow.com')) {
        const m = u.pathname.match(/\/homedetails\/([^/]+)/);
        slug = m ? m[1] : '';
      } else if (host.includes('redfin.com')) {
        const parts = u.pathname.split('/').filter(Boolean);
        const homeIdx = parts.indexOf('home');
        if (homeIdx > 2) slug = parts.slice(0, homeIdx).join('-');
      } else if (host.includes('realtor.com')) {
        const m = u.pathname.match(/realestateandhomes-detail\/([^/]+)/);
        slug = m ? m[1].split('_M')[0] : '';
      }
      if (!slug) return null;
      const cleaned = slug.replace(/_/g, '-');
      const parts = cleaned.split('-');
      const stateIdx = parts.findIndex(p => /^[A-Z]{2}$/.test(p));
      if (stateIdx > 0 && stateIdx < parts.length - 1) {
        const street = parts.slice(0, stateIdx - 1).join(' ');
        const city = parts[stateIdx - 1];
        const state = parts[stateIdx];
        const zip = parts.slice(stateIdx + 1).join(' ');
        return { address: `${street}, ${city}, ${state} ${zip}`.trim() };
      }
      return { address: parts.join(' ') };
    } catch { return null; }
  }

  async function importListing(query) {
    try {
      const data = await fetchFromServer(query);
      return { ...data, source: data.source || 'api' };
    } catch (err) {
      // No backend — try URL parsing.
      const parsed = parseListingUrl(query);
      if (parsed) {
        return {
          address: parsed.address,
          listingUrl: /^https?:\/\//i.test(query) ? query : null,
          source: 'url-parse',
          _warning: 'Backend unavailable — filled address only. Deploy to Netlify with RENTCAST_API_KEY for full auto-import.'
        };
      }
      throw err;
    }
  }

  global.MLS = { importListing, probeBackend };
})(window);
