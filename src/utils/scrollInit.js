// Ativa scroll apenas após o carregamento completo e em novos módulos
window.addEventListener('load', () => {
  const apply = () => {
    document.querySelectorAll('#content, .scroll-container').forEach(el => {
      if (!el.classList.contains('scroll-ready')) {
        el.classList.add('scroll-ready');
      }
    });
  };

  apply();
  document.addEventListener('module-change', apply);
});
