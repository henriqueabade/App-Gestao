// geo-service.js
// Busca países (nome + ISO-2) e estados por país, com cache e lazy-load.

/* Endpoints públicos */
const ENDPOINT_COUNTRIES =
  'https://restcountries.com/v3.1/all?fields=name,cca2'; // leve (nome + ISO-2)
const ENDPOINT_STATES =
  'https://raw.githubusercontent.com/dr5hn/countries-states-cities-database/master/states.json'; // carregado sob demanda

/* Caches */
let _countriesCache = null;            // Array<{ name, code }>
let _statesIndexByCountry = null;      // Map<string, Array<{ name, code }>>

/* Util: sort por nome (case-insensitive) */
const byName = (a, b) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/**
 * Retorna todos os países (nome + ISO-2), ordenados por nome.
 * Cacheado após a primeira chamada.
 */
async function getCountries() {
  if (_countriesCache) return _countriesCache;

  const res = await fetch(ENDPOINT_COUNTRIES, { cache: 'force-cache' });
  if (!res.ok) throw new Error('Falha ao baixar lista de países');

  const data = await res.json();
  _countriesCache = data
    .map(c => ({ name: c?.name?.common ?? '', code: c?.cca2 ?? '' }))
    .filter(c => c.name && c.code)
    .sort(byName);

  return _countriesCache;
}

/* Garante o índice de estados por país (carrega uma vez e mantém em memória) */
async function ensureStatesIndex() {
  if (_statesIndexByCountry) return _statesIndexByCountry;

  const res = await fetch(ENDPOINT_STATES, { cache: 'force-cache' });
  if (!res.ok) throw new Error('Falha ao baixar lista de estados');

  const states = await res.json(); // [{ country_code, name, state_code, ... }]
  const idx = new Map();

  for (const s of states) {
    const cc = s.country_code; // ISO-2 (ex.: "BR", "US")
    if (!cc) continue;
    if (!idx.has(cc)) idx.set(cc, []);
    idx.get(cc).push({ name: s.name, code: s.state_code || s.name });
  }
  // Ordena cada lista
  for (const [cc, list] of idx) list.sort(byName);

  _statesIndexByCountry = idx;
  return _statesIndexByCountry;
}

/**
 * Retorna os estados/províncias de um país (ISO-2), ex.: "BR", "US".
 * Lazy-load: baixa o dataset na primeira chamada e guarda em cache.
 */
async function getStatesByCountry(iso2) {
  if (!iso2) return [];
  const idx = await ensureStatesIndex();
  return idx.get(iso2) ?? [];
}

/* Opcional: helpers */
function clearGeoCache() {
  _countriesCache = null;
  _statesIndexByCountry = null;
}

// Expondo funções no escopo global
window.geoService = { getCountries, getStatesByCountry, clearGeoCache };
