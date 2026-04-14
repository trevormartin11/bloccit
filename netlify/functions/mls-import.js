// MLS / Zillow listing import.
//
// Accepts either a listing URL (Zillow/Redfin/Realtor.com) or a raw address
// and returns normalized property fields that the UI can drop into the form.
//
// This function uses the RentCast API by default (https://www.rentcast.io/api)
// which covers ~140M US properties, provides sale & rent estimates, and has
// a generous free tier. Set the env var RENTCAST_API_KEY in Netlify.
//
// If no API key is configured, the function returns a best-effort parse so
// the app still works in demo/offline mode.

const UA = 'FlipCRM/1.0 (+https://github.com/)';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  let query = '';
  try {
    const body = JSON.parse(event.body || '{}');
    query = (body.query || '').trim();
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }
  if (!query) return json(400, { error: 'Missing query' });

  // Normalize URL -> address where possible.
  const address = extractAddressFromInput(query);
  const listingUrl = /^https?:\/\//i.test(query) ? query : null;

  const apiKey = process.env.RENTCAST_API_KEY;
  if (!apiKey) {
    // Demo fallback — return parsed address only, plus a warning.
    return json(200, {
      address: address || query,
      listingUrl,
      source: 'demo',
      _warning: 'RENTCAST_API_KEY not set. Returning address only. Add the env var in Netlify to enable full MLS import.'
    });
  }

  try {
    const property = await lookupRentcast(address, apiKey);
    return json(200, {
      ...property,
      listingUrl: listingUrl || property.listingUrl,
      source: 'rentcast'
    });
  } catch (err) {
    console.error('MLS import failed:', err);
    // Degrade gracefully — still hand back the address.
    return json(200, {
      address: address || query,
      listingUrl,
      source: 'error-fallback',
      _warning: `Lookup failed: ${err.message}. Populated address only.`
    });
  }
};

// ---- Helpers ----------------------------------------------------------

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

// Pull a usable address out of a Zillow/Redfin/Realtor URL, or return as-is.
function extractAddressFromInput(input) {
  if (!/^https?:\/\//i.test(input)) return input;
  try {
    const u = new URL(input);
    const host = u.hostname.toLowerCase();
    let slug = '';
    if (host.includes('zillow.com')) {
      // /homedetails/123-Main-St-Austin-TX-78701/12345_zpid/
      const m = u.pathname.match(/\/homedetails\/([^/]+)/);
      slug = m ? m[1] : '';
    } else if (host.includes('redfin.com')) {
      // /TX/Austin/123-Main-St-78701/home/12345
      const parts = u.pathname.split('/').filter(Boolean);
      const homeIdx = parts.indexOf('home');
      if (homeIdx > 2) slug = parts.slice(0, homeIdx).join('-');
    } else if (host.includes('realtor.com')) {
      // /realestateandhomes-detail/123-Main-St_Austin_TX_78701_M12345-67890
      const m = u.pathname.match(/realestateandhomes-detail\/([^/]+)/);
      slug = m ? m[1].split('_M')[0] : '';
    }
    if (!slug) return input;
    // "123-Main-St-Austin-TX-78701" -> "123 Main St, Austin, TX 78701"
    return humanizeAddressSlug(slug);
  } catch {
    return input;
  }
}

function humanizeAddressSlug(slug) {
  const cleaned = slug.replace(/_/g, '-');
  // Split "123-Main-St-Austin-TX-78701" by finding the state code.
  const parts = cleaned.split('-');
  const stateIdx = parts.findIndex(p => /^[A-Z]{2}$/.test(p));
  if (stateIdx > 0 && stateIdx < parts.length - 1) {
    const street = parts.slice(0, stateIdx - 1).join(' ');
    const city = parts[stateIdx - 1];
    const state = parts[stateIdx];
    const zip = parts.slice(stateIdx + 1).join(' ');
    return `${street}, ${city}, ${state} ${zip}`.trim();
  }
  return parts.join(' ');
}

// RentCast: GET /properties?address=...
async function lookupRentcast(address, apiKey) {
  if (!address) throw new Error('No address to look up');

  const url = 'https://api.rentcast.io/v1/properties?' +
              new URLSearchParams({ address });
  const res = await fetch(url, {
    headers: { 'X-Api-Key': apiKey, 'Accept': 'application/json', 'User-Agent': UA }
  });
  if (!res.ok) throw new Error(`RentCast ${res.status}`);
  const body = await res.json();
  const hit = Array.isArray(body) ? body[0] : body;
  if (!hit) throw new Error('No matching property found');

  // Also fetch an ARV-ish value estimate.
  let arv = null;
  try {
    const valRes = await fetch('https://api.rentcast.io/v1/avm/value?' +
      new URLSearchParams({ address }), {
      headers: { 'X-Api-Key': apiKey, 'Accept': 'application/json', 'User-Agent': UA }
    });
    if (valRes.ok) {
      const v = await valRes.json();
      arv = v?.price || v?.value || null;
    }
  } catch (_) {}

  return {
    address: hit.formattedAddress || address,
    propertyType: mapPropertyType(hit.propertyType),
    beds: hit.bedrooms || null,
    baths: hit.bathrooms || null,
    sqft: hit.squareFootage || null,
    yearBuilt: hit.yearBuilt || null,
    askingPrice: hit.lastSalePrice || null,
    arv: arv,
    ownerName: hit.owner?.names?.[0] || null,
    ownerType: hit.owner?.type === 'Company' ? 'Corporate' : hit.owner ? 'Individual' : null,
    status: 'New',
    dealType: 'MLS',
    strategy: 'Flip'
  };
}

function mapPropertyType(t) {
  if (!t) return 'SFR';
  const s = String(t).toLowerCase();
  if (s.includes('single')) return 'SFR';
  if (s.includes('multi')) return 'Multi-Family';
  if (s.includes('condo')) return 'Condo';
  if (s.includes('town')) return 'Townhome';
  if (s.includes('land')) return 'Land';
  if (s.includes('commerc')) return 'Commercial';
  return 'SFR';
}
