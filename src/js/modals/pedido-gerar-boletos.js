/**
 * Modal "Gerar boletos".
 *
 * Lê GET /api/cobranca/pedidos/:id/boletos (parcelas com o boleto de cada
 * uma e o que impede gerar), deixa marcar as parcelas sem boleto vivo e
 * registra no Banco do Brasil por POST /api/cobranca/pedidos/:id/boletos.
 * O resultado sai parcela a parcela: uma recusa do BB não impede as outras.
 * Nada vai para o cliente. Com as parcelas registradas, o PDF sai por linha
 * ("PDF") ou de todas ("Boletos (PDF)"), e o "Gerar boletos" some.
 * Fase D: "Detalhes" abre o boleto por cima (consultar, prorrogar,
 * abatimento, baixar) e "Consultar no BB" atualiza todos os a pagar; o
 * título vira "Boletos do pedido" quando não há o que gerar.
 *
 * Contexto: `window.gerarBoletosContext = { pedidoId, numero, cliente }`.
 */
(() => {
  const overlayId = 'gerarBoletos';
  const overlay = document.getElementById('gerarBoletosOverlay');
  if (!overlay) return;

  // ------------------------------------------------------ funções puras
  const ROTULO_STATUS = {
    registrado: ['badge-success', 'Registrado'], pago: ['badge-success', 'Pago'], baixado: ['badge-neutral', 'Baixado'], vencido: ['badge-warning', 'Vencido'],
    protestado: ['badge-danger', 'Protestado'], erro: ['badge-danger', 'Erro no BB'], reservado: ['badge-warning', 'Reservado']
  };

  const MOTIVOS_BAIXA = { quitado_por_fora: 'quitado por fora', cancelado: 'cancelado', reemissao: 'reemissão', banco: 'pelo banco' };
  const diaCurto = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };

  /** Como a parcela aparece: se pode ser marcada, e a tag do boleto que ela tem. */
  function linhaDaParcela(l) {
    // Já paga (Pix, cartão…) e sem boleto: não se marca — só depois de
    // estornar o pagamento em "Pagamentos" (decisão do dono, 24/09/2026).
    // Ordem de pagamento aberta (Pix, cartão… para uma data): também não se marca.
    if (l?.ordem && !l?.recebimento && !l?.tem_boleto_vivo && !l?.boleto_externo) {
      const o = l.ordem;
      return {
        id: l?.parcela?.id ?? null, numero: l?.parcela?.numero_parcela ?? null,
        vencimento: String(l?.parcela?.data_vencimento || '').slice(0, 10), valor: Number(l?.parcela?.valor) || 0,
        podeGerar: false, temPdf: false, temDetalhe: false, boletoId: null,
        classe: 'badge-info', rotulo: `Ordem${o.forma ? ` · ${o.forma}` : ''}`,
        detalhe: [o.data ? `para ${diaCurto(o.data)}` : '', 'para gerar boleto, cancele a ordem em "Pagamentos"'].filter(Boolean).join(' · ')
      };
    }
    if (l?.recebimento && !l?.tem_boleto_vivo && !l?.boleto_externo) {
      const r = l.recebimento;
      return {
        id: l?.parcela?.id ?? null, numero: l?.parcela?.numero_parcela ?? null,
        vencimento: String(l?.parcela?.data_vencimento || '').slice(0, 10), valor: Number(l?.parcela?.valor) || 0,
        podeGerar: false, temPdf: false, temDetalhe: false, boletoId: null,
        classe: 'badge-success', rotulo: `Paga${r.forma ? ` · ${r.forma}` : ''}`,
        detalhe: [r.data ? `em ${diaCurto(r.data)}` : '', 'para gerar boleto, estorne o pagamento em "Pagamentos"'].filter(Boolean).join(' · ')
      };
    }
    // Boleto emitido fora e informado: a parcela já está cobrada, não se marca.
    if (l?.boleto_externo && !l?.tem_boleto_vivo) {
      const e = l.boleto_externo;
      return {
        id: l?.parcela?.id ?? null, numero: l?.parcela?.numero_parcela ?? null,
        vencimento: String(l?.parcela?.data_vencimento || '').slice(0, 10), valor: Number(l?.parcela?.valor) || 0,
        podeGerar: false, temPdf: false, temDetalhe: false, boletoId: null,
        classe: 'badge-info', rotulo: `Boleto de fora${e.banco_nome ? ` · ${e.banco_nome}` : ''}`,
        detalhe: [e.vencimento ? `vence ${diaCurto(e.vencimento)}` : '', e.linha_impressa || e.linha_digitavel || ''].filter(Boolean).join(' · ')
      };
    }
    const b = l?.boleto || null;
    const [classe, rotuloBase] = b ? (ROTULO_STATUS[b.status] || ['badge-neutral', String(b.status || '')]) : ['badge-neutral', 'Sem boleto'];
    const rotulo = b?.status === 'baixado' && MOTIVOS_BAIXA[b.motivo_baixa] ? `${rotuloBase} · ${MOTIVOS_BAIXA[b.motivo_baixa]}` : rotuloBase;
    const vencParcela = String(l?.parcela?.data_vencimento || '').slice(0, 10);
    const vencBoleto = String(b?.data_vencimento || '').slice(0, 10);
    const abatimento = Number(b?.valor_abatimento) || 0;
    const reais = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const extras = [];
    // O boleto que vale pode vencer em outra data (prorrogação, reemissão) e ter abatimento.
    if (l?.tem_boleto_vivo && vencBoleto && vencBoleto !== vencParcela) extras.push(`vence ${diaCurto(vencBoleto)}`);
    if (l?.tem_boleto_vivo && abatimento > 0) extras.push(`abatimento ${reais(abatimento)}`);
    // Valor cheio com desconto até o vencimento (decisões do dono, 25/09/2026).
    const descontoDoBoleto = Number(b?.valor_desconto) || 0;
    if (l?.tem_boleto_vivo && descontoDoBoleto > 0) {
      extras.push(`boleto de ${reais(b.valor)} com desconto de ${reais(descontoDoBoleto)} até ${diaCurto(b.desconto_ate || vencBoleto)}`);
    }
    const descontoNovo = Number(l?.desconto_condicional) || 0;
    const valorParcela = Number(l?.parcela?.valor) || 0;
    const aviso = !l?.tem_boleto_vivo && descontoNovo > 0
      ? `o boleto sai com ${reais(valorParcela + descontoNovo)} e desconto de ${reais(descontoNovo)} até o vencimento`
      : '';
    // Boleto cancelado: a parcela está livre de novo (decisão do dono, 06/10/2026).
    const cancelado = !l?.tem_boleto_vivo && Boolean(l?.cancelado)
      ? 'boleto cancelado: marque para gerar um novo — com a data e o valor que quiser'
      : '';
    return {
      id: l?.parcela?.id ?? null,
      numero: l?.parcela?.numero_parcela ?? null,
      vencimento: vencParcela,
      valor: Number(l?.parcela?.valor) || 0,
      // A parte da parcela no desconto até o vencimento (acompanha o valor escolhido).
      desconto: descontoNovo,
      // Quem emitiu, quem registrou o pagamento, se foi automático (o balão da etiqueta).
      auditoria: Array.isArray(l?.auditoria) ? l.auditoria.filter(Boolean) : [],
      podeGerar: !l?.tem_boleto_vivo,
      // Tem o que imprimir: registrado, vencido ou em protesto (pago e baixado não se pagam mais).
      temPdf: Boolean(b && ['registrado', 'vencido', 'protestado'].includes(String(b.status))),
      // Tem o que ver: todo boleto que passou pelo BB (reservado ainda não passou).
      temDetalhe: Boolean(b?.id) && String(b?.status) !== 'reservado',
      boletoId: b?.id ?? null,
      classe, rotulo,
      detalhe: [
        b ? (b.status === 'erro' ? (b.erro || '') : [b.nosso_numero ? `${b.nosso_numero}${b.nosso_numero_dv ? `-${b.nosso_numero_dv}` : ''}` : '', b.linha_digitavel || '', ...extras].filter(Boolean).join(' · ')) : '',
        cancelado,
        aviso
      ].filter(Boolean).join(' · ')
    };
  }

  /** '3.326,51', 'R$ 3.326,51' ou '3326.51' → 3326.51; vazio ou inválido → null. Pura. */
  function lerValor(texto) {
    const limpo = String(texto ?? '').replace(/[^\d.,]/g, '');
    if (!limpo) return null;
    const normal = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
    const n = Number(normal);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }

  /**
   * O que a tela manda quando a data ou o valor das parcelas marcadas mudam
   * (06/10/2026) e se o total do pedido muda junto — a mesma conta do backend
   * (cobranca/boletos.conferirAjustes): diferença até R$ 0,02 é arredondamento.
   * `edicoes`: id → { vencimento, valor (texto) }. Pura.
   */
  function planoDaTela(estado, edicoes, marcadas) {
    const centavos = v => Math.round(Number(v || 0) * 100) / 100;
    const linhas = (estado?.parcelas || []).map(linhaDaParcela);
    const ajustes = {};
    const mudancas = [];
    const erros = [];
    const hoje = String(estado?.hoje || '').slice(0, 10);
    let soma = 0;
    for (const l of linhas) {
      const e = edicoes?.get?.(l.id);
      const marcada = (marcadas || []).includes(Number(l.id));
      let valor = centavos(l.valor);
      if (marcada && e) {
        const vencimento = String(e.vencimento || l.vencimento || '').slice(0, 10);
        const lido = e.valor === undefined ? l.valor : lerValor(e.valor);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) erros.push(`Informe o vencimento da ${l.numero}ª parcela.`);
        else if (hoje && vencimento < hoje) erros.push(`O vencimento da ${l.numero}ª parcela já passou: escolha hoje ou uma data à frente.`);
        if (!(lido > 0)) erros.push(`Informe o valor da ${l.numero}ª parcela.`);
        const novo = lido > 0 ? centavos(lido) : valor;
        const mudouData = vencimento !== l.vencimento;
        const mudouValor = Math.abs(novo - valor) > 0.005;
        if (mudouData || mudouValor) {
          ajustes[l.id] = { vencimento, valor: novo };
          mudancas.push({ numero: l.numero, mudouData, mudouValor, antes: { vencimento: l.vencimento, valor }, vencimento, valor: novo });
        }
        valor = novo;
      }
      soma = centavos(soma + valor);
    }
    const total = centavos(estado?.pedido?.valor_final);
    const ajusteAntes = centavos(estado?.pedido?.ajuste_valor);
    const itens = centavos(total - ajusteAntes);
    const diferenca = centavos(soma - itens);
    const ajuste = Math.abs(diferenca) <= 0.02 ? 0 : diferenca;
    const mudaTotal = mudancas.some(m => m.mudouValor) && Math.abs(ajuste - ajusteAntes) > 0.005;
    return { ajustes, mudancas, erros, soma, total, itens, ajuste, mudaTotal, totalDepois: ajuste ? soma : itens };
  }

  /** "2ª: vencimento 12/10/2026 → 20/10/2026 · valor R$ 1,00 → R$ 2,00". Pura. */
  function textoDaMudanca(m) {
    const reais = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const partes = [];
    if (m.mudouData) partes.push(`vencimento ${diaCurto(m.antes.vencimento)} → ${diaCurto(m.vencimento)}`);
    if (m.mudouValor) partes.push(`valor ${reais(m.antes.valor)} → ${reais(m.valor)}`);
    return `${m.numero}ª parcela: ${partes.join(' · ')}`;
  }

  /** O aviso depois de gerar: quantos saíram, quantos já existiam, quantos deram erro. */
  function resumoDosResultados(corpo) {
    const registrados = Number(corpo?.registrados) || 0;
    const erros = Number(corpo?.erros) || 0;
    const jaExistiam = (corpo?.resultados || []).filter(r => r?.ja_existia).length;
    const partes = [];
    if (registrados) partes.push(registrados === 1 ? '1 boleto registrado no BB' : `${registrados} boletos registrados no BB`);
    if (jaExistiam) partes.push(jaExistiam === 1 ? '1 já existia' : `${jaExistiam} já existiam`);
    if (erros) partes.push(erros === 1 ? '1 com erro' : `${erros} com erro`);
    if (!partes.length) partes.push('Nenhum boleto para gerar');
    return { texto: `${partes.join(' · ')}.`, tipo: erros ? 'error' : (registrados ? 'success' : 'info') };
  }

  /** O rodapé: gerar só quando há parcela sem boleto; PDF e consulta ao BB quando há boleto a pagar. */
  function estadoDoRodape(estado) {
    const linhas = (estado?.parcelas || []).map(linhaDaParcela);
    const faltam = linhas.filter(l => l.podeGerar).length;
    const comPdf = linhas.filter(l => l.temPdf).length;
    const mostrarGerar = Boolean(estado?.pode_gerar) && faltam > 0;
    return {
      mostrarGerar,
      mostrarPdf: comPdf > 0,
      mostrarConsultar: comPdf > 0,
      titulo: faltam > 0 || !linhas.length ? 'Gerar boletos' : 'Boletos do pedido',
      aviso: linhas.length && faltam === 0 ? 'Todas as parcelas já têm boleto registrado.' : ''
    };
  }

  /** O aviso depois de consultar o pedido no BB. */
  function resumoDaConsulta(corpo) {
    const consultados = Number(corpo?.consultados) || 0;
    const mudaram = Number(corpo?.mudaram) || 0;
    const erros = Number(corpo?.erros) || 0;
    if (!consultados && !erros) return { texto: 'Nenhum boleto a pagar para consultar.', tipo: 'info' };
    const partes = [consultados === 1 ? '1 boleto consultado no BB' : `${consultados} boletos consultados no BB`];
    partes.push(mudaram ? (mudaram === 1 ? '1 mudou de situação' : `${mudaram} mudaram de situação`) : 'nenhuma mudança');
    if (erros) partes.push(erros === 1 ? '1 com erro' : `${erros} com erro`);
    return { texto: `${partes.join(' · ')}.`, tipo: erros ? 'error' : 'success' };
  }

  /**
   * O aviso do pedido que ainda não embarcou. Gerar boleto antes do embarque
   * é legítimo (cliente que paga adiantado), mas no pedido "ao embarcar" os
   * vencimentos são refeitos no envio — e o boleto já registrado no banco
   * precisa então ser prorrogado. Pura.
   */
  function avisoDoEmbarque(pedido) {
    const situacao = String(pedido?.situacao || '').trim().toLowerCase();
    if (['enviado', 'entregue', 'cancelado'].includes(situacao)) return '';
    if (String(pedido?.faturamento_regra || '').trim() !== 'ao_embarcar') return '';
    return 'Este pedido fatura "ao embarcar": os vencimentos são refeitos no dia do envio. '
      + 'Boleto gerado agora fica com o vencimento de hoje — depois do envio, confira e prorrogue pelo "Detalhes" do boleto.';
  }

  function mensagemDeErro(status, corpo) {
    if (status === 403) return 'Você não tem permissão para gerar boletos.';
    if (status === 404) return 'Pedido não encontrado.';
    if (status === 409 && Array.isArray(corpo?.pendencias) && corpo.pendencias.length) return `${corpo.error || 'A cobrança não está pronta.'}`;
    return corpo?.error || 'Não foi possível gerar os boletos.';
  }
  // ------------------------------------------------- fim das funções puras

  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }
  const formatarMoeda = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const formatarDia = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : '—'; };

  const bruto = window.gerarBoletosContext;
  const ctx = { pedidoId: bruto?.pedidoId ?? window.selectedOrderId ?? null, numero: bruto?.numero ? String(bruto.numero) : '', cliente: bruto?.cliente ? String(bruto.cliente) : '' };
  window.EstadoTrabalho?.registrarContexto?.(overlayId, () => ({ gerarBoletosContext: ctx, selectedOrderId: ctx.pedidoId }));

  const el = id => overlay.querySelector(`#${id}`);
  const linhasEl = el('gerarBoletosLinhas');
  const mensagemEl = el('gerarBoletosMensagem');
  const resultadoEl = el('gerarBoletosResultado');
  const confirmarBtn = el('confirmarGerarBoletos');
  const pdfTodosBtn = el('baixarBoletosPdf');
  const consultarBtn = el('consultarBoletosBB');
  let estado = null;
  let emAndamento = false;
  let fechado = false;
  // Data e valor escolhidos nas parcelas marcadas: id → { vencimento, valor (texto) }.
  const edicoes = new Map();
  const ajusteEl = el('gerarBoletosAjuste');
  const somaEl = el('gerarBoletosSoma');
  const justificativaCaixa = el('gerarBoletosJustificativaCaixa');
  const justificativaEl = el('gerarBoletosJustificativa');

  function desligarOuvintes() {
    document.removeEventListener('keydown', aoEsc);
    window.removeEventListener('modalFechado', aoFecharModal);
    window.removeEventListener('boletos:alterados', aoAlterarBoleto);
  }
  /** O modal do boleto (por cima) mudou algo deste pedido: relê a lista. */
  function aoAlterarBoleto(evento) {
    if (fechado || String(evento?.detail?.pedidoId) !== String(ctx.pedidoId)) return;
    carregar();
  }
  function fechar() {
    if (fechado) return;
    fechado = true;
    desligarOuvintes();
    if (window.gerarBoletosContext === bruto) window.gerarBoletosContext = null;
    Modal.close(overlayId);
  }
  function aoEsc(e) {
    if (e.key !== 'Escape') return;
    if (document.querySelector('dialog[open]')) return;
    // Com o boleto aberto por cima, o Esc é dele.
    if (document.getElementById('boletoDetalheOverlay')) return;
    e.preventDefault();
    if (!emAndamento) fechar();
  }
  function aoFecharModal(evento) {
    if (evento?.detail === overlayId) desligarOuvintes();
  }
  document.addEventListener('keydown', aoEsc);
  window.addEventListener('modalFechado', aoFecharModal);
  window.addEventListener('boletos:alterados', aoAlterarBoleto);
  el('voltarGerarBoletos')?.addEventListener('click', () => { if (!emAndamento) fechar(); });
  el('desistirGerarBoletos')?.addEventListener('click', () => { if (!emAndamento) fechar(); });

  function exibirMensagem(tipo, texto) {
    mensagemEl.textContent = texto;
    mensagemEl.style.color = tipo === 'erro' ? 'var(--color-red)' : (tipo === 'ok' ? 'var(--color-green)' : 'var(--color-primary-light)');
    mensagemEl.classList.remove('hidden');
  }

  function marcadas() {
    return Array.from(linhasEl.querySelectorAll('input[type="checkbox"]:checked')).map(c => Number(c.value)).filter(Number.isFinite);
  }

  function pintar() {
    const ambiente = el('gerarBoletosAmbiente');
    const producao = estado?.ambiente === 'producao';
    ambiente.className = `${producao ? 'badge-success' : 'badge-warning'} px-3 py-1 rounded-full text-xs font-medium justify-self-end`;
    ambiente.textContent = producao ? 'Produção' : 'Homologação (teste, sem valor)';
    el('gerarBoletosSubtitulo').textContent = [ctx.numero ? `Pedido ${ctx.numero}` : '', estado?.pedido?.cliente || ctx.cliente, estado?.nota_fiscal ? `NF-e ${estado.nota_fiscal.serie}/${estado.nota_fiscal.numero}` : ''].filter(Boolean).join(' · ');

    // Pedido que ainda não embarcou e fatura "ao embarcar": o vencimento de
    // hoje pode mudar no envio. Avisa junto do texto fixo do rodapé.
    const rodapeTexto = el('gerarBoletosAviso');
    if (rodapeTexto) {
      const embarque = avisoDoEmbarque(estado?.pedido);
      if (!rodapeTexto.dataset.textoBase) rodapeTexto.dataset.textoBase = rodapeTexto.textContent.trim();
      rodapeTexto.textContent = [rodapeTexto.dataset.textoBase, embarque].filter(Boolean).join(' ');
      rodapeTexto.style.color = embarque ? 'var(--color-primary-light)' : '';
    }

    const pend = el('gerarBoletosPendencias');
    const lista = Array.isArray(estado?.pendencias) ? estado.pendencias : [];
    pend.querySelector('span').textContent = lista.join(' ');
    pend.style.display = lista.length ? 'flex' : 'none';
    pend.classList.toggle('hidden', !lista.length);

    linhasEl.replaceChildren();
    for (const l of (estado?.parcelas || []).map(linhaDaParcela)) {
      const tr = document.createElement('tr');
      const tdCaixa = document.createElement('td');
      tdCaixa.className = 'px-4 py-3';
      const caixa = document.createElement('input');
      caixa.type = 'checkbox';
      caixa.value = String(l.id ?? '');
      caixa.checked = l.podeGerar && Boolean(estado?.pode_gerar);
      caixa.disabled = !l.podeGerar || !estado?.pode_gerar;
      caixa.style.accentColor = 'var(--color-primary)';
      tdCaixa.appendChild(caixa);
      const celula = (texto, classe = 'px-4 py-3 text-white') => { const td = document.createElement('td'); td.className = classe; td.textContent = texto; return td; };
      const tdBoleto = document.createElement('td');
      tdBoleto.className = 'px-4 py-3';
      const tag = document.createElement('span');
      tag.className = `${l.classe} px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap`;
      tag.textContent = l.rotulo;
      // Quem emitiu, quem registrou o pagamento, se foi automático (06/10/2026).
      if (l.auditoria.length) {
        tag.title = l.auditoria.join('\n');
        tag.style.cursor = 'help';
      }
      tdBoleto.appendChild(tag);
      if (l.temDetalhe) {
        const ver = document.createElement('button');
        ver.type = 'button';
        ver.className = 'btn-neutral ml-2 px-2 py-0.5 rounded-md text-xs font-medium text-white';
        ver.dataset.perm = 'financeiro.boleto.view';
        ver.textContent = 'Detalhes';
        ver.title = `Situação no BB, histórico, prorrogar, abatimento e baixa do boleto da parcela ${l.numero}`;
        ver.addEventListener('click', () => abrirDetalhe(l));
        tdBoleto.appendChild(ver);
      }
      if (l.temPdf) {
        const pdf = document.createElement('button');
        pdf.type = 'button';
        pdf.className = 'btn-neutral ml-2 px-2 py-0.5 rounded-md text-xs font-medium text-white';
        pdf.dataset.perm = 'financeiro.boleto.view';
        pdf.textContent = 'PDF';
        pdf.title = `Gerar o PDF do boleto da parcela ${l.numero}`;
        // Sem a marca, a rede automática do BotaoAcao ocupa o botão antes do clique e o run desiste.
        pdf.dataset.acaoGerida = 'true';
        pdf.addEventListener('click', () => (window.BotaoAcao?.run ? window.BotaoAcao.run(pdf, () => gerarPdf(l.boletoId)) : gerarPdf(l.boletoId)));
        tdBoleto.appendChild(pdf);
      }
      if (l.detalhe) {
        const det = document.createElement('p');
        det.className = 'mt-1 text-xs text-gray-400 break-all';
        det.textContent = l.detalhe;
        tdBoleto.appendChild(det);
      }
      // Parcela que pode ganhar boleto: o vencimento e o valor são editáveis
      // (o boleto novo sai com eles e a parcela passa a ter os dele).
      let tdVenc;
      let tdValor;
      if (!caixa.disabled) {
        const editado = edicoes.get(l.id) || {};
        const data = document.createElement('input');
        data.type = 'date';
        data.value = editado.vencimento || l.vencimento || '';
        if (estado?.hoje) data.min = String(estado.hoje).slice(0, 10);
        data.dataset.noRestore = 'true';
        data.setAttribute('aria-label', `Vencimento da ${l.numero}ª parcela`);
        data.className = 'ctl-campo ctl-campo--pequeno bg-input border border-inputBorder text-white focus:border-primary focus:ring-2 focus:ring-primary/50 transition';
        data.style.width = '10.5rem';
        const valor = document.createElement('input');
        valor.type = 'text';
        valor.inputMode = 'decimal';
        valor.autocomplete = 'off';
        valor.dataset.noRestore = 'true';
        valor.dataset.numeric = 'false';
        valor.value = editado.valor ?? Number(l.valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        valor.setAttribute('aria-label', `Valor da ${l.numero}ª parcela`);
        valor.className = 'ctl-campo ctl-campo--pequeno bg-input border border-inputBorder text-white text-right focus:border-primary focus:ring-2 focus:ring-primary/50 transition';
        valor.style.width = '8.5rem';
        const lembrar = () => {
          edicoes.set(l.id, { vencimento: data.value, valor: valor.value });
          atualizarAjuste();
        };
        data.addEventListener('change', lembrar);
        data.addEventListener('input', lembrar);
        valor.addEventListener('input', lembrar);
        valor.addEventListener('blur', () => {
          const n = lerValor(valor.value);
          if (n !== null) valor.value = n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          lembrar();
        });
        const habilitar = () => {
          data.disabled = !caixa.checked;
          valor.disabled = !caixa.checked;
          data.style.opacity = caixa.checked ? '' : '0.5';
          valor.style.opacity = caixa.checked ? '' : '0.5';
        };
        habilitar();
        caixa.addEventListener('change', () => { habilitar(); atualizarBotao(); });
        tdVenc = document.createElement('td');
        tdVenc.className = 'px-4 py-2';
        tdVenc.appendChild(data);
        tdValor = document.createElement('td');
        tdValor.className = 'px-4 py-2 text-right';
        tdValor.appendChild(valor);
      } else {
        caixa.addEventListener('change', atualizarBotao);
        tdVenc = celula(formatarDia(l.vencimento));
        tdValor = celula(formatarMoeda(l.valor), 'px-4 py-3 text-right text-white');
      }
      tr.append(tdCaixa, celula(l.numero ? `${l.numero}ª` : '—'), tdVenc, tdValor, tdBoleto);
      linhasEl.appendChild(tr);
    }
    el('gerarBoletosTabela').classList.toggle('hidden', !(estado?.parcelas || []).length);
    atualizarBotao();
  }

  /**
   * A soma das parcelas com a data e o valor escolhidos: o total do pedido
   * muda junto? Então a justificativa aparece (e é obrigatória).
   */
  function atualizarAjuste() {
    if (!ajusteEl) return;
    const plano = planoDaTela(estado, edicoes, marcadas());
    const mostrar = plano.mudancas.length > 0;
    ajusteEl.classList.toggle('hidden', !mostrar);
    if (!mostrar) return;
    const partes = [`${plano.mudancas.length === 1 ? '1 parcela muda' : `${plano.mudancas.length} parcelas mudam`}: ${plano.mudancas.map(textoDaMudanca).join('; ')}.`];
    if (plano.mudaTotal) {
      const rotulo = plano.ajuste > 0 ? 'Adicional' : (plano.ajuste < 0 ? 'Desconto' : '');
      partes.push(`As parcelas passam a somar ${formatarMoeda(plano.soma)}: o total do pedido vai de ${formatarMoeda(plano.total)} para ${formatarMoeda(plano.totalDepois)}${rotulo ? ` (${rotulo} de ${formatarMoeda(Math.abs(plano.ajuste))} sobre os itens)` : ''}.`);
      if (estado?.nota_fiscal) partes.push(`A NF-e ${estado.nota_fiscal.serie}/${estado.nota_fiscal.numero} já emitida não muda.`);
    } else {
      partes.push(`O total do pedido continua ${formatarMoeda(plano.total)}.`);
    }
    if (plano.erros.length) partes.push(plano.erros[0]);
    somaEl.textContent = partes.join(' ');
    somaEl.style.color = plano.erros.length ? 'var(--color-red)' : '';
    justificativaCaixa?.classList.toggle('hidden', !plano.mudaTotal);
  }

  function atualizarBotao() {
    const n = marcadas().length;
    const rodape = estadoDoRodape(estado);
    // Nada a gerar: o botão sai de cena (o verde desabilitado parecia ativo).
    confirmarBtn.classList.toggle('hidden', !rodape.mostrarGerar);
    confirmarBtn.disabled = !rodape.mostrarGerar || n === 0;
    confirmarBtn.style.opacity = confirmarBtn.disabled ? '0.5' : '';
    confirmarBtn.textContent = n ? `Gerar ${n === 1 ? '1 boleto' : `${n} boletos`}` : 'Gerar boletos';
    pdfTodosBtn?.classList.toggle('hidden', !rodape.mostrarPdf);
    consultarBtn?.classList.toggle('hidden', !rodape.mostrarConsultar);
    const titulo = el('gerarBoletosTituloTexto');
    if (titulo) titulo.textContent = rodape.titulo;
    const aviso = el('gerarBoletosCompleto');
    if (aviso) {
      aviso.textContent = rodape.aviso;
      aviso.classList.toggle('hidden', !rodape.aviso);
    }
    atualizarAjuste();
  }

  function gerarPdf(boletoId) {
    if (!window.BoletoDocumentos) { exibirMensagem('erro', 'Geração de PDF indisponível nesta janela.'); return null; }
    return window.BoletoDocumentos.gerarBoletoPdf(boletoId);
  }

  function gerarPdfDoPedido() {
    if (!window.BoletoDocumentos) { exibirMensagem('erro', 'Geração de PDF indisponível nesta janela.'); return null; }
    return window.BoletoDocumentos.gerarBoletosDoPedidoPdf(ctx.pedidoId);
  }

  /** O boleto por cima deste modal (este continua aberto e se relê quando ele muda algo). */
  function abrirDetalhe(l) {
    if (!l?.boletoId || document.getElementById('boletoDetalheOverlay')) return;
    window.boletoDetalheContext = { boletoId: l.boletoId, pedidoId: ctx.pedidoId, numero: ctx.numero, parcela: l.numero };
    if (typeof Modal.openWithSpinner === 'function') {
      Modal.openWithSpinner('modals/pedidos/boleto-detalhe.html', '../js/modals/pedido-boleto-detalhe.js', 'boletoDetalhe', { keepExisting: true });
      return;
    }
    Modal.open('modals/pedidos/boleto-detalhe.html', '../js/modals/pedido-boleto-detalhe.js', 'boletoDetalhe', true);
  }

  /** Consulta no BB todos os boletos a pagar do pedido e relê a lista. */
  async function consultarNoBB() {
    if (emAndamento || fechado) return;
    emAndamento = true;
    mensagemEl.classList.add('hidden');
    resultadoEl.classList.add('hidden');
    try {
      let resp;
      try {
        resp = await fetchApi(`/api/cobranca/pedidos/${encodeURIComponent(ctx.pedidoId)}/boletos/sincronizar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      } catch (_) {
        exibirMensagem('erro', 'Não foi possível falar com o servidor. Tente de novo.');
        return;
      }
      const corpo = await resp.json().catch(() => null);
      if (!resp.ok) { exibirMensagem('erro', resp.status === 403 ? 'Você não tem permissão para consultar boletos.' : (corpo?.error || 'Não foi possível consultar o BB.')); return; }
      const r = resumoDaConsulta(corpo);
      exibirMensagem(r.tipo === 'error' ? 'erro' : 'ok', r.texto);
      resultadoEl.replaceChildren();
      for (const item of (corpo?.resultados || []).filter(x => !x.ok || x.mudou)) {
        const li = document.createElement('li');
        li.style.color = item.ok ? 'var(--color-green)' : 'var(--color-red)';
        li.textContent = item.ok ? `Parcela ${item.numero_parcela}: agora ${item.status} (${item.situacao || 'BB'})` : `Parcela ${item.numero_parcela}: ${item.erro}`;
        resultadoEl.appendChild(li);
      }
      resultadoEl.classList.toggle('hidden', !resultadoEl.children.length);
      window.showToast?.(r.texto, r.tipo);
      if (Number(corpo?.mudaram) > 0) window.carregarPedidos?.();
      await carregar();
    } finally {
      emAndamento = false;
    }
  }

  async function carregar() {
    try {
      const resp = await fetchApi(`/api/cobranca/pedidos/${encodeURIComponent(ctx.pedidoId)}/boletos`);
      const corpo = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(mensagemDeErro(resp.status, corpo));
      estado = corpo;
      pintar();
    } catch (err) {
      exibirMensagem('erro', err?.message || 'Não foi possível ler as parcelas.');
      confirmarBtn.disabled = true;
      confirmarBtn.classList.add('hidden');
    } finally {
      el('gerarBoletosCarregando').classList.add('hidden');
    }
  }

  async function confirmar() {
    if (emAndamento || fechado) return;
    const ids = marcadas();
    if (!ids.length) { exibirMensagem('erro', 'Marque ao menos uma parcela.'); return; }
    // Data e valor escolhidos: conferidos aqui antes da caixa (o backend confere de novo).
    const plano = planoDaTela(estado, edicoes, ids);
    if (plano.erros.length) { exibirMensagem('erro', plano.erros[0]); return; }
    const justificativa = String(justificativaEl?.value || '').replace(/\s+/g, ' ').trim();
    if (plano.mudaTotal && justificativa.length < 10) {
      exibirMensagem('erro', 'O total do pedido muda com esses valores: escreva a justificativa (ao menos 10 letras).');
      justificativaCaixa?.classList.remove('hidden');
      justificativaEl?.focus();
      return;
    }
    const producao = estado?.ambiente === 'producao';
    const secoes = plano.mudancas.length ? [{
      titulo: 'Data e valor escolhidos', icone: 'fa-pen',
      lista: [
        ...plano.mudancas.map(textoDaMudanca),
        ...(plano.mudaTotal ? [`Total do pedido: ${formatarMoeda(plano.total)} → ${formatarMoeda(plano.totalDepois)}`] : [])
      ]
    }] : [];
    const ok = await window.DialogPadrao?.confirm?.({
      title: producao ? 'Registrar boletos reais?' : 'Registrar boletos na homologação?',
      message: `${ids.length === 1 ? '1 boleto será registrado' : `${ids.length} boletos serão registrados`} no Banco do Brasil (${producao ? 'PRODUÇÃO — com valor' : 'homologação, conta de teste, sem valor'}) para o pedido ${ctx.numero}. Nada é enviado ao cliente.${plano.mudancas.length ? ' Cada parcela passa a ter a data e o valor do boleto novo.' : ''}`,
      ...(secoes.length ? { secoes } : {}),
      confirmText: 'Gerar boletos'
    });
    if (!ok) return;
    emAndamento = true;
    mensagemEl.classList.add('hidden');
    resultadoEl.classList.add('hidden');
    try {
      let resp;
      try {
        resp = await fetchApi(`/api/cobranca/pedidos/${encodeURIComponent(ctx.pedidoId)}/boletos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            parcelas: ids, nota_fiscal_id: estado?.nota_fiscal?.id ?? null,
            ...(plano.mudancas.length ? { ajustes: plano.ajustes } : {}),
            ...(plano.mudaTotal ? { justificativa } : {})
          })
        });
      } catch (err) {
        exibirMensagem('erro', 'Não foi possível falar com o servidor. Tente de novo.');
        return;
      }
      const corpo = await resp.json().catch(() => null);
      if (!resp.ok) {
        exibirMensagem('erro', mensagemDeErro(resp.status, corpo));
        if (corpo?.code === 'JUSTIFICATIVA_OBRIGATORIA') { justificativaCaixa?.classList.remove('hidden'); justificativaEl?.focus(); }
        return;
      }
      const r = resumoDosResultados(corpo);
      exibirMensagem(r.tipo === 'error' ? 'erro' : (r.tipo === 'success' ? 'ok' : 'info'), r.texto);
      resultadoEl.replaceChildren();
      for (const item of corpo?.resultados || []) {
        const li = document.createElement('li');
        li.style.color = item.ok ? 'var(--color-green)' : 'var(--color-red)';
        li.textContent = item.ok
          ? `Parcela ${item.numero_parcela}: ${item.ja_existia ? 'já tinha boleto' : 'registrado'} ${item.boleto?.nosso_numero ? `· ${item.boleto.nosso_numero}` : ''}${item.boleto?.linha_digitavel ? ` · ${item.boleto.linha_digitavel}` : ''}${item.aviso ? ` · ${item.aviso}` : ''}`
          : `Parcela ${item.numero_parcela}: ${item.erro}`;
        resultadoEl.appendChild(li);
      }
      // A parcela ficou com a data e o valor do boleto novo; e o total do pedido, se mudou.
      for (const a of corpo?.parcelas_ajustadas || []) {
        const li = document.createElement('li');
        li.style.color = 'var(--color-primary-light)';
        li.textContent = `${a.numero_parcela}ª parcela agora: ${formatarDia(a.vencimento)} · ${formatarMoeda(a.valor)}`;
        resultadoEl.appendChild(li);
      }
      if (corpo?.total?.erro || corpo?.total?.total_depois !== undefined) {
        const li = document.createElement('li');
        li.style.color = corpo.total.erro ? 'var(--color-red)' : 'var(--color-primary-light)';
        li.textContent = corpo.total.erro || `Total do pedido: ${formatarMoeda(corpo.total.total_antes)} → ${formatarMoeda(corpo.total.total_depois)}`;
        resultadoEl.appendChild(li);
      }
      resultadoEl.classList.remove('hidden');
      edicoes.clear();
      if (justificativaEl) justificativaEl.value = '';
      window.showToast?.(r.texto, r.tipo);
      window.dispatchEvent(new CustomEvent('boletos:gerados', { detail: { pedidoId: ctx.pedidoId, resultado: corpo } }));
      window.carregarPedidos?.();
      await carregar();
    } finally {
      emAndamento = false;
    }
  }

  if (typeof window.BotaoAcao?.bind === 'function') {
    window.BotaoAcao.bind(confirmarBtn, confirmar);
    if (pdfTodosBtn) window.BotaoAcao.bind(pdfTodosBtn, gerarPdfDoPedido);
    if (consultarBtn) window.BotaoAcao.bind(consultarBtn, consultarNoBB);
  } else {
    confirmarBtn.addEventListener('click', confirmar);
    pdfTodosBtn?.addEventListener('click', gerarPdfDoPedido);
    consultarBtn?.addEventListener('click', consultarNoBB);
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
