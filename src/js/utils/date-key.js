(function (global) {
  const TIME_ZONE = 'America/Sao_Paulo';
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  function getTodayKey(date = new Date()) {
    try {
      const parts = formatter.formatToParts(date);
      const year = parts.find((part) => part.type === 'year')?.value;
      const month = parts.find((part) => part.type === 'month')?.value;
      const day = parts.find((part) => part.type === 'day')?.value;
      if (year && month && day) {
        return `${year}-${month}-${day}`;
      }
    } catch (err) {
      // Ignora e usa fallback abaixo
    }
    const safeDate = date instanceof Date ? date : new Date(date);
    const year = String(safeDate.getFullYear()).padStart(4, '0');
    const month = String(safeDate.getMonth() + 1).padStart(2, '0');
    const day = String(safeDate.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function isSameDayKey(a, b) {
    if (!a || !b) return false;
    return String(a) === String(b);
  }

  const api = {
    getTodayKey,
    isSameDayKey,
    TIME_ZONE,
  };

  global.dateUtils = global.dateUtils || {};
  if (typeof global.dateUtils.getTodayKey !== 'function') {
    global.dateUtils.getTodayKey = getTodayKey;
  }
  if (typeof global.dateUtils.isSameDayKey !== 'function') {
    global.dateUtils.isSameDayKey = isSameDayKey;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
