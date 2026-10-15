/**
 * Editar as peças de um pedido em Produção (pedido do dono, 14/10/2026) —
 * backend/pedidoEdicao.js.
 *
 * Um passo de cada vez na mesma tela:
 *   1. as linhas do pedido, com de onde veio cada unidade e em que ponto ela
 *      está: mudar a quantidade, tirar, juntar linhas da mesma peça, pôr peça
 *      nova, e o motivo;
 *   2. "Revisar": se há unidades novas, o modal da conversão abre em modo
 *      edição (orcamento-converter.js) para escolher de onde elas saem
 *      (prontas, pela metade, do zero); depois a prévia do servidor diz o que
 *      volta ao estoque e à matéria-prima, o que é consumido, os valores e as
 *      parcelas;
 *   3. "Salvar edição": grava com a assinatura da prévia — se o pedido mudou
 *      no meio, o servidor recusa e a tela relê.
 */
(async () => {
  const overlayId = 'editarPecasPedido';
  const overlay = document.getElementById('editarPecasPedidoOverlay');
  if (!overlay) return;

  const contexto = window.editarPecasContext || {};
  delete window.editarPecasContext;
  const pedidoId = contexto.pedidoId ?? window.selectedOrderId;

  // início das funções puras

  /** "CXR-P — Caixa Rio - P". */
  function nomeDaPeca(item) {
    return [item?.codigo, item?.nome].filter(Boolean).join(' — ') || `Peça ${item?.item_id ?? item?.produto_id ?? ''}`.trim();
  }

  const reais = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  /** O estado inicial da edição: cada linha como está. Pura. */
  function edicaoInicial(dados) {
    const linhas = {};
    for (const l of dados?.linhas || []) linhas[String(l.item_id)] = { quantidade: Number(l.quantidade) || 0, juntar_em: null };
    return { linhas, novas: [] };
  }

  /**
   * As linhas da mesma peça, por produto (só as que podem ser juntadas: sem
   * trava). A primeira de cada grupo é a que recebe. Pura.
   */
  function gruposDeIguais(dados) {
    const porPeca = new Map();
    for (const l of dados?.linhas || []) {
      if (l.travado || l.produto_id === null || l.produto_id === undefined) continue;
      const k = String(l.produto_id);
      if (!porPeca.has(k)) porPeca.set(k, []);
      porPeca.get(k).push(l);
    }
    return [...porPeca.values()].filter(g => g.length > 1);
  }

  /** O que mudou em relação ao pedido? Pura. */
  function mudou(dados, edicao) {
    if ((edicao?.novas || []).some(n => Number(n.quantidade) > 0)) return true;
    return (dados?.linhas || []).some(l => {
      const e = edicao?.linhas?.[String(l.item_id)];
      return e && (e.juntar_em !== null || Number(e.quantidade) !== Number(l.quantidade));
    });
  }

  /** O corpo que vai ao servidor: todas as linhas e as peças novas. Pura. */
  function entradaDaEdicao(dados, edicao) {
    const linhas = (dados?.linhas || []).map(l => {
      const e = edicao.linhas[String(l.item_id)] || { quantidade: l.quantidade, juntar_em: null };
      return e.juntar_em !== null ? { item_id: l.item_id, juntar_em: e.juntar_em } : { item_id: l.item_id, quantidade: Math.trunc(Number(e.quantidade) || 0) };
    });
    for (const n of edicao.novas || []) {
      if (Number(n.quantidade) > 0) linhas.push({ produto_id: n.produto_id, quantidade: Math.trunc(Number(n.quantidade)) });
    }
    return { linhas };
  }

  /**
   * As unidades NOVAS por peça (as que precisam da escolha de origem), com a
   * mesma conta do servidor: a linha que fica recebe as da linha juntada a
   * ela; o que passar disso é novo; peça nova de uma peça que o pedido já
   * tem aumenta a linha dela. Pura.
   */
  function unidadesNovas(dados, edicao) {
    const linhas = dados?.linhas || [];
    const pool = new Map();
    const desejado = new Map();
    for (const l of linhas) {
      const e = edicao.linhas[String(l.item_id)] || { quantidade: l.quantidade, juntar_em: null };
      const alvo = e.juntar_em !== null ? String(e.juntar_em) : String(l.item_id);
      pool.set(alvo, (pool.get(alvo) || 0) + (Number(l.quantidade) || 0));
      if (e.juntar_em === null) desejado.set(String(l.item_id), Math.trunc(Number(e.quantidade) || 0));
    }
    const porProduto = new Map();
    const somar = (produtoId, nome, q) => {
      if (!(q > 0)) return;
      const k = String(produtoId);
      const atual = porProduto.get(k) || { produto_id: Number(produtoId), nome, qtd: 0 };
      atual.qtd += q;
      porProduto.set(k, atual);
    };
    for (const n of edicao.novas || []) {
      const q = Math.trunc(Number(n.quantidade) || 0);
      const existente = linhas.find(l => String(l.produto_id) === String(n.produto_id) && desejado.has(String(l.item_id)) && Number(l.quantidade) > 0);
      if (existente) desejado.set(String(existente.item_id), desejado.get(String(existente.item_id)) + q);
      else somar(n.produto_id, nomeDaPeca(n), q);
    }
    for (const l of linhas) {
      if (!desejado.has(String(l.item_id))) continue;
      somar(l.produto_id, nomeDaPeca(l), desejado.get(String(l.item_id)) - (pool.get(String(l.item_id)) || 0));
    }
    return [...porProduto.values()];
  }

  /** As decisões do modal da conversão, no formato do servidor. Pura. */
  function decisoesDaConversao(conversao) {
    return (Array.isArray(conversao?.items) ? conversao.items : []).map(i => ({
      produto_id: Number(i.produto_id),
      qtd_usar_pronta: Number(i.qtd_usar_pronta) || 0,
      qtd_a_produzir: Number(i.qtd_a_produzir) || 0,
      qtd_produzir_parcial: Number(i.qtd_produzir_parcial) || 0,
      parciais: Array.isArray(i.parciais) ? i.parciais : [],
      forcarProduzirDoZero: i.forcarProduzirDoZero === true
    }));
  }

  /** O que impede de revisar (texto) ou null. Pura. */
  function problemaDaEdicao(dados, edicao, motivo, minimo = 10) {
    for (const l of dados?.linhas || []) {
      const e = edicao.linhas[String(l.item_id)];
      if (!e || e.juntar_em !== null) continue;
      const q = Number(e.quantidade);
      if (!Number.isInteger(q) || q < 0) return `Quantidade inválida em ${nomeDaPeca(l)}: use um número inteiro, 0 para tirar todas.`;
    }
    for (const n of edicao.novas || []) {
      const q = Number(n.quantidade);
      if (!Number.isInteger(q) || q < 1) return `Quantidade inválida na peça nova ${nomeDaPeca(n)}.`;
    }
    if (!mudou(dados, edicao)) return 'Nada foi mudado nas peças.';
    const ficam = (dados?.linhas || []).reduce((s, l) => {
      const e = edicao.linhas[String(l.item_id)];
      return s + (e && e.juntar_em === null ? Number(e.quantidade) || 0 : 0);
    }, 0) + (edicao.novas || []).reduce((s, n) => s + (Number(n.quantidade) || 0), 0);
    if (!(ficam > 0)) return 'O pedido não pode ficar sem nenhuma peça. Para desistir dele, use Cancelar.';
    if (String(motivo || '').replace(/[^\p{L}]/gu, '').length < minimo) return `Diga o motivo da edição (ao menos ${minimo} letras).`;
    return null;
  }

  /** Acha a peça do catálogo pelo que foi digitado ("código — nome", só o código ou só o nome). Pura. */
  function pecaDoCatalogo(catalogo, digitado) {
    const t = String(digitado || '').trim().toLowerCase();
    if (!t) return null;
    const lista = Array.isArray(catalogo) ? catalogo : [];
    return lista.find(p => nomeDaPeca(p).toLowerCase() === t)
      || lista.find(p => String(p.codigo || '').toLowerCase() === t)
      || lista.find(p => String(p.nome || '').toLowerCase() === t)
      || null;
  }

  // fim das funções puras

  const el = id => document.getElementById(id);
  const criar = (tag, classe, texto) => {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto !== undefined && texto !== null) e.textContent = texto;
    return e;
  };

  async function fetchApi(caminho, opcoes) {
    const base = await window.apiConfig.getApiBaseUrl();
    const resposta = await fetch(`${base}${caminho}`, { ...opcoes, headers: { 'Content-Type': 'application/json', ...(opcoes?.headers || {}) } });
    const corpo = await resposta.json().catch(() => null);
    if (!resposta.ok) {
      const e = new Error(corpo?.error || `O servidor respondeu com erro (${resposta.status}).`);
      e.status = resposta.status;
      e.corpo = corpo;
      throw e;
    }
    return corpo;
  }

  const fechar = () => {
    document.removeEventListener('keydown', aoTeclar);
    Modal.close(overlayId);
  };
  function aoTeclar(evento) {
    if (evento.key !== 'Escape') return;
    // A caixa de confirmação e o modal da conversão por cima respondem ao Esc deles.
    if (document.querySelector('.app-message-overlay, dialog[data-dialog-padrao][open], #converterOrcamentoOverlay')) return;
    fechar();
  }
  document.addEventListener('keydown', aoTeclar);
  el('voltarEditarPecas')?.addEventListener('click', fechar);
  el('fecharEditarPecas')?.addEventListener('click', fechar);

  let dados = null;
  let edicao = { linhas: {}, novas: [] };
  let catalogo = [];
  let previa = null;
  let decisoes = [];
  let conversao = null;
  let contadorNovas = 0;

  function avisar(conteudo) {
    const a = el('editarPecasAviso');
    a.replaceChildren();
    if (Array.isArray(conteudo) && conteudo.length) {
      a.append(criar('strong', null, 'Não dá para editar as peças agora:'));
      const ul = criar('ul');
      conteudo.forEach(t => ul.appendChild(criar('li', null, t)));
      a.appendChild(ul);
    } else if (conteudo && !Array.isArray(conteudo)) {
      a.textContent = conteudo;
    }
    a.classList.toggle('hidden', !a.textContent);
  }

  function mensagem(texto, tom = 'erro') {
    const m = el('editarPecasMensagem');
    m.textContent = texto || '';
    m.style.color = tom === 'erro' ? 'var(--color-red)' : 'var(--color-green)';
    m.classList.toggle('hidden', !texto);
  }

  /** A prévia deixa de valer quando algo muda na edição. */
  function esquecerPrevia() {
    previa = null;
    el('editarPecasRevisao').classList.add('hidden');
  }

  function linhaDaTela(l) {
    const e = edicao.linhas[String(l.item_id)];
    const juntada = e.juntar_em !== null;
    const q = Number(e.quantidade);
    const classes = ['editar-pecas__linha'];
    if (l.travado) classes.push('editar-pecas__linha--travada');
    else if (juntada || q === 0) classes.push('editar-pecas__linha--sai');
    else if (q !== Number(l.quantidade)) classes.push('editar-pecas__linha--mudou');
    const card = criar('div', classes.join(' '));

    const nome = criar('div', 'editar-pecas__nome');
    const titulo = criar('span', 'editar-pecas__titulo', nomeDaPeca(l));
    titulo.title = nomeDaPeca(l);
    nome.append(titulo, criar('span', 'editar-pecas__sub', `${l.quantidade} no pedido · ${reais(l.valor_unitario)} a unidade${l.desconto_prc ? ` · ${String(l.desconto_prc).replace('.', ',')}% de desconto` : ''} · ${reais(l.valor_total)}`));
    const unidades = criar('div', 'editar-pecas__unidades');
    for (const u of l.unidades || []) {
      const chip = criar('span', `editar-pecas__unidade${/estoque/.test(u.origem) ? ' editar-pecas__unidade--estoque' : ''}`);
      chip.append(criar('strong', null, String(u.quantidade)), document.createTextNode(` ${u.origem}${u.estado ? ` · ${u.estado}` : ''}`));
      unidades.appendChild(chip);
    }
    nome.appendChild(unidades);

    const controles = criar('div', 'editar-pecas__controles');
    if (juntada) {
      const alvo = dados.linhas.find(x => String(x.item_id) === String(e.juntar_em));
      controles.appendChild(criar('span', 'editar-pecas__sub', `Juntada à linha de ${nomeDaPeca(alvo)}`));
      const desfazer = criar('button', 'btn-neutral ctl-botao ctl-botao--pequeno text-white', 'Desfazer');
      desfazer.type = 'button';
      desfazer.addEventListener('click', () => {
        const a = edicao.linhas[String(e.juntar_em)];
        a.quantidade = Math.max(0, Number(a.quantidade) - Number(l.quantidade));
        e.juntar_em = null;
        e.quantidade = Number(l.quantidade);
        esquecerPrevia();
        pintar();
      });
      controles.appendChild(desfazer);
    } else {
      const campo = criar('input', 'ctl-campo input-glass text-white editar-pecas__qtd');
      campo.type = 'number';
      campo.min = '0';
      campo.step = '1';
      campo.value = String(e.quantidade);
      campo.disabled = Boolean(l.travado) || !dados.pode_editar;
      campo.setAttribute('aria-label', `Quantidade de ${nomeDaPeca(l)}`);
      campo.addEventListener('change', () => {
        e.quantidade = Math.max(0, Math.trunc(Number(campo.value) || 0));
        esquecerPrevia();
        pintar();
      });
      controles.appendChild(campo);
      const tirar = criar('button', 'btn-danger ctl-botao ctl-botao--pequeno text-white', 'Tirar');
      tirar.type = 'button';
      tirar.title = 'Tirar todas as peças desta linha';
      tirar.disabled = campo.disabled || q === 0;
      tirar.addEventListener('click', () => { e.quantidade = 0; esquecerPrevia(); pintar(); });
      controles.appendChild(tirar);
      // Juntar: só a linha de baixo de um grupo da mesma peça, na primeira do grupo.
      const grupo = gruposDeIguais(dados).find(g => g.some(x => String(x.item_id) === String(l.item_id)));
      const primeira = grupo ? grupo.find(x => edicao.linhas[String(x.item_id)].juntar_em === null) : null;
      if (grupo && primeira && String(primeira.item_id) !== String(l.item_id) && dados.pode_editar) {
        const juntar = criar('button', 'btn-neutral ctl-botao ctl-botao--pequeno text-white', 'Juntar na linha de cima');
        juntar.type = 'button';
        juntar.title = 'É a mesma peça: as unidades desta linha passam para a outra, sem mexer no estoque';
        juntar.addEventListener('click', () => {
          const a = edicao.linhas[String(primeira.item_id)];
          a.quantidade = Number(a.quantidade) + Number(e.quantidade);
          e.juntar_em = primeira.item_id;
          esquecerPrevia();
          pintar();
        });
        controles.appendChild(juntar);
      }
    }
    card.append(nome, controles);
    if (l.travado) card.appendChild(criar('span', 'editar-pecas__nota', `Esta peça não pode ser editada: ${l.travado}`));
    return card;
  }

  function linhaNovaDaTela(n) {
    const card = criar('div', 'editar-pecas__linha editar-pecas__linha--nova');
    const nome = criar('div', 'editar-pecas__nome');
    nome.append(criar('span', 'editar-pecas__titulo', nomeDaPeca(n)), criar('span', 'editar-pecas__sub', `Peça nova${n.preco_tabela ? ` · ${reais(n.preco_tabela)} a unidade (tabela)` : ''}`));
    const controles = criar('div', 'editar-pecas__controles');
    const campo = criar('input', 'ctl-campo input-glass text-white editar-pecas__qtd');
    campo.type = 'number';
    campo.min = '1';
    campo.step = '1';
    campo.value = String(n.quantidade);
    campo.setAttribute('aria-label', `Quantidade de ${nomeDaPeca(n)}`);
    campo.addEventListener('change', () => { n.quantidade = Math.max(1, Math.trunc(Number(campo.value) || 1)); esquecerPrevia(); pintar(); });
    const tirar = criar('button', 'btn-danger ctl-botao ctl-botao--pequeno text-white', 'Tirar');
    tirar.type = 'button';
    tirar.addEventListener('click', () => { edicao.novas = edicao.novas.filter(x => x.uid !== n.uid); esquecerPrevia(); pintar(); });
    controles.append(campo, tirar);
    card.append(nome, controles);
    return card;
  }

  function pintar() {
    const lista = el('editarPecasLinhas');
    lista.replaceChildren();
    for (const l of dados.linhas) lista.appendChild(linhaDaTela(l));
    for (const n of edicao.novas) lista.appendChild(linhaNovaDaTela(n));
    const bloqueado = !dados.pode_editar || dados.sql_pendente;
    ['editarPecasRevisar', 'editarPecasAdicionar', 'editarPecasBusca', 'editarPecasNovaQtd', 'editarPecasMotivo'].forEach(id => { el(id).disabled = bloqueado; });
  }

  /** A prévia, em blocos de texto (tudo por textContent). */
  function pintarPrevia() {
    const resumo = el('editarPecasResumo');
    resumo.replaceChildren();
    const bloco = (titulo, itens, classe = '') => {
      if (!itens.length) return;
      const b = criar('div', `editar-pecas__bloco ${classe}`.trim());
      b.appendChild(criar('h4', null, titulo));
      const ul = criar('ul');
      itens.forEach(t => ul.appendChild(criar('li', null, t)));
      b.appendChild(ul);
      resumo.appendChild(b);
    };
    const mudadas = previa.linhas.filter(l => l.alterada);
    bloco('As peças', mudadas.map(l => {
      if (l.tipo === 'juntada') return `${l.peca}: juntada à outra linha da mesma peça (${l.quantidade_antes} un.).`;
      if (l.tipo === 'nova') return `${l.peca}: peça nova, ${l.quantidade_depois} un. — ${reais(l.valor_total)}.`;
      return `${l.peca}: ${l.quantidade_antes} → ${l.quantidade_depois} un.${l.novas ? ` (${l.novas} nova${l.novas > 1 ? 's' : ''})` : ''}${l.saem ? ` (${l.saem} sai${l.saem > 1 ? 'em' : ''})` : ''} — ${reais(l.valor_total)}.`;
    }));
    bloco('O que sai do pedido', previa.saem.map(s => `${s.quantidade} × ${s.peca} (${s.origem}): ${s.destino}.`));
    bloco('As peças novas', previa.novas.map(n => {
      const d = n.decisao || {};
      const partes = [];
      if (d.qtd_usar_pronta) partes.push(`${d.qtd_usar_pronta} pronta${d.qtd_usar_pronta > 1 ? 's' : ''} do estoque`);
      if (d.qtd_produzir_parcial) partes.push(`${d.qtd_produzir_parcial} pela metade do estoque`);
      const doZero = Math.max(0, (Number(d.qtd_a_produzir) || 0) - (Number(d.qtd_produzir_parcial) || 0));
      if (doZero) partes.push(`${doZero} do zero`);
      return `${n.quantidade} × ${n.peca}: ${partes.join(', ') || 'a escolher'}.`;
    }));
    bloco('Volta à matéria-prima', previa.materia_prima.volta.map(m => `${m.nome}: ${String(m.quantidade).replace('.', ',')} ${m.unidade}`.trim()));
    bloco('Sai da matéria-prima (peças novas)', previa.materia_prima.sai.map(m => `${m.nome}: ${String(m.quantidade).replace('.', ',')} ${m.unidade}${m.saldo - m.quantidade < 0 ? ' — o saldo fica negativo' : ''}`.trim()));
    const total = criar('div', 'editar-pecas__bloco editar-pecas__bloco--total');
    total.appendChild(criar('h4', null, 'Valores e parcelas'));
    const valores = criar('div', 'editar-pecas__valores');
    valores.append(criar('span', 'editar-pecas__antes', reais(previa.valores.antes.valor_final)), criar('strong', null, reais(previa.valores.depois.valor_final)));
    if (previa.valores.depois.ajuste) valores.appendChild(criar('span', 'editar-pecas__sub', `(com o ${previa.valores.depois.ajuste > 0 ? 'Adicional' : 'Desconto'} de ${reais(Math.abs(previa.valores.depois.ajuste))} do pagamento, mantido)`));
    total.appendChild(valores);
    const ul = criar('ul');
    previa.parcelas.forEach(p => ul.appendChild(criar('li', null, `${p.numero_parcela}ª parcela: ${reais(p.antes)} → ${reais(p.valor)} (vencimento mantido)`)));
    total.appendChild(ul);
    resumo.appendChild(total);
    bloco('Atenção', previa.avisos || []);
    el('editarPecasRevisao').classList.remove('hidden');
    el('editarPecasRevisao').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  /**
   * O modal da conversão em modo edição, só com as unidades novas. Devolve a
   * escolha (o `conversao` dele) ou null se a pessoa voltou.
   */
  function escolherOrigemDasNovas(itens) {
    return new Promise(resolve => {
      let resolvido = false;
      const fim = valor => { if (!resolvido) { resolvido = true; resolve(valor); } };
      window.quoteConversionContext = {
        modo: 'edicao', numero: dados.pedido.numero, cliente: contexto.cliente || '',
        items: itens.map(i => ({ produto_id: i.produto_id, nome: i.nome, qtd: i.qtd })),
        aoCancelar: () => fim(null)
      };
      window.confirmQuoteConversion = changes => {
        window.confirmQuoteConversion = null;
        window.quoteConversionContext = null;
        fim(changes?.conversao || null);
      };
      Promise.resolve(Modal.open('modals/orcamentos/converter.html', '../js/modals/orcamento-converter.js', 'converterOrcamento', true))
        .catch(err => { console.error(err); fim(null); });
    });
  }

  async function revisar() {
    mensagem('');
    const problema = problemaDaEdicao(dados, edicao, el('editarPecasMotivo').value, dados.minimo_motivo || 10);
    if (problema) { mensagem(problema); return; }
    const novas = unidadesNovas(dados, edicao);
    decisoes = [];
    conversao = null;
    if (novas.length) {
      conversao = await escolherOrigemDasNovas(novas);
      if (!conversao) { mensagem('Escolha de onde saem as peças novas para revisar.'); return; }
      decisoes = decisoesDaConversao(conversao);
    }
    try {
      previa = await fetchApi(`/api/pedido-edicao/${encodeURIComponent(pedidoId)}/simular`, {
        method: 'POST', body: JSON.stringify({ ...entradaDaEdicao(dados, edicao), decisoes })
      });
      pintarPrevia();
    } catch (e) {
      previa = null;
      el('editarPecasRevisao').classList.add('hidden');
      mensagem(e?.status === 403 ? 'Editar as peças de um pedido é uma ação restrita ao dono do sistema.' : (e?.message || 'Não foi possível revisar a edição.'));
    }
  }

  async function salvar() {
    if (!previa) return;
    const motivo = el('editarPecasMotivo').value.trim();
    const ok = await window.DialogPadrao?.confirm?.({
      title: 'Salvar a edição das peças?',
      tom: 'pergunta',
      icone: 'fa-pen-to-square',
      message: `${dados.pedido.numero}: o total passa de ${reais(previa.valores.antes.valor_final)} para ${reais(previa.valores.depois.valor_final)}.`,
      nota: 'Estoque, matéria-prima, produção, valores e parcelas mudam agora, e tudo fica registrado no histórico do pedido. Para voltar atrás, faça outra edição.',
      confirmText: 'Salvar edição'
    }) ?? window.confirm('Salvar a edição das peças?');
    if (!ok) return;
    try {
      const r = await fetchApi(`/api/pedido-edicao/${encodeURIComponent(pedidoId)}`, {
        method: 'POST',
        body: JSON.stringify({
          ...entradaDaEdicao(dados, edicao), decisoes, motivo, assinatura: previa.assinatura,
          podeSaldoNegativo: Boolean(conversao?.hasNegative), decisaoNote: conversao?.decisionNote || ''
        })
      });
      const avisos = Array.isArray(r?.avisos) ? r.avisos : [];
      window.showToast?.(`Peças do ${dados.pedido.numero} editadas. Total: ${reais(r?.totais?.valor_final)}.${avisos.length ? ' Confira os avisos no histórico do pedido.' : ''}`, avisos.length ? 'warning' : 'success');
      window.dispatchEvent(new CustomEvent('pedido:pecas-editadas', { detail: { pedidoId, edicaoId: r?.edicao_id ?? null } }));
      fechar();
    } catch (e) {
      if (e?.status === 409 && e?.corpo?.mudou) {
        await carregar();
        avisar('O pedido mudou enquanto a revisão estava aberta. Confira as peças e revise de novo.');
        return;
      }
      mensagem(e?.status === 403 ? 'Editar as peças de um pedido é uma ação restrita ao dono do sistema.' : (e?.message || 'Não foi possível salvar a edição.'));
    }
  }

  function adicionar() {
    mensagem('');
    const peca = pecaDoCatalogo(catalogo, el('editarPecasBusca').value);
    if (!peca) { mensagem('Escolha a peça na lista do catálogo.'); return; }
    const q = Math.trunc(Number(el('editarPecasNovaQtd').value) || 0);
    if (!(q >= 1)) { mensagem('Informe quantas peças.'); return; }
    const ja = edicao.novas.find(n => String(n.produto_id) === String(peca.id));
    if (ja) ja.quantidade += q;
    else edicao.novas.push({ uid: (contadorNovas += 1), produto_id: Number(peca.id), codigo: peca.codigo || '', nome: peca.nome || '', preco_tabela: peca.preco_tabela ?? null, quantidade: q });
    el('editarPecasBusca').value = '';
    el('editarPecasNovaQtd').value = '1';
    esquecerPrevia();
    pintar();
  }

  async function carregarCatalogo() {
    try { catalogo = await (window.electronAPI?.listarProdutos?.() ?? []); } catch (_) { catalogo = []; }
    const lista = el('editarPecasCatalogo');
    lista.replaceChildren();
    for (const p of (Array.isArray(catalogo) ? catalogo : [])) {
      const o = document.createElement('option');
      o.value = nomeDaPeca(p);
      lista.appendChild(o);
    }
  }

  async function carregar() {
    el('editarPecasCarregando').classList.remove('hidden');
    el('editarPecasConteudo').classList.add('hidden');
    try {
      dados = await fetchApi(`/api/pedido-edicao/${encodeURIComponent(pedidoId)}`);
    } catch (e) {
      dados = null;
      avisar(e?.status === 403 ? 'Editar as peças de um pedido é uma ação restrita ao dono do sistema.' : (e?.message || 'Não foi possível abrir as peças do pedido.'));
    }
    el('editarPecasCarregando').classList.add('hidden');
    if (!dados) return;
    edicao = edicaoInicial(dados);
    previa = null;
    el('editarPecasSubtitulo').textContent = [dados.pedido.numero, contexto.cliente, dados.pedido.situacao].filter(Boolean).join(' · ');
    if (dados.sql_pendente) avisar(`Falta rodar ${dados.sql_arquivo || 'sql/pedido_edicoes.sql'} no banco e reiniciar a API: a edição ainda não pode ser gravada.`);
    else if (!dados.pode_editar) avisar(dados.bloqueios || []);
    else avisar('');
    el('editarPecasRevisao').classList.add('hidden');
    el('editarPecasConteudo').classList.remove('hidden');
    pintar();
  }

  el('editarPecasAdicionar').addEventListener('click', adicionar);
  el('editarPecasBusca').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); adicionar(); } });
  el('editarPecasDesfazer').addEventListener('click', () => { edicao = edicaoInicial(dados); esquecerPrevia(); mensagem(''); pintar(); });
  el('editarPecasMudar').addEventListener('click', () => { esquecerPrevia(); el('editarPecasLinhas').scrollIntoView({ block: 'start', behavior: 'smooth' }); });
  el('editarPecasMotivo').addEventListener('input', () => mensagem(''));
  for (const [id, fn] of [['editarPecasRevisar', revisar], ['editarPecasSalvar', salvar]]) {
    const botao = el(id);
    if (typeof window.BotaoAcao?.bind === 'function') window.BotaoAcao.bind(botao, fn);
    else botao.addEventListener('click', fn);
  }

  try {
    await Promise.all([carregar(), carregarCatalogo()]);
  } finally {
    if (typeof Modal?.signalReady === 'function') Modal.signalReady(overlayId);
    window.dispatchEvent(new CustomEvent('pedidoModalLoaded', { detail: overlayId }));
  }
})();
