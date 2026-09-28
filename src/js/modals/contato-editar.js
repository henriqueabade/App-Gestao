// Editar Contato: a mesma ficha do Novo, preenchida pelo GET /api/contatos/:id.
// As pessoas acumulam o que mudou (new / updated / excluídas) e tudo vai junto
// no PUT — o desenho do Editar Cliente.
(async function(){
  const overlay = document.getElementById('editarContatoOverlay');
  if(!overlay) return;
  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }
  let tiposLigados = null;
  const close = () => { tiposLigados?.destruir?.(); Modal.close('editarContato'); };
  document.getElementById('voltarEditarContato')?.addEventListener('click', close);
  document.getElementById('cancelarEditarContato')?.addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', esc); }});

  const contato = window.contatoEditar;
  const preferencias = window.contatoEditarPreferencias || null;
  if (preferencias) delete window.contatoEditarPreferencias;

  const carregarUtil = (arquivo, global) => (window[global] ? Promise.resolve() : new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `../js/utils/${arquivo}`;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Não foi possível carregar ${arquivo}.`));
    document.head.appendChild(s);
  }));
  const pronto = () => window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'editarContato' }));
  try {
    await carregarUtil('contato-ficha.js', 'ContatoFicha');
  } catch (err) {
    console.error(err);
    pronto();
    showToast('Não foi possível abrir o contato.', 'error');
    return;
  }
  const F = window.ContatoFicha;
  const { activateTab, abaAtiva } = F.ligarAbas(overlay);
  F.ligarTipoPessoa();

  let pessoas = [];
  const pessoasExcluidas = [];
  const tbody = document.getElementById('pessoasTabela');
  const acoes = {
    editar: idx => F.abrirPessoa({ ...pessoas[idx], indice: idx }),
    excluir: idx => {
      const p = pessoas[idx];
      window.DialogPadrao?.confirm({ title: 'Excluir esta pessoa?', message: `"${p.nome}" sai das pessoas de contato ao salvar.`, confirmText: 'Excluir', confirmVariant: 'danger' })
        .then(ok => {
          if (!ok) return;
          if (p.status !== 'new' && p.id) pessoasExcluidas.push(p.id);
          pessoas.splice(idx, 1);
          F.renderPessoas(tbody, pessoas, acoes);
        });
    }
  };

  if (contato) {
    const titulo = document.getElementById('contatoEditarTitulo');
    if (titulo) titulo.textContent = `Editar – ${contato.nome || ''}`;
    try {
      const res = await fetchApi(`/api/contatos/${contato.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Erro ${res.status}`);
      F.preencherDados(data.contato);
      if (titulo && data.contato?.nome) titulo.textContent = `Editar – ${data.contato.nome}`;
      tiposLigados = await F.ligarTipos({ select: document.getElementById('contatoTipo'), botaoMais: document.getElementById('addTipoContato'), botaoMenos: document.getElementById('delTipoContato') });
      await tiposLigados.recarregar(data.contato?.tipo_id ?? '', data.contato?.tipo || '');
      await F.ligarEndereco(data.contato?.endereco || null);
      pessoas = (data.pessoas || []).map(p => ({ ...p, status: 'unchanged' }));
      F.renderPessoas(tbody, pessoas, acoes);
    } catch (err) {
      console.error('Erro ao carregar o contato', err);
      showToast(err.message || 'Erro ao carregar o contato', 'error');
    } finally {
      pronto();
    }
  } else {
    pronto();
  }

  document.getElementById('addPessoaBtn')?.addEventListener('click', () => F.abrirPessoa());
  const aoSalvarPessoa = e => {
    const { indice, ...dados } = e.detail || {};
    if (indice !== undefined && pessoas[indice]) {
      Object.assign(pessoas[indice], dados);
      if (pessoas[indice].status !== 'new') pessoas[indice].status = 'updated';
    } else {
      pessoas.push({ ...dados, status: 'new' });
    }
    F.renderPessoas(tbody, pessoas, acoes);
  };
  window.addEventListener('contatoPessoaSalva', aoSalvarPessoa);
  window.addEventListener('modalFechado', function soltar(e){
    if (e.detail !== 'editarContato') return;
    window.removeEventListener('contatoPessoaSalva', aoSalvarPessoa);
    window.removeEventListener('modalFechado', soltar);
  });

  // Aberto pelo ícone "nova pessoa" da lista: vai direto para a aba e abre o mini-modal.
  if (preferencias?.tabId) activateTab(document.getElementById(preferencias.tabId), { setFocus: false });
  if (preferencias?.abrirNovaPessoa) {
    const esperar = () => { if (!overlay.classList.contains('hidden')) setTimeout(() => F.abrirPessoa(), 50); else requestAnimationFrame(esperar); };
    esperar();
  }

  window.EstadoTrabalho?.registrarConteudo?.('editarContato', {
    capturar: () => ({
      __contexto: { contatoEditar: contato },
      pessoas: pessoas.map(p => ({ ...p })), pessoasExcluidas: pessoasExcluidas.slice(), abaAtiva: abaAtiva(),
      tipo: document.getElementById('contatoTipo')?.value || '',
      endereco: { pais: document.getElementById('endPais')?.value || '', estado: document.getElementById('endEstado')?.value || '' }
    }),
    restaurar: async (dados) => {
      if (!dados) return;
      if (Array.isArray(dados.pessoas) && dados.pessoas.length) { pessoas = dados.pessoas.map(p => ({ ...p })); F.renderPessoas(tbody, pessoas, acoes); }
      const excluidas = Array.isArray(dados.pessoasExcluidas) ? dados.pessoasExcluidas : [];
      if (excluidas.length) {
        pessoasExcluidas.length = 0;
        excluidas.forEach(id => pessoasExcluidas.push(id));
        const removidas = new Set(excluidas.map(String));
        pessoas = pessoas.filter(p => !removidas.has(String(p.id)));
        F.renderPessoas(tbody, pessoas, acoes);
      }
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

  const salvarBtn = document.getElementById('salvarEditarContato');
  if (salvarBtn && contato) {
    salvarBtn.addEventListener('click', async () => {
      const dados = F.coletarDados({ activateTab });
      if (!dados) return;
      const corpo = {
        ...dados,
        pessoasNovas: pessoas.filter(p => p.status === 'new').map(({ status, id, ...resto }) => resto),
        pessoasAtualizadas: pessoas.filter(p => p.status === 'updated').map(({ status, ...resto }) => resto),
        pessoasExcluidas
      };
      try {
        const res = await fetchApi(`/api/contatos/${contato.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          showToast(json.error || 'Erro ao salvar o contato', 'error');
          return;
        }
        showToast('Contato atualizado com sucesso');
        window.dispatchEvent(new Event('contatoEditado'));
        window.dispatchEvent(new CustomEvent('moduloSalvou', { detail: { overlay: 'editarContato' } }));
        close();
      } catch (err) {
        console.error('Erro ao atualizar contato', err);
        showToast('Erro ao salvar contato', 'error');
      }
    });
  }
})();
