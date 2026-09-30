/**
 * Prospecções — as listas editáveis da tela (/api/prospeccoes/listas/:lista):
 *   origens          a "Origem" da prospecção;
 *   tipos-interacao  o "Tipo" de Registrar interação.
 * Cada uma tem o + e o − ao lado do campo (permissão pros.lists.manage), no
 * mesmo desenho do "Tipo" de Contatos (utils/contato-tipos.js). O valor
 * gravado é o NOME; um nome que já não está na lista continua aparecendo,
 * marcado "(fora da lista)", e não se perde ao salvar.
 *
 * Também traz as redes da caixa das "Redes sociais" (lista fixa do backend).
 * Exposto como `window.ProspeccaoListas`.
 */
(() => {
  if (window.ProspeccaoListas) return;
  const EVENTO = 'prospeccaoListaAtualizada';
  const REDES_PADRAO = ['Instagram', 'Facebook', 'LinkedIn', 'TikTok', 'YouTube', 'X (Twitter)', 'Pinterest', 'WhatsApp', 'Outra'];
  const PADRAO = {
    origens: ['Evento', 'Feira', 'Indicação', 'Prospecção ativa', 'Redes Sociais', 'Website'],
    'tipos-interacao': ['E-mail', 'Ligação', 'Nota', 'Proposta', 'Reunião', 'Visita', 'WhatsApp']
  };
  const ROTULOS = {
    origens: { nome: 'origem', titulo: 'ORIGEM', exemplo: 'Ex.: Google, Parceiro, Mostra de decoração.' },
    'tipos-interacao': { nome: 'tipo de interação', titulo: 'TIPO DE INTERAÇÃO', exemplo: 'Ex.: Mensagem no Instagram, Videochamada, Amostra enviada.' }
  };
  const chave = t => String(t ?? '').replace(/\s+/g, ' ').trim().normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  let redes = REDES_PADRAO.slice();

  async function chamar(caminho, opcoes) {
    const base = await window.apiConfig.getApiBaseUrl();
    const resposta = await fetch(`${base}${caminho}`, {
      ...opcoes,
      headers: { 'Content-Type': 'application/json', ...(opcoes?.headers || {}) }
    });
    let corpo = null;
    try { corpo = await resposta.json(); } catch (_) { corpo = null; }
    if (!resposta.ok) {
      const e = new Error(corpo?.error || `O servidor respondeu com erro (${resposta.status}).`);
      e.status = resposta.status;
      e.corpo = corpo;
      throw e;
    }
    return corpo;
  }

  /** `[{ id, nome }]` — na falha, a lista padrão (a tela não trava). */
  async function listar(lista) {
    try {
      const r = await chamar(`/api/prospeccoes/listas/${encodeURIComponent(lista)}`);
      if (Array.isArray(r?.redes) && r.redes.length) redes = r.redes.slice();
      return Array.isArray(r?.itens) ? r.itens : [];
    } catch (err) {
      console.error(`Erro ao carregar a lista ${lista}:`, err);
      return (PADRAO[lista] || []).map(nome => ({ id: null, nome }));
    }
  }
  const incluir = (lista, nome) => chamar(`/api/prospeccoes/listas/${encodeURIComponent(lista)}`, { method: 'POST', body: JSON.stringify({ nome }) });
  const excluir = (lista, id) => chamar(`/api/prospeccoes/listas/${encodeURIComponent(lista)}/${encodeURIComponent(id)}`, { method: 'DELETE' });

  /**
   * Preenche o <select> com os nomes (o valor é o nome) e escolhe `valor`.
   * `vazio` é o texto da primeira opção (null = sem opção vazia). Um valor que
   * não está na lista entra marcado "(fora da lista)" com o próprio nome como
   * valor — salvar não apaga o que já estava gravado.
   */
  function preencher(select, itens, valor = '', { vazio = null } = {}) {
    if (!select) return;
    const opcoes = [];
    if (vazio !== null) opcoes.push(new Option(vazio, ''));
    for (const i of itens) opcoes.push(new Option(i.nome, i.nome));
    const atual = String(valor ?? '').trim();
    const achado = atual ? itens.find(i => chave(i.nome) === chave(atual)) : null;
    if (atual && !achado) {
      const antigo = new Option(`${atual} (fora da lista)`, atual);
      antigo.dataset.foraDaLista = 'true';
      opcoes.push(antigo);
    }
    select.replaceChildren(...opcoes);
    if (achado) select.value = achado.nome;
    else if (atual) select.value = atual;
    else select.value = vazio !== null ? '' : (itens[0]?.nome ?? '');
  }

  const avisar = detalhe => window.dispatchEvent(new CustomEvent(EVENTO, { detail: detalhe || {} }));

  /**
   * Liga um <select> às listas: carrega, preenche e mantém em dia quando o +
   * ou o − mudam a lista (por cima, modais lista-incluir/lista-excluir).
   * Devolve { recarregar(valor), destruir() }.
   */
  async function ligar({ lista, select, botaoMais, botaoMenos, valor = '', vazio = null, aoMudar = null } = {}) {
    if (!select) return { recarregar: async () => {}, destruir: () => {} };
    let foraDaLista = String(valor ?? '').trim();
    async function recarregar(escolher = select.value || foraDaLista) {
      const itens = await listar(lista);
      preencher(select, itens, escolher, { vazio });
      aoMudar?.();
    }
    const aoAtualizar = e => {
      const d = e?.detail || {};
      if (d.lista !== lista) return;
      let escolher = d.selecionado ?? select.value;
      if (d.removido !== undefined && chave(select.value) === chave(d.removido)) escolher = '';
      recarregar(escolher);
    };
    window.addEventListener(EVENTO, aoAtualizar);
    const abrir = (html, script, id) => {
      window.prospeccaoListaAlvo = { lista, ...ROTULOS[lista] };
      window.Modal.open(html, script, id, true);
    };
    botaoMais?.addEventListener('click', () => abrir('modals/prospeccoes/lista-incluir.html', '../js/modals/prospeccao-lista-incluir.js', 'incluirListaProspeccao'));
    botaoMenos?.addEventListener('click', () => abrir('modals/prospeccoes/lista-excluir.html', '../js/modals/prospeccao-lista-excluir.js', 'excluirListaProspeccao'));
    await recarregar(foraDaLista);
    return {
      recarregar: async v => { if (v !== undefined) foraDaLista = String(v ?? '').trim(); await recarregar(v); },
      destruir: () => window.removeEventListener(EVENTO, aoAtualizar)
    };
  }

  window.ProspeccaoListas = {
    EVENTO, PADRAO, ROTULOS, chave, listar, incluir, excluir, preencher, avisar, ligar,
    redes: () => redes.slice()
  };
})();
