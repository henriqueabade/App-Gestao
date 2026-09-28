// Novo Contato (fornecedor, prestador de serviço, parceiro…): o mesmo desenho
// do Novo Cliente. A lógica da ficha (abas, tipo com + e −, CNPJ/CPF,
// endereço, pessoas) mora em src/js/utils/contato-ficha.js.
(async function(){
  const overlay = document.getElementById('novoContatoOverlay');
  if(!overlay) return;
  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }
  let tiposLigados = null;
  const close = () => { tiposLigados?.destruir?.(); Modal.close('novoContato'); };
  document.getElementById('voltarNovoContato')?.addEventListener('click', close);
  document.getElementById('cancelarNovoContato')?.addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); }});

  // O utilitário da ficha carrega antes de o modal aparecer (o spinner segura a tela).
  const carregarUtil = (arquivo, global) => (window[global] ? Promise.resolve() : new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `../js/utils/${arquivo}`;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Não foi possível carregar ${arquivo}.`));
    document.head.appendChild(s);
  }));
  const pronto = () => window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'novoContato' }));
  try {
    await carregarUtil('contato-ficha.js', 'ContatoFicha');
  } catch (err) {
    console.error(err);
    pronto();
    showToast('Não foi possível abrir o cadastro de contato.', 'error');
    return;
  }
  const F = window.ContatoFicha;
  const { activateTab, abaAtiva } = F.ligarAbas(overlay);
  F.ligarTipoPessoa();
  try {
    tiposLigados = await F.ligarTipos({ select: document.getElementById('contatoTipo'), botaoMais: document.getElementById('addTipoContato'), botaoMenos: document.getElementById('delTipoContato') });
    await F.ligarEndereco();
  } catch (err) {
    console.error('Erro ao montar o cadastro de contato', err);
  } finally {
    pronto();
  }

  // ------------------------------------------------------------ pessoas
  const pessoas = [];
  const tbody = document.getElementById('pessoasTabela');
  const acoes = {
    editar: idx => F.abrirPessoa({ ...pessoas[idx], indice: idx }),
    excluir: idx => { pessoas.splice(idx, 1); F.renderPessoas(tbody, pessoas, acoes); }
  };
  F.renderPessoas(tbody, pessoas, acoes);
  document.getElementById('addPessoaBtn')?.addEventListener('click', () => F.abrirPessoa());
  const aoSalvarPessoa = e => {
    const { indice, ...dados } = e.detail || {};
    if (indice !== undefined && pessoas[indice]) Object.assign(pessoas[indice], dados);
    else pessoas.push(dados);
    F.renderPessoas(tbody, pessoas, acoes);
  };
  window.addEventListener('contatoPessoaSalva', aoSalvarPessoa);
  window.addEventListener('modalFechado', function soltar(e){
    if (e.detail !== 'novoContato') return;
    window.removeEventListener('contatoPessoaSalva', aoSalvarPessoa);
    window.removeEventListener('modalFechado', soltar);
  });

  // Preservação do trabalho (docs/restauracao-de-trabalho.md): as pessoas são
  // estado interno, e o tipo/país/estado são selects carregados por fetch.
  window.EstadoTrabalho?.registrarConteudo?.('novoContato', {
    capturar: () => ({
      pessoas: pessoas.map(p => ({ ...p })), abaAtiva: abaAtiva(),
      tipo: document.getElementById('contatoTipo')?.value || '',
      endereco: { pais: document.getElementById('endPais')?.value || '', estado: document.getElementById('endEstado')?.value || '' }
    }),
    restaurar: async (dados) => {
      if (!dados) return;
      if (Array.isArray(dados.pessoas) && dados.pessoas.length) { pessoas.length = 0; dados.pessoas.forEach(p => pessoas.push({ ...p })); F.renderPessoas(tbody, pessoas, acoes); }
      const repor = window.EstadoTrabalho?.reporSelect;
      if (repor) {
        await repor(document.getElementById('contatoTipo'), dados.tipo);
        if (dados.endereco?.pais) {
          await repor(document.getElementById('endPais'), dados.endereco.pais);
          await repor(document.getElementById('endEstado'), dados.endereco.estado);
        }
      }
      if (dados.abaAtiva) activateTab(document.getElementById(dados.abaAtiva), { setFocus: false });
    }
  });

  document.getElementById('registrarContato')?.addEventListener('click', async () => {
    const dados = F.coletarDados({ activateTab });
    if(!dados) return;
    try{
      const res = await fetchApi('/api/contatos', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ ...dados, pessoas }) });
      const corpo = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(corpo.error || 'Erro ao registrar o contato', 'error');
        return;
      }
      showToast('Contato registrado com sucesso');
      window.dispatchEvent(new CustomEvent('moduloSalvou', { detail: { overlay: 'novoContato' } }));
      window.dispatchEvent(new Event('contatoAdicionado'));
      close();
    }catch(err){
      console.error('Erro ao registrar contato', err);
      showToast('Erro ao registrar contato', 'error');
    }
  });
})();
