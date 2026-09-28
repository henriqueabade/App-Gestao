/**
 * Tipos de contato (/api/contatos/tipos): a lista do campo "Tipo" do cadastro
 * de contato e o + e − ao lado dele — o mesmo desenho dos desenhistas das
 * peças (utils/desenhistas.js). O tipo é só um nome ("Fornecedor",
 * "Prestador de serviço"…); quem edita a lista precisa de ctt.type.manage.
 */
(() => {
  if (window.ContatoTipos) return;
  const EVENTO = 'contatoTipoAtualizado';
  const chave = t => String(t ?? '').replace(/\s+/g, ' ').trim().normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
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
  async function listar() {
    const r = await chamar('/api/contatos/tipos');
    return Array.isArray(r?.tipos) ? r.tipos : [];
  }
  const incluir = nome => chamar('/api/contatos/tipos', { method: 'POST', body: JSON.stringify({ nome }) });
  const excluir = id => chamar(`/api/contatos/tipos/${encodeURIComponent(id)}`, { method: 'DELETE' });

  /**
   * Preenche o <select> com os tipos e escolhe `selecionadoId`. O contato cujo
   * tipo saiu da lista continua mostrando o nome dele, marcado "fora da lista".
   */
  function preencher(select, lista, selecionadoId = '', nomeAntigo = '') {
    if (!select) return;
    const opcoes = [new Option('Tipo (selecionar)', '')];
    for (const t of lista) opcoes.push(new Option(t.nome, String(t.id)));
    const alvo = selecionadoId === null || selecionadoId === undefined ? '' : String(selecionadoId);
    const achado = alvo ? lista.find(t => String(t.id) === alvo) : null;
    if (!achado && nomeAntigo) {
      const antigo = new Option(`${String(nomeAntigo).trim()} (fora da lista)`, '');
      antigo.dataset.foraDaLista = 'true';
      opcoes.push(antigo);
    }
    select.replaceChildren(...opcoes);
    select.value = achado ? alvo : '';
    if (!achado && nomeAntigo) select.selectedIndex = opcoes.length - 1;
  }

  /** O tipo escolhido é um da lista? ("fora da lista" não vale) */
  function escolhaValida(select) {
    const opcao = select?.selectedOptions?.[0];
    return Boolean(select?.value) && opcao?.dataset?.foraDaLista !== 'true';
  }

  const avisar = detalhe => window.dispatchEvent(new CustomEvent(EVENTO, { detail: detalhe || {} }));

  window.ContatoTipos = { EVENTO, chave, listar, incluir, excluir, preencher, escolhaValida, avisar };
})();
