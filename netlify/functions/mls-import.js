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

// Common US street suffixes — used to find the street/city boundary so
// multi-word cities ("San Antonio", "Los Angeles", "New York") don't get
// broken up.
const STREET_SUFFIXES = new Set([
  'st', 'street', 'ave', 'avenue', 'rd', 'road', 'dr', 'drive',
  'blvd', 'boulevard', 'ln', 'lane', 'ct', 'court', 'pl', 'place',
  'way', 'cir', 'circle', 'ter', 'terrace', 'pkwy', 'parkway',
  'hwy', 'highway', 'trl', 'trail', 'cv', 'cove', 'ridge', 'run',
  'path', 'row', 'walk', 'plaza', 'sq', 'square', 'loop'
]);

function humanizeAddressSlug(slug) {
  const parts = slug.replace(/_/g, '-').split('-');

  // Locate the state (two uppercase letters) — last hop before the zip.
  const stateIdx = parts.findIndex(p => /^[A-Z]{2}$/.test(p));
  if (stateIdx < 2 || stateIdx >= parts.length) return parts.join(' ');

  const state = parts[stateIdx];
  const zip = parts.slice(stateIdx + 1).join(' ');

  // Find the last street suffix *before* the state; city = everything
  // between it and the state, street = everything up through the suffix.
  let suffixIdx = -1;
  for (let i = stateIdx - 1; i >= 0; i--) {
    if (STREET_SUFFIXES.has(parts[i].toLowerCase())) { suffixIdx = i; break; }
  }
  let street, city;
  if (suffixIdx >= 0 && suffixIdx < stateIdx - 1) {
    street = parts.slice(0, suffixIdx + 1).join(' ');
    city = parts.slice(suffixIdx + 1, stateIdx).join(' ');
  } else {
    // Fallback: assume last token before state is the city.
    street = parts.slice(0, stateIdx - 1).join(' ');
    city = parts[stateIdx - 1];
  }
  return `${street}, ${city}, ${state} ${zip}`.trim();
}

// RentCast: GET /properties?address=...
// Verified response shape (April 2025): formattedAddress, propertyType,
// bedrooms, bathrooms, squareFootage, yearBuilt, owner {names:[], type}.
// lastSalePrice is NOT top-level — it lives in history[date].price where
// event === 'Sale' (and only for some properties).
async function lookupRentcast(address, apiKey) {
  if (!address) throw new Error('No address to look up');

  const res = await fetch('https://api.rentcast.io/v1/properties?' +
    new URLSearchParams({ address }), {
    headers: { 'X-Api-Key': apiKey, 'Accept': 'application/json', 'User-Agent': UA }
  });
  if (!res.ok) throw new Error(`RentCast ${res.status}`);
  const body = await res.json();
  const hit = Array.isArray(body) ? body[0] : body;
  if (!hit) throw new Error('No matching property found');

  // Fetch the most recent listing for asking-price. We deliberately do NOT
  // call /v1/avm/value — ARV is a human decision that factors in the rehab
  // scope, and pulling the AVM was costing an API token per import without
  // adding real value. User fills ARV + Max Offer manually.
  const listing = await fetchJson(
    'https://api.rentcast.io/v1/listings/sale?' + new URLSearchParams({ address, limit: '1' }),
    apiKey
  );
  const latestListing = Array.isArray(listing) ? listing[0] : listing;

  return {
    address: hit.formattedAddress || address,
    propertyType: mapPropertyType(hit.propertyType),
    beds: hit.bedrooms || null,
    baths: hit.bathrooms || null,
    sqft: hit.squareFootage || null,
    yearBuilt: hit.yearBuilt || null,
    askingPrice: latestListing?.price || latestSalePrice(hit) || null,
    annualPropertyTax: latestPropertyTax(hit),
    monthlyHOA: hit.hoa?.fee || null,
    ownerName: (hit.owner?.names || []).join(' & ') || null,
    ownerType: mapOwnerType(hit.owner?.type),
    status: 'New',
    dealType: 'MLS',
    strategy: 'Flip'
  };
}

// Walks property.propertyTaxes (keyed by year) and returns the most-recent
// year's total tax amount. RentCast typically uses { "2024": { year, total } }.
function latestPropertyTax(property) {
  const taxes = property?.propertyTaxes;
  if (!taxes || typeof taxes !== 'object') return null;
  const years = Object.keys(taxes).sort().reverse();
  for (const y of years) {
    const v = taxes[y];
    const amount = v?.total || v?.amount || v?.value;
    if (typeof amount === 'number' && amount > 0) return amount;
  }
  return null;
}

async function fetchJson(url, apiKey) {
  try {
    const r = await fetch(url, {
      headers: { 'X-Api-Key': apiKey, 'Accept': 'application/json', 'User-Agent': UA }
    });
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

// Walk the property's sale history and return the most recent priced sale.
function latestSalePrice(property) {
  const hist = property?.history;
  if (!hist || typeof hist !== 'object') return null;
  const entries = Object.entries(hist)
    .filter(([, v]) => v?.event === 'Sale' && typeof v.price === 'number')
    .sort(([a], [b]) => (a < b ? 1 : -1)); // newest first by date key
  return entries[0]?.[1].price || null;
}

function mapPropertyType(t) {
  if (!t) return 'SFR';
  const s = String(t).toLowerCase();
  if (s.includes('single')) return 'SFR';
  if (s.includes('multi') || s.includes('duplex') || s.includes('triplex') || s.includes('fourplex')) return 'Multi-Family';
  if (s.includes('condo') || s.includes('apartment')) return 'Condo';
  if (s.includes('town')) return 'Townhome';
  if (s.includes('land') || s.includes('vacant')) return 'Land';
  if (s.includes('commerc')) return 'Commercial';
  return 'SFR';
}

function mapOwnerType(t) {
  if (!t) return null;
  const s = String(t).toLowerCase();
  if (s.includes('company') || s.includes('corp') || s.includes('llc')) return 'Corporate';
  if (s.includes('trust')) return 'Trust';
  return 'Individual';
}
