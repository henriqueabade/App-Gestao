/**
 * Modal "Datas do pedido": previsão de embarque e início do faturamento.
 *
 * Os vencimentos de um pedido contam a partir do INÍCIO DO FATURAMENTO: cada
 * parcela vence em início + o prazo dela, em dias. Este modal escolhe esse
 * início por uma de três regras, que ficam gravadas no pedido
 * (`faturamento_regra`):
 *
 *   ao_embarcar   o início é a previsão de embarque. Se o embarque atrasar, o
 *                 backend passa a contar da data real ao marcar "Enviado";
 *                 embarcar no dia ou antes não muda nada.
 *   ao_converter  o início é o dia da conversão.
 *   data          o início é a data escolhida aqui.
 *
 * Abre em dois modos (`window.datasPedidoContext.modo`):
 *
 *   'conversao'   dentro da conversão orçamento → pedido. Não grava nada:
 *                 devolve as datas, e quem abriu as manda no corpo da conversão.
 *   'pedido'      no pagamento de um pedido em Produção. Grava aqui mesmo
 *                 (PUT /api/pedidos/:id/datas) e só avisa depois que o backend
 *                 aceitou; se ele recusar, o modal fica aberto com a mensagem.
 *
 * A resposta vai por EVENTO, e não por callback: função guardada em `window`
 * não sobrevive à restauração de trabalho (docs/restauracao-de-trabalho.md).
 *
 *   window 'pedido:datas-definidas'  detail = {
 *     source: 'pedido-datas', modo,
 *     datas: { embarcar_previsao, faturamento_regra, inicio_faturamento },
 *     resposta   // o JSON da API no modo 'pedido'; null na conversão
 *   }
 *
 * `datas.inicio_faturamento` é o início já resolvido pela regra (a previsão,
 * o dia da conversão ou a data escolhida). Para a API, só a "data
 * específica" manda o início; nas outras regras quem resolve é o backend.
 *
 * Desistir (Cancelar, Voltar, Esc) fecha SEM evento. Quem abriu percebe pelo
 * `modalFechado` do src/utils/modal.js, com detail === 'datasPedido'.
 */
