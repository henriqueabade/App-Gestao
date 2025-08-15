const close = () => Modal.close('dependencia');

document.getElementById('fecharDependencia')?.addEventListener('click', close);
document.getElementById('dependenciaOverlay')?.addEventListener('click', e => {
  if (e.target.id === 'dependenciaOverlay') close();
});
