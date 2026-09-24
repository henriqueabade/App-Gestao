(async () => {
  const overlayId = 'visualizarPedido';
  const overlay = document.getElementById('visualizarPedidoOverlay');
  if (!overlay) return;
  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }

  const escapeAttr = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#39;');

  // ------------------------------------------------------------------
  // Datas
  //
  // Colunas DATE ('YYYY-MM-DD') são cortadas como texto, nunca passam por
  // `new Date()`: servidas como '2026-09-13T00:00:00.000Z' e convertidas para
  // o fuso local, virariam o dia 12. As demais (emissão, entrega...) são
  // instantes e seguem o fuso de quem olha.
  // ------------------------------------------------------------------
  const COLUNAS_DATE = new Set(['data_aprovacao', 'embarcar_real', 'embarcar_previsao', 'inicio_faturamento', 'data_devolucao']);

  /**
   * A nota (daqui) que tem DANFE, guardada para as etiquetas clicáveis do
   * rodapé — `pintarTags` roda depois da leitura e precisa do id dela.
   */
  let notaDocumentos = null;

  function diaDeColunaDate(valor) {
    if (valor === null || valor === undefined) return null;
    const achado = /^(\d{4}-\d{2}-\d{2})/.exec(String(valor).trim());
    return achado ? achado[1] : null;
  }

  function formatarDia(dia) {
    const [ano, mes, d] = String(dia).split('-');
    return `${d}/${mes}/${ano}`;
  }

  /** Dia (em São Paulo) de um instante; texto que já é só data volta como está. */
  function diaEmSaoPaulo(valor) {
    if (valor === null || valor === undefined || valor === '') return null;
    const texto = String(valor).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
    const instante = new Date(texto);
    if (Number.isNaN(instante.getTime())) return null;
    const partes = {};
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(instante).forEach(p => { partes[p.type] = p.value; });
    return partes.year && partes.month && partes.day ? `${partes.year}-${partes.month}-${partes.day}` : null;
  }

  /** a − b em dias de calendário, em UTC — sem hora local nem horário de verão. */
  function diferencaEmDias(a, b) {
    const utc = dia => {
      const [ano, mes, d] = dia.split('-').map(Number);
      return Date.UTC(ano, mes - 1, d);
    };
    return Math.round((utc(a) - utc(b)) / 86400000);
  }

  /**
   * De onde os vencimentos contam: o início do faturamento; nos pedidos
   * antigos, que não o têm, o dia (em São Paulo) da emissão — a mesma regra
   * do backend.
   */
  function baseDoFaturamento(pedido) {
    return diaDeColunaDate(pedido?.inicio_faturamento) || diaEmSaoPaulo(pedido?.data_emissao);
  }

  function formatarDataDaColuna(coluna, valor) {
    if (COLUNAS_DATE.has(coluna)) {
      const dia = diaDeColunaDate(valor);
      return dia ? formatarDia(dia) : '';
    }
    const instante = new Date(valor);
    return Number.isNaN(instante.getTime()) ? '' : instante.toLocaleDateString('pt-BR');
  }

  // ------------------------------------------------------------------
  // Tags do rodapé: NF-e (ou "sem nota fiscal"), frete, volumes e pesos —
  // o que foi informado no embarque. Pura e autocontida: o teste a recorta.
  // ------------------------------------------------------------------
  function tagsDoEmbarque(pedido, notas, cartas = 0, boletos = null, notasDevolucao = [], notaExterna = null, ultimaCarta = 0) {
    const ROTULO_FRETE = { 0: 'CIF (emitente)', 1: 'FOB (destinatário)', 2: 'terceiros', 3: 'próprio (emitente)', 4: 'próprio (destinatário)', 9: 'sem frete' };
    const STATUS_NF = {
      autorizada: ['badge-success', 'autorizada'], processando: ['badge-warning', 'em processamento'], enviando: ['badge-warning', 'enviada'],
      cancelamento_pendente: ['badge-warning', 'cancelamento pendente'], rejeitada: ['badge-danger', 'rejeitada'], denegada: ['badge-danger', 'denegada'],
      cancelada: ['badge-danger', 'cancelada'], erro_tecnico: ['badge-danger', 'erro técnico']
    };
    const brl = v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const kg = v => `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} kg`;
    const p = pedido || {};
    const tags = [];
    const lista = (Array.isArray(notas) ? notas : []).filter(Boolean).sort((a, b) => Number(b.id) - Number(a.id));
    const nota = lista.find(n => ['autorizada', 'processando', 'enviando', 'cancelamento_pendente'].includes(String(n.status_fiscal))) || lista[0] || null;
    if (nota) {
      const [classe, rotulo] = STATUS_NF[nota.status_fiscal] || ['badge-neutral', String(nota.status_fiscal || '')];
      const valor = Number(nota.valor_total);
      // Autorizada ou cancelada tem DANFE: a etiqueta gera, como na lista.
      const temDanfe = ['autorizada', 'cancelada'].includes(String(nota.status_fiscal));
      tags.push({
        classe,
        texto: `NF-e ${nota.serie}/${nota.numero} · ${rotulo}${Number.isFinite(valor) && valor > 0 ? ` · ${brl(valor)}` : ''}${nota.ambiente === 'homologacao' ? ' · homologação' : ''}`,
        acao: temDanfe ? 'danfe' : null,
        titulo: temDanfe ? 'Clique para gerar o DANFE desta nota' : ''
      });
    } else if (notaExterna) {
      // A NF-e emitida fora e informada: vence o "Sem nota fiscal". Com o XML
      // dela anexado, a etiqueta vira BOTÃO e gera o DANFE — como a da nota
      // daqui (pedido do dono, 24/09/2026).
      const valorDeFora = Number(notaExterna.valor_total);
      tags.push({
        classe: 'badge-info',
        texto: `NF-e ${Number(notaExterna.serie) || 0}/${Number(notaExterna.numero) || 0} · de fora${Number.isFinite(valorDeFora) && valorDeFora > 0 ? ` · ${brl(valorDeFora)}` : ''}`,
        acao: notaExterna.tem_xml ? 'danfe-fora' : null,
        titulo: notaExterna.tem_xml ? 'Clique para gerar o DANFE desta nota' : 'Anexe o XML da nota em "NF-e e boletos de fora" para gerar o DANFE'
      });
    } else if (p.nfe_dispensada === true || p.nfe_dispensada === 'true') {
      tags.push({ classe: 'badge-neutral', texto: 'Sem nota fiscal' });
    }
    // As cartas de correção contam para a nota daqui e para a de fora: nos
    // dois casos é o mesmo documento, registrado num lugar ou no outro. A
    // etiqueta gera o PDF da ÚLTIMA carta (é ela que vale).
    const totalCartas = Number(cartas) || 0;
    const seqCarta = Number(ultimaCarta) || totalCartas;
    if ((nota || notaExterna) && totalCartas > 0) {
      const deFora = !nota && Boolean(notaExterna);
      const podePdf = deFora ? Boolean(notaExterna?.tem_xml) : true;
      tags.push({
        classe: 'badge-info',
        texto: totalCartas === 1 ? 'CC-e 1' : `CC-e ×${totalCartas}`,
        acao: podePdf ? (deFora ? 'cce-fora' : 'cce') : null,
        seq: seqCarta,
        titulo: podePdf ? `Clique para gerar o PDF da carta de correção nº ${seqCarta}` : 'Anexe o XML da nota para gerar o PDF da carta'
      });
    }
    // Devolução (roxo): o que voltou e a nota que o cliente emitiu.
    const devolvido = Number(p.valor_devolvido);
    if (p.devolucao && devolvido > 0) tags.push({ classe: 'badge-purple', texto: `${p.devolucao === 'total' ? 'Devolvido' : 'Devolução parcial'} · ${brl(devolvido)}` });
    for (const nd of (Array.isArray(notasDevolucao) ? notasDevolucao : []).filter(Boolean)) {
      tags.push({ classe: 'badge-purple', texto: `NF dev. ${nd.serie ?? ''}/${nd.numero ?? ''}` });
    }
    // Boletos das parcelas (cobrança BB): quantas parcelas já têm boleto vivo, e quantos pagos.
    const parcelas = Number(boletos?.parcelas) || 0;
    const registrados = Number(boletos?.registrados) || 0;
    if (parcelas > 0 && registrados > 0) {
      const pagos = Number(boletos?.pagos) || 0;
      tags.push({ classe: registrados === parcelas ? 'badge-success' : 'badge-warning', texto: `Boletos ${registrados}/${parcelas}${pagos ? ` · ${pagos} pago${pagos > 1 ? 's' : ''}` : ''}` });
    }
    // Boletos emitidos fora e informados: contados à parte (não são do BB).
    const deFora = Number(boletos?.externos) || 0;
    if (parcelas > 0 && deFora > 0) tags.push({ classe: 'badge-info', texto: `Boletos de fora ${deFora}/${parcelas}` });
    const aMao = Number(boletos?.pagos_a_mao) || 0;
    if (parcelas > 0 && aMao > 0) tags.push({ classe: 'badge-success', texto: `Pagas à mão ${aMao}/${parcelas}` });
    const modalidade = p.modalidade_frete;
    if (modalidade !== null && modalidade !== undefined && modalidade !== '' && ROTULO_FRETE[Number(modalidade)]) {
      tags.push({ classe: 'badge-neutral', texto: `Frete: ${ROTULO_FRETE[Number(modalidade)]}` });
    }
    const volumes = Number(p.volumes_quantidade);
    if (volumes > 0) tags.push({ classe: 'badge-info', texto: `Volumes: ${volumes}${p.volumes_especie ? ` ${p.volumes_especie}` : ''}` });
    const pesos = [];
    if (Number(p.peso_bruto) > 0) pesos.push(`${kg(p.peso_bruto)} bruto`);
    if (Number(p.peso_liquido) > 0) pesos.push(`${kg(p.peso_liquido)} líq.`);
    if (pesos.length) tags.push({ classe: 'badge-neutral', texto: `Peso: ${pesos.join(' · ')}` });
    return tags;
  }

  /** O resumo dos boletos para a tag, a partir do estado GET /api/cobranca/pedidos/:id/boletos. Pura. */
  function resumoDeBoletos(estado) {
    const linhas = Array.isArray(estado?.parcelas) ? estado.parcelas : [];
    return {
      parcelas: linhas.length,
      registrados: linhas.filter(l => l?.tem_boleto_vivo).length,
      pagos: linhas.filter(l => l?.boleto?.status === 'pago').length,
      com_erro: linhas.filter(l => l?.boleto?.status === 'erro').length,
      externos: linhas.filter(l => l?.boleto_externo).length,
      // Pagas por Pix, cartão, transferência… (registradas no modal Pagamentos).
      pagos_a_mao: linhas.filter(l => l?.recebimento?.origem === 'manual').length
    };
  }

  /** Como a parcela paga à mão (Pix, cartão…) aparece na coluna das parcelas. Pura. */
  function rotuloDoPagamento(r) {
    const [ano, mes, dia] = String(r?.data || '').split('-');
    const partes = [r?.forma || '', dia ? `${dia}/${mes}/${ano}` : ''].filter(Boolean);
    return { classe: 'badge-success', texto: `pago${partes.length ? ` · ${partes.join(' · ')}` : ''}` };
  }

  /** Como o boleto emitido fora aparece na coluna das parcelas. Pura. */
  function rotuloDoBoletoExterno(b) {
    const [ano, mes, dia] = String(b?.vencimento || '').split('-');
    const partes = [b?.banco_nome || (b?.banco ? `Banco ${b.banco}` : ''), dia ? `vence ${dia}/${mes}/${ano}` : ''].filter(Boolean);
    return { classe: 'badge-info', texto: `de fora${partes.length ? ` · ${partes.join(' · ')}` : ''}`, linha: String(b?.linha_digitavel || '') };
  }

  /**
   * O botão "NF-e e boletos de fora": só pedido que saiu, e só quando falta a
   * nota (nenhuma emitida aqui nem informada), falta boleto numa parcela de
   * pedido pago com boleto, ou já há dado de fora para ver ou tirar. Pura.
   */
  function precisaDeDadosDeFora({ pedido, notas = [], notaExterna = null, boletos = null }) {
    if (pedidoCancelado(pedido)) return false;
    const temNotaPropria = (Array.isArray(notas) ? notas : []).some(n => n && String(n.status_fiscal) === 'autorizada');
    const linhas = Array.isArray(boletos?.parcelas) ? boletos.parcelas : [];
    // Boleto importado (colado ou trazido do BB) também: é lá que ele muda de
    // parcela quando foi ligado à errada (decisão do dono, 24/09/2026).
    const temDeFora = Boolean(notaExterna) || linhas.some(l => l?.boleto_externo || l?.boleto?.origem === 'importado');
    // A NOTA de fora só depois que o pedido saiu (a nota acompanha a mercadoria).
    // O BOLETO não espera o embarque: cliente que pagou adiantado já tem o
    // boleto na mão antes da nota (decisão do dono, 23/09/2026).
    const faltaNota = pedidoJaSaiu(pedido) && !temNotaPropria && !notaExterna;
    const faltaBoleto = pagaComBoleto(pedido) && linhas.some(l => !l?.tem_boleto_vivo && !l?.boleto_externo && !l?.recebimento);
    return faltaNota || faltaBoleto || temDeFora;
  }

  /** Como cada boleto aparece na coluna das parcelas: classe da tag e texto. Pura. */
  function rotuloDoBoleto(boleto) {
    if (!boleto) return { classe: 'badge-neutral', texto: 'sem boleto' };
    const ROTULO = { registrado: ['badge-success', 'registrado'], pago: ['badge-success', 'pago'], baixado: ['badge-neutral', 'baixado'], vencido: ['badge-warning', 'vencido'], protestado: ['badge-danger', 'protestado'], erro: ['badge-danger', 'erro'], reservado: ['badge-warning', 'reservado'] };
    const MOTIVO = { quitado_por_fora: 'quitado por fora', cancelado: 'cancelado', reemissao: 'reemissão', banco: 'pelo banco' };
    const [classe, rotuloBase] = ROTULO[boleto.status] || ['badge-neutral', String(boleto.status || '')];
    const rotulo = boleto.status === 'baixado' && MOTIVO[boleto.motivo_baixa] ? `${rotuloBase} (${MOTIVO[boleto.motivo_baixa]})` : rotuloBase;
    const numero = boleto.nosso_numero ? `${boleto.nosso_numero}${boleto.nosso_numero_dv ? `-${boleto.nosso_numero_dv}` : ''}` : '';
    return { classe, texto: `${rotulo}${numero ? ` · ${numero}` : ''}${boleto.ambiente === 'sandbox' ? ' · homologação' : ''}`, detalhe: boleto.status === 'erro' ? (boleto.erro || '') : (boleto.linha_digitavel || '') };
  }

  /**
   * Quais dos botões Cancelar, Enviar e Devolução o rodapé mostra, pela
   * situação do pedido (regra do dono, 21/09/2026):
   *
   *   Produção .............. Cancelar e Enviar (verde) — não saiu: não se devolve
   *     com NF-e autorizada . só Enviar — o backend não cancela pedido com
   *                           nota viva (409); cancelada a nota na SEFAZ
   *                           ("Cancelar NF-e"), o Cancelar volta
   *   Enviado / Entregue .... só Devolução — o que já saiu não se cancela
   *   Parcial ............... só Devolução, das peças que ainda não voltaram
   *   Devolvido (total) ..... nenhum dos três
   *   Cancelado ............. nenhum
   *   Pendente, Rascunho .... Cancelar
   *
   * Pura.
   */
  function botoesDoPedido(pedido, notas = []) {
    const situacao = String(pedido?.situacao || '').trim().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
    const nenhum = { cancelar: false, enviar: false, devolucao: false };
    if (situacao === 'cancelado' || pedido?.devolucao === 'total') return nenhum;
    if (situacao === 'enviado' || situacao === 'entregue' || pedido?.devolucao === 'parcial') return { ...nenhum, devolucao: true };
    if (situacao === 'producao' || situacao === 'em producao') {
      const notaViva = (Array.isArray(notas) ? notas : []).some(n => n && String(n.status_fiscal) === 'autorizada');
      return { ...nenhum, cancelar: !notaViva, enviar: true };
    }
    return { ...nenhum, cancelar: true };
  }

  /** A etiqueta roxa "N dev." que vai na frente do nome do item (vazia sem devolução). Pura. */
  function tagDeDevolucaoDoItem(item) {
    const devolvidas = Number(item?.quantidade_devolvida);
    if (!(devolvidas > 0)) return '';
    const todas = devolvidas >= Number(item?.quantidade);
    const titulo = todas ? 'Todas as peças deste item foram devolvidas pelo cliente' : 'Peças devolvidas pelo cliente';
    return `<span class="badge-purple mr-2 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap align-middle" title="${titulo}">${devolvidas} dev.</span>`;
  }

  /** A forma de pagamento do pedido é boleto? Pura. */
  function pagaComBoleto(pedido) {
    return String(pedido?.forma_pagamento || '').trim().toLowerCase() === 'boleto';
  }

  /** Pedido que não se cobra mais: cancelado ou devolvido por inteiro. Pura. */
  function pedidoCancelado(pedido) {
    return String(pedido?.situacao || '').trim().toLowerCase() === 'cancelado' || pedido?.devolucao === 'total';
  }

  /** O pedido já saiu para o cliente (enviado ou entregue, e não devolvido por inteiro)? Pura. */
  function pedidoJaSaiu(pedido) {
    const situacao = String(pedido?.situacao || '').trim().toLowerCase();
    return (situacao === 'enviado' || situacao === 'entregue') && pedido?.devolucao !== 'total';
  }

  /** A etiqueta de status: a devolução (roxa) vence o Enviado/Entregue que está por baixo. Pura. */
  function etiquetaDaDevolucao(pedido) {
    if (pedido?.devolucao === 'total') return { rotulo: 'Devolvido', badge: 'badge-purple', dateKey: 'data_devolucao' };
    if (pedido?.devolucao === 'parcial') return { rotulo: 'Parcial', badge: 'badge-purple', dateKey: 'data_devolucao' };
    return null;
  }

  /**
   * As etiquetas do rodapé. A que `tagsDoEmbarque` marcou com `acao` vira
   * clicável — mesmo desenho de etiqueta (o dono não aceita que virem botão
   * de verdade), mas com papel de botão, teclado e cursor, como a tag verde
   * "DANFE" da lista de pedidos.
   */
  function pintarTags(tags) {
    const caixa = overlay.querySelector('#visualizarPedidoTagsLista') || overlay.querySelector('#visualizarPedidoTags');
    if (!caixa) return;
    const notaId = () => notaDocumentos?.id || null;
    const ACOES = {
      danfe: () => window.NfeDocumentos?.gerarDanfe?.(notaId()),
      cce: t => window.NfeDocumentos?.gerarCartaCorrecaoPdf?.(notaId(), t.seq),
      'danfe-fora': () => window.NfeDocumentos?.gerarDanfeExterna?.(id),
      'cce-fora': t => window.NfeDocumentos?.gerarCartaExternaPdf?.(id, t.seq)
    };
    caixa.replaceChildren();
    for (const t of tags) {
      const s = document.createElement('span');
      s.className = `${t.classe} px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap`;
      s.textContent = t.texto;
      if (t.titulo) s.title = t.titulo;
      const acao = t.acao ? ACOES[t.acao] : null;
      if (acao) {
        s.classList.add('cursor-pointer');
        s.setAttribute('role', 'button');
        s.setAttribute('tabindex', '0');
        const disparar = () => acao(t);
        if (typeof window.BotaoAcao?.bind === 'function') window.BotaoAcao.bind(s, disparar);
        else s.addEventListener('click', disparar);
        s.addEventListener('keydown', e => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          disparar();
        });
      }
      caixa.appendChild(s);
    }
  }

  /** A nota que vale para DANFE/XML/cancelamento: autorizada (ou cancelada, que ainda tem DANFE e XML). */
  function notaParaDocumentos(notas) {
    return (Array.isArray(notas) ? notas : []).filter(n => n && ['autorizada', 'cancelada'].includes(String(n.status_fiscal)))
      .sort((a, b) => Number(b.id) - Number(a.id))[0] || null;
  }

  /**
   * A NF-e emitida FORA também tem DANFE e XML — desde que o XML dela esteja
   * anexado em "NF-e e boletos de fora" (é dele que os dois são desenhados).
   * Reusa os MESMOS botões da nota daqui: ou o pedido tem nota própria, ou
   * tem a de fora, nunca as duas.
   */
  function ligarDocumentosDaNotaDeFora(notaExterna) {
    if (!notaExterna?.tem_xml) return;
    const ligar = (botao, fn, titulo) => {
      if (!botao) return;
      botao.classList.remove('hidden');
      botao.title = titulo;
      if (typeof window.BotaoAcao?.bind === 'function') window.BotaoAcao.bind(botao, fn);
      else botao.addEventListener('click', fn);
    };
    ligar(overlay.querySelector('#visualizarPedidoDanfe'), () => window.NfeDocumentos?.gerarDanfeExterna?.(id), 'Gerar o DANFE da NF-e emitida fora');
    ligar(overlay.querySelector('#visualizarPedidoXml'), () => window.NfeDocumentos?.salvarXmlExterna?.(id), 'Salvar o XML da NF-e emitida fora');
  }

  function ligarDocumentosDaNota(nota, pedido) {
    const danfeBtn = overlay.querySelector('#visualizarPedidoDanfe');
    const xmlBtn = overlay.querySelector('#visualizarPedidoXml');
    const cancelarBtn = overlay.querySelector('#visualizarPedidoCancelarNfe');
    if (!nota) return;
    const aviso = (texto, tipo) => { if (typeof showToast === 'function') showToast(texto, tipo || 'info'); };

    // DANFE e XML ficam em utils/nfe-documentos.js: a lista de pedidos usa os mesmos.
    const gerarDanfe = () => (window.NfeDocumentos ? window.NfeDocumentos.gerarDanfe(nota.id) : aviso('Documentos da NF-e indisponíveis.', 'error'));
    const salvarXml = () => (window.NfeDocumentos ? window.NfeDocumentos.salvarXml(nota.id) : aviso('Documentos da NF-e indisponíveis.', 'error'));

    const contextoDaNota = () => ({ notaId: nota.id, serie: nota.serie, numero: nota.numero, chave: nota.chave_acesso, pedidoId: id, pedidoNumero: pedido?.numero || '', email: nota.destinatario?.email || '' });
    const cancelarNfe = () => {
      window.cancelarNfeContext = contextoDaNota();
      abrirPorCima('modals/pedidos/cancelar-nfe.html', '../js/modals/pedido-cancelar-nfe.js', 'cancelarNfe');
    };
    const emailNfe = () => {
      window.emailNfeContext = contextoDaNota();
      abrirPorCima('modals/pedidos/enviar-nfe-email.html', '../js/modals/pedido-enviar-nfe-email.js', 'enviarNfeEmail');
    };
    const cartaNfe = () => {
      window.cartaCorrecaoContext = contextoDaNota();
      abrirPorCima('modals/pedidos/carta-correcao-nfe.html', '../js/modals/pedido-carta-correcao-nfe.js', 'cartaCorrecaoNfe');
    };

    const ligar = (botao, fn) => {
      if (!botao) return;
      botao.classList.remove('hidden');
      if (typeof window.BotaoAcao?.bind === 'function') window.BotaoAcao.bind(botao, fn);
      else botao.addEventListener('click', fn);
    };
    ligar(danfeBtn, gerarDanfe);
    ligar(xmlBtn, salvarXml);
    ligar(overlay.querySelector('#visualizarPedidoEmailNfe'), emailNfe);
    if (nota.status_fiscal === 'autorizada') {
      ligar(overlay.querySelector('#visualizarPedidoCartaNfe'), cartaNfe);
      ligar(cancelarBtn, cancelarNfe);
    }
  }

  /**
   * A coluna "BOLETO" na tabela de parcelas, montada por createElement sobre
   * as linhas já desenhadas (uma por parcela, na ordem de `detalhes`).
   */
  function pintarColunaDeBoletos(caixa, detalhes, estado) {
    if (!estado || !Array.isArray(estado.parcelas)) return;
    const tabela = caixa.querySelector('table');
    const cabecalho = tabela?.querySelector('thead tr');
    const linhas = tabela ? Array.from(tabela.querySelectorAll('tbody tr')) : [];
    if (!cabecalho || !linhas.length) return;
    const th = document.createElement('th');
    th.className = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
    th.textContent = 'BOLETO';
    cabecalho.appendChild(th);
    const porParcela = new Map(estado.parcelas.map(l => [String(l?.parcela?.id), l]));
    detalhes.forEach((p, i) => {
      const tr = linhas[i];
      if (!tr) return;
      const td = document.createElement('td');
      td.className = 'px-6 py-4 text-left text-sm';
      const linha = porParcela.get(String(p.id)) || estado.parcelas.find(l => Number(l?.parcela?.numero_parcela) === Number(p.numero_parcela));
      // Paga à mão (Pix, cartão…): vale mais que o boleto que ficou para trás.
      if (linha?.recebimento?.origem === 'manual') {
        const pago = rotuloDoPagamento(linha.recebimento);
        const tagPago = document.createElement('span');
        tagPago.className = `${pago.classe} px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap`;
        tagPago.textContent = pago.texto;
        tagPago.title = 'Pagamento registrado à mão — veja em "Pagamentos"';
        td.appendChild(tagPago);
        tr.appendChild(td);
        return;
      }
      // Boleto emitido fora: a tag azul copia a linha digitável.
      if (linha?.boleto_externo && !linha?.tem_boleto_vivo) {
        const ext = rotuloDoBoletoExterno(linha.boleto_externo);
        const tagFora = document.createElement('span');
        tagFora.className = `${ext.classe} px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap cursor-pointer`;
        tagFora.setAttribute('role', 'button');
        tagFora.textContent = ext.texto;
        tagFora.title = `${linha.boleto_externo.linha_impressa || ext.linha} — clique para copiar a linha digitável`;
        tagFora.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(ext.linha); window.showToast?.('Linha digitável copiada.', 'success'); } catch (_) { window.showToast?.('Não foi possível copiar.', 'error'); }
        });
        td.appendChild(tagFora);
        tr.appendChild(td);
        return;
      }
      const r = rotuloDoBoleto(linha?.boleto || null);
      const tag = document.createElement('span');
      tag.className = `${r.classe} px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap`;
      tag.textContent = r.texto;
      if (r.detalhe) tag.title = r.detalhe;
      // Boleto a pagar: a tag gera o PDF daquela parcela.
      if (linha?.boleto && boletoImprimivel(linha.boleto) && window.BoletoDocumentos) {
        tag.classList.add('cursor-pointer');
        tag.setAttribute('role', 'button');
        tag.dataset.perm = 'financeiro.boleto.view';
        tag.title = `${r.detalhe ? `${r.detalhe} — ` : ''}clique para gerar o PDF do boleto`;
        tag.addEventListener('click', () => window.BoletoDocumentos.gerarBoletoPdf(linha.boleto.id));
      }
      td.appendChild(tag);
      tr.appendChild(td);
    });
  }

  /** Boleto que ainda se paga (registrado, vencido ou em protesto): tem PDF. Pura. */
  function boletoImprimivel(boleto) {
    return ['registrado', 'vencido', 'protestado'].includes(String(boleto?.status || ''));
  }

  /**
   * "NF-e e boletos de fora" no rodapé: abre por cima o modal que informa os
   * dados da nota e dos boletos emitidos fora do sistema. Aparece para quem
   * pode emitir NF-e ou gerar boletos, quando precisaDeDadosDeFora.
   */
  function ligarDadosDeFora({ pedido, notas, notaExterna, boletos, cliente }) {
    const botao = overlay.querySelector('#visualizarPedidoDadosExternos');
    if (!botao) return;
    const pode = chave => (typeof window.Permissoes?.pode === 'function' ? window.Permissoes.pode(chave) : true);
    if (!(pode('financeiro.nfe.emit') || pode('financeiro.boleto.emit'))) return;
    if (!precisaDeDadosDeFora({ pedido, notas, notaExterna, boletos })) return;
    botao.classList.remove('hidden');
    const abrir = () => {
      window.dadosExternosContext = { pedidoId: id, numero: pedido?.numero || '', cliente, formaPagamento: pedido?.forma_pagamento || '' };
      abrirPorCima('modals/pedidos/dados-externos.html', '../js/modals/pedido-dados-externos.js', 'dadosExternos');
    };
    if (typeof window.BotaoAcao?.bind === 'function') window.BotaoAcao.bind(botao, abrir);
    else botao.addEventListener('click', abrir);
  }

  /**
   * "Etiquetas" (bordô) no rodapé do pedido que saiu: o PDF das etiquetas das
   * caixas — a de transporte (paisagem, duas por folha; a que sobra fica
   * sozinha no centro) e a "ATENÇÃO" (retrato, duas por folha), uma de cada
   * por volume. O HTML vem do backend (GET /api/fiscal/pedidos/:id/etiquetas).
   */
  function ligarEtiquetas(pedido) {
    const botao = overlay.querySelector('#visualizarPedidoEtiquetas');
    if (!botao || !pedidoJaSaiu(pedido)) return;
    const gerar = async () => {
      try {
        const resp = await fetchApi(`/api/fiscal/pedidos/${encodeURIComponent(id)}/etiquetas`);
        const corpo = await resp.json().catch(() => null);
        if (!resp.ok) { window.showToast?.(corpo?.error || 'Não foi possível montar as etiquetas.', 'error'); return; }
        const r = await window.electronAPI?.salvarHtmlComoPdf?.({ html: corpo.html, nomeSugerido: corpo.nome, titulo: 'Salvar etiquetas em PDF' });
        if (!r) { window.showToast?.('Geração de PDF indisponível nesta janela.', 'error'); return; }
        if (r.success) window.showToast?.(r.opened ? 'Etiquetas salvas e abertas.' : (r.message || 'Etiquetas salvas.'), 'success');
        else if (!r.canceled) window.showToast?.(r.message || 'Não foi possível gerar as etiquetas.', 'error');
      } catch (_) {
        window.showToast?.('Não foi possível falar com o servidor.', 'error');
      }
    };
    botao.classList.remove('hidden');
    if (typeof window.BotaoAcao?.bind === 'function') window.BotaoAcao.bind(botao, gerar);
    else botao.addEventListener('click', gerar);
  }

  /** "Boletos (PDF)" no rodapé: todos os boletos a pagar do pedido. */
  function ligarBoletosPdf(estado) {
    const botao = overlay.querySelector('#visualizarPedidoBoletosPdf');
    if (!botao || !estado || !Array.isArray(estado.parcelas)) return;
    if (!estado.parcelas.some(l => boletoImprimivel(l?.boleto)) || !window.BoletoDocumentos) return;
    const gerar = () => window.BoletoDocumentos.gerarBoletosDoPedidoPdf(id);
    botao.classList.remove('hidden');
    if (typeof window.BotaoAcao?.bind === 'function') window.BotaoAcao.bind(botao, gerar);
    else botao.addEventListener('click', gerar);
  }

  /**
   * "Gerar boletos" no rodapé: só quando há parcela sem boleto vivo e o pedido
   * não está cancelado. Com tudo gerado, "Boletos" abre o mesmo modal para
   * consultar, prorrogar, conceder abatimento e baixar (fase D).
   */
  function ligarGerarBoletos(estado, pedido) {
    const botao = overlay.querySelector('#visualizarPedidoGerarBoletos');
    const lista = overlay.querySelector('#visualizarPedidoBoletos');
    if (!estado || !Array.isArray(estado.parcelas)) return;
    // Parcela com boleto emitido fora já está cobrada: não conta como faltando.
    // Parcela já paga (Pix, cartão…) também não falta (dono, 24/09/2026).
    const falta = estado.parcelas.some(l => !l?.tem_boleto_vivo && !l?.boleto_externo && !l?.recebimento);
    const cancelado = pedidoCancelado(pedido);
    const abrir = () => {
      window.gerarBoletosContext = { pedidoId: id, numero: pedido?.numero || '', cliente: pedido?.cliente_nome || '' };
      abrirPorCima('modals/pedidos/gerar-boletos.html', '../js/modals/pedido-gerar-boletos.js', 'gerarBoletos');
    };
    const ligar = b => {
      b.classList.remove('hidden');
      if (typeof window.BotaoAcao?.bind === 'function') window.BotaoAcao.bind(b, abrir);
      else b.addEventListener('click', abrir);
    };
    const temBoleto = estado.parcelas.some(l => l?.boleto?.id);
    // Quem só vê boletos (ou pedido cancelado, cujos boletos ainda se baixam) entra pela lista.
    const podeGerar = typeof window.Permissoes?.pode === 'function' ? window.Permissoes.pode('financeiro.boleto.emit') : true;
    // Gerar em qualquer pedido que não esteja cancelado, inclusive em produção:
    // há cliente que paga adiantado, antes do embarque, e a nota só sai no
    // embarque (decisão do dono, 23/09/2026). Só em pedido pago com boleto —
    // num pedido em Pix ou cartão o botão aparecia só porque as parcelas não
    // tinham boleto. No pedido "ao embarcar" o modal avisa que os vencimentos
    // ainda podem mudar no envio.
    if (botao && falta && !cancelado && podeGerar && pagaComBoleto(pedido)) ligar(botao);
    else if (lista && temBoleto) ligar(lista);
  }

  /**
   * "Importar do BB": boleto deste pedido que já existe no banco (emitido
   * antes, pelo Gerenciador Financeiro) e ainda não está no app. Aparece para
   * pedido pago com boleto que não esteja cancelado — é lá que falta boleto.
   */
  function ligarImportarBoletos(pedido) {
    const botao = overlay.querySelector('#visualizarPedidoImportarBoletos');
    if (!botao || pedidoCancelado(pedido) || !pagaComBoleto(pedido)) return;
    const pode = typeof window.Permissoes?.pode === 'function' ? window.Permissoes.pode('financeiro.boleto.view') : true;
    if (!pode) return;
    const abrir = () => {
      window.importarBoletosContext = { pedidoId: id, numero: pedido?.numero || '', cliente: pedido?.cliente_nome || '' };
      abrirPorCima('modals/pedidos/importar-boletos.html', '../js/modals/pedido-importar-boletos.js', 'importarBoletos');
    };
    botao.classList.remove('hidden');
    if (typeof window.BotaoAcao?.bind === 'function') window.BotaoAcao.bind(botao, abrir);
    else botao.addEventListener('click', abrir);
  }

  /**
   * "Pagamentos" no rodapé: o que o cliente pagou em cada parcela (Pix,
   * cartão, transferência…, com ou sem boleto). Aparece em todo pedido com
   * parcelas; no cancelado, só se há pagamento registrado (para estornar).
   */
  function ligarPagamentos(pedido, detalhes, estado) {
    const botao = overlay.querySelector('#visualizarPedidoPagamentos');
    if (!botao || !Array.isArray(detalhes) || !detalhes.length) return;
    const pode = typeof window.Permissoes?.pode === 'function' ? window.Permissoes.pode('financeiro.recebimento.view') : true;
    if (!pode) return;
    const temPagamento = (Array.isArray(estado?.parcelas) ? estado.parcelas : []).some(l => l?.recebimento);
    if (pedidoCancelado(pedido) && !temPagamento) return;
    const abrir = () => {
      window.pagamentosParcelasContext = { pedidoId: id, numero: pedido?.numero || '', cliente: pedido?.cliente_nome || '' };
      abrirPorCima('modals/pedidos/pagamentos-parcelas.html', '../js/modals/pedido-pagamentos-parcelas.js', 'pagamentosParcelas');
    };
    botao.classList.remove('hidden');
    if (typeof window.BotaoAcao?.bind === 'function') window.BotaoAcao.bind(botao, abrir);
    else botao.addEventListener('click', abrir);
  }

  const close = () => {
    Modal.close(overlayId);
    document.removeEventListener('keydown', esc);
    desligarFilhos();
  };

  // ------------------------------------------------ modais por cima
  // Os modais do rodapé (NF-e, boletos, devolução, cancelar) abrem POR CIMA:
  // o Visualizar continua aberto embaixo, e voltar deles cai de novo aqui.
  // Antes cada um fechava o Visualizar primeiro.
  const FILHOS = ['cancelarNfe', 'enviarNfeEmail', 'cartaCorrecaoNfe', 'gerarBoletos', 'boletoDetalhe', 'devolucaoPedido', 'cancelarPedido', 'emitirNfePedido', 'dadosExternos', 'importarBoletos', 'pagamentosParcelas'];
  const EVENTOS_QUE_MUDAM_O_PEDIDO = ['nfe:cancelada', 'nfe:carta-correcao', 'boletos:gerados', 'boletos:alterados', 'pedido:devolvido', 'pedido:enviado', 'nfe:emitida', 'nfe:externa', 'recebimentos:alterados'];
  let filhoMudouOPedido = false;

  function abrirPorCima(htmlPath, scriptPath, filhoId) {
    // Com o spinner da casa, como a lista faz no openPedidoModal: o filho só
    // aparece depois de carregado. Sem isso, o "Enviar" e o "Importar do BB"
    // — que esperam o aviso de pronto em vez de se revelarem sozinhos —
    // ficavam escondidos para sempre, e os outros piscavam vazios na tela.
    if (typeof Modal.openWithSpinner === 'function') {
      return Modal.openWithSpinner(htmlPath, scriptPath, filhoId, { keepExisting: true });
    }
    return Modal.open(htmlPath, scriptPath, filhoId, true);
  }

  /** O Visualizar é o modal de cima? (Esc de um filho não pode fechar os dois.) */
  function ehOModalDeCima() {
    if (document.querySelector('dialog[open]')) return false;
    const abertos = [...document.querySelectorAll('body > div > [id$="Overlay"]')]
      .filter(o => !o.classList.contains('hidden') && o.offsetParent !== null);
    return abertos.length === 0 || abertos[abertos.length - 1] === overlay;
  }

  function aoMudarOPedido(evento) {
    const pedidoId = evento?.detail?.pedidoId;
    if (pedidoId === undefined || pedidoId === null || String(pedidoId) === String(window.selectedOrderId)) filhoMudouOPedido = true;
  }

  function aoFecharFilho(evento) {
    const filho = evento?.detail;
    // O próprio Visualizar fechou por fora (troca de módulo, closeAll): solta tudo.
    if (filho === overlayId) {
      desligarFilhos();
      document.removeEventListener('keydown', esc);
      return;
    }
    if (!FILHOS.includes(filho)) return;
    // Cancelar o pedido não avisa por evento: ao fechar, relê sempre.
    if (filho === 'cancelarPedido') filhoMudouOPedido = true;
    const outroFilhoAberto = FILHOS.some(f => f !== filho && document.getElementById(`${f}Overlay`));
    if (filhoMudouOPedido && !outroFilhoAberto && document.getElementById(`${overlayId}Overlay`)) reabrirAtualizado();
  }

  function desligarFilhos() {
    EVENTOS_QUE_MUDAM_O_PEDIDO.forEach(nome => window.removeEventListener(nome, aoMudarOPedido));
    window.removeEventListener('modalFechado', aoFecharFilho);
  }

  /** O pedido mudou lá no filho (NF-e cancelada, boletos, devolução…): o Visualizar volta atualizado. */
  function reabrirAtualizado() {
    desligarFilhos();
    document.removeEventListener('keydown', esc);
    if (typeof Modal.openWithSpinner === 'function') {
      Modal.openWithSpinner('modals/pedidos/visualizar.html', '../js/modals/pedido-visualizar.js', overlayId);
      return;
    }
    Modal.open('modals/pedidos/visualizar.html', '../js/modals/pedido-visualizar.js', overlayId);
  }

  EVENTOS_QUE_MUDAM_O_PEDIDO.forEach(nome => window.addEventListener(nome, aoMudarOPedido));
  window.addEventListener('modalFechado', aoFecharFilho);

  /**
   * Cancelar, Enviar e Devolução: os três nascem escondidos e aparecem os que
   * a situação pede (botoesDoPedido). A permissão de cada um está no HTML.
   */
  function ligarBotoesDoPedido(pedido, clienteNome, notas) {
    const quais = botoesDoPedido(pedido, notas);
    overlay.querySelector('#cancelarVisualizarPedido')?.classList.toggle('hidden', !quais.cancelar);

    const enviar = overlay.querySelector('#enviarVisualizarPedido');
    if (enviar && quais.enviar) {
      enviar.classList.remove('hidden');
      // O mesmo do "Concluir" da tabela em produção: a conferência da NF-e,
      // que emite e só então marca Enviado (ou envia sem nota, com
      // confirmação). Por cima do Visualizar; ao terminar ele volta atualizado.
      enviar.addEventListener('click', () => {
        window.selectedOrderId = id;
        window.emitirNfeContext = { pedidoId: id, numero: pedido?.numero || '', cliente: clienteNome || pedido?.cliente_nome || '' };
        abrirPorCima('modals/pedidos/emitir-nfe.html', '../js/modals/pedido-emitir-nfe.js', 'emitirNfePedido');
      });
    }

    const devolver = overlay.querySelector('#devolucaoVisualizarPedido');
    if (devolver && quais.devolucao) {
      devolver.classList.remove('hidden');
      devolver.addEventListener('click', () => {
        window.devolucaoPedidoContext = { pedidoId: window.selectedOrderId, numero: pedido?.numero || '', cliente: pedido?.cliente_nome || '' };
        abrirPorCima('modals/pedidos/devolucao.html', '../js/modals/pedido-devolucao.js', 'devolucaoPedido');
      });
    }
  }
  const esc = e => { if (e.key === 'Escape' && ehOModalDeCima()) close(); };
  document.addEventListener('keydown', esc);
  overlay.querySelector('#voltarVisualizarPedido')?.addEventListener('click', close);
  overlay.querySelector('#voltarVisualizarPedidoFooter')?.addEventListener('click', close);

  const id = window.selectedOrderId;

  // Tela só de leitura, mas sem devolver `window.selectedOrderId` o script sai
  // na linha seguinte e o modal reabre vazio (ver
  // docs/restauracao-de-trabalho.md). É também daqui que sai o contexto do
  // "Cancelar Pedido", então perder isso quebraria o cancelamento inteiro.
  window.EstadoTrabalho?.registrarContexto?.(overlayId,
    () => ({ selectedOrderId: window.selectedOrderId }));

  if (!id) return;

  const clienteSel = overlay.querySelector('#visualizarPedidoCliente');
  const contatoSel = overlay.querySelector('#visualizarPedidoContato');
  const condicaoSel = overlay.querySelector('#visualizarPedidoCondicao');
  const transportadoraSel = overlay.querySelector('#visualizarPedidoTransportadora');
  const formaSel = overlay.querySelector('#visualizarPedidoFormaPagamento');
  const validadeInput = overlay.querySelector('#visualizarPedidoValidade');
  const donoSel = overlay.querySelector('#visualizarPedidoDono');
  const obsInput = overlay.querySelector('#visualizarPedidoObservacoes');
  const itensTbody = overlay.querySelector('#pedidoItens tbody');
  const pagamentoBox = overlay.querySelector('#visualizarPedidoPagamento');

  window.cancelarPedidoContext = null;

  try {
    const resp = await fetchApi(`/api/pedidos/${id}`);
    if (!resp.ok) throw new Error('Falha ao buscar pedido');
    const data = await resp.json();

    overlay.querySelector('#tituloVisualizarPedido').textContent = `VISUALIZAR PEDIDO ${data.numero || ''}`.trim();

    const filled = el => el?.setAttribute('data-filled', 'true');

    try {
      const clientesResp = await fetchApi('/api/clientes/lista');
      if (!clientesResp.ok) throw new Error();
      const clientes = await clientesResp.json();
      if (clienteSel) {
        clienteSel.innerHTML = clientes.map(c => `<option value="${c.id}">${c.nome_fantasia}</option>`).join('');
        if (data.cliente_id) {
          clienteSel.value = String(data.cliente_id);
          filled(clienteSel);
        }
      }
    } catch (err) {
      console.error('Erro ao carregar clientes', err);
      if (clienteSel) {
        const fallback = data.cliente || 'Cliente nao identificado';
        clienteSel.innerHTML = `<option>${fallback}</option>`;
        filled(clienteSel);
      }
    }

    try {
      if (data.cliente_id && contatoSel) {
        const respContatos = await fetchApi(`/api/clientes/${data.cliente_id}`);
        if (!respContatos.ok) throw new Error();
        const clienteData = await respContatos.json();
        const contatos = clienteData.contatos || [];
        contatoSel.innerHTML = contatos.map(ct => `<option value="${ct.id}">${ct.nome}</option>`).join('');
        if (data.contato_id) {
          contatoSel.value = String(data.contato_id);
          filled(contatoSel);
        }
      }
    } catch (err) {
      console.error('Erro ao carregar contatos', err);
      if (contatoSel) {
        const fallback = data.contato || data.contato_id || '';
        contatoSel.innerHTML = fallback ? `<option>${fallback}</option>` : '<option></option>';
        if (fallback) {
          contatoSel.value = fallback;
          filled(contatoSel);
        }
      }
    }

    try {
      if (transportadoraSel) {
        const respTransportadoras = await fetchApi(`/api/transportadoras/${data.cliente_id}`);
        if (respTransportadoras.ok) {
          const transportadoras = await respTransportadoras.json();
          transportadoraSel.innerHTML = transportadoras.map(tp => `<option value="${tp.id}">${tp.nome}</option>`).join('');
          const opt = Array.from(transportadoraSel.options).find(o => o.textContent === data.transportadora);
          if (opt) {
            transportadoraSel.value = opt.value;
            filled(transportadoraSel);
          }
        }
      }
    } catch (err) {
      console.error('Erro ao carregar transportadoras', err);
    } finally {
      if (transportadoraSel && !transportadoraSel.value && data.transportadora) {
        transportadoraSel.innerHTML = `<option>${data.transportadora}</option>`;
        transportadoraSel.value = data.transportadora;
        filled(transportadoraSel);
      }
    }

    if (formaSel) {
      formaSel.value = data.forma_pagamento || '';
      if (formaSel.value) filled(formaSel);
    }

    if (condicaoSel) {
      condicaoSel.value = data.parcelas > 1 ? 'prazo' : 'vista';
      filled(condicaoSel);
    }

    if (validadeInput) {
      validadeInput.value = data.validade ? String(data.validade).split('T')[0] : '';
      if (validadeInput.value) filled(validadeInput);
    }

    if (obsInput) {
      obsInput.value = data.observacoes || '';
      if (obsInput.value) filled(obsInput);
    }

    if (donoSel) {
      const dono = data.dono || '';
      donoSel.innerHTML = `<option>${dono}</option>`;
      donoSel.value = dono;
      if (dono) filled(donoSel);
    }

    const statusConfig = {
      'Produção': { badge: 'badge-warning', dateKey: 'data_aprovacao' },
      'Em Produção': { badge: 'badge-warning', dateKey: 'data_aprovacao' },
      'Em Producao': { badge: 'badge-warning', dateKey: 'data_aprovacao' },
      Producao: { badge: 'badge-warning', dateKey: 'data_aprovacao' },
      Pendente: { badge: 'badge-warning', dateKey: 'data_emissao' },
      Enviado: { badge: 'badge-info', dateKey: 'embarcar_real' },
      Entregue: { badge: 'badge-success', dateKey: 'data_entrega' },
      Cancelado: { badge: 'badge-danger', dateKey: 'data_cancelamento' },
      Rascunho: { badge: 'badge-neutral', dateKey: 'data_emissao' }
    };
    const statusTag = overlay.querySelector('#statusPedidoTag');
    const dateTag = overlay.querySelector('#dataStatusPedidoTag');
    const daDevolucao = etiquetaDaDevolucao(data);
    const statusInfo = daDevolucao || statusConfig[data.situacao] || { badge: 'badge-neutral', dateKey: null };
    if (statusTag) {
      statusTag.textContent = daDevolucao ? daDevolucao.rotulo : (data.situacao || 'Sem status');
      if (daDevolucao) statusTag.title = `Pedido ${String(data.situacao || '').toLowerCase()} com devolução ${data.devolucao === 'total' ? 'total' : 'parcial'}`;
      statusTag.className = `${statusInfo.badge} px-3 py-1 rounded-full text-xs font-medium`;
    }
    if (dateTag) {
      const dateValue = statusInfo.dateKey ? data[statusInfo.dateKey] : null;
      const dataFormatada = dateValue ? formatarDataDaColuna(statusInfo.dateKey, dateValue) : '';
      if (dataFormatada) {
        dateTag.textContent = `Atualizado em ${dataFormatada}`;
        dateTag.classList.remove('hidden');
      } else {
        dateTag.textContent = '';
        dateTag.classList.add('hidden');
      }
    }

    if (itensTbody) itensTbody.innerHTML = '';
    let subtotal = 0;
    let descPag = 0;
    let descEsp = 0;
    const safeNumber = v => Number(v ?? 0);
    const fmtCurrency = v => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const fmtNumber = v => Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    (data.itens || []).forEach(item => {
      if (!itensTbody) return;
      const qtd = safeNumber(item.quantidade);
      const valorUnit = safeNumber(item.valor_unitario);
      const valorUnitDesc = safeNumber(item.valor_unitario_desc);
      const descPagPrc = safeNumber(item.desconto_pagamento_prc);
      const descEspPrc = safeNumber(item.desconto_especial_prc);
      const valorTotal = safeNumber(item.valor_total);
      const descPagUnit = safeNumber(item.desconto_pagamento);
      const descEspUnit = safeNumber(item.desconto_especial);

      const tr = document.createElement('tr');
      tr.className = 'border-b border-white/10';
      // As peças devolvidas: etiqueta roxa na FRENTE do nome (não mais na
      // quantidade). Sem a coluna de ações: no Visualizar os itens não se editam.
      tr.innerHTML = `
        <td data-perm-col="col_ped_it_nome" class="text-left text-white" title="${escapeAttr(item.nome || '')}">${tagDeDevolucaoDoItem(item)}${item.nome || ''}</td>
        <td data-perm-col="col_ped_it_qtd" class="text-left text-white">${fmtNumber(qtd)}</td>
        <td data-perm-col="col_ped_it_preco" class="text-left text-white">${fmtNumber(valorUnit)}</td>
        <td data-perm-col="col_ped_it_preco_desc" class="text-left text-white">${fmtNumber(valorUnitDesc)}</td>
        <td data-perm-col="col_ped_it_desc" class="text-left text-white">${fmtNumber(descPagPrc + descEspPrc)}</td>
        <td data-perm-col="col_ped_it_subtotal" class="text-left text-white">${fmtCurrency(valorTotal)}</td>`;
      itensTbody.appendChild(tr);
      subtotal += valorUnit * qtd;
      descPag += descPagUnit * qtd;
      descEsp += descEspUnit * qtd;
    });

    const descontoTotal = descPag + descEsp;
    const total = subtotal - descontoTotal;
    overlay.querySelector('#subtotalPedido').textContent = fmtCurrency(subtotal);
    overlay.querySelector('#descontoPagPedido').textContent = fmtCurrency(descPag);
    overlay.querySelector('#descontoEspPedido').textContent = fmtCurrency(descEsp);
    overlay.querySelector('#descontoPedido').textContent = fmtCurrency(descontoTotal);
    // Devolução parcial: as linhas continuam como foram vendidas; o Total mostra o que restou.
    const devolvido = data.devolucao ? safeNumber(data.valor_devolvido) : 0;
    const totalAtual = data.devolucao === 'parcial' ? Math.max(0, total - devolvido) : total;
    const chipDevolvido = overlay.querySelector('#devolvidoPedidoChip');
    if (chipDevolvido) {
      overlay.querySelector('#devolvidoPedido').textContent = fmtCurrency(devolvido);
      chipDevolvido.classList.toggle('hidden', !(devolvido > 0));
    }
    overlay.querySelector('#totalPedido').textContent = fmtCurrency(totalAtual);
    const footerTotal = overlay.querySelector('#totalPedidoFooter');
    if (footerTotal) footerTotal.textContent = fmtCurrency(totalAtual);

    // Tags do rodapé. As notas exigem financeiro.nfe.view; sem ela (ou sem a
    // tabela) ficam só as do embarque.
    let notas = [];
    try {
      const respNotas = await fetchApi(`/api/fiscal/notas?pedido_id=${encodeURIComponent(id)}`);
      if (respNotas.ok) notas = await respNotas.json();
    } catch (_) { /* sem notas, sem tag */ }
    const notaDocs = notaParaDocumentos(notas);
    notaDocumentos = notaDocs;
    const cartas = notaDocs && window.NfeDocumentos?.listarCartasCorrecao ? await window.NfeDocumentos.listarCartasCorrecao(notaDocs.id) : [];
    // Boletos das parcelas (cobrança BB): sem permissão (403) ou sem a cobrança configurada, fica tudo como era.
    let boletosEstado = null;
    try {
      const respBoletos = await fetchApi(`/api/cobranca/pedidos/${encodeURIComponent(id)}/boletos`);
      if (respBoletos.ok) boletosEstado = await respBoletos.json();
    } catch (_) { /* sem boletos, sem coluna */ }
    // A nota de devolução do cliente (guardada pela devolução): sem a tabela ou sem permissão, sem tag.
    let notasDevolucao = [];
    if (data.devolucao) {
      try {
        const respDev = await fetchApi(`/api/devolucoes/notas?pedido_id=${encodeURIComponent(id)}`);
        if (respDev.ok) notasDevolucao = await respDev.json();
      } catch (_) { /* sem nota de devolução, sem tag */ }
    }
    // A NF-e emitida fora e informada: sem permissão ou sem o SQL, fica como era.
    let notaExterna = null;
    let cartasDeFora = [];
    try {
      const respExt = await fetchApi(`/api/fiscal/pedidos/${encodeURIComponent(id)}/nfe-externa`);
      if (respExt.ok) notaExterna = (await respExt.json())?.nota_externa || null;
      if (notaExterna) {
        const respCartas = await fetchApi(`/api/fiscal/pedidos/${encodeURIComponent(id)}/nfe-externa/cartas`);
        if (respCartas.ok) cartasDeFora = (await respCartas.json())?.cartas || [];
      }
    } catch (_) { /* sem nota de fora */ }
    // A etiqueta CC-e gera o PDF da ÚLTIMA carta: é ela que vale.
    const ultimaSeq = lista => Math.max(0, ...(lista || []).map(c => Number(c.nSeqEvento ?? c.sequencia) || 0));
    pintarTags(tagsDoEmbarque(
      data, notas,
      notaDocs ? cartas.length : cartasDeFora.length,
      resumoDeBoletos(boletosEstado), notasDevolucao, notaExterna,
      ultimaSeq(notaDocs ? cartas : cartasDeFora)
    ));
    ligarBotoesDoPedido(data, clienteSel?.selectedOptions?.[0]?.textContent?.trim() || data.cliente || '', notas);
    ligarDocumentosDaNota(notaDocs, data);
    // Sem nota daqui, quem manda nos botões DANFE/XML é a nota de fora.
    if (!notaDocs) ligarDocumentosDaNotaDeFora(notaExterna);

    if (pagamentoBox) {
      pagamentoBox.classList.add('hidden');
      pagamentoBox.innerHTML = '';
      if (data.parcelas_detalhes && data.parcelas_detalhes.length) {
        // O prazo de cada parcela é o dia na posição dela em `prazo`. O upstream
        // ignora o `order` do GET, então a ordem vem de `numero_parcela`.
        const detalhes = data.parcelas_detalhes.slice()
          .sort((a, b) => (Number(a?.numero_parcela) || 0) - (Number(b?.numero_parcela) || 0));
        const baseFaturamento = baseDoFaturamento(data);
        const prazos = (data.prazo || '').split('/').map(p => p.trim()).filter(Boolean);
        const rows = detalhes.map((p, index) => {
          let prazoDias = '';
          const vencimento = diaDeColunaDate(p.data_vencimento);
          if (prazos[index] !== undefined) {
            prazoDias = `${prazos[index]} dias`;
          } else if (baseFaturamento && vencimento) {
            // Sem o texto do prazo, deduz pela distância entre o vencimento e
            // o início do faturamento — não mais a emissão, que deixou de ser a
            // base quando o faturamento ganhou início próprio.
            prazoDias = `${diferencaEmDias(vencimento, baseFaturamento)} dias`;
          }
          const numeroParcela = p.numero_parcela ? `${p.numero_parcela}ª` : '';
          // O vencimento previsto de cada parcela (pedido do dono, 24/09/2026).
          const venceEm = vencimento ? formatarDia(vencimento) : '—';
          return `<tr class="border-b border-white/10"><td class="px-4 py-4 text-left text-sm text-white" style="width: 4ch">${numeroParcela}</td><td class="px-6 py-4 text-left text-sm text-white">${fmtCurrency(p.valor)}</td><td class="px-6 py-4 text-left text-sm text-white">${prazoDias}</td><td class="px-6 py-4 text-left text-sm text-white">${venceEm}</td></tr>`;
        }).join('');
        const previsaoEmbarque = formatarDataDaColuna('embarcar_previsao', data.embarcar_previsao);
        const inicioFaturamento = formatarDataDaColuna('inicio_faturamento', data.inicio_faturamento);
        const datasDoFaturamento = [
          previsaoEmbarque ? `<span class="badge-neutral px-3 py-1 rounded-full text-xs font-medium">Previsão de embarque: ${previsaoEmbarque}</span>` : '',
          inicioFaturamento ? `<span class="badge-info px-3 py-1 rounded-full text-xs font-medium">Início do faturamento: ${inicioFaturamento}</span>` : ''
        ].filter(Boolean).join('');
        pagamentoBox.innerHTML = `
          <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
            <h4 class="text-white font-medium">Parcelas</h4>
            ${datasDoFaturamento ? `<div class="flex flex-wrap gap-2">${datasDoFaturamento}</div>` : ''}
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-gray-50 sticky top-0">
                <tr class="border-b border-gray-200">
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style="width: 4ch" title="Parcela">PRC.</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">VALOR</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">PRAZO</th>
                  <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">VENCIMENTO</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>`;
        pagamentoBox.classList.remove('hidden');
        pintarColunaDeBoletos(pagamentoBox, detalhes, boletosEstado);
      }
    }
    ligarGerarBoletos(boletosEstado, data);
    ligarBoletosPdf(boletosEstado);
    ligarImportarBoletos(data);
    ligarPagamentos(data, data.parcelas_detalhes, boletosEstado);
    ligarEtiquetas(data);
    ligarDadosDeFora({ pedido: data, notas, notaExterna, boletos: boletosEstado, cliente: clienteSel?.selectedOptions?.[0]?.textContent?.trim() || data.cliente || '' });

    const clienteNome = clienteSel?.selectedOptions?.[0]?.textContent?.trim() || data.cliente || '';
    const contatoNome = contatoSel?.selectedOptions?.[0]?.textContent?.trim() || data.contato || '';
    window.cancelarPedidoContext = {
      id,
      pedido: data,
      numero: data.numero || '',
      cliente: clienteNome,
      contato: contatoNome,
      status: data.situacao || '',
      dataEmissao: data.data_emissao || data.dataEmissao || '',
    };
  } catch (err) {
    console.error('Erro ao carregar pedido', err);
    if (typeof showToast === 'function') showToast('Erro ao carregar pedido', 'error');
    window.cancelarPedidoContext = null;
  }

  overlay.querySelector('#cancelarVisualizarPedido')?.addEventListener('click', async () => {
    if (!window.cancelarPedidoContext || !window.cancelarPedidoContext.pedido) {
      if (typeof showToast === 'function') showToast('Não foi possível carregar os dados do pedido.', 'error');
      return;
    }

    // Cancelar duas vezes devolveria o estoque em dobro. O backend recusa de
    // qualquer forma; aqui a recusa vira uma frase em vez de um erro.
    const situacao = String(window.cancelarPedidoContext.status || '').trim().toLowerCase();
    if (situacao === 'cancelado') {
      if (typeof showToast === 'function') {
        showToast('Este pedido já está cancelado.', 'info');
      }
      return;
    }

    const openCancelModal = async () => {
      // Por cima do Visualizar, que continua aberto embaixo.
      await Modal.open('modals/pedidos/cancelar.html', '../js/modals/pedido-cancelar.js', 'cancelarPedido', true);
      if (typeof Modal?.waitForReady === 'function') {
        await Modal.waitForReady('cancelarPedido');
      }
    };
    if (typeof window.withModalLoading === 'function') {
      await window.withModalLoading(2000, openCancelModal);
    } else {
      await openCancelModal();
    }
  });

  window.dispatchEvent(new CustomEvent('pedidoModalLoaded', { detail: overlayId }));
})();
