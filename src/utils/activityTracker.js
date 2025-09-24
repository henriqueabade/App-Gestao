(function setupActivityTracker() {
  const api = window.electronAPI;
  if (!api || typeof api.recordActivity !== 'function') {
    return;
  }

  const METHOD_SKIP = new Set(['GET', 'HEAD', 'OPTIONS']);

  function shouldTrack(url, method) {
    if (!url) return false;
    const normalized = String(url).toLowerCase();
    if (!normalized.startsWith('http')) return false;
    if (!normalized.includes('/api/')) return false;
    return !METHOD_SKIP.has(method);
  }

  function summarizeBody(body) {
    if (!body) return null;
    if (typeof body === 'string') {
      if (!body.trim()) return null;
      try {
        const parsed = JSON.parse(body);
        return JSON.stringify(parsed).slice(0, 200);
      } catch (_) {
        return body.slice(0, 200);
      }
    }
    if (body instanceof URLSearchParams) {
      return body.toString().slice(0, 200);
    }
    if (body instanceof FormData) {
      const entries = [];
      for (const [key, value] of body.entries()) {
        entries.push(`${key}=${String(value).slice(0, 40)}`);
        if (entries.length >= 10) break;
      }
      return entries.join('&');
    }
    return null;
  }

  const originalFetch = window.fetch ? window.fetch.bind(window) : null;
  if (!originalFetch) return;

  window.registerUserAction = function registerUserAction(module, description, extra = {}) {
    if (!module && !description) return;
    const payload = {
      module,
      description,
      ...extra,
      source: extra.source || 'renderer'
    };
    api.recordActivity(payload);
  };

  window.fetch = async function trackedFetch(input, init = {}) {
    const request = input instanceof Request ? input : null;
    const url = request ? request.url : typeof input === 'string' ? input : null;
    const method = (init.method || (request && request.method) || 'GET').toUpperCase();
    const startedAt = Date.now();
    const bodySummary = summarizeBody(init.body);
    const track = shouldTrack(url, method);

    try {
      const response = await originalFetch(input, init);
      if (track) {
        api.recordActivity({
          source: 'fetch',
          method,
          url,
          bodySummary,
          ok: response ? response.ok : false,
          status: response ? response.status : undefined,
          timestamp: startedAt
        });
      }
      return response;
    } catch (err) {
      if (track) {
        api.recordActivity({
          source: 'fetch',
          method,
          url,
          bodySummary,
          ok: false,
          error: err ? err.message : 'erro-desconhecido',
          timestamp: startedAt
        });
      }
      throw err;
    }
  };
})();
