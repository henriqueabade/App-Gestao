(function () {
  let runtimeConfigPromise = null;
  let cachedConfig = null;

  const hasProtocol = (value) => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value);
  const isDataLike = (value) => /^(?:data|blob|file):/i.test(value);

  async function loadRuntimeConfig() {
    if (!runtimeConfigPromise) {
      runtimeConfigPromise = (async () => {
        if (!window.electronAPI?.getRuntimeConfig) {
          throw new Error('Runtime config API not available');
        }
        const config = await window.electronAPI.getRuntimeConfig();
        if (!config || typeof config.apiBaseUrl !== 'string') {
          throw new Error('Invalid runtime config received');
        }
        cachedConfig = config;
        return config;
      })().catch((err) => {
        runtimeConfigPromise = null;
        throw err;
      });
    }
    return runtimeConfigPromise;
  }

  async function getApiBaseUrl() {
    const config = await loadRuntimeConfig();
    return config.apiBaseUrl;
  }

  const getCachedBaseUrl = () => cachedConfig?.apiBaseUrl ?? null;

  const normalizeUrlWithBase = (value, baseUrl) => {
    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value !== 'string') {
      return value;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }

    if (isDataLike(trimmed) || hasProtocol(trimmed)) {
      return trimmed;
    }

    if (!baseUrl) {
      return trimmed;
    }

    try {
      return new URL(trimmed, baseUrl).toString();
    } catch (err) {
      return trimmed;
    }
  };

  function resolveUrl(value) {
    return normalizeUrlWithBase(value, getCachedBaseUrl());
  }

  async function resolveUrlAsync(value) {
    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value !== 'string') {
      return value;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }

    const cached = resolveUrl(trimmed);
    if (cached !== trimmed || isDataLike(trimmed) || hasProtocol(trimmed)) {
      return cached;
    }

    try {
      const config = await loadRuntimeConfig();
      return normalizeUrlWithBase(trimmed, config.apiBaseUrl);
    } catch (err) {
      return trimmed;
    }
  }

  window.apiConfig = {
    getRuntimeConfig: loadRuntimeConfig,
    getApiBaseUrl,
    resolveUrl,
    resolveUrlAsync
  };
})();
