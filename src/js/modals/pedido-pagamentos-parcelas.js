/**
 * Modal "Pagamentos das parcelas" do pedido (Visualizar → "Pagamentos").
 *
 * O cliente pode pagar uma parcela por Pix, cartão, transferência… sem boleto
 * nenhum, ou mesmo tendo boleto (decisões do dono, 24/09/2026). Aqui se vê
 * cada parcela (paga, em aberto, atrasada, com boleto), se registra quando e
 * como o cliente pagou e se estorna o que foi registrado por engano:
 *   - leitura: GET /api/cobranca/pedidos/:id/pagamentos;
 *   - multa e juros sugeridos para a data escolhida:
 *     GET /api/cobranca/pedidos/:id/pagamentos/encargos (a conta é do backend,
 *     pelas regras dos boletos, com o vencimento em dia não útil);
 *   - gravar: POST /api/cobranca/recebimentos. Parcela com boleto do BB em
 *     aberto pergunta antes e manda `baixar_boleto` (o boleto é baixado no BB
 *     como "quitado por fora" — senão o cliente poderia pagá-lo de novo);
 *   - estornar: POST /api/cobranca/recebimentos/:id/estornar { motivo }.
 *
 * O pagamento registrado entra na comissão e no royalty como qualquer
 * recebimento, no mês em que o cliente pagou.
 *
 * Contexto: `window.pagamentosParcelasContext = { pedidoId, numero, cliente }`.
 * Avisa quem está aberto por baixo com `recebimentos:alterados` (e
 * `boletos:alterados` quando baixou um boleto) e relê a lista de Pedidos.
 */
