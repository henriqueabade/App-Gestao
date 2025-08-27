// geo-service.js
// Busca países (nome + ISO-2) e estados por país, com cache e lazy-load.

/* Endpoints públicos */
const ENDPOINT_COUNTRIES =
  'https://restcountries.com/v3.1/all?fields=name,cca2'; // leve (nome + ISO-2)
const ENDPOINT_STATES =
  // dataset completo de estados, listado dentro da pasta "json" do repositório
  'https://raw.githubusercontent.com/dr5hn/countries-states-cities-database/master/json/states.json'; // carregado sob demanda

// Fallbacks offline mínimos para evitar falhas quando não há internet
const FALLBACK_COUNTRIES = [{ name: 'Brasil', code: 'BR' }];
const FALLBACK_STATES = {
  BR: [
    { name: 'Acre', code: 'AC' },
    { name: 'Alagoas', code: 'AL' },
    { name: 'Amapá', code: 'AP' },
    { name: 'Amazonas', code: 'AM' },
    { name: 'Bahia', code: 'BA' },
    { name: 'Ceará', code: 'CE' },
    { name: 'Distrito Federal', code: 'DF' },
    { name: 'Espírito Santo', code: 'ES' },
    { name: 'Goiás', code: 'GO' },
    { name: 'Maranhão', code: 'MA' },
    { name: 'Mato Grosso', code: 'MT' },
    { name: 'Mato Grosso do Sul', code: 'MS' },
    { name: 'Minas Gerais', code: 'MG' },
    { name: 'Pará', code: 'PA' },
    { name: 'Paraíba', code: 'PB' },
    { name: 'Paraná', code: 'PR' },
    { name: 'Pernambuco', code: 'PE' },
    { name: 'Piauí', code: 'PI' },
    { name: 'Rio de Janeiro', code: 'RJ' },
    { name: 'Rio Grande do Norte', code: 'RN' },
    { name: 'Rio Grande do Sul', code: 'RS' },
    { name: 'Rondônia', code: 'RO' },
    { name: 'Roraima', code: 'RR' },
    { name: 'Santa Catarina', code: 'SC' },
    { name: 'São Paulo', code: 'SP' },
    { name: 'Sergipe', code: 'SE' },
    { name: 'Tocantins', code: 'TO' }
  ]
};

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
  try {
    const res = await fetch(ENDPOINT_COUNTRIES, { cache: 'force-cache' });
    if (!res.ok) throw new Error('Falha ao baixar lista de países');
    const data = await res.json();
    _countriesCache = data
      .map(c => ({ name: c?.name?.common ?? '', code: c?.cca2 ?? '' }))
      .filter(c => c.name && c.code)
      .sort(byName);
  } catch (err) {
    console.warn('getCountries fallback usado:', err);
    _countriesCache = FALLBACK_COUNTRIES.slice();
  }
  return _countriesCache;
}

/* Garante o índice de estados por país (carrega uma vez e mantém em memória) */
async function ensureStatesIndex() {
  if (_statesIndexByCountry) return _statesIndexByCountry;

  const idx = new Map();
  try {
    const res = await fetch(ENDPOINT_STATES, { cache: 'force-cache' });
    if (!res.ok) throw new Error('Falha ao baixar lista de estados');
    const states = await res.json(); // [{ country_code, name, state_code, ... }]
    for (const s of states) {
      const cc = s.country_code;
      if (!cc) continue;
      if (!idx.has(cc)) idx.set(cc, []);
      idx.get(cc).push({ name: s.name, code: s.state_code || s.name });
    }
  } catch (err) {
    console.warn('ensureStatesIndex fallback usado:', err);
    for (const cc in FALLBACK_STATES) {
      idx.set(cc, FALLBACK_STATES[cc].slice());
    }
  }
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
