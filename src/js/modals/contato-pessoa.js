// Pessoa de contato do fornecedor/prestador: o mesmo mini-modal do contato
// do cliente (cliente-contato.js). Nada vai ao servidor daqui: a pessoa vai
// no salvamento do contato. Com `window.contatoPessoaEditar` abre para editar.
(function(){
  const overlay = document.getElementById('pessoaContatoOverlay');
  if(!overlay) return;
  const close = () => Modal.close('pessoaContato');
  document.getElementById('voltarPessoaContato')?.addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ e.stopPropagation(); close(); document.removeEventListener('keydown', esc); }}, true);

  const form = document.getElementById('pessoaContatoForm');
  const editando = window.contatoPessoaEditar || null;
  delete window.contatoPessoaEditar;
  if (editando) {
    document.getElementById('pessoaContatoTitulo').textContent = 'Editar pessoa';
    form.nome.value = editando.nome || '';
    form.cargo.value = editando.cargo || '';
    form.email.value = editando.email || '';
    form.telefone_celular.value = editando.telefone_celular || '';
    form.telefone_fixo.value = editando.telefone_fixo || '';
    overlay.querySelector('footer button').textContent = 'Salvar';
  }
  const onlyDigits = e => { e.target.value = e.target.value.replace(/[^\d()+\-\s]/g, ''); };
  form.telefone_celular.addEventListener('input', onlyDigits);
  form.telefone_fixo.addEventListener('input', onlyDigits);
  form.addEventListener('submit', e => {
    e.preventDefault();
    const data = {
      nome: form.nome.value.trim(),
      cargo: form.cargo.value.trim(),
      email: form.email.value.trim(),
      telefone_celular: form.telefone_celular.value.trim(),
      telefone_fixo: form.telefone_fixo.value.trim()
    };
    if (!data.nome) { form.nome.focus(); return; }
    window.dispatchEvent(new CustomEvent('contatoPessoaSalva', { detail: { ...data, indice: editando?.indice } }));
    close();
  });
})();
