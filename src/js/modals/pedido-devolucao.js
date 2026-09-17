/**
 * Modal "Devolução" do pedido.
 *
 * Lê GET /api/devolucoes/pedido/:id (peças com o que ainda pode voltar,
 * parcelas, nota e devoluções anteriores). A cada mudança nas quantidades
 * pede a PRÉVIA ao backend (POST …/previa) — é ele quem faz a conta do
 * dinheiro, a tela só mostra: parcial ou total, desconto proporcional nas
 * parcelas em aberto, abatimento/baixa de boleto e reembolso. O XML da nota
 * do cliente (POST …/xml) preenche as quantidades e segue junto no registro
 * (POST /api/devolucoes/pedido/:id), onde fica guardado. O que falhar no meio
 * (estoque, BB) volta como pendência, com "Tentar de novo"
 * (POST /api/devolucoes/:id/reaplicar). Nada vai para o cliente.
 *
 * Contexto: `window.devolucaoPedidoContext = { pedidoId, numero, cliente }`.
 */
(() => {
  const overlayId = 'devolucaoPedido';
  const overlay = document.getElementById('devolucaoPedidoOverlay');
  if (!overlay) return;

  // ------------------------------------------------------ funções puras
  const ROTULO_DO_MODO = {
    valor_parcela: 'Desconto na parcela', abatimento_boleto: 'Abatimento no boleto (BB)', baixa_boleto: 'Boleto baixado no BB',
    cancelada: 'Parcela cancelada', reembolso: 'Reembolso ao cliente'
  };
  const ROTULO_DO_STATUS = { concluida: ['badge-success', 'Concluída'], pendencias: ['badge-danger', 'Com pendência'], processando: ['badge-warning', 'Em andamento'] };
  const TAMANHO_MAXIMO_DO_XML = 2 * 1024 * 1024;

  const moedaBR = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const diaBR = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : '—'; };

  /** A quantidade digitada, inteira e dentro do que a linha ainda pode devolver. */
  function quantidadeValida(texto, disponivel) {
    const n = Math.floor(Number(String(texto ?? '').replace(',', '.')));
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(n, Math.max(0, Number(disponivel) || 0));
  }

  /** O que vai para o backend: só as linhas com quantidade. */
  function escolhasDe(itens, quantidades) {
    return (itens || [])
      .map(i => ({ pedido_item_id: i.pedido_item_id, quantidade: quantidadeValida(quantidades?.[i.pedido_item_id], i.disponivel) }))
      .filter(e => e.quantidade > 0);
  }

  /** Estimativa imediata (a conta que vale é a da prévia): parcial ou total, e o valor pelas peças. */
  function estimativa(itens, quantidades) {
    const escolhas = escolhasDe(itens, quantidades);
    const porId = new Map(escolhas.map(e => [String(e.pedido_item_id), e.quantidade]));
    const pecas = escolhas.reduce((s, e) => s + e.quantidade, 0);
    const valor = (itens || []).reduce((s, i) => s + (porId.get(String(i.pedido_item_id)) || 0) * (Number(i.valor_unitario) || 0), 0);
    const tudo = pecas > 0 && (itens || []).every(i => (porId.get(String(i.pedido_item_id)) || 0) === (Number(i.disponivel) || 0));
    return { pecas, valor: Math.round(valor * 100) / 100, tipo: pecas ? (tudo ? 'total' : 'parcial') : null };
  }

  /** A etiqueta do cabeçalho: roxa quando há o que devolver. */
  function etiquetaDoTipo(tipo) {
    if (tipo === 'total') return ['badge-purple', 'Devolução total'];
    if (tipo === 'parcial') return ['badge-purple', 'Devolução parcial'];
    return ['badge-neutral', '—'];
  }

  /** Uma linha da tabela "O que vai acontecer". */
  function linhaDaParcela(p) {
    const paga = p?.situacao === 'paga';
    const depois = moedaBR(p?.valor_depois);
    const detalhe = {
      valor_parcela: `a parcela passa a valer ${depois}`,
      abatimento_boleto: `o boleto${p?.nosso_numero ? ` ${p.nosso_numero}` : ''} passa a cobrar ${depois}`,
      baixa_boleto: `o boleto${p?.nosso_numero ? ` ${p.nosso_numero}` : ''} é baixado e a parcela cancelada`,
      cancelada: 'nada mais a receber nesta parcela',
      reembolso: 'volta para o cliente (fica pendente no Financeiro)'
    }[p?.modo] || '';
    return {
      numero: p?.numero_parcela ? `${p.numero_parcela}ª` : '—',
      vencimento: diaBR(p?.data_vencimento),
      situacao: paga ? ['badge-success', 'Paga'] : ['badge-warning', 'Em aberto'],
      antes: moedaBR(p?.valor_antes), desconto: `− ${moedaBR(p?.desconto)}`, depois,
      acao: ROTULO_DO_MODO[p?.modo] || String(p?.modo || ''), detalhe
    };
  }

  /** O texto da confirmação: o que será feito, em linhas. */
  function textoDaConfirmacao(plano, numero) {
    const pecas = (plano?.itens || []).map(i => `${i.quantidade}× ${i.nome}`).join(', ');
    const linhas = [
      `Devolução ${plano?.tipo === 'total' ? 'TOTAL' : 'parcial'} do pedido ${numero || ''}: ${moedaBR(plano?.valor)}.`,
      `Voltam ao estoque: ${pecas}.`
    ];
    const abertas = (plano?.parcelas || []).filter(p => p.situacao === 'aberta');
    if (abertas.length) linhas.push(`Parcelas em aberto: ${moedaBR(plano.valor_parcelas)} de desconto em ${abertas.length === 1 ? '1 parcela' : `${abertas.length} parcelas`} (os prazos não mudam).`);
    if (abertas.some(p => p.modo === 'abatimento_boleto' || p.modo === 'baixa_boleto')) linhas.push('Os boletos em aberto são alterados no Banco do Brasil agora.');
    if (Number(plano?.valor_reembolso) > 0) linhas.push(`Reembolso ao cliente: ${moedaBR(plano.valor_reembolso)} (fica pendente no Financeiro até ser pago).`);
    linhas.push('Esta ação não pode ser desfeita.');
    return linhas.join('\n');
  }

  /** O resumo depois de gravar. */
  function resumoDoResultado(corpo) {
    const d = corpo?.devolucao || {};
    const pendencias = Number(corpo?.pendencias) || 0;
    const linhas = [
      `${(corpo?.itens || []).reduce((s, i) => s + (Number(i.quantidade) || 0), 0)} peça(s) de volta ao estoque · ${moedaBR(d.valor)} devolvidos.`
    ];
    for (const p of corpo?.parcelas || []) {
      linhas.push(`Parcela ${p.numero_parcela}: ${ROTULO_DO_MODO[p.modo] || p.modo} de ${moedaBR(p.desconto)}${p.status === 'erro' ? ` — NÃO FEITO: ${p.erro || 'erro'}` : ''}`);
    }
    if (corpo?.reembolso) linhas.push(`Reembolso de ${moedaBR(corpo.reembolso.valor)} lançado como pendente no Financeiro.`);
    if (corpo?.nota) linhas.push(`Nota de devolução nº ${corpo.nota.numero} guardada com o pedido.`);
    return {
      titulo: `Devolução ${d.tipo === 'total' ? 'total' : 'parcial'} nº ${d.sequencia ?? ''} registrada${pendencias ? ` — ${pendencias === 1 ? '1 pendência' : `${pendencias} pendências`}` : ''}`,
      linhas, tipo: pendencias ? 'error' : 'success'
    };
  }

  /** Uma devolução anterior, numa linha. */
  function linhaDoHistorico(d) {
    const [classe, rotulo] = ROTULO_DO_STATUS[d?.status] || ['badge-neutral', String(d?.status || '')];
    return {
      texto: [`nº ${d?.sequencia}`, d?.tipo === 'total' ? 'total' : 'parcial', diaBR(d?.data_devolucao), moedaBR(d?.valor),
        Number(d?.valor_reembolso) > 0 ? `reembolso ${moedaBR(d.valor_reembolso)}` : '', d?.motivo || ''].filter(Boolean).join(' · '),
      classe, rotulo, podeTentarDeNovo: d?.status === 'pendencias'
    };
  }

  function mensagemDeErro(status, corpo) {
    if (corpo?.sql_pendente) return 'Falta ativar a devolução no banco: rode sql/devolucoes.sql e reinicie a API.';
    if (status === 403) return 'Você não tem permissão para registrar devoluções.';
    if (status === 404) return 'Pedido não encontrado.';
    return corpo?.error || 'Não foi possível concluir. Tente de novo.';
  }
  // ------------------------------------------------- fim das funções puras

  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }
  const comoJson = corpo => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo || {}) });
  const novaChave = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`);

  const bruto = window.devolucaoPedidoContext;
  const ctx = { pedidoId: bruto?.pedidoId ?? window.selectedOrderId ?? null, numero: bruto?.numero ? String(bruto.numero) : '', cliente: bruto?.cliente ? String(bruto.cliente) : '' };
  window.EstadoTrabalho?.registrarContexto?.(overlayId, () => ({ devolucaoPedidoContext: ctx, selectedOrderId: ctx.pedidoId }));

  const el = id => overlay.querySelector(`#${id}`);
  const itensEl = el('devolucaoItens');
  const mensagemEl = el('devolucaoMensagem');
  const confirmarBtn = el('confirmarDevolucao');
  const arquivoEl = el('devolucaoXmlArquivo');
  const caminhoDoPedido = () => `/api/devolucoes/pedido/${encodeURIComponent(ctx.pedidoId)}`;

  let estado = null;
  let quantidades = {};
  let plano = null;
  let xml = null;
  let chave = novaChave();
  let pedidoDePrevia = 0;
  let timerDaPrevia = null;
  let emAndamento = false;
  let fechado = false;

  function desligarOuvintes() {
    document.removeEventListener('keydown', aoEsc);
    window.removeEventListener('modalFechado', aoFecharModal);
    clearTimeout(timerDaPrevia);
  }
  function fechar() {
    if (fechado) return;
    fechado = true;
    desligarOuvintes();
    if (window.devolucaoPedidoContext === bruto) window.devolucaoPedidoContext = null;
    Modal.close(overlayId);
  }
  function aoEsc(e) {
    if (e.key !== 'Escape') return;
    if (document.querySelector('dialog[open]')) return;
    e.preventDefault();
    if (!emAndamento) fechar();
  }
  function aoFecharModal(evento) {
    if (evento?.detail === overlayId) desligarOuvintes();
  }
  document.addEventListener('keydown', aoEsc);
  window.addEventListener('modalFechado', aoFecharModal);
  el('voltarDevolucao')?.addEventListener('click', () => { if (!emAndamento) fechar(); });
  el('desistirDevolucao')?.addEventListener('click', () => { if (!emAndamento) fechar(); });

  function exibirMensagem(tipo, texto) {
    mensagemEl.textContent = texto;
    mensagemEl.style.color = tipo === 'erro' ? 'var(--color-red)' : (tipo === 'ok' ? 'var(--color-green)' : 'var(--color-primary-light)');
    mensagemEl.classList.toggle('hidden', !texto);
  }

  const celula = (texto, classe = 'px-4 py-3 text-white') => { const td = document.createElement('td'); td.className = classe; td.textContent = texto; return td; };
  function tag(classe, rotulo) {
    const span = document.createElement('span');
    span.className = `${classe} px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap`;
    span.textContent = rotulo;
    return span;
  }
  function preencherLista(ul, textos) {
    ul.replaceChildren(...textos.map(t => { const li = document.createElement('li'); li.textContent = t; return li; }));
    ul.classList.toggle('hidden', !textos.length);
  }

  // ---------------------------------------------------------------- peças
  function pintarItens() {
    itensEl.replaceChildren();
    for (const item of estado?.itens || []) {
      const tr = document.createElement('tr');
      const tdNome = celula(item.nome);
      if (item.codigo) {
        const codigo = document.createElement('p');
        codigo.className = 'text-xs text-gray-400';
        codigo.textContent = item.codigo;
        tdNome.appendChild(codigo);
      }
      const tdQtd = document.createElement('td');
      tdQtd.className = 'px-4 py-2 text-right';
      const campo = document.createElement('input');
      campo.type = 'number';
      campo.min = '0';
      campo.max = String(item.disponivel);
      campo.step = '1';
      campo.inputMode = 'numeric';
      campo.value = String(quantidades[item.pedido_item_id] || 0);
      campo.disabled = !(item.disponivel > 0);
      campo.setAttribute('aria-label', `Quantas unidades de ${item.nome} foram devolvidas (até ${item.disponivel})`);
      campo.className = 'w-24 bg-input border border-inputBorder rounded-lg px-3 py-2 text-white text-right focus:border-primary focus:ring-2 focus:ring-primary/50 transition';
      const tdValor = celula('—', 'px-4 py-3 text-right text-white');
      const atualizar = () => {
        const n = quantidadeValida(campo.value, item.disponivel);
        quantidades[item.pedido_item_id] = n;
        tdValor.textContent = n ? moedaBR(n * item.valor_unitario) : '—';
      };
      campo.addEventListener('input', () => { atualizar(); agendarPrevia(); });
      campo.addEventListener('blur', () => { campo.value = String(quantidades[item.pedido_item_id] || 0); });
      atualizar();
      tdQtd.appendChild(campo);
      tr.append(tdNome, celula(String(item.quantidade), 'px-4 py-3 text-right text-white'),
        celula(item.devolvida ? String(item.devolvida) : '—', 'px-4 py-3 text-right text-gray-300'), tdQtd,
        celula(moedaBR(item.valor_unitario), 'px-4 py-3 text-right text-gray-300'), tdValor);
      itensEl.appendChild(tr);
    }
  }

  function definirQuantidades(novas) {
    quantidades = {};
    for (const item of estado?.itens || []) quantidades[item.pedido_item_id] = quantidadeValida(novas?.[item.pedido_item_id], item.disponivel);
    pintarItens();
    agendarPrevia(0);
  }

  // --------------------------------------------------------------- prévia
  function pintarTipo(tipo) {
    const [classe, rotulo] = etiquetaDoTipo(tipo);
    const alvo = el('devolucaoTipo');
    alvo.className = `${classe} px-3 py-1 rounded-full text-xs font-medium justify-self-end`;
    alvo.textContent = rotulo;
  }

  function pintarPrevia() {
    const caixa = el('devolucaoPrevia');
    caixa.classList.toggle('hidden', !plano);
    confirmarBtn.disabled = !plano || emAndamento;
    if (!plano) return;
    pintarTipo(plano.tipo);
    el('devolucaoValor').textContent = moedaBR(plano.valor);
    el('devolucaoValorParcelas').textContent = moedaBR(plano.valor_parcelas);
    el('devolucaoValorReembolso').textContent = moedaBR(plano.valor_reembolso);
    el('devolucaoValorPedido').textContent = plano.tipo === 'total' ? 'Devolvido' : moedaBR(plano.pedido?.valor_final);
    const corpo = el('devolucaoParcelas');
    corpo.replaceChildren();
    for (const l of (plano.parcelas || []).map(linhaDaParcela)) {
      const tr = document.createElement('tr');
      const tdSituacao = document.createElement('td');
      tdSituacao.className = 'px-4 py-3';
      tdSituacao.appendChild(tag(l.situacao[0], l.situacao[1]));
      const tdAcao = celula(l.acao);
      if (l.detalhe) {
        const det = document.createElement('p');
        det.className = 'text-xs text-gray-400';
        det.textContent = l.detalhe;
        tdAcao.appendChild(det);
      }
      // Sem quebra: o sinal de menos não pode ficar numa linha e o valor em outra.
      tr.append(celula(l.numero), celula(l.vencimento, 'px-4 py-3 text-white whitespace-nowrap'), tdSituacao, celula(l.antes, 'px-4 py-3 text-right text-gray-300 whitespace-nowrap'),
        celula(l.desconto, 'px-4 py-3 text-right text-white whitespace-nowrap'), celula(l.depois, 'px-4 py-3 text-right text-white whitespace-nowrap'), tdAcao);
      corpo.appendChild(tr);
    }
    if (!(plano.parcelas || []).length) {
      const tr = document.createElement('tr');
      const td = celula('Nenhuma parcela é alterada por esta devolução.', 'px-4 py-3 text-gray-400');
      td.colSpan = 7;
      tr.appendChild(td);
      corpo.appendChild(tr);
    }
    preencherLista(el('devolucaoPreviaAvisos'), plano.avisos || []);
  }

  function agendarPrevia(espera = 350) {
    clearTimeout(timerDaPrevia);
    const local = estimativa(estado?.itens, quantidades);
    pintarTipo(local.tipo);
    if (!local.pecas) {
      plano = null;
      pedidoDePrevia += 1;
      pintarPrevia();
      return;
    }
    timerDaPrevia = setTimeout(pedirPrevia, espera);
  }

  async function pedirPrevia() {
    if (fechado) return;
    const pedido = ++pedidoDePrevia;
    try {
      const resp = await fetchApi(`${caminhoDoPedido()}/previa`, comoJson({ itens: escolhasDe(estado?.itens, quantidades) }));
      const corpo = await resp.json().catch(() => null);
      // Só a resposta do último pedido vale: as quantidades podem ter mudado no caminho.
      if (pedido !== pedidoDePrevia || fechado) return;
      if (!resp.ok) { plano = null; pintarPrevia(); exibirMensagem('erro', mensagemDeErro(resp.status, corpo)); return; }
      plano = corpo;
      exibirMensagem('info', '');
      pintarPrevia();
    } catch (_) {
      if (pedido !== pedidoDePrevia) return;
      plano = null;
      pintarPrevia();
      exibirMensagem('erro', 'Não foi possível falar com o servidor. Tente de novo.');
    }
  }

  // ------------------------------------------------------------------ XML
  function pintarXml(lido) {
    el('devolucaoXmlRemover').classList.toggle('hidden', !xml);
    const resumo = el('devolucaoXmlResumo');
    if (!lido) {
      resumo.textContent = 'Opcional: o XML preenche as quantidades e fica guardado com o pedido.';
      preencherLista(el('devolucaoXmlAvisos'), []);
      preencherLista(el('devolucaoXmlNaoReconhecidos'), []);
      return;
    }
    const n = lido.nota || {};
    resumo.textContent = [`NF-e ${n.serie ?? ''}/${n.numero ?? ''}`, n.emitente_nome || '', diaBR(n.data_emissao), moedaBR(n.valor_total),
      `${(lido.casados || []).length} de ${n.quantidade_de_itens ?? 0} ${n.quantidade_de_itens === 1 ? 'item reconhecido' : 'itens reconhecidos'}`].filter(Boolean).join(' · ');
    preencherLista(el('devolucaoXmlAvisos'), lido.avisos || []);
    preencherLista(el('devolucaoXmlNaoReconhecidos'), (lido.nao_reconhecidos || [])
      .map(i => `Não reconhecido: ${i.descricao || i.codigo || `item ${i.n_item}`} (${i.quantidade} un.) — informe a quantidade na peça certa, se for deste pedido.`));
  }

  function lerArquivo(arquivo) {
    return new Promise((resolver, rejeitar) => {
      const leitor = new FileReader();
      leitor.onload = () => resolver(String(leitor.result || ''));
      leitor.onerror = () => rejeitar(new Error('Não foi possível ler o arquivo.'));
      leitor.readAsText(arquivo);
    });
  }

  async function carregarXml(arquivo) {
    if (!arquivo || emAndamento || fechado) return;
    if (arquivo.size > TAMANHO_MAXIMO_DO_XML) { exibirMensagem('erro', 'O arquivo é grande demais para ser o XML de uma NF-e.'); return; }
    emAndamento = true;
    try {
      const texto = await lerArquivo(arquivo);
      const resp = await fetchApi(`${caminhoDoPedido()}/xml`, comoJson({ xml: texto }));
      const corpo = await resp.json().catch(() => null);
      if (!resp.ok) { exibirMensagem('erro', mensagemDeErro(resp.status, corpo)); return; }
      if ((corpo?.bloqueios || []).length) { exibirMensagem('erro', corpo.bloqueios.join(' ')); return; }
      xml = texto;
      exibirMensagem('info', '');
      pintarXml(corpo);
      definirQuantidades(Object.fromEntries((corpo.escolhas || []).map(e => [e.pedido_item_id, e.quantidade])));
      const data = String(corpo?.nota?.data_emissao || '').slice(0, 10);
      if (data && data <= (estado?.hoje || data)) el('devolucaoData').value = data;
    } catch (err) {
      exibirMensagem('erro', err?.message || 'Não foi possível ler o XML.');
    } finally {
      emAndamento = false;
      arquivoEl.value = '';
    }
  }

  el('devolucaoXmlEscolher')?.addEventListener('click', () => { if (!emAndamento) arquivoEl.click(); });
  arquivoEl?.addEventListener('change', () => carregarXml(arquivoEl.files?.[0]));
  el('devolucaoXmlRemover')?.addEventListener('click', () => { xml = null; pintarXml(null); });
  el('devolucaoTudo')?.addEventListener('click', () => definirQuantidades(Object.fromEntries((estado?.itens || []).map(i => [i.pedido_item_id, i.disponivel]))));
  el('devolucaoLimpar')?.addEventListener('click', () => definirQuantidades({}));

  // ------------------------------------------------------------ histórico
  function pintarHistorico() {
    const lista = el('devolucaoHistoricoLinhas');
    lista.replaceChildren();
    for (const d of estado?.devolucoes || []) {
      const l = linhaDoHistorico(d);
      const li = document.createElement('li');
      li.className = 'flex flex-wrap items-center justify-between gap-3 px-4 py-3';
      const texto = document.createElement('span');
      texto.className = 'text-sm text-gray-200 min-w-0';
      texto.textContent = l.texto;
      const lado = document.createElement('span');
      lado.className = 'flex items-center gap-2';
      lado.appendChild(tag(l.classe, l.rotulo));
      if (l.podeTentarDeNovo) {
        const botao = document.createElement('button');
        botao.type = 'button';
        botao.className = 'btn-neutral px-3 py-1 rounded-lg text-white text-xs font-medium';
        botao.dataset.perm = 'ped.devolucao';
        botao.textContent = 'Tentar de novo';
        botao.title = 'Refaz o que ficou pendente (estoque, abatimento ou baixa no BB)';
        // Sem a marca, a rede automática do BotaoAcao ocupa o botão antes do clique e o run desiste.
        botao.dataset.acaoGerida = 'true';
        botao.addEventListener('click', () => (window.BotaoAcao?.run ? window.BotaoAcao.run(botao, () => tentarDeNovo(d.id)) : tentarDeNovo(d.id)));
        lado.appendChild(botao);
      }
      li.append(texto, lado);
      lista.appendChild(li);
    }
    el('devolucaoHistorico').classList.toggle('hidden', !(estado?.devolucoes || []).length);
  }

  function pintarResultado(corpo) {
    const r = resumoDoResultado(corpo);
    el('devolucaoResultadoTitulo').textContent = r.titulo;
    el('devolucaoResultadoTitulo').style.color = r.tipo === 'error' ? 'var(--color-red)' : 'var(--color-green)';
    preencherLista(el('devolucaoResultadoLinhas'), r.linhas);
    preencherLista(el('devolucaoResultadoAvisos'), corpo?.avisos || []);
    el('devolucaoResultado').classList.remove('hidden');
    return r;
  }

  async function tentarDeNovo(devolucaoId) {
    if (emAndamento || fechado) return;
    emAndamento = true;
    try {
      const resp = await fetchApi(`/api/devolucoes/${encodeURIComponent(devolucaoId)}/reaplicar`, comoJson({}));
      const corpo = await resp.json().catch(() => null);
      if (!resp.ok) { exibirMensagem('erro', mensagemDeErro(resp.status, corpo)); return; }
      const r = pintarResultado(corpo);
      window.showToast?.(Number(corpo?.pendencias) ? 'Ainda há pendência nesta devolução.' : 'Pendências resolvidas.', r.tipo);
      avisarMudanca();
      await carregar();
    } catch (_) {
      exibirMensagem('erro', 'Não foi possível falar com o servidor. Tente de novo.');
    } finally {
      emAndamento = false;
    }
  }

  function avisarMudanca() {
    window.dispatchEvent(new CustomEvent('pedido:devolvido', { detail: { pedidoId: ctx.pedidoId } }));
    window.dispatchEvent(new CustomEvent('boletos:alterados', { detail: { pedidoId: ctx.pedidoId } }));
    window.carregarPedidos?.();
  }

  // -------------------------------------------------------------- carregar
  function pintar() {
    el('devolucaoSubtitulo').textContent = [estado?.pedido?.numero ? `Pedido ${estado.pedido.numero}` : (ctx.numero ? `Pedido ${ctx.numero}` : ''),
      estado?.pedido?.cliente || ctx.cliente, estado?.nota ? `NF-e ${estado.nota.serie}/${estado.nota.numero}` : ''].filter(Boolean).join(' · ');
    const bloqueio = el('devolucaoBloqueio');
    bloqueio.querySelector('span').textContent = estado?.bloqueio || '';
    bloqueio.style.display = estado?.bloqueio ? 'flex' : 'none';
    bloqueio.classList.toggle('hidden', !estado?.bloqueio);
    const podeDevolver = Boolean(estado) && !estado.bloqueio;
    el('devolucaoFormulario').classList.toggle('hidden', !podeDevolver);
    confirmarBtn.classList.toggle('hidden', !podeDevolver);
    if (podeDevolver) {
      const data = el('devolucaoData');
      data.max = estado.hoje || '';
      if (!data.value) data.value = estado.hoje || '';
      definirQuantidades(quantidades);
    } else {
      plano = null;
      pintarTipo(estado?.pedido?.devolucao === 'total' ? 'total' : null);
    }
    pintarHistorico();
  }

  async function carregar() {
    try {
      const resp = await fetchApi(caminhoDoPedido());
      const corpo = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(mensagemDeErro(resp.status, corpo));
      estado = corpo;
      pintar();
    } catch (err) {
      exibirMensagem('erro', err?.message || 'Não foi possível ler o pedido.');
      confirmarBtn.classList.add('hidden');
    } finally {
      el('devolucaoCarregando').classList.add('hidden');
    }
  }

  async function confirmar() {
    if (emAndamento || fechado) return;
    const data = el('devolucaoData').value;
    const motivo = el('devolucaoMotivo').value.trim();
    if (!plano) { exibirMensagem('erro', 'Informe quantas peças foram devolvidas.'); return; }
    if (!data) { exibirMensagem('erro', 'Informe a data da devolução.'); el('devolucaoData').focus(); return; }
    if (motivo.length < 3) { exibirMensagem('erro', 'Diga o motivo da devolução.'); el('devolucaoMotivo').focus(); return; }
    const ok = await window.DialogPadrao?.confirm?.({
      title: plano.tipo === 'total' ? 'Registrar a devolução total?' : 'Registrar a devolução parcial?',
      message: textoDaConfirmacao(plano, estado?.pedido?.numero || ctx.numero),
      confirmText: 'Confirmar devolução'
    });
    if (!ok) return;
    emAndamento = true;
    confirmarBtn.disabled = true;
    exibirMensagem('info', 'Registrando a devolução…');
    try {
      let resp;
      try {
        resp = await fetchApi(caminhoDoPedido(), comoJson({
          itens: escolhasDe(estado?.itens, quantidades), data_devolucao: data, motivo,
          observacao: el('devolucaoObservacao').value.trim(), xml, chave_idempotencia: chave
        }));
      } catch (_) {
        exibirMensagem('erro', 'Não foi possível falar com o servidor. Reabra a devolução para conferir se ela foi registrada.');
        return;
      }
      const corpo = await resp.json().catch(() => null);
      if (!resp.ok) { exibirMensagem('erro', mensagemDeErro(resp.status, corpo)); return; }
      const r = pintarResultado(corpo);
      exibirMensagem('info', '');
      window.showToast?.(r.titulo, r.tipo);
      // Registrada: o formulário volta a zero, com chave nova para a próxima.
      chave = novaChave();
      quantidades = {};
      plano = null;
      xml = null;
      pintarXml(null);
      el('devolucaoMotivo').value = '';
      el('devolucaoObservacao').value = '';
      avisarMudanca();
      await carregar();
    } finally {
      emAndamento = false;
      confirmarBtn.disabled = !plano;
    }
  }

  if (typeof window.BotaoAcao?.bind === 'function') window.BotaoAcao.bind(confirmarBtn, confirmar);
  else confirmarBtn.addEventListener('click', confirmar);

  overlay.classList.remove('hidden');
  overlay.removeAttribute('aria-hidden');
  window.Modal?.signalReady?.(overlayId);
  carregar();
})();
