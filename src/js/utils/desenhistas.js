/**
 * Desenhistas das peças (/api/desenhistas): a lista do "Desenhado por" do
 * cadastro de peça e o + e − ao lado dele, como os da coleção. O desenhista
 * é só um nome (não é usuário do app); é para ele que vai o Royalty.
 */
(() => {
  if (window.Desenhistas) return;

  const EVENTO = 'desenhistaAtualizado';
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
    const r = await chamar('/api/desenhistas');
    return Array.isArray(r?.desenhistas) ? r.desenhistas : [];
  }
  const incluir = nome => chamar('/api/desenhistas', { method: 'POST', body: JSON.stringify({ nome }) });
  const excluir = id => chamar(`/api/desenhistas/${encodeURIComponent(id)}`, { method: 'DELETE' });

  /**
   * Refaz as opções do select e escolhe `selecionado` (pelo nome, sem ligar
   * para acento ou caixa). Um nome gravado na peça que não está mais na lista
   * aparece marcado como tal, para não sumir calado.
   */
  function preencher(select, lista, selecionado = '') {
    if (!select) return;
    const opcoes = [new Option('Desenhado por (selecionar)', '')];
    for (const d of lista) opcoes.push(new Option(d.nome, d.nome));
    const alvo = chave(selecionado);
    const achado = alvo ? lista.find(d => chave(d.nome) === alvo) : null;
    if (alvo && !achado) {
      const antigo = new Option(`${String(selecionado).trim()} (fora da lista)`, String(selecionado).trim());
      antigo.dataset.foraDaLista = 'true';
      opcoes.push(antigo);
    }
    select.replaceChildren(...opcoes);
    select.value = achado ? achado.nome : (alvo ? String(selecionado).trim() : '');
  }

  /** O nome escolhido é um desenhista da lista? (o da peça antiga "fora da lista" não vale) */
  function escolhaValida(select) {
    const opcao = select?.selectedOptions?.[0];
    return Boolean(select?.value) && opcao?.dataset?.foraDaLista !== 'true';
  }

  const avisar = detalhe => window.dispatchEvent(new CustomEvent(EVENTO, { detail: detalhe || {} }));

  window.Desenhistas = { EVENTO, chave, listar, incluir, excluir, preencher, escolhaValida, avisar };
})();
