;(function () {
  const overlay = document.getElementById('duplicadoOverlay');
  const close = () => Modal.close('duplicado');

  document.getElementById('fecharDuplicado')?.addEventListener('click', close);
  overlay?.addEventListener('click', e => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', esc);
    }
  });
})();

