/**
 * Modal "Datas do envio" (decisões do dono, 24/09/2026).
 *
 * Corrige um pedido ENVIADO SEM NF-e do sistema cuja data de envio ficou
 * errada — o caso da nota emitida fora e informada depois, em que o envio foi
 * marcado sem trocar a data. Muda a data de envio, a previsão de embarque, o
 * início do faturamento (a mesma escolha do pedido) e os dias de cada
 * parcela.
 *
 *   - "No envio" (ao_embarcar): o faturamento conta da data de envio, e
 *     mudar o envio MOVE as parcelas. Nas outras escolhas o envio muda
 *     sozinho, sem mexer nelas.
 *   - Parcela paga, com boleto (do BB ou de fora) ou ordem de pagamento não
 *     muda: aparece com o cadeado e o motivo.
 *   - Só muda o vencimento da parcela cujo início ou prazo mudou.
 *
 * Quem confere e grava é o backend (GET e PUT /api/pedidos/:id/envio,
 * backend/datasDoEnvio.js). A prévia daqui faz a mesma conta para a pessoa
 * ver antes de salvar. Abre pelo calendário da lista (`abrirDatasDoEnvio` em
 * pedidos.js), com `window.datasEnvioContext = { pedidoId, numero, cliente }`.
 */
(() => {
  const overlayId = 'datasEnvio';
  const overlay = document.getElementById('datasEnvioOverlay');
  if (!overlay) return;

  // ==================================================================
  // Funções puras: datas, a conta das parcelas e os textos.
  //
  // Sem DOM, sem relógio e sem `window`. O teste
  // (src/js/__tests__/pedidoDatasEnvio.test.js) recorta o trecho entre este
  // cabeçalho e o marcador "fim das funções puras" e o executa isolado.
  //
  // As datas trafegam como 'YYYY-MM-DD', o formato das colunas DATE, e a
  // conta é de CALENDÁRIO, em UTC: `new Date('2026-09-13')` em São Paulo é
  // dia 12 às 21h.
  // ==================================================================
  const REGRAS_FATURAMENTO = ['ao_embarcar', 'ao_converter', 'data'];

  const MENSAGEM_DATA = {
    incompleta: 'Data incompleta — use dd/mm/aaaa.',
    inexistente: 'Essa data não existe no calendário.'
  };

  /** Máscara dd/mm/aaaa; colar '2026-08-10' também funciona. */
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
    if (ano < 1900 || ano > 2100 || mes < 1 || mes > 12 || dia < 1) return false;
    const d = new Date(Date.UTC(ano, mes - 1, dia));
    return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
  }

  /** `iso` quando a data é real; senão `erro`: 'vazia', 'incompleta' ou 'inexistente'. */
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

  /** 'R$ 1.234,50'. */
  function reais(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  /** Prazo digitado: só dígitos, até 4. '' quando vazio. */
  function limparPrazo(texto) {
    return String(texto ?? '').replace(/\D/g, '').slice(0, 4);
  }

  /**
   * A escolha com que o modal abre: a do pedido. Pedido antigo, sem ela: a
   * "data específica" quando há início gravado; senão "na conversão", que é
   * de onde o pedido antigo conta — abrir e salvar sem mexer não move nada.
   */
  function regraInicial({ faturamento_regra, inicio_faturamento } = {}) {
    if (REGRAS_FATURAMENTO.includes(faturamento_regra)) return faturamento_regra;
    return diaDeColunaDate(inicio_faturamento) ? 'data' : 'ao_converter';
  }

  /** De onde o faturamento conta, pela escolha. */
  function inicioDaRegra({ regra, dataEnvio, inicioEscolhido, dataConversao } = {}) {
    if (regra === 'ao_embarcar') return diaDeColunaDate(dataEnvio);
    if (regra === 'ao_converter') return diaDeColunaDate(dataConversao);
    if (regra === 'data') return diaDeColunaDate(inicioEscolhido);
    return null;
  }

  /**
   * A mesma conta do backend (datasDoEnvio.planejar): a parcela travada fica
   * como está; as outras mudam se o início ou o prazo delas mudou.
   * `prazos` é um número (ou null, campo vazio) por parcela.
   */
  function planoDaTela({ pedido, parcelas, regra, dataEnvio, inicioEscolhido, prazos }) {
    const inicio = inicioDaRegra({ regra, dataEnvio, inicioEscolhido, dataConversao: pedido?.data_conversao });
    const inicioAntes = diaDeColunaDate(pedido?.inicio_faturamento) || diaDeColunaDate(pedido?.data_conversao);
    const baseMudou = inicio !== inicioAntes;
    const linhas = (parcelas || []).map((p, i) => {
      const digitado = Array.isArray(prazos) ? prazos[i] : p.prazo;
      const prazo = p.travada ? p.prazo : digitado;
      let vencimento = p.vencimento || null;
      const prazoValido = Number.isInteger(prazo) && prazo >= 0;
      if (!p.travada && inicio && prazoValido && (baseMudou || prazo !== p.prazo || !p.vencimento)) {
        vencimento = somarDias(inicio, prazo);
      }
      return { ...p, prazo_antes: p.prazo, prazo, vencimento_antes: p.vencimento || null, vencimento, muda: vencimento !== (p.vencimento || null) };
    });
    return { inicio, linhas, movidas: linhas.filter(l => l.muda).length };
  }

  /** A frase acima da tabela. */
  function textoDaPrevia(plano, regra) {
    if (!plano.inicio) {
      if (regra === 'data') return 'Informe a data de início do faturamento para ver os vencimentos.';
      if (regra === 'ao_embarcar') return 'Informe a data de envio para ver os vencimentos.';
      return 'Escolha quando o faturamento começa.';
    }
    const base = `Faturamento a partir de ${textoDoDia(plano.inicio)}.`;
    if (!plano.linhas.length) return `${base} O pedido não tem parcelas.`;
    if (!plano.movidas) return `${base} Nenhum vencimento muda.`;
    return `${base} ${plano.movidas === 1 ? '1 parcela muda' : `${plano.movidas} parcelas mudam`} de vencimento.`;
  }

  /** O conteúdo da coluna "Novo vencimento": o cadeado, a data nova ou "não muda". */
  function celulaDoNovoVencimento(linha) {
    if (linha.travada) return `<span class="text-gray-400"><i class="fas fa-lock mr-1" aria-hidden="true"></i>${linha.trava || 'Não muda.'}</span>`;
    if (linha.muda) return `<strong style="color: var(--color-primary)">${textoDoDia(linha.vencimento) || '—'}</strong>`;
    return '<span class="text-gray-400">não muda</span>';
  }

  /** Uma linha da tabela das parcelas. */
  function linhaDaParcela(linha, indice) {
    const prazo = linha.travada
      ? `<span class="text-gray-300">${linha.prazo_antes ?? '—'}</span>`
      : `<input type="text" inputmode="numeric" maxlength="4" data-numeric="false" data-prazo="${indice}" value="${linha.prazo ?? ''}" aria-label="Prazo da ${linha.numero}ª parcela, em dias" class="w-24 ctl-campo bg-input border border-inputBorder text-white focus:border-primary focus:ring-2 focus:ring-primary/50 transition" />`;
    return `<tr data-parcela="${linha.numero}">
      <td>${linha.numero}ª</td>
      <td class="text-right">${reais(linha.valor)}</td>
      <td>${prazo}</td>
      <td>${textoDoDia(linha.vencimento_antes) || '—'}</td>
      <td data-novo-vencimento>${celulaDoNovoVencimento(linha)}</td>
    </tr>`;
  }

  /** Corpo do PUT /api/pedidos/:id/envio: o início só vai na "data específica". */
  function corpoDoEnvio({ dataEnvio, previsao, regra, inicioEscolhido, prazos }) {
    const corpo = { data_envio: dataEnvio, embarcar_previsao: previsao, faturamento_regra: regra };
    if (regra === 'data') corpo.inicio_faturamento = inicioEscolhido;
    if (Array.isArray(prazos)) corpo.prazos = prazos;
    return corpo;
  }

  /** O que dizer quando o backend recusa. */
  function mensagemDeErro(status, corpo) {
    if (status === 403) return 'Você não tem permissão para alterar as datas do pedido.';
    if (status === 404) return 'Pedido não encontrado. Ele pode ter sido excluído.';
    return corpo?.error || 'Não foi possível salvar as datas do envio.';
  }
  // ==================================================================
  // fim das funções puras
  // ==================================================================

  const bruto = window.datasEnvioContext || {};
  const ctx = {
    pedidoId: bruto.pedidoId ?? window.selectedOrderId ?? null,
    numero: bruto.numero ? String(bruto.numero) : '',
    cliente: bruto.cliente ? String(bruto.cliente) : ''
  };

  // Numa queda de conexão o modal volta com o mesmo contexto.
  window.EstadoTrabalho?.registrarContexto?.(overlayId, () => ({ datasEnvioContext: ctx, selectedOrderId: ctx.pedidoId }));

  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }

  // ---------------------------------------------------------- elementos
  const el = id => overlay.querySelector(`#${id}`);
  const campoDeData = base => ({ texto: el(base), nativo: el(`${base}Nativo`), botao: el(`${base}Calendario`), erro: el(`${base}Erro`) });
  const envio = campoDeData('datasEnvioData');
  const previsao = campoDeData('datasEnvioPrevisao');
  const inicio = campoDeData('datasEnvioInicio');
  const radios = Array.from(overlay.querySelectorAll('input[name="datasEnvioRegra"]'));
  const blocoInicio = el('datasEnvioInicioBloco');
  const corpoTabela = el('datasEnvioParcelas');
  const previaTexto = el('datasEnvioPreviaTexto');
  const mensagemEl = el('datasEnvioMensagem');
  const bloqueioEl = el('datasEnvioBloqueio');
  const salvarBtn = el('salvarDatasEnvio');
  const cancelarBtn = el('cancelarDatasEnvio');
  const voltarBtn = el('voltarDatasEnvio');

  let dados = null;
  let prazosDigitados = null;
  let fechado = false;
  let emAndamento = false;

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
    mensagemEl.textContent = texto;
    mensagemEl.style.color = 'var(--color-red)';
    mensagemEl.classList.remove('hidden');
  }

  function limparMensagem() {
    mensagemEl.textContent = '';
    mensagemEl.classList.add('hidden');
  }

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
    const travado = Boolean(dados?.bloqueio);
    inicio.texto.disabled = !ehData || travado;
    inicio.botao.disabled = !ehData || travado;
    blocoInicio.style.opacity = ehData ? '' : '0.5';
    if (!ehData) mostrarErro(inicio, '');
    if (ehData && focar) {
      try { inicio.texto.focus(); } catch (_) { /* sem foco, sem problema */ }
    }
  }

  function planoAtual() {
    return planoDaTela({
      pedido: dados?.pedido,
      parcelas: dados?.parcelas || [],
      regra: regraEscolhida(),
      dataEnvio: lerDataDigitada(envio.texto.value).iso,
      inicioEscolhido: regraEscolhida() === 'data' ? lerDataDigitada(inicio.texto.value).iso : null,
      prazos: prazosDigitados
    });
  }

  function atualizarPrevia({ redesenhar = false } = {}) {
    if (!dados) return;
    const plano = planoAtual();
    previaTexto.textContent = textoDaPrevia(plano, regraEscolhida());
    if (redesenhar || !corpoTabela.children.length) {
      corpoTabela.innerHTML = plano.linhas.map(linhaDaParcela).join('')
        || '<tr><td colspan="5" class="text-gray-400">O pedido não tem parcelas.</td></tr>';
      if (dados.bloqueio) corpoTabela.querySelectorAll('input').forEach(i => { i.disabled = true; });
      return;
    }
    // Só a coluna do novo vencimento é refeita: redesenhar a linha inteira
    // tiraria o foco do prazo que está sendo digitado.
    const celulas = corpoTabela.querySelectorAll('td[data-novo-vencimento]');
    plano.linhas.forEach((linha, i) => {
      if (celulas[i]) celulas[i].innerHTML = celulaDoNovoVencimento(linha);
    });
  }

  // ------------------------------------------------------ campos de data
  function abrirCalendario(campo) {
    if (campo.texto.disabled || campo.botao.disabled) return;
    campo.nativo.value = lerDataDigitada(campo.texto.value).iso || '';
    try {
      // Síncrono, dentro do clique: depois de um await o showPicker recusa.
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
      const fim = campo.texto.value.length;
      try { campo.texto.setSelectionRange(fim, fim); } catch (_) { /* campo sem seleção */ }
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

  // Os prazos da tabela: um ouvinte só, no corpo, porque as linhas são refeitas.
  corpoTabela.addEventListener('input', evento => {
    const campo = evento.target?.closest?.('input[data-prazo]');
    if (!campo) return;
    const limpo = limparPrazo(campo.value);
    if (limpo !== campo.value) campo.value = limpo;
    const i = Number(campo.dataset.prazo);
    if (!prazosDigitados) prazosDigitados = (dados?.parcelas || []).map(p => p.prazo);
    prazosDigitados[i] = limpo === '' ? null : Number(limpo);
    limparMensagem();
    atualizarPrevia();
  });

  // ------------------------------------------------------------ salvar
  function fechar() {
    if (fechado) return;
    fechado = true;
    document.removeEventListener('keydown', aoTeclar, true);
    if (window.datasEnvioContext === bruto) window.datasEnvioContext = null;
    window.Modal?.close?.(overlayId);
  }

  function coletar() {
    limparMensagem();
    const dataEnvio = validarCampo(envio, { obrigatorio: true, textoVazio: 'Informe a data de envio.' });
    if (!dataEnvio) {
      try { envio.texto.focus(); } catch (_) { /* sem foco */ }
      return null;
    }
    const previsaoIso = validarCampo(previsao, { obrigatorio: true, textoVazio: 'Informe a previsão de embarque.' });
    if (!previsaoIso) {
      try { previsao.texto.focus(); } catch (_) { /* sem foco */ }
      return null;
    }
    const regra = regraEscolhida();
    if (!REGRAS_FATURAMENTO.includes(regra)) {
      exibirMensagem('Escolha quando o faturamento começa.');
      return null;
    }
    let inicioEscolhido = null;
    if (regra === 'data') {
      inicioEscolhido = validarCampo(inicio, { obrigatorio: true, textoVazio: 'Informe a data de início do faturamento.' });
      if (!inicioEscolhido) {
        try { inicio.texto.focus(); } catch (_) { /* sem foco */ }
        return null;
      }
    }
    if (prazosDigitados) {
      const vazio = prazosDigitados.findIndex((p, i) => !dados.parcelas[i]?.travada && !Number.isInteger(p));
      if (vazio !== -1) {
        exibirMensagem(`Informe o prazo da ${dados.parcelas[vazio].numero}ª parcela, em dias.`);
        return null;
      }
    }
    const prazos = prazosDigitados ? prazosDigitados.map((p, i) => (dados.parcelas[i]?.travada ? dados.parcelas[i].prazo : p)) : null;
    return corpoDoEnvio({ dataEnvio, previsao: previsaoIso, regra, inicioEscolhido, prazos });
  }

  async function salvar() {
    if (emAndamento || fechado || !dados || dados.bloqueio) return;
    const corpo = coletar();
    if (!corpo) return;
    emAndamento = true;
    voltarBtn.disabled = true;
    cancelarBtn.disabled = true;
    try {
      let resp;
      try {
        resp = await fetchApi(`/api/pedidos/${encodeURIComponent(ctx.pedidoId)}/envio`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(corpo)
        });
      } catch (err) {
        console.error('Erro de rede ao salvar as datas do envio:', err);
        exibirMensagem('Não foi possível falar com o servidor. Tente de novo.');
        return;
      }
      let resposta = null;
      try { resposta = await resp.json(); } catch (_) { /* corpo vazio */ }
      if (!resp.ok) {
        exibirMensagem(mensagemDeErro(resp.status, resposta));
        return;
      }
      if (resposta?.nada) {
        window.showToast?.('Nada mudou nas datas do envio.', 'info');
      } else {
        window.showToast?.('Datas do envio corrigidas.', 'success');
        const avisos = (Array.isArray(resposta?.avisos) ? resposta.avisos : []).filter(Boolean);
        if (avisos.length) window.showToast?.(avisos.join(' '), 'info');
        // A lista mostra o envio no balão da situação: relê antes de fechar.
        await window.carregarPedidos?.();
      }
      fechar();
    } finally {
      emAndamento = false;
      if (!fechado) {
        voltarBtn.disabled = false;
        cancelarBtn.disabled = false;
      }
    }
  }

  // ---------------------------------------------------------------- teclado
  function aoTeclar(evento) {
    if (!overlay.isConnected) {
      document.removeEventListener('keydown', aoTeclar, true);
      return;
    }
    if (evento.key !== 'Escape') return;
    // Uma caixa por cima é dona do próprio teclado.
    if (document.querySelector('dialog[open]')) return;
    evento.preventDefault();
    evento.stopPropagation();
    if (!emAndamento) fechar();
  }

  // ------------------------------------------------------------- carga
  function preencher() {
    const p = dados.pedido || {};
    const subtitulo = el('datasEnvioSubtitulo');
    const partes = [ctx.numero || p.numero, ctx.cliente].filter(Boolean).map(String);
    if (partes.length) {
      subtitulo.textContent = partes.join(' · ');
      subtitulo.classList.remove('hidden');
    }
    envio.texto.value = textoDoDia(p.embarcar_real);
    el('datasEnvioDataAntes').textContent = p.embarcar_real
      ? `Gravada hoje: ${textoDoDia(p.embarcar_real)}.`
      : 'O pedido está sem data de envio gravada.';
    previsao.texto.value = textoDoDia(p.embarcar_previsao);
    el('datasEnvioRegraConversaoRotulo').textContent = p.data_conversao
      ? `Na conversão (${textoDoDia(p.data_conversao)})`
      : 'Na conversão';

    const regra = regraInicial(p);
    radios.forEach(r => { r.checked = r.value === regra; });
    if (regra === 'data') inicio.texto.value = textoDoDia(p.inicio_faturamento);

    const nota = dados.nota_de_fora;
    if (nota?.data_emissao) {
      const numero = nota.numero ? ` nº ${nota.numero}` : '';
      el('datasEnvioNotaForaTexto').textContent = `NF-e de fora${numero} emitida em ${textoDoDia(nota.data_emissao)}.`;
      el('datasEnvioNotaFora').classList.remove('hidden');
      el('datasEnvioUsarNotaFora').addEventListener('click', () => {
        envio.texto.value = textoDoDia(nota.data_emissao);
        mostrarErro(envio, '');
        limparMensagem();
        atualizarPrevia();
      });
    }

    if (dados.bloqueio) {
      bloqueioEl.textContent = dados.bloqueio;
      bloqueioEl.classList.remove('hidden');
      [envio, previsao, inicio].forEach(c => { c.texto.disabled = true; c.botao.disabled = true; });
      radios.forEach(r => { r.disabled = true; });
      el('datasEnvioUsarNotaFora').disabled = true;
      salvarBtn.disabled = true;
    }
    aplicarRegra();
    atualizarPrevia({ redesenhar: true });
  }

  async function carregar() {
    if (ctx.pedidoId === null || ctx.pedidoId === '') throw new Error('sem pedido');
    const resp = await fetchApi(`/api/pedidos/${encodeURIComponent(ctx.pedidoId)}/envio`);
    const corpo = await resp.json().catch(() => null);
    if (!resp.ok) {
      dados = { pedido: {}, parcelas: [], bloqueio: mensagemDeErro(resp.status, corpo) };
    } else {
      dados = corpo;
    }
    preencher();
  }

  [envio, previsao, inicio].forEach(ligarCampoData);
  radios.forEach(r => r.addEventListener('change', () => {
    limparMensagem();
    aplicarRegra({ focar: r.checked && r.value === 'data' });
    atualizarPrevia();
  }));
  voltarBtn.addEventListener('click', fechar);
  cancelarBtn.addEventListener('click', fechar);
  if (typeof window.BotaoAcao?.bind === 'function') window.BotaoAcao.bind(salvarBtn, () => salvar());
  else salvarBtn.addEventListener('click', () => salvar());
  document.addEventListener('keydown', aoTeclar, true);

  // Revela DEPOIS de carregar (docs/padroes-de-interface.md, "Carregamento").
  const revelar = () => {
    overlay.classList.remove('hidden');
    overlay.removeAttribute('aria-hidden');
    window.Modal?.signalReady?.(overlayId);
    try { if (!envio.texto.disabled) envio.texto.focus(); } catch (_) { /* sem foco */ }
  };
  Promise.resolve()
    .then(carregar)
    .catch(erro => {
      console.error('[pedido] falha ao carregar as datas do envio', erro);
      dados = { pedido: {}, parcelas: [], bloqueio: 'Não foi possível carregar o pedido. Feche e tente de novo.' };
      try { preencher(); } catch (_) { /* o aviso já está na tela */ }
    })
    .finally(revelar);
})();
