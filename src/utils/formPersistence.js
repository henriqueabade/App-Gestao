const FormPersistence = (() => {
  function save(form, key) {
    const data = {};
    form.querySelectorAll('input, textarea, select').forEach(el => {
      const id = el.id || el.name;
      if (!id) return;
      if (el.type === 'checkbox' || el.type === 'radio') {
        data[id] = el.checked;
      } else {
        data[id] = el.value;
      }
    });
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (err) {
      console.error('FormPersistence save error', err);
    }
  }

  function load(form, key) {
    const saved = localStorage.getItem(key);
    if (!saved) return;
    try {
      const data = JSON.parse(saved);
      form.querySelectorAll('input, textarea, select').forEach(el => {
        const id = el.id || el.name;
        if (!id || !(id in data)) return;
        if (el.type === 'checkbox' || el.type === 'radio') {
          el.checked = !!data[id];
        } else {
          el.value = data[id];
        }
      });
    } catch (err) {
      console.error('FormPersistence load error', err);
    }
  }

  function init(selector, key) {
    const form = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!form) return () => {};
    const handler = () => save(form, key);
    const fields = form.querySelectorAll('input, textarea, select');
    fields.forEach(el => {
      const evt = (el.type === 'checkbox' || el.type === 'radio') ? 'change' : 'input';
      el.addEventListener(evt, handler);
    });
    load(form, key);
    return () => {
      fields.forEach(el => {
        const evt = (el.type === 'checkbox' || el.type === 'radio') ? 'change' : 'input';
        el.removeEventListener(evt, handler);
      });
    };
  }

  function clear(key) {
    localStorage.removeItem(key);
  }

  return { init, clear, save, load };
})();

window.FormPersistence = FormPersistence;