(() => {
  const overlayId = 'datasPedido';
  const overlay = document.getElementById('datasPedidoOverlay');
  if (!overlay) return;

  // ==================================================================
  // Funções puras: texto ↔ data e a conta dos vencimentos.
  //
  // Sem DOM, sem relógio e sem `window`. O teste
  // (src/js/__tests__/pedidoDatasModal.test.js) recorta o trecho entre este
  // cabeçalho e o marcador "fim das funções puras" e o executa isolado.
  //
  // As datas trafegam como 'YYYY-MM-DD', o formato das colunas DATE, e a
  // conta é de CALENDÁRIO, em UTC. Somar milissegundos a um `new Date()`
  // local, ou exibir uma coluna DATE por `new Date(...)`, recua um dia em
  // São Paulo: '2026-08-10T00:00:00.000Z' é 9 de agosto às 21h aqui.
  // ==================================================================
  const REGRAS_FATURAMENTO = ['ao_embarcar', 'ao_converter', 'data'];

  const MENSAGEM_DATA = {
    incompleta: 'Data incompleta — use dd/mm/aaaa.',
    inexistente: 'Essa data não existe no calendário.'
  };

  /**
   * Máscara dd/mm/aaaa: só dígitos, no máximo 8, com as barras postas
   * conforme se digita. Colar uma data ISO ('2026-08-10') também funciona;
   * sem isto ela viraria '20/26/0810'.
   */
  function mascararData(texto) {
    const bruto = String(texto ?? '');
    const iso = /^\s*(\d{4})-(\d{2})-(\d{2})/.exec(bruto);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
    const digitos = bruto.replace(/\D/g, '').slice(0, 8);
    if (digitos.length <= 2) return digitos;
    if (digitos.length <= 4) return `${digitos.slice(0, 2)}/${digitos.slice(2)}`;
    return `${digitos.slice(0, 2)}/${digitos.slice(2, 4)}/${digitos.slice(4)}`;
  }

  /** O dia existe? 31/04 não; 29/02 só em ano bissexto. */
  function diaExiste(ano, mes, dia) {
    if (![ano, mes, dia].every(Number.isInteger)) return false;
    // Ano fora desta faixa é dígito trocado ("0026"), não data de pedido.
    if (ano < 1900 || ano > 2100 || mes < 1 || mes > 12 || dia < 1) return false;
    const d = new Date(Date.UTC(ano, mes - 1, dia));
    return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
  }

  /**
   * Lê o que está escrito no campo. `iso` só vem quando a data é real; senão
   * `erro` diz por quê: 'vazia', 'incompleta' ou 'inexistente'.
   */
  function lerDataDigitada(texto) {
    if (!String(texto ?? '').replace(/\D/g, '')) return { iso: null, erro: 'vazia' };
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(mascararData(texto));
    if (!m) return { iso: null, erro: 'incompleta' };
    if (!diaExiste(Number(m[3]), Number(m[2]), Number(m[1]))) return { iso: null, erro: 'inexistente' };
    return { iso: `${m[3]}-${m[2]}-${m[1]}`, erro: null };
  }

  /** 'YYYY-MM-DD' de uma coluna DATE: cortado do texto, nunca via new Date(). */
  function diaDeColunaDate(valor) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor ?? '').trim());
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }

  /** 'YYYY-MM-DD' → 'dd/mm/aaaa' (vazio quando não é uma data). */
  function textoDoDia(dia) {
    const d = diaDeColunaDate(dia);
    return d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '';
  }

  /** Soma de calendário: '2026-08-10' + 15 → '2026-08-25'. */
  function somarDias(dia, dias) {
    const d = diaDeColunaDate(dia);
    const n = Number(dias);
    if (!d || !Number.isFinite(n)) return null;
    const [ano, mes, diaDoMes] = d.split('-').map(Number);
    return new Date(Date.UTC(ano, mes - 1, diaDoMes + Math.trunc(n))).toISOString().slice(0, 10);
  }

  /** Dias de `b` até `a` (positivo quando `a` vem depois). */
  function diferencaEmDias(a, b) {
    const da = diaDeColunaDate(a);
    const db = diaDeColunaDate(b);
    if (!da || !db) return null;
    const utc = s => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
    return Math.round((utc(da) - utc(db)) / 86400000);
  }

  /** Prazos em dias, na ordem das parcelas; o que não é número fica de fora. */
  function prazosValidos(prazos) {
    return (Array.isArray(prazos) ? prazos : [])
      .map(p => (p === null || p === undefined || p === '' ? NaN : Number(p)))
      .filter(n => Number.isFinite(n) && n >= 0)
      .map(n => Math.trunc(n));
  }

  /**
   * De onde o faturamento conta, pela regra escolhida:
   *   ao_embarcar  → a previsão de embarque;
   *   ao_converter → o dia da conversão;
   *   data         → a data escolhida.
   */
  function resolverInicio({ regra, embarcar_previsao, inicio_data, dataConversao } = {}) {
    if (regra === 'ao_embarcar') return diaDeColunaDate(embarcar_previsao);
    if (regra === 'ao_converter') return diaDeColunaDate(dataConversao);
    if (regra === 'data') return diaDeColunaDate(inicio_data);
    return null;
  }

  /** Regra com que o modal abre: a do pedido; sem ela, "data" se já há início; senão "ao embarcar". */
  function regraInicial({ faturamento_regra, inicio_faturamento } = {}) {
    if (REGRAS_FATURAMENTO.includes(faturamento_regra)) return faturamento_regra;
    return diaDeColunaDate(inicio_faturamento) ? 'data' : 'ao_embarcar';
  }

  /** Um vencimento por prazo: início + os dias daquela parcela. */
  function vencimentosDe(inicio, prazos) {
    if (!diaDeColunaDate(inicio)) return [];
    return prazosValidos(prazos).map((dias, i) => ({ numero: i + 1, dias, data: somarDias(inicio, dias) }));
  }

  /** "1ª — 25/08/2026 (15 dias)", como no pagamento; sem o "1ª" quando é uma parcela só. */
  function rotuloVencimento(vencimento, total) {
    const prefixo = total > 1 ? `${vencimento.numero}ª — ` : '';
    const dias = `${vencimento.dias} ${vencimento.dias === 1 ? 'dia' : 'dias'}`;
    return `${prefixo}${textoDoDia(vencimento.data)} (${dias})`;
  }

  /** A frase acima dos vencimentos. */
  function textoDaPrevia(regra, inicio, quantosPrazos) {
    if (!inicio) {
      if (regra === 'data') return 'Informe a data de início para ver os vencimentos.';
      if (regra === 'ao_converter') return 'O faturamento começa no dia da conversão.';
      if (regra === 'ao_embarcar') return 'Informe a previsão de embarque para ver os vencimentos.';
      return 'Escolha quando o faturamento começa.';
    }
    const aPartir = `Faturamento a partir de ${textoDoDia(inicio)}.`;
    return quantosPrazos > 0 ? aPartir : `${aPartir} Os vencimentos aparecem quando houver prazo definido.`;
  }

  /** Corpo do PUT /api/pedidos/:id/datas: o início só vai na "data específica". */
  function corpoDasDatas(datas) {
    const corpo = { embarcar_previsao: datas.embarcar_previsao, faturamento_regra: datas.faturamento_regra };
    if (datas.faturamento_regra === 'data') corpo.inicio_faturamento = datas.inicio_faturamento;
    return corpo;
  }

  /** As datas que valeram: as da resposta do backend, quando vierem. */
  function datasDaResposta(datas, resposta) {
    return {
      embarcar_previsao: diaDeColunaDate(resposta?.embarcar_previsao) || datas.embarcar_previsao,
      faturamento_regra: REGRAS_FATURAMENTO.includes(resposta?.faturamento_regra)
        ? resposta.faturamento_regra
        : datas.faturamento_regra,
      inicio_faturamento: diaDeColunaDate(resposta?.inicio_faturamento) || datas.inicio_faturamento
    };
  }

  /** O que dizer quando o backend recusa. */
  function mensagemDeErro(status, corpo) {
    if (status === 403) return 'Você não tem permissão para alterar as datas do pedido.';
    if (status === 404) return 'Pedido não encontrado. Ele pode ter sido excluído.';
    if (status === 409 || corpo?.code === 'SITUACAO_NAO_PERMITE') {
      return corpo?.error || 'Este pedido não está mais em produção; as datas não podem ser alteradas.';
    }
    if (status === 400 || corpo?.code === 'DATAS_INVALIDAS') {
      return corpo?.error || 'As datas informadas não são válidas.';
    }
    return corpo?.error || 'Não foi possível salvar as datas do pedido.';
  }
  // ==================================================================
  // fim das funções puras
  // ==================================================================

  // ------------------------------------------------------ ciclo de vida
  let readyMarked = false;
  const markReady = (reveal = true) => {
    if (reveal && overlay.classList.contains('hidden')) {
      overlay.classList.remove('hidden');
      overlay.removeAttribute('aria-hidden');
    } else if (!reveal) {
      overlay.setAttribute('aria-hidden', 'true');
    }
    if (!readyMarked) {
      readyMarked = true;
      overlay.dataset.modalReady = 'true';
      overlay.removeAttribute('data-modal-loading');
      window.Modal?.signalReady?.(overlayId);
    }
  };

  const bruto = window.datasPedidoContext;
  const modo = bruto?.modo;
  const temPedido = bruto?.pedidoId !== undefined && bruto?.pedidoId !== null && bruto?.pedidoId !== '';
  if (!bruto || (modo !== 'conversao' && modo !== 'pedido') || (modo === 'pedido' && !temPedido)) {
    // Sem saber para quê foi aberto, gravar ou devolver datas seria chute.
    console.warn('[datas do pedido] aberto sem contexto válido; fechando.');
    markReady(false);
    window.datasPedidoContext = null;
    window.Modal?.close?.(overlayId);
    return;
  }

  /** Hoje em São Paulo, 'YYYY-MM-DD': o mesmo relógio do resto do app. */
  function hojeEmSaoPaulo() {
    try {
      const doApp = diaDeColunaDate(window.dateUtils?.getTodayKey?.());
      if (doApp) return doApp;
    } catch (_) { /* cai no cálculo abaixo */ }
    try {
      const partes = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(new Date());
      const parte = tipo => partes.find(p => p.type === tipo)?.value;
      return diaDeColunaDate(`${parte('year')}-${parte('month')}-${parte('day')}`);
    } catch (_) {
      return null;
    }
  }

  const hoje = hojeEmSaoPaulo();

  // Cópia limpa e serializável do contexto: é ela que volta numa
  // restauração de trabalho.
  const ctx = {
    modo,
    pedidoId: bruto.pedidoId ?? null,
    numero: bruto.numero ? String(bruto.numero) : '',
    cliente: bruto.cliente ? String(bruto.cliente) : '',
    prazos: prazosValidos(bruto.prazos),
    embarcar_previsao: diaDeColunaDate(bruto.embarcar_previsao),
    inicio_faturamento: diaDeColunaDate(bruto.inicio_faturamento),
    faturamento_regra: REGRAS_FATURAMENTO.includes(bruto.faturamento_regra) ? bruto.faturamento_regra : null,
    // Na conversão, "ao converter" é hoje; no pedido, o dia em que ele foi
    // convertido.
    dataConversao: diaDeColunaDate(bruto.dataConversao) || (modo === 'conversao' ? hoje : null)
  };

  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }

  // ---------------------------------------------------------- elementos
  const el = id => overlay.querySelector(`#${id}`);
  const campoDeData = base => ({
    texto: el(base),
    nativo: el(`${base}Nativo`),
    botao: el(`${base}Calendario`),
    erro: el(`${base}Erro`)
  });
  const embarque = campoDeData('datasPedidoEmbarque');
  const inicio = campoDeData('datasPedidoInicio');
  const radios = Array.from(overlay.querySelectorAll('input[name="datasPedidoRegra"]'));
  const blocoInicio = el('datasPedidoInicioBloco');
  const infoEmbarque = el('datasPedidoRegraEmbarqueInfo');
  const rotuloConversao = el('datasPedidoRegraConversaoRotulo');
  const infoConversao = el('datasPedidoRegraConversaoInfo');
  const aviso = el('datasPedidoAviso');
  const previaTexto = el('datasPedidoPreviaTexto');
  const previaLista = el('datasPedidoVencimentosLista');
  const mensagemEl = el('datasPedidoMensagem');
  const subtitulo = el('datasPedidoSubtitulo');
  const voltarBtn = el('voltarDatasPedido');
  const cancelarBtn = el('cancelarDatasPedido');
  const confirmarBtn = el('confirmarDatasPedido');
  const salvarBtn = el('salvarDatasPedido');

  // Um botão por modo. O de gravar no pedido é o que carrega a guarda
  // ped.dates.edit, escrita no HTML (ver datas.html); na conversão ele sai do
  // DOM, e a guarda sai com ele — quem converte não precisa dessa permissão.
  const botaoFinal = modo === 'pedido' ? salvarBtn : confirmarBtn;
  (modo === 'pedido' ? confirmarBtn : salvarBtn)?.remove();
  botaoFinal.classList.remove('hidden');

  // ---------------------------------------------------------- mensagens
  function mostrarErro(campo, texto) {
    if (!campo?.erro) return;
    campo.erro.textContent = texto || '';
    campo.erro.classList.toggle('hidden', !texto);
    campo.texto.style.borderColor = texto ? 'var(--color-red)' : '';
    if (texto) campo.texto.setAttribute('aria-invalid', 'true');
    else campo.texto.removeAttribute('aria-invalid');
  }

  function exibirMensagem(texto) {
    if (!mensagemEl) return;
    mensagemEl.textContent = texto;
    mensagemEl.style.color = 'var(--color-red)';
    mensagemEl.classList.remove('hidden');
  }

  function limparMensagem() {
    if (!mensagemEl) return;
    mensagemEl.textContent = '';
    mensagemEl.classList.add('hidden');
  }

  /** Confere o campo e mostra o erro dele. Devolve a data ('YYYY-MM-DD') ou null. */
  function validarCampo(campo, { obrigatorio = false, textoVazio = '' } = {}) {
    const { iso, erro } = lerDataDigitada(campo.texto.value);
    if (erro === 'vazia') {
      mostrarErro(campo, obrigatorio ? textoVazio : '');
      return null;
    }
    mostrarErro(campo, erro ? MENSAGEM_DATA[erro] : '');
    return iso;
  }

  // ------------------------------------------------------ regra e prévia
  const regraEscolhida = () => radios.find(r => r.checked)?.value || null;

  function aplicarRegra({ focar = false } = {}) {
    const ehData = regraEscolhida() === 'data';
    inicio.texto.disabled = !ehData;
    inicio.botao.disabled = !ehData;
    if (blocoInicio) blocoInicio.style.opacity = ehData ? '' : '0.5';
    if (!ehData) mostrarErro(inicio, '');
    if (ehData && focar) {
      try { inicio.texto.focus(); } catch (_) { /* sem foco, sem problema */ }
    }
  }

  function atualizarPrevia() {
    const previsao = lerDataDigitada(embarque.texto.value).iso;
    const seAtrasar = 'Se o embarque atrasar, passa a contar do dia em que embarcar.';
    infoEmbarque.textContent = previsao
      ? `Usa a previsão: ${textoDoDia(previsao)}. ${seAtrasar}`
      : `Usa a previsão de embarque. ${seAtrasar}`;

    // Aviso, não bloqueio: registrar um pedido que já devia ter embarcado é
    // legítimo; o que se quer é evitar o ano digitado errado.
    const passou = previsao && hoje ? diferencaEmDias(hoje, previsao) : null;
    if (passou > 0) {
      aviso.textContent = `A previsão (${textoDoDia(previsao)}) já passou. Confira se é isso mesmo.`;
      aviso.classList.remove('hidden');
    } else {
      aviso.textContent = '';
      aviso.classList.add('hidden');
    }

    const regra = regraEscolhida();
    const inicioData = regra === 'data' ? lerDataDigitada(inicio.texto.value).iso : null;
    const base = resolverInicio({
      regra, embarcar_previsao: previsao, inicio_data: inicioData, dataConversao: ctx.dataConversao
    });
    previaTexto.textContent = textoDaPrevia(regra, base, ctx.prazos.length);
    const vencimentos = vencimentosDe(base, ctx.prazos);
    previaLista.innerHTML = vencimentos
      .map(v => `<span class="badge-info px-3 py-1 rounded-full text-xs font-medium">${rotuloVencimento(v, vencimentos.length)}</span>`)
      .join('');
    previaLista.classList.toggle('hidden', !vencimentos.length);
  }

  // ------------------------------------------------------ campos de data
  function abrirCalendario(campo) {
    if (campo.texto.disabled || campo.botao.disabled) return;
    // O seletor abre no dia já escrito, quando é um dia de verdade.
    campo.nativo.value = lerDataDigitada(campo.texto.value).iso || '';
    try {
      // Síncrono, dentro do clique: o showPicker exige o gesto do usuário e,
      // depois de um await, recusa (NotAllowedError).
      if (typeof campo.nativo.showPicker !== 'function') throw new Error('showPicker indisponível');
      campo.nativo.showPicker();
    } catch (_) {
      try {
        campo.nativo.focus();
        campo.nativo.click();
      } catch (__) { /* sem seletor, o campo de texto continua valendo */ }
    }
  }

  function ligarCampoData(campo) {
    campo.texto.addEventListener('input', () => {
      const mascarado = mascararData(campo.texto.value);
      if (mascarado !== campo.texto.value) campo.texto.value = mascarado;
      // Cursor no fim: a máscara reescreve o campo inteiro a cada tecla.
      const fim = campo.texto.value.length;
      try { campo.texto.setSelectionRange(fim, fim); } catch (_) { /* campo sem seleção */ }
      // Enquanto se digita, o erro só SAI (quando a data fica boa). Acusar
      // no meio da digitação é trabalho do blur.
      if (!lerDataDigitada(campo.texto.value).erro) mostrarErro(campo, '');
      limparMensagem();
      atualizarPrevia();
    });
    campo.texto.addEventListener('blur', () => validarCampo(campo));
    campo.botao.addEventListener('click', () => abrirCalendario(campo));

    const aoEscolher = () => {
      const iso = diaDeColunaDate(campo.nativo.value);
      if (!iso) return;
      campo.texto.value = textoDoDia(iso);
      mostrarErro(campo, '');
      limparMensagem();
      atualizarPrevia();
    };
    campo.nativo.addEventListener('input', aoEscolher);
    campo.nativo.addEventListener('change', aoEscolher);
  }

  // ------------------------------------------------------------ confirmar
  let fechado = false;
  let emAndamento = false;

  function fechar() {
    if (fechado) return;
    fechado = true;
    window.removeEventListener('keydown', aoTeclar, true);
    window.removeEventListener('modalFechado', aoFecharAlgumModal);
    if (window.datasPedidoContext === bruto) window.datasPedidoContext = null;
    window.Modal?.close?.(overlayId);
  }

  function travarSaidas(travado) {
    voltarBtn.disabled = travado;
    cancelarBtn.disabled = travado;
  }

  function coletarDatas() {
    limparMensagem();
    const previsao = validarCampo(embarque, { obrigatorio: true, textoVazio: 'Informe a previsão de embarque.' });
    if (!previsao) {
      try { embarque.texto.focus(); } catch (_) { /* sem foco, sem problema */ }
      return null;
    }
    const regra = regraEscolhida();
    if (!REGRAS_FATURAMENTO.includes(regra)) {
      exibirMensagem('Escolha quando o faturamento começa.');
      return null;
    }
    let inicioData = null;
    if (regra === 'data') {
      inicioData = validarCampo(inicio, { obrigatorio: true, textoVazio: 'Informe a data de início do faturamento.' });
      if (!inicioData) {
        try { inicio.texto.focus(); } catch (_) { /* sem foco, sem problema */ }
        return null;
      }
    }
    return {
      embarcar_previsao: previsao,
      faturamento_regra: regra,
      inicio_faturamento: resolverInicio({
        regra, embarcar_previsao: previsao, inicio_data: inicioData, dataConversao: ctx.dataConversao
      })
    };
  }

  function concluir(datas, resposta) {
    // O evento sai ANTES de fechar: quem abriu trata a desistência pelo
    // `modalFechado`, e quando ele chegar as datas já têm de ter chegado.
    window.dispatchEvent(new CustomEvent('pedido:datas-definidas', {
      detail: { source: 'pedido-datas', modo: ctx.modo, datas, resposta }
    }));
    window.SaidaSegura?.limpar?.(overlay);
    fechar();
  }

  async function salvarNoPedido(datas) {
    emAndamento = true;
    travarSaidas(true);
    try {
      let resp;
      try {
        resp = await fetchApi(`/api/pedidos/${encodeURIComponent(ctx.pedidoId)}/datas`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(corpoDasDatas(datas))
        });
      } catch (err) {
        console.error('Erro de rede ao salvar as datas do pedido:', err);
        exibirMensagem('Não foi possível falar com o servidor. Tente de novo.');
        return;
      }
      let resposta = null;
      try { resposta = await resp.json(); } catch (_) { /* corpo vazio */ }
      if (!resp.ok) {
        // Fica aberto, com o que o backend disse: o usuário corrige ou desiste.
        exibirMensagem(mensagemDeErro(resp.status, resposta));
        return;
      }
      concluir(datasDaResposta(datas, resposta), resposta);
    } finally {
      emAndamento = false;
      if (!fechado) travarSaidas(false);
    }
  }

  function confirmar() {
    if (emAndamento || fechado) return undefined;
    const datas = coletarDatas();
    if (!datas) return undefined;
    if (ctx.modo === 'conversao') {
      concluir(datas, null);
      return undefined;
    }
    return salvarNoPedido(datas);
  }

  // ---------------------------------------------------------------- teclado
  function aoTeclar(evento) {
    if (!overlay.isConnected) {
      window.removeEventListener('keydown', aoTeclar, true);
      return;
    }
    if (evento.key !== 'Escape' && evento.key !== 'Enter') return;
    // Uma caixa por cima (a pergunta de "sair sem salvar", um aviso) é dona
    // do próprio teclado.
    if (document.querySelector('dialog[open]')) return;

    if (evento.key === 'Escape') {
      // Em CAPTURA no window, este ouvinte roda antes dos de Esc que o
      // editar, o converter e o pagamento têm no document. Sem parar aqui, um
      // Esc neste modal fecharia os de baixo em cascata, e a revisão da
      // conversão se perderia junto.
      evento.preventDefault();
      evento.stopPropagation();
      // Pelo botão, e não fechando direto: assim passa pela guarda de saída
      // (SaidaSegura), que pergunta antes de descartar datas digitadas.
      if (!emAndamento) cancelarBtn.click();
      return;
    }

    if (evento.isComposing) return;
    const alvo = evento.target;
    if (alvo && alvo !== document.body && !overlay.contains(alvo)) return;
    // Enter num botão é do botão (o de calendário abre o seletor).
    if (alvo?.tagName === 'BUTTON') return;
    evento.preventDefault();
    evento.stopPropagation();
    if (botaoFinal.disabled) {
      if (botaoFinal.dataset.permAplicado === 'negado') {
        exibirMensagem('Você não tem permissão para alterar as datas do pedido.');
      }
      return;
    }
    botaoFinal.click();
  }

  // Fechado por fora (Modal.closeAll, troca de módulo): solta o teclado.
  function aoFecharAlgumModal(evento) {
    if (evento?.detail !== overlayId) return;
    window.removeEventListener('keydown', aoTeclar, true);
    window.removeEventListener('modalFechado', aoFecharAlgumModal);
  }

  // ------------------------------------------------------------- montagem
  const partesSubtitulo = [ctx.numero, ctx.cliente].filter(Boolean);
  if (partesSubtitulo.length) {
    subtitulo.textContent = partesSubtitulo.join(' · ');
    subtitulo.classList.remove('hidden');
  }

  if (modo === 'pedido') {
    rotuloConversao.textContent = ctx.dataConversao
      ? `Na conversão (${textoDoDia(ctx.dataConversao)})`
      : 'Na conversão';
    infoConversao.textContent = 'O dia em que o orçamento virou pedido.';
  } else {
    rotuloConversao.textContent = 'Ao converter';
    infoConversao.textContent = ctx.dataConversao ? `hoje, ${textoDoDia(ctx.dataConversao)}` : 'O dia da conversão.';
  }

  embarque.texto.value = textoDoDia(ctx.embarcar_previsao);
  const regraDeAbertura = regraInicial(ctx);
  radios.forEach(r => { r.checked = r.value === regraDeAbertura; });
  if (regraDeAbertura === 'data') inicio.texto.value = textoDoDia(ctx.inicio_faturamento);

  [embarque, inicio].forEach(ligarCampoData);
  radios.forEach(r => r.addEventListener('change', () => {
    limparMensagem();
    aplicarRegra({ focar: r.checked && r.value === 'data' });
    atualizarPrevia();
  }));

  voltarBtn.addEventListener('click', fechar);
  cancelarBtn.addEventListener('click', fechar);
  if (modo === 'pedido' && typeof window.BotaoAcao?.bind === 'function') {
    // Carregando no PRÓPRIO botão, com a trava de clique duplo do BotaoAcao.
    // O véu de `comCarregamento` (o do pagamento) tem z-index 3000 e ficaria
    // escondido atrás deste overlay, que está em 12000.
    window.BotaoAcao.bind(salvarBtn, () => confirmar());
  } else {
    botaoFinal.addEventListener('click', () => confirmar());
  }

  aplicarRegra();
  atualizarPrevia();
  window.addEventListener('keydown', aoTeclar, true);
  window.addEventListener('modalFechado', aoFecharAlgumModal);

  // Numa queda de conexão o modal volta com o mesmo contexto; o que estava
  // digitado a restauração genérica repõe pelos ids dos campos.
  window.EstadoTrabalho?.registrarContexto?.(overlayId, () => ({ datasPedidoContext: ctx }));

  markReady();
  try {
    embarque.texto.focus();
    const fim = embarque.texto.value.length;
    embarque.texto.setSelectionRange(fim, fim);
  } catch (_) { /* sem foco, sem problema */ }
})();
