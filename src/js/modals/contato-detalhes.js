(async function(){
  const overlay = document.getElementById('detalhesContatoOverlay');
  if(!overlay) return;
  const close = () => Modal.close('detalhesContato');
  overlay.addEventListener('click', e => { if(e.target === overlay) close(); });
  const voltar = document.getElementById('voltarDetalhesContato');
  if(voltar) voltar.addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key === 'Escape'){ close(); document.removeEventListener('keydown', esc); }});

  const contato = window.contatoDetalhes;
  if(contato){
    try{
      const res = await fetch(`http://localhost:3000/api/contatos/${contato.id}`);
      const data = await res.json();
      preencher(data);
      window.contatoEditar = data;
    }catch(err){
      console.error('Erro ao carregar detalhes do contato', err);
    }finally{
      window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'detalhesContato' }));
    }
  }else{
    window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'detalhesContato' }));
  }

  const editar = document.getElementById('editarDetalhesContato');
  if(editar){
    editar.addEventListener('click', () => {
      close();
      if(window.contatoEditar) abrirEditarContato(window.contatoEditar);
    });
  }

  function preencher(c){
    const map = {
      detalhesNome: 'nome',
      detalhesCargo: 'cargo',
      detalhesEmail: 'email',
      detalhesCelular: 'telefone_celular',
      detalhesFixo: 'telefone_fixo'
    };
    for(const id in map){
      const el = document.getElementById(id);
      if(el) el.value = c[map[id]] || '';
    }
    const titulo = document.getElementById('contatoDetalhesTitulo');
    if(titulo) titulo.textContent = c.nome ? `Detalhes – ${c.nome}` : 'Detalhes do Contato';
  }
})();
