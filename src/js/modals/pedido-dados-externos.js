/**
 * Modal "NF-e e boletos de fora" do pedido.
 *
 * Para o pedido que saiu com nota e/ou boleto feitos em outro lugar, informa
 * só os DADOS (backend/fiscal/externas.js):
 *   - NF-e: pelo XML (guardado desde 24/09/2026, para o DANFE e as cartas de
 *     correção) ou pela chave de acesso + valor. Primeiro confere
 *     (POST …/nfe-externa/previa), mostra o que a nota diz e os avisos; só
 *     grava no "Gravar a nota".
 *   - Boletos: a linha digitável de cada parcela, conferida ao colar
 *     (POST /api/cobranca/pedidos/:id/boletos-externos/previa) e gravada no
 *     "Gravar boletos". Parcela com boleto do BB não recebe boleto de fora.
 *     A coluna Ações copia a linha, TROCA o boleto por outro (a linha vira o
 *     campo; gravar desliga o anterior) e remove. O boleto do BB IMPORTADO
 *     (colado aqui ou trazido pelo "Importar do BB") pode MUDAR de parcela
 *     — o pagamento vai junto — e, sem pagamento, ser desvinculado
 *     (POST /api/cobranca/boletos/:id/vincular).
 * Remover só desliga (fica o rastro). Nada vai para a SEFAZ nem para o BB.
 *
 * Contexto: `window.dadosExternosContext = { pedidoId, numero, cliente, formaPagamento }`.
 * Avisa quem está aberto por baixo com os eventos `nfe:externa` e
 * `boletos:alterados`, e relê a lista de Pedidos.
 */
