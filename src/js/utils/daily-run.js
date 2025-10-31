(function (global) {
  const DEFAULT_PREFIX = 'daily-flag';

  function sanitizeIdentifier(value) {
    if (value === undefined || value === null) {
      return 'anonimo';
    }
    const normalized = String(value).trim();
    if (!normalized) return 'anonimo';
    return normalized.replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase();
  }

  function resolveUserIdentifier(user) {
    if (!user || typeof user !== 'object') {
      return 'anonimo';
    }
    return (
      user.id ||
      user.usuario_id ||
      user.userId ||
      user.email ||
      user.login ||
      user.uid ||
      user.cpf ||
      user.nome ||
      'anonimo'
    );
  }

  function getScopedKey(baseKey, user, prefix = DEFAULT_PREFIX) {
    const identifier = sanitizeIdentifier(resolveUserIdentifier(user));
    return `${prefix}:${baseKey}:${identifier}`;
  }

  function readFlag(baseKey, user, storage) {
    const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!store || typeof store.getItem !== 'function') {
      return null;
    }
    try {
      return store.getItem(getScopedKey(baseKey, user));
    } catch (err) {
      return null;
    }
  }

  function writeFlag(baseKey, user, value, storage) {
    const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!store || typeof store.setItem !== 'function') {
      return false;
    }
    try {
      store.setItem(getScopedKey(baseKey, user), value);
      return true;
    } catch (err) {
      return false;
    }
  }

  function clearFlag(baseKey, user, storage) {
    const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!store || typeof store.removeItem !== 'function') {
      return false;
    }
    try {
      store.removeItem(getScopedKey(baseKey, user));
      return true;
    } catch (err) {
      return false;
    }
  }

  function shouldRunToday(baseKey, user, { storage, todayKey } = {}) {
    const today = todayKey || (global.dateUtils?.getTodayKey?.() ?? new Date().toISOString().slice(0, 10));
    const stored = readFlag(baseKey, user, storage);
    return stored !== today;
  }

  function markToday(baseKey, user, { storage, todayKey } = {}) {
    const today = todayKey || (global.dateUtils?.getTodayKey?.() ?? new Date().toISOString().slice(0, 10));
    writeFlag(baseKey, user, today, storage);
    return today;
  }

  const api = {
    getScopedKey,
    readFlag,
    writeFlag,
    clearFlag,
    shouldRunToday,
    markToday,
  };

  global.dailyRun = global.dailyRun || {};
  Object.keys(api).forEach((key) => {
    if (typeof global.dailyRun[key] !== 'function') {
      global.dailyRun[key] = api[key];
    }
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
