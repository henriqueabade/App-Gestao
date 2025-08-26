(async function(){
  const overlay = document.getElementById('editarContatoOverlay');
  if(!overlay) return;
  const close = () => Modal.close('editarContato');
  overlay.addEventListener('click', e => { if(e.target === overlay) close(); });
  const voltar = document.getElementById('voltarEditarContato');
  if(voltar) voltar.addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key === 'Escape'){ close(); document.removeEventListener('keydown', esc); }});

  const contato = window.contatoEditar;
  if(contato){
    preencher(contato);
  }
  window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'editarContato' }));

  const form = document.getElementById('editarContatoForm');
  if(form){
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const body = {
        nome: document.getElementById('editarNome').value,
        cargo: document.getElementById('editarCargo').value,
        email: document.getElementById('editarEmail').value,
        telefone_celular: document.getElementById('editarCelular').value,
        telefone_fixo: document.getElementById('editarFixo').value
      };
      try{
        const res = await fetch(`http://localhost:3000/api/contatos/${contato.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if(!res.ok) throw new Error('Erro ao salvar');
        showToast('Contato atualizado com sucesso', 'success');
        close();
      }catch(err){
        console.error('Erro ao atualizar contato', err);
        showToast('Erro ao atualizar contato', 'error');
      }
    });
  }

  function preencher(c){
    const map = {
      editarNome: 'nome',
      editarCargo: 'cargo',
      editarEmail: 'email',
      editarCelular: 'telefone_celular',
      editarFixo: 'telefone_fixo'
    };
    for(const id in map){
      const el = document.getElementById(id);
      if(el) el.value = c[map[id]] || '';
    }
    const titulo = document.getElementById('contatoEditarTitulo');
    if(titulo) titulo.textContent = c.nome ? `Editar – ${c.nome}` : 'Editar Contato';
  }
})();