(() => {
  const overlayId = 'dadosExternos';
  const overlay = document.getElementById('dadosExternosOverlay');
  if (!overlay) return;

  // ------------------------------------------------------ funções puras
  const TAMANHO_MAXIMO_DO_XML = 2 * 1024 * 1024;
  const moedaBR = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const diaBR = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
  const soDigitos = v => String(v ?? '').replace(/\D/g, '');

  /** A chave em grupos de 4, como sai no DANFE. */
  function chaveEmGrupos(chave) {
    return soDigitos(chave).replace(/(\d{4})(?=\d)/g, '$1 ');
  }

  /** CNPJ (14) ou CPF (11) com a pontuação; o resto como veio. */
  function documentoFormatado(doc) {
    const d = soDigitos(doc);
    if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    return d;
  }

  /** As linhas "rótulo: valor" de uma nota de fora (a gravada ou a da prévia). */
  function linhasDaNota(nota) {
    if (!nota) return [];
    const [ano, mes] = String(nota.mes_emissao || '').split('-');
    const emissao = diaBR(nota.data_emissao) || (ano && mes ? `${mes}/${ano}` : '—');
    const linhas = [
      ['NF-e', `série ${Number(nota.serie) || 0} · nº ${Number(nota.numero) || 0}`],
      ['Valor', nota.valor_total ? moedaBR(nota.valor_total) : '—'],
      ['Emissão', emissao],
      ['Emitente', [nota.emitente_nome, documentoFormatado(nota.emitente_documento)].filter(Boolean).join(' · ') || '—'],
      ['Chave de acesso', chaveEmGrupos(nota.chave_acesso)]
    ];
    if (nota.destinatario_documento) linhas.push(['Destinatário', documentoFormatado(nota.destinatario_documento)]);
    if (nota.protocolo) linhas.push(['Protocolo', String(nota.protocolo)]);
    linhas.push(['Informada', nota.origem === 'xml' ? 'pelo XML' : 'pela chave de acesso']);
    return linhas;
  }

  /** A etiqueta da seção da nota. */
  function etiquetaDaNota(estado) {
    if (estado?.nota_externa) return ['badge-info', `NF-e ${Number(estado.nota_externa.serie) || 0}/${Number(estado.nota_externa.numero) || 0} · de fora`];
    if (estado?.nota_propria) return ['badge-success', `NF-e ${estado.nota_propria.serie}/${estado.nota_propria.numero} · emitida aqui`];
    return ['badge-neutral', 'Sem nota'];
  }

  /**
   * Como cada parcela aparece: com boleto do BB (não recebe outro), com boleto
   * de fora (mostra e deixa remover) ou livre (recebe a linha digitável).
   */
  function estadoDaParcela(linha) {
    // Já paga (Pix, cartão…) e sem boleto: não recebe boleto (dono, 24/09/2026).
    if (linha?.recebimento && !linha?.boleto_externo && !linha?.tem_boleto_vivo) {
      const r = linha.recebimento;
      return { tipo: 'paga', texto: `Paga${r.forma ? ` · ${r.forma}` : ''}${r.data ? ` · ${diaBR(r.data)}` : ''}` };
    }
    // Ordem de pagamento aberta: a parcela já está cobrada (por Pix, cartão…).
    if (linha?.ordem && !linha?.boleto_externo && !linha?.tem_boleto_vivo) {
      const o = linha.ordem;
      return { tipo: 'paga', ordem: true, texto: `Ordem${o.forma ? ` · ${o.forma}` : ''}${o.data ? ` · para ${diaBR(o.data)}` : ''}` };
    }
    if (linha?.boleto_externo) {
      const b = linha.boleto_externo;
      const partes = [b.banco_nome || (b.banco ? `Banco ${b.banco}` : 'Banco'), b.vencimento ? `vence ${diaBR(b.vencimento)}` : 'sem vencimento', b.valor ? moedaBR(b.valor) : null].filter(Boolean);
      return { tipo: 'externo', texto: `De fora · ${partes.join(' · ')}`, linha: b.linha_impressa || b.linha_digitavel || '' };
    }
    if (linha?.tem_boleto_vivo) {
      const status = String(linha?.boleto?.status || 'registrado');
      return { tipo: 'bb', texto: `Boleto do BB · ${status}` };
    }
    return { tipo: 'livre', texto: '' };
  }

  /**
   * As ações de cada parcela na coluna Ações:
   *   - boleto de fora: copiar a linha e, para quem pode informar (pedido não
   *     cancelado), trocar por outro e remover;
   *   - boleto do BB IMPORTADO (colado aqui ou trazido pelo "Importar do BB"):
   *     mudar de parcela (o pagamento vai junto) e, se ainda não foi pago,
   *     desvincular (decisão do dono, 24/09/2026). O que o app gerou nasce na
   *     parcela certa: nenhuma ação;
   *   - no meio de uma troca ou mudança, só desistir dela;
   *   - parcela livre (recebe a linha no campo): nenhuma. Pura.
   */
  function acoesDaParcela(tipo, { podeInformar = false, cancelado = false, trocando = false, importado = false, pago = false } = {}) {
    if (trocando) return ['desistir'];
    if (tipo === 'externo') return podeInformar && !cancelado ? ['copiar', 'trocar', 'remover'] : ['copiar'];
    if (tipo === 'bb' && importado && podeInformar && !cancelado) return pago ? ['mudar'] : ['mudar', 'desvincular'];
    return [];
  }

  /** O que a prévia de uma linha digitável diz, numa frase. */
  function frasedaPrevia(r) {
    if (!r) return { tom: 'neutro', texto: '' };
    if (!r.ok) return { tom: 'erro', texto: r.erro || 'Não foi possível ler a linha.' };
    const b = r.boleto || {};
    // Boleto do NOSSO convênio no BB: não é "de fora", é importado de verdade
    // (com PDF, consulta e aviso de pagamento). Ver importacao.js.
    if (r.no_bb) {
      const dados = [b.vencimento ? `vence ${diaBR(b.vencimento)}` : '', b.valor ? moedaBR(b.valor) : '', b.situacao_bb || ''].filter(Boolean).join(' · ');
      return { tom: 'ok', texto: `Reconhecido no Banco do Brasil${dados ? ` (${dados})` : ''} — entra como boleto de verdade, não como boleto de fora.` };
    }
    const texto = [b.banco_nome, b.vencimento ? `vence ${diaBR(b.vencimento)}` : 'sem vencimento', b.valor ? moedaBR(b.valor) : 'valor em aberto'].filter(Boolean).join(' · ');
    return { tom: (r.avisos || []).length ? 'aviso' : 'ok', texto: [texto, ...(r.avisos || [])].join(' — ') };
  }

  /** A mensagem de erro que a tela mostra, pelo status e o corpo da resposta. */
  function mensagemDeErro(status, corpo) {
    if (corpo?.sql_pendente) return 'Falta rodar sql/nfe_boletos_externos.sql no banco e reiniciar a API.';
    if (status === 403) return 'Sem permissão para esta ação.';
    return corpo?.error || `Não foi possível concluir (HTTP ${status}).`;
  }
  // ------------------------------------------------- fim das funções puras

  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }
  const comoJson = (corpo, method = 'POST') => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo || {}) });
  const pode = chave => (typeof window.Permissoes?.pode === 'function' ? window.Permissoes.pode(chave) : true);

  const bruto = window.dadosExternosContext;
  const ctx = {
    pedidoId: bruto?.pedidoId ?? window.selectedOrderId ?? null,
    numero: bruto?.numero ? String(bruto.numero) : '',
    cliente: bruto?.cliente ? String(bruto.cliente) : '',
    formaPagamento: bruto?.formaPagamento ? String(bruto.formaPagamento) : ''
  };
  window.EstadoTrabalho?.registrarContexto?.(overlayId, () => ({ dadosExternosContext: ctx, selectedOrderId: ctx.pedidoId }));

  const el = id => overlay.querySelector(`#${id}`);
  const id = encodeURIComponent(ctx.pedidoId);
  let estadoNota = null;
  let estadoBoletos = null;
  let estadoCartas = null;
  let entradaNota = null;
  let emAndamento = false;
  let fechado = false;
  const previasDasParcelas = new Map();
  /** Parcelas com boleto de fora em troca: a linha mostra o campo para o boleto novo. */
  const trocando = new Set();
  /** Parcelas com boleto importado mudando de parcela: a linha mostra para onde. */
  const mudando = new Set();

  function desligarOuvintes() {
    document.removeEventListener('keydown', aoEsc);
    window.removeEventListener('modalFechado', aoFecharModal);
  }
  function fechar() {
    if (fechado) return;
    fechado = true;
    desligarOuvintes();
    if (window.dadosExternosContext === bruto) window.dadosExternosContext = null;
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
  el('voltarDadosExternos')?.addEventListener('click', () => { if (!emAndamento) fechar(); });
  el('fecharDadosExternos')?.addEventListener('click', () => { if (!emAndamento) fechar(); });

  function exibirMensagem(tipo, texto) {
    const m = el('dadosExternosMensagem');
    m.textContent = texto || '';
    m.style.color = tipo === 'erro' ? 'var(--color-red)' : (tipo === 'ok' ? 'var(--color-green)' : 'var(--color-primary-light)');
    m.classList.toggle('hidden', !texto);
  }

  function pintarDl(dl, linhas) {
    dl.replaceChildren();
    for (const [rotulo, valor] of linhas) {
      const par = document.createElement('div');
      par.className = 'flex flex-col min-w-0';
      const dt = document.createElement('dt');
      dt.className = 'text-xs text-gray-400';
      dt.textContent = rotulo;
      const dd = document.createElement('dd');
      dd.className = 'text-white break-words';
      dd.textContent = valor;
      par.append(dt, dd);
      dl.appendChild(par);
    }
  }

  function avisarQuemEstaAberto(evento) {
    window.dispatchEvent(new CustomEvent(evento, { detail: { pedidoId: ctx.pedidoId } }));
    if (document.getElementById('pedidosTabela')) window.carregarPedidos?.();
  }

  // ------------------------------------------------------------ NF-e
  function pintarNota() {
    const secao = el('dadosExternosNota');
    if (!estadoNota) { secao.classList.add('hidden'); return; }
    secao.classList.remove('hidden');
    const [classe, rotulo] = etiquetaDaNota(estadoNota);
    const tag = el('dadosExternosNotaTag');
    tag.className = `${classe} px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap`;
    tag.textContent = rotulo;

    const temExterna = Boolean(estadoNota.nota_externa);
    el('dadosExternosNotaAtual').classList.toggle('hidden', !temExterna);
    if (temExterna) pintarDl(el('dadosExternosNotaDados'), linhasDaNota(estadoNota.nota_externa));
    el('removerNotaExterna').classList.toggle('hidden', !temExterna || !pode('financeiro.nfe.emit'));
    pintarDocumentosDaNota();

    const podeInformar = Boolean(estadoNota.pode_informar) && pode('financeiro.nfe.emit');
    el('dadosExternosNotaForm').classList.toggle('hidden', !podeInformar);
    const motivo = !temExterna && !estadoNota.pode_informar ? estadoNota.motivo
      : (!temExterna && !pode('financeiro.nfe.emit') ? 'Informar nota pede a permissão de emitir NF-e.' : '');
    el('dadosExternosNotaMotivo').textContent = motivo || '';
    el('dadosExternosNotaMotivo').classList.toggle('hidden', !motivo);
    if (!podeInformar) { entradaNota = null; el('dadosExternosNotaPrevia').classList.add('hidden'); }
  }

  // ------------------------------- documentos da nota de fora (XML e CC-e)
  //
  // DANFE e carta de correção são desenhados em cima do `nfeProc`: sem o XML
  // guardado não sai nenhum dos dois. Quem informou a nota só pela chave
  // anexa o XML aqui e libera tudo (decisão do dono, 24/09/2026).

  function pintarDocumentosDaNota() {
    const nota = estadoNota?.nota_externa || null;
    const temXml = Boolean(nota?.tem_xml);
    const semSql = Boolean(nota) && nota.guarda_xml === false;
    const podeEmitir = pode('financeiro.nfe.emit');
    const podeVer = pode('financeiro.nfe.view');

    el('danfeNotaExterna').classList.toggle('hidden', !temXml || !podeVer);
    el('xmlNotaExterna').classList.toggle('hidden', !temXml || !podeVer);
    el('anexarXmlExterno').classList.toggle('hidden', !nota || !podeEmitir || semSql);
    el('anexarXmlExterno').textContent = temXml ? 'Trocar o XML' : 'Anexar o XML';

    const aviso = el('dadosExternosNotaSemXml');
    aviso.textContent = semSql
      ? 'Falta rodar sql/nfe_externa_xml_cce.sql no banco e reiniciar a API para guardar o XML e as cartas de correção.'
      : 'Sem o XML da nota não dá para gerar o DANFE nem a carta de correção — os dois são desenhados em cima dele. Anexe o XML autorizado (o "procNFe") para liberar.';
    aviso.classList.toggle('hidden', Boolean(temXml) || !nota);

    el('dadosExternosCartas').classList.toggle('hidden', !nota || semSql);
    pintarCartas();
  }

  /** Uma linha da lista de cartas, montada por createElement. */
  function linhaDaCarta(carta) {
    const li = document.createElement('li');
    li.className = 'rounded-lg border border-white/10 bg-white/5 p-3 space-y-2';

    const topo = document.createElement('div');
    topo.className = 'flex items-center justify-between gap-3 flex-wrap';
    const titulo = document.createElement('span');
    titulo.className = 'text-white';
    titulo.textContent = `Sequência ${carta.sequencia}${carta.protocolo ? ` · protocolo ${carta.protocolo}` : ''}`;
    const marca = document.createElement('span');
    marca.className = `${carta.origem === 'xml' ? 'badge-success' : 'badge-neutral'} px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap`;
    marca.textContent = carta.origem === 'xml' ? 'do XML' : 'à mão';
    marca.title = carta.data_evento ? `Registrada em ${diaBR(String(carta.data_evento).slice(0, 10))}` : '';
    topo.append(titulo, marca);

    const texto = document.createElement('p');
    texto.className = 'text-xs text-gray-300 whitespace-pre-wrap';
    texto.textContent = carta.correcao;

    const acoes = document.createElement('div');
    acoes.className = 'ctl-acoes justify-end';
    const botao = (rotulo, fn, classe = 'btn-neutral ctl-botao ctl-botao--pequeno text-white') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = classe;
      b.textContent = rotulo;
      if (typeof window.BotaoAcao?.bind === 'function') window.BotaoAcao.bind(b, fn);
      else b.addEventListener('click', fn);
      acoes.appendChild(b);
    };
    if (estadoNota?.nota_externa?.tem_xml && pode('financeiro.nfe.view')) {
      botao('PDF', () => window.NfeDocumentos?.gerarCartaExternaPdf?.(ctx.pedidoId, carta.sequencia));
    }
    if (carta.tem_xml && pode('financeiro.nfe.view')) {
      botao('XML', () => window.NfeDocumentos?.salvarXmlCartaExterna?.(ctx.pedidoId, carta.sequencia));
    }
    if (pode('financeiro.nfe.emit')) {
      botao('Remover', () => removerCarta(carta), 'btn-danger ctl-botao ctl-botao--pequeno text-white');
    }

    li.append(topo, texto, acoes);
    return li;
  }

  function pintarCartas() {
    const lista = el('dadosExternosCartasLista');
    const cartas = estadoCartas?.cartas || [];
    lista.replaceChildren(...cartas.map(linhaDaCarta));

    const tag = el('dadosExternosCartasTag');
    tag.className = `${cartas.length ? 'badge-info' : 'badge-neutral'} px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap`;
    tag.textContent = cartas.length === 0 ? 'nenhuma' : (cartas.length === 1 ? '1 carta' : `${cartas.length} cartas`);

    // Registrar a carta vale sempre; o PDF é que espera o XML da nota.
    const aviso = el('dadosExternosCartasAviso');
    const semXmlDaNota = Boolean(estadoNota?.nota_externa) && !estadoNota.nota_externa.tem_xml && cartas.length > 0;
    aviso.textContent = semXmlDaNota ? 'As cartas estão registradas, mas o PDF só sai depois de anexar o XML da nota.' : '';
    aviso.classList.toggle('hidden', !semXmlDaNota);
  }

  function pintarPrevia(resposta) {
    const caixa = el('dadosExternosNotaPrevia');
    if (!resposta?.nota) { caixa.classList.add('hidden'); return; }
    pintarDl(el('dadosExternosPreviaDados'), linhasDaNota(resposta.nota));
    const avisos = el('dadosExternosPreviaAvisos');
    avisos.replaceChildren(...(resposta.avisos || []).map(a => {
      const li = document.createElement('li');
      li.textContent = `• ${a}`;
      return li;
    }));
    avisos.classList.toggle('hidden', !(resposta.avisos || []).length);
    caixa.classList.remove('hidden');
  }

  async function conferirNota(entrada) {
    emAndamento = true;
    exibirMensagem('info', 'Conferindo a nota…');
    try {
      const resp = await fetchApi(`/api/fiscal/pedidos/${id}/nfe-externa/previa`, comoJson(entrada));
      const corpo = await resp.json().catch(() => null);
      if (!resp.ok) {
        entradaNota = null;
        pintarPrevia(null);
        exibirMensagem('erro', mensagemDeErro(resp.status, corpo));
        return;
      }
      entradaNota = entrada;
      pintarPrevia(corpo);
      exibirMensagem('info', '');
    } catch (_) {
      exibirMensagem('erro', 'Não foi possível falar com o servidor.');
    } finally {
      emAndamento = false;
    }
  }

  const arquivoEl = el('notaExternaXml');
  el('escolherXmlExterno')?.addEventListener('click', () => arquivoEl?.click());
  arquivoEl?.addEventListener('change', async () => {
    const arquivo = arquivoEl.files?.[0];
    arquivoEl.value = '';
    if (!arquivo) return;
    if (arquivo.size > TAMANHO_MAXIMO_DO_XML) { exibirMensagem('erro', 'O arquivo é grande demais para ser o XML de uma NF-e.'); return; }
    const xml = await arquivo.text();
    await conferirNota({ xml });
  });
  el('conferirChaveExterna')?.addEventListener('click', () => conferirNota({
    chave: el('notaExternaChave').value, valor: el('notaExternaValor').value, data_emissao: el('notaExternaData').value || null
  }));

  async function gravarNota() {
    if (!entradaNota || emAndamento) return;
    emAndamento = true;
    exibirMensagem('info', 'Gravando a nota…');
    try {
      const resp = await fetchApi(`/api/fiscal/pedidos/${id}/nfe-externa`, comoJson(entradaNota));
      const corpo = await resp.json().catch(() => null);
      if (!resp.ok) { exibirMensagem('erro', mensagemDeErro(resp.status, corpo)); return; }
      entradaNota = null;
      el('notaExternaChave').value = '';
      el('notaExternaValor').value = '';
      el('notaExternaData').value = '';
      pintarPrevia(null);
      window.showToast?.(`NF-e ${corpo?.nota?.serie}/${corpo?.nota?.numero} de fora informada no pedido ${ctx.numero}.`, 'success');
      exibirMensagem('info', '');
      avisarQuemEstaAberto('nfe:externa');
      await carregar();
    } catch (_) {
      exibirMensagem('erro', 'Não foi possível falar com o servidor. Reabra o pedido para conferir se a nota foi gravada.');
    } finally {
      emAndamento = false;
    }
  }

  async function removerNota() {
    const n = estadoNota?.nota_externa;
    if (!n || emAndamento) return;
    const ok = await window.DialogPadrao?.confirm?.({
      title: 'Remover a NF-e de fora?', tom: 'aviso', icone: 'fa-file-invoice',
      subtitle: `Pedido ${ctx.numero}`,
      secoes: [{ titulo: 'A nota', itens: [{ rotulo: `NF-e ${n.serie}/${n.numero}`, valor: n.valor_total ? moedaBR(n.valor_total) : '' }] }],
      nota: 'O pedido volta a aparecer como sem nota (e na lista "Aguardando NF-e"). Fica o registro de quem informou e de quem tirou.',
      confirmText: 'Remover', confirmVariant: 'danger'
    });
    if (!ok) return;
    emAndamento = true;
    try {
      await comVeu(async () => {
        const resp = await fetchApi(`/api/fiscal/pedidos/${id}/nfe-externa`, { method: 'DELETE' });
        const corpo = await resp.json().catch(() => null);
        if (!resp.ok) { exibirMensagem('erro', mensagemDeErro(resp.status, corpo)); return; }
        window.showToast?.('NF-e de fora removida.', 'success');
        avisarQuemEstaAberto('nfe:externa');
        await carregar();
      }, 'Removendo a NF-e de fora...');
    } finally {
      emAndamento = false;
    }
  }

  const botao = (elemento, fn) => {
    if (!elemento) return;
    if (typeof window.BotaoAcao?.bind === 'function') window.BotaoAcao.bind(elemento, fn);
    else elemento.addEventListener('click', fn);
  };

  /**
   * O véu de "ação em andamento" da casa, para o trabalho que começa DEPOIS
   * de uma caixa de diálogo: ali o clique que abriu a caixa já terminou e
   * nenhum botão fica carregando sozinho, então a tela parava sem sinal de
   * vida enquanto a API respondia.
   */
  const comVeu = (fn, texto) => (typeof window.BotaoAcao?.comCarregamento === 'function'
    ? window.BotaoAcao.comCarregamento(fn, texto)
    : fn());
  botao(el('gravarNotaExterna'), gravarNota);
  botao(el('removerNotaExterna'), removerNota);

  // ---------------------- anexar o XML da nota e as cartas de correção

  /** Lê um arquivo escolhido, com o limite de tamanho do XML da NF-e. */
  async function lerArquivoEscolhido(campo, oQue) {
    const arquivo = campo?.files?.[0];
    if (campo) campo.value = '';
    if (!arquivo) return null;
    if (arquivo.size > TAMANHO_MAXIMO_DO_XML) { exibirMensagem('erro', `O arquivo é grande demais para ser o XML ${oQue}.`); return null; }
    return arquivo.text();
  }

  const anexoEl = el('notaExternaXmlAnexo');
  el('anexarXmlExterno')?.addEventListener('click', () => anexoEl?.click());
  anexoEl?.addEventListener('change', async () => {
    const xml = await lerArquivoEscolhido(anexoEl, 'de uma NF-e');
    if (!xml || emAndamento) return;
    emAndamento = true;
    try {
      await comVeu(async () => {
        const resp = await fetchApi(`/api/fiscal/pedidos/${id}/nfe-externa/xml`, comoJson({ xml }));
        const corpo = await resp.json().catch(() => null);
        if (!resp.ok) { exibirMensagem('erro', mensagemDeErro(resp.status, corpo)); return; }
        const avisos = corpo?.avisos || [];
        window.showToast?.('XML anexado: o DANFE e a carta de correção já podem ser gerados.', 'success');
        exibirMensagem(avisos.length ? 'info' : 'ok', avisos.join(' ') || '');
        avisarQuemEstaAberto('nfe:externa');
        await carregar();
      }, 'Anexando o XML da nota...');
    } finally {
      emAndamento = false;
    }
  });

  botao(el('danfeNotaExterna'), () => window.NfeDocumentos?.gerarDanfeExterna?.(ctx.pedidoId));
  botao(el('xmlNotaExterna'), () => window.NfeDocumentos?.salvarXmlExterna?.(ctx.pedidoId));

  async function gravarCarta(entrada, oQueDizer) {
    if (emAndamento) return;
    emAndamento = true;
    try {
      await comVeu(async () => {
        const resp = await fetchApi(`/api/fiscal/pedidos/${id}/nfe-externa/cartas`, comoJson(entrada));
        const corpo = await resp.json().catch(() => null);
        if (!resp.ok) { exibirMensagem('erro', mensagemDeErro(resp.status, corpo)); return; }
        window.showToast?.(`Carta de correção ${corpo?.carta?.sequencia} registrada.`, 'success');
        exibirMensagem('info', '');
        el('cartaExternaSequencia').value = '';
        el('cartaExternaProtocolo').value = '';
        el('cartaExternaData').value = '';
        el('cartaExternaTexto').value = '';
        contarCarta();
        avisarQuemEstaAberto('nfe:externa');
        await carregar();
      }, oQueDizer);
    } finally {
      emAndamento = false;
    }
  }

  const cartaXmlEl = el('cartaExternaXml');
  el('escolherXmlCartaExterna')?.addEventListener('click', () => cartaXmlEl?.click());
  cartaXmlEl?.addEventListener('change', async () => {
    const xml = await lerArquivoEscolhido(cartaXmlEl, 'de uma carta de correção');
    if (!xml) return;
    await gravarCarta({ xml }, 'Registrando a carta de correção...');
  });

  botao(el('gravarCartaExterna'), () => gravarCarta({
    sequencia: el('cartaExternaSequencia').value || 1,
    correcao: el('cartaExternaTexto').value,
    protocolo: el('cartaExternaProtocolo').value,
    data_evento: el('cartaExternaData').value || null
  }, 'Registrando a carta de correção...'));

  function contarCarta() {
    const n = el('cartaExternaTexto').value.trim().length;
    const contador = el('cartaExternaContador');
    contador.textContent = n === 0 ? '0 caracteres' : `${n} de 15 a 1000 caracteres`;
    contador.style.color = n > 0 && n < 15 ? 'var(--color-red)' : '';
  }
  el('cartaExternaTexto')?.addEventListener('input', contarCarta);

  async function removerCarta(carta) {
    if (emAndamento) return;
    const ok = await window.DialogPadrao?.confirm?.({
      title: 'Remover a carta de correção?', tom: 'aviso', icone: 'fa-file-signature',
      subtitle: `Pedido ${ctx.numero} · sequência ${carta.sequencia}`,
      nota: 'Isto tira o registro daqui; a carta continua valendo na SEFAZ. Fica o rastro de quem tirou.',
      confirmText: 'Remover', confirmVariant: 'danger'
    });
    if (!ok) return;
    emAndamento = true;
    try {
      await comVeu(async () => {
        const resp = await fetchApi(`/api/fiscal/pedidos/${id}/nfe-externa/cartas/${encodeURIComponent(carta.sequencia)}`, { method: 'DELETE' });
        const corpo = await resp.json().catch(() => null);
        if (!resp.ok) { exibirMensagem('erro', mensagemDeErro(resp.status, corpo)); return; }
        window.showToast?.('Carta de correção removida.', 'success');
        avisarQuemEstaAberto('nfe:externa');
        await carregar();
      }, 'Removendo a carta de correção...');
    } finally {
      emAndamento = false;
    }
  }

  // --------------------------------------------------------- boletos
  function celula(conteudo, classe = 'px-4 py-3 text-left text-white') {
    const td = document.createElement('td');
    td.className = classe;
    if (conteudo instanceof Node) td.appendChild(conteudo);
    else td.textContent = conteudo ?? '';
    return td;
  }

  /** Um ícone de ação da linha, no padrão das tabelas (`<i class="fas … cursor-pointer">`). */
  function iconeDeAcao(icone, titulo, cor, fn) {
    const i = document.createElement('i');
    i.className = `fas ${icone} w-5 h-5 cursor-pointer p-1 rounded transition-colors duration-150 hover:bg-white/10`;
    i.style.color = cor;
    i.title = titulo;
    i.setAttribute('role', 'button');
    i.setAttribute('aria-label', titulo);
    i.tabIndex = 0;
    i.addEventListener('click', fn);
    i.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } });
    return i;
  }

  /** O campo da linha digitável (parcela livre ou boleto em troca), conferido ao colar. */
  function campoDaLinha(p, dica) {
    const caixa = document.createElement('div');
    caixa.className = 'flex flex-col gap-1 min-w-0';
    const campo = document.createElement('input');
    campo.type = 'text';
    campo.inputMode = 'numeric';
    campo.autocomplete = 'off';
    campo.maxLength = 60;
    campo.dataset.parcelaId = String(p.id);
    campo.className = 'w-full ctl-campo ctl-campo--pequeno bg-input border border-inputBorder text-white placeholder-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/50 transition';
    campo.placeholder = dica;
    campo.setAttribute('aria-label', `Linha digitável da parcela ${p.numero_parcela}`);
    const saida = document.createElement('span');
    saida.className = 'text-xs break-words';
    const pintarSaida = r => {
      const f = frasedaPrevia(r);
      saida.textContent = f.texto;
      saida.style.color = f.tom === 'erro' ? 'var(--color-red)' : (f.tom === 'aviso' ? 'var(--color-primary-light)' : 'var(--color-green)');
    };
    campo.addEventListener('input', () => {
      previasDasParcelas.delete(String(p.id));
      saida.textContent = '';
      if (soDigitos(campo.value).length >= 44) conferirLinha(p.id, campo.value).then(pintarSaida);
    });
    caixa.append(campo, saida);
    return caixa;
  }

  /**
   * Para onde vai o boleto importado: só as parcelas livres (sem boleto, sem
   * boleto de fora e sem pagamento). O backend confere de novo.
   */
  function campoDeMudanca(linha, estado) {
    const caixa = document.createElement('div');
    caixa.className = 'flex flex-col gap-2 min-w-0';
    const tag = document.createElement('span');
    tag.className = 'badge-success px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap self-start';
    tag.textContent = estado.texto;
    caixa.appendChild(tag);
    const livres = (Array.isArray(estadoBoletos?.parcelas) ? estadoBoletos.parcelas : [])
      .filter(l => l !== linha && !l?.tem_boleto_vivo && !l?.boleto_externo && !l?.recebimento && !l?.ordem);
    if (!livres.length) {
      const aviso = document.createElement('span');
      aviso.className = 'text-xs text-gray-400';
      aviso.textContent = 'Nenhuma parcela livre para receber este boleto (sem boleto, sem boleto de fora e sem pagamento).';
      caixa.appendChild(aviso);
      return caixa;
    }
    const linhaCampos = document.createElement('div');
    linhaCampos.className = 'flex flex-wrap items-center gap-2';
    const sel = document.createElement('select');
    sel.dataset.mudar = String(linha.parcela?.id);
    sel.className = 'flex-1 min-w-0 appearance-none select-arrow ctl-campo ctl-campo--pequeno bg-input border border-inputBorder text-white focus:border-primary focus:ring-2 focus:ring-primary/50 transition';
    sel.setAttribute('aria-label', `Parcela para onde vai o boleto da parcela ${linha.parcela?.numero_parcela}`);
    for (const l of livres) {
      const o = document.createElement('option');
      o.value = String(l.parcela?.id);
      o.textContent = `${l.parcela?.numero_parcela}ª parcela · vence ${diaBR(l.parcela?.data_vencimento) || '—'} · ${moedaBR(l.parcela?.valor)}`;
      sel.appendChild(o);
    }
    const mudar = document.createElement('button');
    mudar.type = 'button';
    mudar.className = 'btn-success ctl-botao ctl-botao--pequeno';
    mudar.textContent = 'Mudar';
    mudar.addEventListener('click', () => mudarDeParcela(linha, livres.find(l => String(l.parcela?.id) === sel.value)));
    linhaCampos.append(sel, mudar);
    caixa.appendChild(linhaCampos);
    return caixa;
  }

  /** O boleto importado vai para outra parcela; pago, o pagamento vai junto. */
  async function mudarDeParcela(linha, alvo) {
    const b = linha?.boleto;
    if (!b || !alvo || emAndamento) return;
    const de = linha.parcela?.numero_parcela;
    const para = alvo.parcela?.numero_parcela;
    const pago = String(b.status) === 'pago' || Boolean(linha.recebimento);
    const ok = await window.DialogPadrao?.confirm?.({
      title: 'Mudar o boleto de parcela?', tom: 'aviso', icone: 'fa-exchange-alt',
      subtitle: `Pedido ${ctx.numero}`,
      secoes: [{ titulo: 'O boleto', itens: [{ rotulo: b.nosso_numero ? `Nº ${b.nosso_numero}` : 'Boleto do BB', valor: `da ${de}ª para a ${para}ª parcela`, detalhe: pago ? 'pago — o pagamento vai junto' : 'ainda não pago' }] }],
      nota: pago
        ? `A ${para}ª parcela passa a ficar paga e a ${de}ª volta a ficar em aberto. Nada muda no Banco do Brasil.`
        : `A ${de}ª parcela fica livre para outro boleto. Nada muda no Banco do Brasil.`,
      confirmText: 'Mudar'
    });
    if (!ok) return;
    emAndamento = true;
    try {
      await comVeu(async () => {
        const resp = await fetchApi(`/api/cobranca/boletos/${encodeURIComponent(b.id)}/vincular`, comoJson({ pedido_id: Number(ctx.pedidoId), parcela_id: Number(alvo.parcela.id) }));
        const corpo = await resp.json().catch(() => null);
        if (!resp.ok) { exibirMensagem('erro', corpo?.error || mensagemDeErro(resp.status, corpo)); return; }
        mudando.delete(String(linha.parcela?.id));
        window.showToast?.(`Boleto mudou da ${de}ª para a ${para}ª parcela${pago ? ' — o pagamento foi junto' : ''}.`, 'success');
        avisarQuemEstaAberto('boletos:alterados');
        if (pago) avisarQuemEstaAberto('recebimentos:alterados');
        await carregar();
      }, 'Mudando o boleto de parcela...');
    } catch (_) {
      exibirMensagem('erro', 'Não foi possível falar com o servidor. Reabra o modal para conferir.');
    } finally {
      emAndamento = false;
    }
  }

  /** Solta da parcela o boleto importado que ainda não foi pago (ele continua no BB). */
  async function desvincularBoleto(linha) {
    const b = linha?.boleto;
    if (!b || emAndamento) return;
    const ok = await window.DialogPadrao?.confirm?.({
      title: 'Desvincular o boleto da parcela?', tom: 'aviso', icone: 'fa-unlink',
      subtitle: `Pedido ${ctx.numero} · parcela ${linha?.parcela?.numero_parcela ?? ''}`,
      secoes: [{ titulo: 'O boleto', itens: [{ rotulo: b.nosso_numero ? `Nº ${b.nosso_numero}` : 'Boleto do BB', valor: b.valor ? moedaBR(b.valor) : '', detalhe: b.data_vencimento ? `vence ${diaBR(b.data_vencimento)}` : '' }] }],
      nota: 'A parcela fica livre para outro boleto. O boleto continua registrado no Banco do Brasil e pode ser ligado de novo pelo "Importar do BB".',
      confirmText: 'Desvincular', confirmVariant: 'danger'
    });
    if (!ok) return;
    emAndamento = true;
    try {
      await comVeu(async () => {
        const resp = await fetchApi(`/api/cobranca/boletos/${encodeURIComponent(b.id)}/vincular`, comoJson({}));
        const corpo = await resp.json().catch(() => null);
        if (!resp.ok) { exibirMensagem('erro', corpo?.error || mensagemDeErro(resp.status, corpo)); return; }
        window.showToast?.('Boleto desvinculado da parcela.', 'success');
        avisarQuemEstaAberto('boletos:alterados');
        await carregar();
      }, 'Desvinculando o boleto...');
    } catch (_) {
      exibirMensagem('erro', 'Não foi possível falar com o servidor. Reabra o modal para conferir.');
    } finally {
      emAndamento = false;
    }
  }

  /** O "Gravar boletos" aparece enquanto houver campo de linha digitável na tabela. */
  function atualizarGravar() {
    const campos = overlay.querySelectorAll('#dadosExternosParcelas input[data-parcela-id]');
    el('gravarBoletosExternos').classList.toggle('hidden', !campos.length);
  }

  /**
   * Uma linha da tabela: parcela, vencimento, valor, o boleto (a tag do de
   * fora, a do BB ou o campo para colar) e as ações. Trocar e desistir
   * refazem só a própria linha — o que foi colado nas outras não se perde.
   */
  function montarLinhaDoBoleto(linha, { podeInformar, cancelado }) {
    const p = linha.parcela || {};
    const chave = String(p.id);
    const estado = estadoDaParcela(linha);
    const emTroca = estado.tipo === 'externo' && trocando.has(chave) && podeInformar && !cancelado;
    const importado = estado.tipo === 'bb' && String(linha.boleto?.origem || '') === 'importado';
    const pago = String(linha.boleto?.status || '') === 'pago' || Boolean(linha.recebimento);
    const emMudanca = importado && mudando.has(chave) && podeInformar && !cancelado;
    const tr = document.createElement('tr');
    let conteudo;
    if (emMudanca) {
      conteudo = campoDeMudanca(linha, estado);
    } else if (emTroca) {
      conteudo = campoDaLinha(p, 'Cole a linha digitável do boleto novo');
      const antes = document.createElement('span');
      antes.className = 'text-xs text-gray-400 break-all';
      antes.textContent = `Substitui: ${estado.texto}`;
      conteudo.appendChild(antes);
    } else if (estado.tipo === 'externo') {
      conteudo = document.createElement('div');
      conteudo.className = 'flex flex-col gap-1 min-w-0';
      const tag = document.createElement('span');
      tag.className = 'badge-info px-3 py-1 rounded-full text-xs font-medium self-start max-w-full truncate';
      tag.textContent = estado.texto;
      tag.title = estado.texto;
      const linhaTexto = document.createElement('span');
      linhaTexto.className = 'text-xs text-gray-400 break-all';
      linhaTexto.textContent = estado.linha;
      conteudo.append(tag, linhaTexto);
    } else if (estado.tipo === 'bb') {
      conteudo = document.createElement('span');
      conteudo.className = 'badge-success px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap';
      conteudo.textContent = estado.texto;
    } else if (estado.tipo === 'paga') {
      conteudo = document.createElement('div');
      conteudo.className = 'flex flex-col gap-1 min-w-0';
      const tag = document.createElement('span');
      tag.className = 'badge-success px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap self-start';
      tag.textContent = estado.texto;
      const nota = document.createElement('span');
      nota.className = 'text-xs text-gray-400';
      nota.textContent = estado.ordem
        ? 'Parcela com ordem de pagamento: para pôr um boleto nela, cancele a ordem em "Pagamentos".'
        : 'Parcela já paga: para pôr um boleto nela, estorne o pagamento em "Pagamentos".';
      conteudo.append(tag, nota);
    } else if (!cancelado && podeInformar) {
      conteudo = campoDaLinha(p, 'Cole a linha digitável (47 números)');
    } else {
      conteudo = document.createElement('span');
      conteudo.className = 'text-gray-400';
      conteudo.textContent = 'Sem boleto';
    }

    const acoes = document.createElement('div');
    acoes.className = 'flex items-center justify-center gap-1';
    const refazer = () => {
      tr.replaceWith(montarLinhaDoBoleto(linha, { podeInformar, cancelado }));
      atualizarGravar();
    };
    const FAZ = {
      copiar: () => iconeDeAcao('fa-copy', 'Copiar a linha digitável', 'var(--color-primary-light)', async () => {
        try { await navigator.clipboard.writeText(soDigitos(estado.linha)); window.showToast?.('Linha digitável copiada.', 'success'); } catch (_) { window.showToast?.('Não foi possível copiar.', 'error'); }
      }),
      trocar: () => iconeDeAcao('fa-edit', 'Trocar por outro boleto', 'var(--color-primary)', () => {
        trocando.add(chave);
        refazer();
        overlay.querySelector(`#dadosExternosParcelas input[data-parcela-id="${chave}"]`)?.focus();
      }),
      remover: () => iconeDeAcao('fa-trash', 'Remover o boleto de fora', 'var(--color-red)', () => removerBoleto(linha)),
      mudar: () => iconeDeAcao('fa-exchange-alt', pago ? 'Mudar de parcela (o pagamento vai junto)' : 'Mudar de parcela', 'var(--color-primary)', () => {
        mudando.add(chave);
        refazer();
        overlay.querySelector(`#dadosExternosParcelas select[data-mudar="${chave}"]`)?.focus();
      }),
      desvincular: () => iconeDeAcao('fa-unlink', 'Desvincular da parcela', 'var(--color-red)', () => desvincularBoleto(linha)),
      desistir: () => iconeDeAcao('fa-times', emMudanca ? 'Desistir da mudança' : 'Desistir da troca', 'var(--color-red)', () => {
        trocando.delete(chave);
        mudando.delete(chave);
        previasDasParcelas.delete(chave);
        refazer();
      })
    };
    for (const acao of acoesDaParcela(estado.tipo, { podeInformar, cancelado, trocando: emTroca || emMudanca, importado, pago })) acoes.appendChild(FAZ[acao]());
    if (!acoes.childElementCount) {
      acoes.classList.add('text-gray-500');
      acoes.textContent = '—';
    }
    tr.append(
      celula(p.numero_parcela ? `${p.numero_parcela}ª` : '—'),
      celula(diaBR(p.data_vencimento) || '—'),
      celula(moedaBR(p.valor)),
      celula(conteudo, 'px-4 py-3 text-left min-w-0'),
      celula(acoes, 'px-4 py-3 text-center')
    );
    return tr;
  }

  function pintarBoletos() {
    const secao = el('dadosExternosBoletos');
    const tbody = el('dadosExternosParcelas').querySelector('tbody');
    tbody.replaceChildren();
    const linhas = Array.isArray(estadoBoletos?.parcelas) ? estadoBoletos.parcelas : [];
    const forma = String(estadoNota?.pedido?.forma_pagamento || ctx.formaPagamento || '').toLowerCase();
    const temDeFora = linhas.some(l => l?.boleto_externo);
    if (!estadoBoletos || (forma !== 'boleto' && !temDeFora)) {
      secao.classList.toggle('hidden', !estadoBoletos);
      el('dadosExternosParcelasCaixa').classList.add('hidden');
      el('gravarBoletosExternos').classList.add('hidden');
      const motivo = el('dadosExternosBoletosMotivo');
      motivo.textContent = 'O pedido não é pago com boleto.';
      motivo.classList.remove('hidden');
      return;
    }
    secao.classList.remove('hidden');
    el('dadosExternosParcelasCaixa').classList.remove('hidden');
    const podeInformar = pode('financeiro.boleto.emit');
    const situacao = String(estadoBoletos?.pedido?.situacao || estadoNota?.pedido?.situacao || '').toLowerCase();
    // O boleto de fora não espera o embarque (a NOTA, sim): há cliente que paga
    // adiantado e recebe o boleto antes de a mercadoria sair (decisão do dono,
    // 23/09/2026). Só o pedido cancelado fica de fora.
    const cancelado = situacao === 'cancelado' || estadoNota?.pedido?.devolucao === 'total';
    const motivo = el('dadosExternosBoletosMotivo');
    const textoMotivo = !linhas.length ? 'O pedido não tem parcelas cadastradas.'
      : (cancelado ? 'Pedido cancelado ou devolvido por inteiro não recebe boleto de fora.' : (!podeInformar ? 'Informar boleto pede a permissão de gerar boletos.' : ''));
    motivo.textContent = textoMotivo;
    motivo.classList.toggle('hidden', !textoMotivo);

    // A parcela que deixou de ter boleto de fora (removido) sai da troca.
    const comDeFora = new Set(linhas.filter(l => l?.boleto_externo).map(l => String(l.parcela?.id)));
    for (const chave of [...trocando]) if (!comDeFora.has(chave)) trocando.delete(chave);
    const comImportado = new Set(linhas.filter(l => String(l?.boleto?.origem || '') === 'importado' && l?.tem_boleto_vivo).map(l => String(l.parcela?.id)));
    for (const chave of [...mudando]) if (!comImportado.has(chave)) mudando.delete(chave);
    for (const linha of linhas) tbody.appendChild(montarLinhaDoBoleto(linha, { podeInformar, cancelado }));
    atualizarGravar();
  }

  async function conferirLinha(parcelaId, linha) {
    try {
      const resp = await fetchApi(`/api/cobranca/pedidos/${id}/boletos-externos/previa`, comoJson({ linhas: [{ parcela_id: parcelaId, linha }] }));
      const corpo = await resp.json().catch(() => null);
      if (!resp.ok) return { ok: false, erro: mensagemDeErro(resp.status, corpo) };
      const r = corpo?.resultados?.[0] || null;
      if (r?.ok) previasDasParcelas.set(String(parcelaId), linha);
      return r;
    } catch (_) {
      return { ok: false, erro: 'Não foi possível falar com o servidor.' };
    }
  }

  async function gravarBoletos() {
    if (emAndamento) return;
    const campos = [...overlay.querySelectorAll('#dadosExternosParcelas input[data-parcela-id]')];
    const linhas = campos.filter(c => soDigitos(c.value)).map(c => ({ parcela_id: Number(c.dataset.parcelaId), linha: c.value }));
    if (!linhas.length) { exibirMensagem('erro', 'Cole a linha digitável de ao menos uma parcela.'); return; }
    emAndamento = true;
    exibirMensagem('info', 'Gravando os boletos…');
    try {
      const resp = await fetchApi(`/api/cobranca/pedidos/${id}/boletos-externos`, comoJson({ linhas }));
      const corpo = await resp.json().catch(() => null);
      if (!resp.ok) { exibirMensagem('erro', mensagemDeErro(resp.status, corpo)); return; }
      const resultados = Array.isArray(corpo?.resultados) ? corpo.resultados : [];
      const gravados = resultados.filter(r => r.ok).length;
      const erros = resultados.filter(r => !r.ok);
      // A troca que deu certo sai do modo de troca; a que falhou continua com o campo.
      for (const r of resultados) if (r.ok) trocando.delete(String(r.parcela_id));
      if (gravados) {
        window.showToast?.(`${gravados === 1 ? '1 boleto de fora gravado' : `${gravados} boletos de fora gravados`} no pedido ${ctx.numero}.`, 'success');
        avisarQuemEstaAberto('boletos:alterados');
      }
      await carregar();
      exibirMensagem(erros.length ? 'erro' : 'info', erros.map(r => `Parcela ${r.numero_parcela ?? '?'}: ${r.erro}`).join(' · '));
    } catch (_) {
      exibirMensagem('erro', 'Não foi possível falar com o servidor. Reabra o pedido para conferir o que foi gravado.');
    } finally {
      emAndamento = false;
    }
  }

  async function removerBoleto(linha) {
    const b = linha?.boleto_externo;
    if (!b || emAndamento) return;
    const ok = await window.DialogPadrao?.confirm?.({
      title: 'Remover o boleto de fora?', tom: 'aviso', icone: 'fa-barcode',
      subtitle: `Pedido ${ctx.numero} · parcela ${linha?.parcela?.numero_parcela ?? ''}`,
      secoes: [{ titulo: 'O boleto', itens: [{ rotulo: b.banco_nome || 'Banco', valor: b.valor ? moedaBR(b.valor) : '', detalhe: b.vencimento ? `vence ${diaBR(b.vencimento)}` : '' }] }],
      nota: 'A parcela volta a ficar sem boleto. Fica o registro de quem informou e de quem tirou.',
      confirmText: 'Remover', confirmVariant: 'danger'
    });
    if (!ok) return;
    emAndamento = true;
    try {
      await comVeu(async () => {
        const resp = await fetchApi(`/api/cobranca/boletos-externos/${encodeURIComponent(b.id)}`, { method: 'DELETE' });
        const corpo = await resp.json().catch(() => null);
        if (!resp.ok) { exibirMensagem('erro', mensagemDeErro(resp.status, corpo)); return; }
        window.showToast?.('Boleto de fora removido.', 'success');
        avisarQuemEstaAberto('boletos:alterados');
        await carregar();
      }, 'Removendo o boleto de fora...');
    } finally {
      emAndamento = false;
    }
  }
  botao(el('gravarBoletosExternos'), gravarBoletos);

  // ---------------------------------------------------------- leitura
  async function lerJson(caminho) {
    try {
      const resp = await fetchApi(caminho);
      const corpo = await resp.json().catch(() => null);
      return { ok: resp.ok, status: resp.status, corpo };
    } catch (_) {
      return { ok: false, status: 0, corpo: null };
    }
  }

  async function carregar() {
    const [nota, boletos, cartas] = await Promise.all([
      lerJson(`/api/fiscal/pedidos/${id}/nfe-externa`),
      lerJson(`/api/cobranca/pedidos/${id}/boletos`),
      lerJson(`/api/fiscal/pedidos/${id}/nfe-externa/cartas`)
    ]);
    el('dadosExternosCarregando').classList.add('hidden');
    // Sem permissão para ver notas (403) a seção da nota some; sem o SQL, a tela diz o que fazer.
    estadoNota = nota.ok ? nota.corpo : null;
    estadoBoletos = boletos.ok ? boletos.corpo : null;
    // As cartas nunca derrubam a tela: sem a tabela (SQL da fase) vem vazio.
    estadoCartas = cartas.ok ? cartas.corpo : null;
    const problemas = [];
    if (!nota.ok && nota.status !== 403) problemas.push(mensagemDeErro(nota.status, nota.corpo));
    if (!boletos.ok && boletos.status !== 403 && !problemas.length) problemas.push(mensagemDeErro(boletos.status, boletos.corpo));
    if (!nota.ok && nota.status === 403 && !boletos.ok) problemas.push('Sem permissão para ver notas fiscais nem boletos.');
    const numero = estadoNota?.pedido?.numero || estadoBoletos?.pedido?.numero || ctx.numero;
    if (numero) ctx.numero = String(numero);
    el('dadosExternosSubtitulo').textContent = [ctx.numero ? `Pedido ${ctx.numero}` : '', estadoBoletos?.pedido?.cliente || ctx.cliente].filter(Boolean).join(' · ');
    pintarNota();
    pintarBoletos();
    if (problemas.length) exibirMensagem('erro', problemas.join(' '));
  }

  // Revela só depois da PRIMEIRA leitura, como os modais do Financeiro: até
  // lá fica o spinner de quem abriu (Modal.openWithSpinner). Antes o modal
  // aparecia vazio e os dados caíam nele depois, com cara de travamento.
  const revelar = () => {
    overlay.classList.remove('hidden');
    overlay.removeAttribute('aria-hidden');
    window.Modal?.signalReady?.(overlayId);
  };
  Promise.resolve(carregar())
    .catch(erro => console.error('[pedido] falha ao carregar o modal', overlayId, erro))
    .finally(revelar);
})();
