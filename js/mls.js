// MLS / Zillow import client.
// Calls the Netlify serverless function at /.netlify/functions/mls-import
// which proxies to a real estate data API (RentCast / ATTOM / etc.) when
// an API key is configured. If the function is unavailable (e.g. local
// preview without a backend), falls back to a best-effort URL parser + demo.

(function (global) {
  const ENDPOINT = '/.netlify/functions/mls-import';

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

  // Very lightweight Zillow URL address extractor (used as a fallback
  // demo when the serverless function isn't available).
  function parseZillowUrl(url) {
    try {
      const u = new URL(url);
      if (!/zillow\.com/i.test(u.hostname)) return null;
      // e.g. /homedetails/123-Main-St-Austin-TX-78701/12345_zpid/
      const m = u.pathname.match(/\/homedetails\/([^/]+)/);
      if (!m) return null;
      const slug = m[1].replace(/-/g, ' ');
      // Try to split "123 Main St Austin TX 78701" -> "123 Main St, Austin, TX 78701"
      const zip = slug.match(/\b(\d{5})\b/);
      const state = slug.match(/\b([A-Z]{2})\b/);
      return { address: slug, zip: zip?.[1], state: state?.[1] };
    } catch {
      return null;
    }
  }

  async function importListing(query) {
    // Prefer the serverless function (real data).
    try {
      const data = await fetchFromServer(query);
      return { ...data, source: data.source || 'api' };
    } catch (err) {
      // Fallback: attempt to at least populate an address from a Zillow URL.
      const parsed = parseZillowUrl(query);
      if (parsed) {
        return {
          address: parsed.address,
          listingUrl: query,
          source: 'url-parse',
          _warning: 'Backend unavailable — populated address only. ' +
                    'Deploy to Netlify with an API key for full field import.'
        };
      }
      throw err;
    }
  }

  global.MLS = { importListing };
})(window);