(() => {
  const overlayId = 'pagamentosParcelas';
  const overlay = document.getElementById('pagamentosParcelasOverlay');
  if (!overlay) return;

  // ------------------------------------------------------ funções puras
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const moedaBR = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const numeroBR = v => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const diaBR = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

  /** 'setembro/2026' de uma data 'YYYY-MM-DD'. */
  function rotuloDoMes(iso) {
    const m = /^(\d{4})-(\d{2})/.exec(String(iso || ''));
    return m ? `${MESES[Number(m[2]) - 1]}/${m[1]}` : '';
  }

  /** '3.326,51', 'R$ 3.326,51' ou '3326.51' → 3326.51; vazio ou inválido → null. */
  function lerValor(texto) {
    const limpo = String(texto ?? '').replace(/[^\d.,]/g, '');
    if (!limpo) return null;
    const normal = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
    const n = Number(normal);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }

  /** Como a parcela é cobrada, numa frase curta (o detalhe de quem está em aberto). */
  function textoDaCobranca(p) {
    if (p?.boleto_aberto) return `Boleto do BB ${p.boleto?.status === 'vencido' ? 'vencido' : 'em aberto'}${p.boleto?.nosso_numero ? ` · nº ${p.boleto.nosso_numero}` : ''}`;
    if (p?.boleto_externo) return `Boleto de fora${p.boleto_externo.banco_nome ? ` · ${p.boleto_externo.banco_nome}` : ''}`;
    return 'Sem boleto';
  }

  /** A etiqueta e o detalhe da coluna Situação. */
  function situacaoDaParcela(p) {
    const r = p?.recebimento;
    // Ordem de pagamento aberta (Pix, cartão… para uma data): como um boleto à mão.
    if (p?.ordem && !r) {
      const o = p.ordem;
      const detalhe = [moedaBR(o.valor), o.observacao || ''].filter(Boolean).join(' · ');
      return p.situacao === 'atrasada'
        ? { classe: 'badge-warning', texto: `Ordem atrasada · ${plural(Number(p.dias_atraso) || 0, 'dia', 'dias')}`, detalhe: `${o.forma || 'Pagamento'} para ${diaBR(o.data)} · ${detalhe}` }
        : { classe: 'badge-info', texto: `Ordem · ${o.forma || 'pagamento'} · para ${diaBR(o.data)}`, detalhe };
    }
    if (p?.situacao === 'paga' && r) {
      const partes = [
        moedaBR(r.valor), r.origem_rotulo,
        Number(r.encargos) > 0 ? `${moedaBR(r.encargos)} de multa e juros` : '',
        r.observacao || ''
      ].filter(Boolean);
      return { classe: 'badge-success', texto: `Pago em ${diaBR(r.data)}${r.forma ? ` · ${r.forma}` : ''}`, detalhe: partes.join(' · ') };
    }
    if (p?.situacao === 'paga_no_banco') {
      return p?.boleto?.status === 'baixado'
        ? { classe: 'badge-success', texto: 'Quitado por fora', detalhe: 'O boleto foi baixado; o lançamento do recebimento está pendente.' }
        : { classe: 'badge-success', texto: 'Boleto pago no banco', detalhe: 'A conciliação com o BB lança o recebimento.' };
    }
    if (p?.situacao === 'cancelada') return { classe: 'badge-neutral', texto: 'Cancelada', detalhe: 'Nada a receber nesta parcela.' };
    if (p?.situacao === 'atrasada') {
      return { classe: 'badge-warning', texto: `Atrasada · ${plural(Number(p.dias_atraso) || 0, 'dia', 'dias')}`, detalhe: textoDaCobranca(p) };
    }
    return { classe: 'badge-neutral', texto: 'Em aberto', detalhe: textoDaCobranca(p) };
  }

  /**
   * O vencimento e o que muda nele: se cai em fim de semana ou feriado, até
   * quando se paga sem encargos; se o boleto foi prorrogado, o do papel.
   */
  function textoDoVencimento(p) {
    const detalhe = [];
    if (p?.limite_sem_encargos && p.limite_sem_encargos !== p.vencimento) detalhe.push(`sem encargos até ${diaBR(p.limite_sem_encargos)}`);
    if (p?.vencimento_original) detalhe.push(`original ${diaBR(p.vencimento_original)}`);
    return { principal: diaBR(p?.vencimento) || '—', detalhe: detalhe.join(' · ') };
  }

  /**
   * As ações da linha: registrar (em aberto ou atrasada), editar (o que foi
   * pago à mão — data, valor, forma, observação) e estornar (o que foi pago à
   * mão ou por fora; o do banco só o BB desfaz).
   */
  function acoesDaParcela(p, { podeRegistrar = false, podeEstornar = false } = {}) {
    const acoes = [];
    // Ordem de pagamento aberta: dar a baixa (o cliente pagou) ou cancelá-la.
    if (p?.ordem && !p?.recebimento && podeRegistrar) acoes.push('baixar', 'cancelar_ordem');
    if (p?.pode_registrar && podeRegistrar) acoes.push('registrar');
    if (p?.situacao === 'paga' && p?.recebimento?.pode_editar && podeRegistrar) acoes.push('editar');
    if (p?.situacao === 'paga' && p?.recebimento?.pode_estornar && podeEstornar) acoes.push('estornar');
    return acoes;
  }

  /** O que o formulário diz sobre atraso e encargos na data escolhida. */
  function textoDosEncargos(e) {
    if (!e) return { texto: '', somar: false };
    const prorrogado = e.limite && e.vencimento && e.limite !== e.vencimento;
    if (!(Number(e.dias) > 0)) {
      return prorrogado
        ? { texto: `Em dia: o vencimento (${diaBR(e.vencimento)}) caiu em fim de semana ou feriado e vale até ${diaBR(e.limite)}, sem multa nem juros.`, somar: false }
        : { texto: '', somar: false };
    }
    const base = `Pago com ${plural(Number(e.dias), 'dia', 'dias')} de atraso, contados desde o vencimento (${diaBR(e.vencimento)})${prorrogado ? ` — sem encargos só até ${diaBR(e.limite)}` : ''}.`;
    if (!(Number(e.total) > 0)) return { texto: `${base} As regras dos boletos não cobram multa nem juros.`, somar: false };
    const partes = [Number(e.multa) > 0 ? `multa ${moedaBR(e.multa)}` : '', Number(e.juros) > 0 ? `juros ${moedaBR(e.juros)}` : ''].filter(Boolean);
    return { texto: `${base} Pelas regras dos boletos: ${partes.join(' + ')} = ${moedaBR(e.total)}.`, somar: true };
  }

  /**
   * "Pago em ou para quando" (decisão do dono, 24/09/2026): até hoje é o
   * pagamento que entrou; data futura — no máximo o vencimento da parcela — é
   * uma ORDEM DE PAGAMENTO. Devolve o modo e a frase do formulário. Pura.
   */
  function modoDaData(data, { hoje, vencimentoParcela, podeOrdem }) {
    if (!data || !hoje || data <= hoje) return { modo: 'pagamento', texto: '' };
    if (!podeOrdem) return { modo: 'invalida', texto: 'Esta parcela não aceita ordem de pagamento (tem boleto, já venceu ou já está paga): use a data de hoje ou de antes.' };
    if (vencimentoParcela && data > vencimentoParcela) return { modo: 'invalida', texto: `A ordem vai no máximo até o vencimento da parcela (${diaBR(vencimentoParcela)}).` };
    return { modo: 'ordem', texto: `Ordem de pagamento para ${diaBR(data)}: a parcela fica cobrada por esta forma até lá (como um boleto, mas à mão). Quando o cliente pagar, dê a baixa em "Ações"; passou da data sem baixa, ela fica atrasada desde ${diaBR(data)}.` };
  }

  /**
   * A coluna do valor: o que a parcela cobra HOJE e, embaixo, de onde vem
   * (dono, 25/09/2026). Vencida com boleto: o valor cheio, sem o desconto, com
   * a multa e os juros; em dia com desconto: o boleto de valor cheio; e o
   * abatimento, quando há.
   */
  function valorDaParcelaNaTela(p) {
    const e = p?.encargos_hoje;
    const detalhes = [];
    if (Number(p?.abatimento) > 0) detalhes.push(`abatimento de ${moedaBR(p.abatimento)}`);
    if (e && Number(e.total) > 0) {
      detalhes.push(`em dia ${moedaBR(p.a_receber)}; vencido: ${[
        Number(e.desconto_perdido) > 0 ? `sem o desconto de ${moedaBR(e.desconto_perdido)}` : '',
        Number(e.multa) > 0 ? `multa ${moedaBR(e.multa)}` : '', Number(e.juros) > 0 ? `juros ${moedaBR(e.juros)}` : ''
      ].filter(Boolean).join(', ')}`);
      return { principal: moedaBR(p.a_receber_hoje), detalhe: detalhes.join(' · ') };
    }
    if (Number(p?.desconto_condicional) > 0 && Number(p?.valor_boleto) > 0 && p?.boleto_aberto) {
      detalhes.push(`boleto de ${moedaBR(p.valor_boleto)} com desconto até o vencimento`);
    }
    return { principal: moedaBR(p?.a_receber), detalhe: detalhes.join(' · ') };
  }

  /** A mensagem de erro que a tela mostra, pelo status e o corpo da resposta. */
  function mensagemDeErro(status, corpo) {
    if (corpo?.sql_pendente) return corpo?.error || 'Falta rodar sql/cobranca_recebimentos.sql no banco e reiniciar a API.';
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

  const bruto = window.pagamentosParcelasContext;
  const ctx = {
    pedidoId: bruto?.pedidoId ?? window.selectedOrderId ?? null,
    numero: bruto?.numero ? String(bruto.numero) : '',
    cliente: bruto?.cliente ? String(bruto.cliente) : ''
  };
  window.EstadoTrabalho?.registrarContexto?.(overlayId, () => ({ pagamentosParcelasContext: ctx, selectedOrderId: ctx.pedidoId }));

  const el = id => overlay.querySelector(`#${id}`);
  const id = encodeURIComponent(ctx.pedidoId);
  let estado = null;
  let emAndamento = false;
  let fechado = false;
  /** A parcela do formulário aberto (registrar) e a do estorno. */
  let alvo = null;
  let alvoEstorno = null;
  /** O pagamento em edição (o formulário serve para registrar e para editar). */
  let editando = null;
  /** A ordem de pagamento que está recebendo a baixa. */
  let baixando = null;
  let encargosAtuais = null;
  /** Descarta a resposta de encargos que chegou depois de outra data escolhida. */
  let vezDosEncargos = 0;

  function desligarOuvintes() {
    document.removeEventListener('keydown', aoEsc);
    window.removeEventListener('modalFechado', aoFecharModal);
  }
  function fechar() {
    if (fechado) return;
    fechado = true;
    desligarOuvintes();
    if (window.pagamentosParcelasContext === bruto) window.pagamentosParcelasContext = null;
    Modal.close(overlayId);
  }
  function aoEsc(e) {
    if (e.key !== 'Escape') return;
    if (document.querySelector('dialog[open]')) return;
    e.preventDefault();
    if (emAndamento) return;
    // Esc fecha primeiro o formulário aberto; só depois o modal.
    if (alvo || alvoEstorno) fecharPaineis();
    else fechar();
  }
  function aoFecharModal(evento) {
    if (evento?.detail === overlayId) desligarOuvintes();
  }
  document.addEventListener('keydown', aoEsc);
  window.addEventListener('modalFechado', aoFecharModal);
  el('voltarPagamentosParcelas')?.addEventListener('click', () => { if (!emAndamento) fechar(); });
  el('fecharPagamentosParcelas')?.addEventListener('click', () => { if (!emAndamento) fechar(); });

  function exibirMensagem(tipo, texto) {
    const m = el('pagamentosParcelasMensagem');
    m.textContent = texto || '';
    m.style.color = tipo === 'erro' ? 'var(--color-red)' : (tipo === 'ok' ? 'var(--color-green)' : 'var(--color-primary-light)');
    m.classList.toggle('hidden', !texto);
  }

  function avisarQuemEstaAberto(evento) {
    window.dispatchEvent(new CustomEvent(evento, { detail: { pedidoId: ctx.pedidoId } }));
    if (document.getElementById('pedidosTabela')) window.carregarPedidos?.();
  }

  const botao = (elemento, fn) => {
    if (!elemento) return;
    if (typeof window.BotaoAcao?.bind === 'function') window.BotaoAcao.bind(elemento, fn);
    else elemento.addEventListener('click', fn);
  };

  /**
   * O véu de "ação em andamento" da casa, para o trabalho que começa DEPOIS
   * de uma caixa de diálogo (ali nenhum botão fica carregando sozinho).
   */
  const comVeu = (fn, texto) => (typeof window.BotaoAcao?.comCarregamento === 'function'
    ? window.BotaoAcao.comCarregamento(fn, texto)
    : fn());

  // ----------------------------------------------------------- tabela
  function celula(conteudo, classe = 'px-4 py-3 text-left text-white') {
    const td = document.createElement('td');
    td.className = classe;
    if (conteudo instanceof Node) td.appendChild(conteudo);
    else td.textContent = conteudo ?? '';
    return td;
  }

  /** Texto principal com uma linha menor embaixo (a segunda some quando vazia). */
  function duasLinhas(principal, detalhe, classePrincipal = 'text-white') {
    const caixa = document.createElement('div');
    caixa.className = 'flex flex-col gap-1 min-w-0';
    const topo = document.createElement('span');
    topo.className = classePrincipal;
    topo.textContent = principal;
    caixa.appendChild(topo);
    if (detalhe) {
      const baixo = document.createElement('span');
      baixo.className = 'text-xs text-gray-400 break-words';
      baixo.textContent = detalhe;
      caixa.appendChild(baixo);
    }
    return caixa;
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

  function pintarResumo() {
    const r = estado?.resumo;
    const parcelas = Array.isArray(estado?.parcelas) ? estado.parcelas : [];
    el('pagamentosParcelasResumo').classList.toggle('hidden', !r || !parcelas.length);
    const tag = el('pagamentosParcelasTag');
    tag.classList.toggle('hidden', !r || !parcelas.length);
    if (!r || !parcelas.length) return;
    const abertas = parcelas.filter(p => p.situacao === 'aberta' || p.situacao === 'atrasada').length;
    el('pagamentosParcelasRecebido').textContent = moedaBR(r.recebido);
    el('pagamentosParcelasRecebidoDetalhe').textContent = `${r.pagas} de ${plural(r.parcelas, 'parcela paga', 'parcelas pagas')}`;
    el('pagamentosParcelasAberto').textContent = moedaBR(r.em_aberto);
    el('pagamentosParcelasAbertoDetalhe').textContent = abertas ? plural(abertas, 'parcela', 'parcelas') : 'nada em aberto';
    el('pagamentosParcelasAtrasadas').textContent = String(r.atrasadas);
    el('pagamentosParcelasAtrasadasDetalhe').textContent = r.atrasadas ? 'o atraso conta desde o vencimento' : 'nenhuma em atraso';
    tag.className = `justify-self-end ${r.pagas === r.parcelas ? 'badge-success' : 'badge-neutral'} px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap`;
    tag.textContent = `${r.pagas}/${r.parcelas} pagas`;
  }

  function pintarParcelas() {
    const secao = el('pagamentosParcelasSecao');
    const tbody = el('pagamentosParcelasTabela').querySelector('tbody');
    tbody.replaceChildren();
    secao.classList.toggle('hidden', !estado);
    if (!estado) return;
    const parcelas = Array.isArray(estado.parcelas) ? estado.parcelas : [];
    const podeRegistrar = pode('financeiro.recebimento.registrar');
    const podeEstornar = pode('financeiro.recebimento.estornar');
    const motivo = el('pagamentosParcelasMotivo');
    const texto = !parcelas.length ? 'O pedido não tem parcelas cadastradas.'
      : (estado.pedido?.cancelado ? 'Pedido cancelado não recebe pagamento; o que já foi registrado ainda pode ser estornado.'
        : (!podeRegistrar ? 'Registrar pagamento pede a permissão de registrar recebimentos.' : ''));
    motivo.textContent = texto;
    motivo.classList.toggle('hidden', !texto);

    for (const p of parcelas) {
      const tr = document.createElement('tr');
      const venc = textoDoVencimento(p);
      const sit = situacaoDaParcela(p);
      const conteudo = document.createElement('div');
      conteudo.className = 'flex flex-col gap-1 min-w-0';
      const tag = document.createElement('span');
      tag.className = `${sit.classe} px-3 py-1 rounded-full text-xs font-medium self-start max-w-full truncate`;
      tag.textContent = sit.texto;
      tag.title = sit.texto;
      conteudo.appendChild(tag);
      if (sit.detalhe) {
        const detalhe = document.createElement('span');
        detalhe.className = 'text-xs text-gray-400 break-words';
        detalhe.textContent = sit.detalhe;
        conteudo.appendChild(detalhe);
      }

      const acoes = document.createElement('div');
      acoes.className = 'flex items-center justify-center gap-1';
      const FAZ = {
        registrar: () => iconeDeAcao('fa-hand-holding-usd', 'Registrar o pagamento desta parcela', 'var(--color-green)', () => abrirRegistro(p)),
        editar: () => iconeDeAcao('fa-edit', 'Editar este pagamento (data, valor, forma)', 'var(--color-primary)', () => abrirRegistro(p, p.recebimento)),
        baixar: () => iconeDeAcao('fa-check-circle', 'Dar baixa: o cliente pagou esta ordem', 'var(--color-green)', () => abrirRegistro(p, null, p.ordem)),
        cancelar_ordem: () => iconeDeAcao('fa-ban', 'Cancelar a ordem de pagamento', 'var(--color-red)', () => cancelarOrdem(p)),
        estornar: () => iconeDeAcao('fa-undo', 'Estornar este pagamento', 'var(--color-red)', () => abrirEstorno(p))
      };
      for (const acao of acoesDaParcela(p, { podeRegistrar, podeEstornar })) acoes.appendChild(FAZ[acao]());
      if (!acoes.childElementCount) {
        acoes.classList.add('text-gray-500');
        acoes.textContent = '—';
      }
      tr.append(
        celula(p.numero_parcela ? `${p.numero_parcela}ª` : '—'),
        celula(duasLinhas(venc.principal, venc.detalhe), 'px-4 py-3 text-left'),
        celula((v => duasLinhas(v.principal, v.detalhe))(valorDaParcelaNaTela(p)), 'px-4 py-3 text-left'),
        celula(conteudo, 'px-4 py-3 text-left min-w-0'),
        celula(acoes, 'px-4 py-3 text-center')
      );
      tbody.appendChild(tr);
    }
  }

  // ------------------------------------------------------- registrar
  function fecharPaineis() {
    alvo = null;
    alvoEstorno = null;
    editando = null;
    baixando = null;
    encargosAtuais = null;
    vezDosEncargos += 1;
    el('pagamentosParcelasForm').classList.add('hidden');
    el('pagamentosParcelasEstorno').classList.add('hidden');
  }

  function mostrarPainel(painel, foco) {
    painel.classList.remove('hidden');
    painel.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    foco?.focus?.();
  }

  /** O formulário: registrar um pagamento novo ou, com `recebimento`, editar o que foi lançado à mão. */
  function abrirRegistro(p, recebimento = null, ordem = null) {
    if (emAndamento) return;
    fecharPaineis();
    exibirMensagem('', '');
    alvo = p;
    editando = recebimento;
    baixando = ordem;
    el('pagamentosParcelasFormTituloTexto').textContent = editando
      ? `Editar o pagamento da ${p.numero_parcela}ª parcela`
      : (baixando ? `Dar baixa na ordem de pagamento da ${p.numero_parcela}ª parcela` : `Registrar o pagamento da ${p.numero_parcela}ª parcela`);
    el('pagamentosParcelasRegistrar').textContent = editando ? 'Salvar alteração' : (baixando ? 'Dar baixa' : 'Registrar pagamento');
    el('pagamentosParcelasFormContexto').textContent = `vence ${diaBR(p.vencimento)} · ${moedaBR(p.a_receber)}`;
    const aviso = el('pagamentosParcelasAvisoBoleto');
    const textoAviso = editando ? '' : baixando
      ? `Ordem de ${baixando.forma || 'pagamento'} para ${diaBR(baixando.data)}, de ${moedaBR(baixando.valor)}: confirme o dia em que o cliente pagou, o valor e a forma.`
      : p.boleto_aberto
      ? `Esta parcela tem boleto do BB em aberto${p.boleto?.nosso_numero ? ` (nº ${p.boleto.nosso_numero})` : ''}. Ao registrar, o app pergunta se pode baixá-lo no BB como "quitado por fora" — assim o cliente não paga duas vezes.`
      : (p.boleto_externo ? 'O boleto de fora desta parcela fica só como registro: quem cobra é o banco que o emitiu.' : '');
    aviso.textContent = textoAviso;
    aviso.classList.toggle('hidden', !textoAviso);

    const data = el('pagamentosParcelasData');
    // Registrar de verdade vai até hoje; a ordem de pagamento, até o vencimento da parcela.
    const aceitaOrdem = !editando && !baixando && Boolean(p.pode_ordem);
    data.max = aceitaOrdem && p.vencimento_parcela ? p.vencimento_parcela : (estado?.hoje || '');
    data.value = estado?.hoje || '';
    const forma = el('pagamentosParcelasForma');
    forma.replaceChildren();
    const vazio = document.createElement('option');
    vazio.value = '';
    vazio.textContent = 'Selecione';
    forma.appendChild(vazio);
    for (const f of Array.isArray(estado?.formas) ? estado.formas : []) {
      const o = document.createElement('option');
      o.value = f;
      o.textContent = f;
      forma.appendChild(o);
    }
    const formaInicial = editando?.forma || baixando?.forma || '';
    forma.value = formaInicial && [...forma.options].some(o => o.value === formaInicial) ? formaInicial : '';
    el('pagamentosParcelasValor').value = numeroBR(editando ? editando.valor : (baixando ? baixando.valor : p.a_receber));
    el('pagamentosParcelasObservacao').value = editando?.observacao || baixando?.observacao || '';
    if (editando?.data) data.value = editando.data;
    mostrarPainel(el('pagamentosParcelasForm'), forma);
    atualizarEncargos();
  }

  async function atualizarEncargos() {
    const caixa = el('pagamentosParcelasEncargos');
    const somar = el('pagamentosParcelasSomarEncargos');
    const vez = ++vezDosEncargos;
    encargosAtuais = null;
    const data = el('pagamentosParcelasData').value;
    if (!alvo || !data) { caixa.classList.add('hidden'); return; }
    // Data futura: é uma ordem de pagamento (sem atraso nem encargos).
    const modo = editando || baixando ? { modo: 'pagamento' } : modoDaData(data, { hoje: estado?.hoje, vencimentoParcela: alvo.vencimento_parcela, podeOrdem: alvo.pode_ordem });
    el('pagamentosParcelasRegistrar').textContent = editando ? 'Salvar alteração' : (baixando ? 'Dar baixa' : (modo.modo === 'ordem' ? 'Agendar pagamento' : 'Registrar pagamento'));
    if (modo.modo !== 'pagamento') {
      el('pagamentosParcelasEncargosTexto').textContent = modo.texto;
      caixa.classList.remove('hidden');
      somar.classList.add('hidden');
      return;
    }
    try {
      const resp = await fetchApi(`/api/cobranca/pedidos/${id}/pagamentos/encargos?numero_parcela=${encodeURIComponent(alvo.numero_parcela)}&data=${encodeURIComponent(data)}`);
      const corpo = await resp.json().catch(() => null);
      if (vez !== vezDosEncargos) return;
      if (!resp.ok) { caixa.classList.add('hidden'); return; }
      encargosAtuais = corpo;
      const t = textoDosEncargos(corpo);
      el('pagamentosParcelasEncargosTexto').textContent = t.texto;
      caixa.classList.toggle('hidden', !t.texto);
      somar.classList.toggle('hidden', !t.somar);
      if (t.somar) somar.textContent = `Somar encargos (${moedaBR(corpo.com_encargos)})`;
    } catch (_) {
      if (vez === vezDosEncargos) caixa.classList.add('hidden');
    }
  }
  el('pagamentosParcelasData')?.addEventListener('change', atualizarEncargos);
  el('pagamentosParcelasSomarEncargos')?.addEventListener('click', () => {
    if (encargosAtuais?.com_encargos) el('pagamentosParcelasValor').value = numeroBR(encargosAtuais.com_encargos);
  });
  el('pagamentosParcelasValor')?.addEventListener('blur', e => {
    const v = lerValor(e.target.value);
    if (v !== null) e.target.value = numeroBR(v);
  });
  el('pagamentosParcelasCancelarForm')?.addEventListener('click', () => { if (!emAndamento) fecharPaineis(); });

  async function registrar() {
    if (emAndamento || !alvo) return;
    exibirMensagem('', '');
    const p = alvo;
    const data = el('pagamentosParcelasData').value;
    const forma = el('pagamentosParcelasForma').value;
    const valor = lerValor(el('pagamentosParcelasValor').value);
    const observacao = el('pagamentosParcelasObservacao').value.trim();
    if (!data) { exibirMensagem('erro', 'Informe o dia em que o cliente pagou (ou para quando é o pagamento).'); return; }
    const modo = editando || baixando ? { modo: 'pagamento' } : modoDaData(data, { hoje: estado?.hoje, vencimentoParcela: p.vencimento_parcela, podeOrdem: p.pode_ordem });
    if (modo.modo === 'invalida') { exibirMensagem('erro', modo.texto); return; }
    if (modo.modo === 'pagamento' && estado?.hoje && data > estado.hoje) { exibirMensagem('erro', 'O dia do pagamento não pode ser futuro.'); return; }
    if (!forma) { exibirMensagem('erro', 'Diga como o cliente pagou (Pix, cartão, transferência…).'); return; }
    if (!(valor > 0)) { exibirMensagem('erro', 'Informe o valor.'); return; }

    if (editando) {
      await salvarEdicao(p, editando, { data, forma, valor, observacao });
      return;
    }
    if (baixando) {
      await darBaixa(p, baixando, { data, forma, valor, observacao });
      return;
    }
    if (modo.modo === 'ordem') {
      await agendar(p, { data, forma, valor, observacao });
      return;
    }

    let baixar = false;
    if (p.boleto_aberto) {
      if (!pode('financeiro.boleto.baixa')) {
        exibirMensagem('erro', 'Esta parcela tem boleto do BB em aberto: registrar o pagamento por fora pede também a permissão de baixar boletos.');
        return;
      }
      const ok = await window.DialogPadrao?.confirm?.({
        title: 'Baixar o boleto no BB?', tom: 'aviso', icone: 'fa-barcode',
        subtitle: `Pedido ${ctx.numero} · parcela ${p.numero_parcela}`,
        secoes: [{ titulo: 'O boleto em aberto', itens: [{ rotulo: p.boleto?.nosso_numero ? `Nº ${p.boleto.nosso_numero}` : 'Boleto do BB', valor: moedaBR(p.a_receber), detalhe: `vence ${diaBR(p.vencimento)}` }] }],
        nota: `O cliente pagou por ${forma}. O boleto é baixado no Banco do Brasil como "quitado por fora" e o pagamento fica registrado — assim ele não pode ser pago de novo nem ir a protesto.`,
        confirmText: 'Baixar e registrar'
      });
      if (!ok) return;
      baixar = true;
    }

    emAndamento = true;
    try {
      await comVeu(async () => {
        const envio = {
          pedido_id: Number(ctx.pedidoId), numero_parcela: p.numero_parcela,
          data_recebimento: data, valor_recebido: valor, forma, observacao,
          ...(baixar ? { baixar_boleto: true } : {})
        };
        const resp = await fetchApi('/api/cobranca/recebimentos', comoJson(envio));
        const corpo = await resp.json().catch(() => null);
        if (!resp.ok) { exibirMensagem('erro', mensagemDeErro(resp.status, corpo)); return; }
        window.showToast?.(`Pagamento da ${p.numero_parcela}ª parcela registrado.`, 'success');
        avisarQuemEstaAberto('recebimentos:alterados');
        if (baixar) avisarQuemEstaAberto('boletos:alterados');
        fecharPaineis();
        await carregar();
        const avisos = (Array.isArray(corpo?.avisos) ? corpo.avisos : []).filter(Boolean);
        exibirMensagem(avisos.length ? 'aviso' : 'ok', avisos.length
          ? avisos.join(' · ')
          : `Pagamento da ${p.numero_parcela}ª parcela registrado — entra na comissão de ${rotuloDoMes(data)}.`);
      }, baixar ? 'Baixando o boleto no BB e registrando o pagamento...' : 'Registrando o pagamento...');
    } catch (_) {
      exibirMensagem('erro', 'Não foi possível falar com o servidor. Reabra o modal para conferir o que foi gravado.');
    } finally {
      emAndamento = false;
    }
  }
  botao(el('pagamentosParcelasRegistrar'), registrar);

  /** Cria a ordem de pagamento (POST /api/cobranca/pedidos/:id/ordens). */
  async function agendar(p, { data, forma, valor, observacao }) {
    emAndamento = true;
    try {
      const resp = await fetchApi(`/api/cobranca/pedidos/${id}/ordens`, comoJson({ numero_parcela: p.numero_parcela, data_prevista: data, valor, forma, observacao }));
      const corpo = await resp.json().catch(() => null);
      if (!resp.ok) { exibirMensagem('erro', corpo?.sql_pendente ? 'Falta rodar sql/ordens_pagamento.sql no banco e reiniciar a API.' : mensagemDeErro(resp.status, corpo)); return; }
      window.showToast?.(`Ordem de pagamento da ${p.numero_parcela}ª parcela para ${diaBR(data)}.`, 'success');
      avisarQuemEstaAberto('recebimentos:alterados');
      fecharPaineis();
      await carregar();
      exibirMensagem('ok', `Ordem de ${forma} para ${diaBR(data)} registrada na ${p.numero_parcela}ª parcela. Dê a baixa quando o cliente pagar.`);
    } catch (_) {
      exibirMensagem('erro', 'Não foi possível falar com o servidor. Reabra o modal para conferir o que foi gravado.');
    } finally {
      emAndamento = false;
    }
  }

  /** O cliente pagou a ordem: vira recebimento (POST /api/cobranca/ordens/:id/baixar). */
  async function darBaixa(p, o, { data, forma, valor, observacao }) {
    emAndamento = true;
    try {
      const resp = await fetchApi(`/api/cobranca/ordens/${encodeURIComponent(o.id)}/baixar`, comoJson({ data_recebimento: data, valor_recebido: valor, forma, observacao }));
      const corpo = await resp.json().catch(() => null);
      if (!resp.ok) { exibirMensagem('erro', mensagemDeErro(resp.status, corpo)); return; }
      window.showToast?.(`Baixa da ordem da ${p.numero_parcela}ª parcela registrada.`, 'success');
      avisarQuemEstaAberto('recebimentos:alterados');
      fecharPaineis();
      await carregar();
      exibirMensagem('ok', `Ordem baixada: pagamento da ${p.numero_parcela}ª parcela registrado — entra na comissão de ${rotuloDoMes(data)}.`);
    } catch (_) {
      exibirMensagem('erro', 'Não foi possível falar com o servidor. Reabra o modal para conferir o que foi gravado.');
    } finally {
      emAndamento = false;
    }
  }

  /** Cancela a ordem (a parcela volta a ficar livre para boleto ou outra ordem). */
  async function cancelarOrdem(p) {
    const o = p?.ordem;
    if (!o || emAndamento) return;
    const ok = await window.DialogPadrao?.confirm?.({
      title: 'Cancelar a ordem de pagamento?', tom: 'aviso', icone: 'fa-ban',
      subtitle: `Pedido ${ctx.numero} · parcela ${p.numero_parcela}`,
      secoes: [{ titulo: 'A ordem', itens: [{ rotulo: o.forma || 'Pagamento', valor: moedaBR(o.valor), detalhe: `para ${diaBR(o.data)}` }] }],
      nota: 'A parcela volta a ficar em aberto, pelo vencimento dela, e pode receber boleto ou outra ordem.',
      confirmText: 'Cancelar a ordem', confirmVariant: 'danger'
    });
    if (!ok) return;
    emAndamento = true;
    try {
      await comVeu(async () => {
        const resp = await fetchApi(`/api/cobranca/ordens/${encodeURIComponent(o.id)}/cancelar`, comoJson({}));
        const corpo = await resp.json().catch(() => null);
        if (!resp.ok) { exibirMensagem('erro', mensagemDeErro(resp.status, corpo)); return; }
        window.showToast?.('Ordem de pagamento cancelada.', 'success');
        avisarQuemEstaAberto('recebimentos:alterados');
        fecharPaineis();
        await carregar();
      }, 'Cancelando a ordem...');
    } catch (_) {
      exibirMensagem('erro', 'Não foi possível falar com o servidor. Reabra o modal para conferir.');
    } finally {
      emAndamento = false;
    }
  }

  /** Grava a edição do pagamento lançado à mão (PUT /api/cobranca/recebimentos/:id). */
  async function salvarEdicao(p, r, { data, forma, valor, observacao }) {
    emAndamento = true;
    try {
      const resp = await fetchApi(`/api/cobranca/recebimentos/${encodeURIComponent(r.id)}`, comoJson({ data_recebimento: data, valor_recebido: valor, forma, observacao }, 'PUT'));
      const corpo = await resp.json().catch(() => null);
      if (!resp.ok) { exibirMensagem('erro', mensagemDeErro(resp.status, corpo)); return; }
      window.showToast?.(`Pagamento da ${p.numero_parcela}ª parcela atualizado.`, 'success');
      avisarQuemEstaAberto('recebimentos:alterados');
      fecharPaineis();
      await carregar();
      exibirMensagem('ok', `Pagamento da ${p.numero_parcela}ª parcela atualizado — conta na comissão de ${rotuloDoMes(data)}.`);
    } catch (_) {
      exibirMensagem('erro', 'Não foi possível falar com o servidor. Reabra o modal para conferir o que foi gravado.');
    } finally {
      emAndamento = false;
    }
  }

  // --------------------------------------------------------- estornar
  function abrirEstorno(p) {
    if (emAndamento || !p?.recebimento) return;
    fecharPaineis();
    exibirMensagem('', '');
    alvoEstorno = p;
    const r = p.recebimento;
    el('pagamentosParcelasEstornoTituloTexto').textContent = `Estornar o pagamento da ${p.numero_parcela}ª parcela`;
    el('pagamentosParcelasEstornoTexto').textContent = `${moedaBR(r.valor)} pago em ${diaBR(r.data)}${r.forma ? ` por ${r.forma}` : ''} (${r.origem_rotulo}). `
      + 'A parcela volta a ficar em aberto e sai da comissão; se a comissão do mês já foi fechada, o estorno entra como ajuste no próximo fechamento.'
      + (r.origem === 'quitado_por_fora' ? ' O boleto baixado continua baixado, e a parcela pode ganhar um boleto novo.' : '');
    el('pagamentosParcelasMotivoEstorno').value = '';
    mostrarPainel(el('pagamentosParcelasEstorno'), el('pagamentosParcelasMotivoEstorno'));
  }
  el('pagamentosParcelasVoltarEstorno')?.addEventListener('click', () => { if (!emAndamento) fecharPaineis(); });

  async function estornar() {
    if (emAndamento || !alvoEstorno?.recebimento) return;
    exibirMensagem('', '');
    const p = alvoEstorno;
    const motivo = el('pagamentosParcelasMotivoEstorno').value.trim();
    if (motivo.length < 5) { exibirMensagem('erro', 'Diga o motivo do estorno (ao menos 5 letras).'); return; }
    emAndamento = true;
    try {
      await comVeu(async () => {
        const resp = await fetchApi(`/api/cobranca/recebimentos/${encodeURIComponent(p.recebimento.id)}/estornar`, comoJson({ motivo }));
        const corpo = await resp.json().catch(() => null);
        if (!resp.ok) { exibirMensagem('erro', mensagemDeErro(resp.status, corpo)); return; }
        window.showToast?.('Pagamento estornado.', 'success');
        avisarQuemEstaAberto('recebimentos:alterados');
        fecharPaineis();
        await carregar();
        exibirMensagem('ok', `Pagamento da ${p.numero_parcela}ª parcela estornado: ela voltou a ficar em aberto.`);
      }, 'Estornando o pagamento...');
    } catch (_) {
      exibirMensagem('erro', 'Não foi possível falar com o servidor. Reabra o modal para conferir o que foi gravado.');
    } finally {
      emAndamento = false;
    }
  }
  botao(el('pagamentosParcelasConfirmarEstorno'), estornar);

  // ---------------------------------------------------------- leitura
  async function carregar() {
    let resp = null;
    let corpo = null;
    try {
      resp = await fetchApi(`/api/cobranca/pedidos/${id}/pagamentos`);
      corpo = await resp.json().catch(() => null);
    } catch (_) {
      resp = null;
    }
    el('pagamentosParcelasCarregando').classList.add('hidden');
    estado = resp?.ok ? corpo : null;
    if (estado?.pedido?.numero) ctx.numero = String(estado.pedido.numero);
    el('pagamentosParcelasSubtitulo').textContent = [ctx.numero ? `Pedido ${ctx.numero}` : '', estado?.pedido?.cliente || ctx.cliente].filter(Boolean).join(' · ');
    pintarResumo();
    pintarParcelas();
    if (!resp) exibirMensagem('erro', 'Não foi possível falar com o servidor.');
    else if (!resp.ok) exibirMensagem('erro', mensagemDeErro(resp.status, corpo));
    else if (estado?.sql_pendente) exibirMensagem('erro', 'Falta rodar sql/cobranca_recebimentos.sql no banco e reiniciar a API.');
  }

  // Revela só depois da PRIMEIRA leitura (spinner de quem abriu, Modal.openWithSpinner).
  const revelar = () => {
    overlay.classList.remove('hidden');
    overlay.removeAttribute('aria-hidden');
    window.Modal?.signalReady?.(overlayId);
  };
  Promise.resolve(carregar())
    .catch(erro => console.error('[pedido] falha ao carregar o modal', overlayId, erro))
    .finally(revelar);
})();
