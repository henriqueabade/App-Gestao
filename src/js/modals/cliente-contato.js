(function(){
  const overlay = document.getElementById('novoContatoClienteOverlay');
  if(!overlay) return;
  const close = () => Modal.close('novoContatoCliente');
  overlay.addEventListener('click', e => { if(e.target === overlay) close(); });
  document.getElementById('voltarNovoContatoCliente')?.addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); }});

  const form = document.getElementById('novoContatoClienteForm');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const data = {
      nome: form.nome.value.trim(),
      cargo: form.cargo.value.trim(),
      email: form.email.value.trim(),
      telefone_celular: form.telefone_celular.value.trim(),
      telefone_fixo: form.telefone_fixo.value.trim()
    };
    window.dispatchEvent(new CustomEvent('clienteContatoAdicionado', { detail: data }));
    close();
  });
})();
