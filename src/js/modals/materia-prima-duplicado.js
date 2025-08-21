const close = () => Modal.close('duplicado');

document.getElementById('fecharDuplicado')?.addEventListener('click', close);
document.getElementById('duplicadoOverlay')?.addEventListener('click', e => {
  if (e.target.id === 'duplicadoOverlay') close();
});

