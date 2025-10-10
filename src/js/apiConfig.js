(function () {
  let runtimeConfigPromise = null;

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

  window.apiConfig = {
    getRuntimeConfig: loadRuntimeConfig,
    getApiBaseUrl
  };
})();
