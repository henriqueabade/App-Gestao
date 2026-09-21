/**
 * Modal "NF-e e boletos de fora" do pedido.
 *
 * Para o pedido que saiu com nota e/ou boleto feitos em outro lugar, informa
 * só os DADOS (backend/fiscal/externas.js):
 *   - NF-e: pelo XML (lido no backend e descartado) ou pela chave de acesso +
 *     valor. Primeiro confere (POST …/nfe-externa/previa), mostra o que a
 *     nota diz e os avisos; só grava no "Gravar a nota".
 *   - Boletos: a linha digitável de cada parcela, conferida ao colar
 *     (POST /api/cobranca/pedidos/:id/boletos-externos/previa) e gravada no
 *     "Gravar boletos". Parcela com boleto do BB não recebe boleto de fora.
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

  /** O que a prévia de uma linha digitável diz, numa frase. */
  function frasedaPrevia(r) {
    if (!r) return { tom: 'neutro', texto: '' };
    if (!r.ok) return { tom: 'erro', texto: r.erro || 'Não foi possível ler a linha.' };
    const b = r.boleto || {};
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
  let entradaNota = null;
  let emAndamento = false;
  let fechado = false;
  const previasDasParcelas = new Map();

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

    const podeInformar = Boolean(estadoNota.pode_informar) && pode('financeiro.nfe.emit');
    el('dadosExternosNotaForm').classList.toggle('hidden', !podeInformar);
    const motivo = !temExterna && !estadoNota.pode_informar ? estadoNota.motivo
      : (!temExterna && !pode('financeiro.nfe.emit') ? 'Informar nota pede a permissão de emitir NF-e.' : '');
    el('dadosExternosNotaMotivo').textContent = motivo || '';
    el('dadosExternosNotaMotivo').classList.toggle('hidden', !motivo);
    if (!podeInformar) { entradaNota = null; el('dadosExternosNotaPrevia').classList.add('hidden'); }
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
      const resp = await fetchApi(`/api/fiscal/pedidos/${id}/nfe-externa`, { method: 'DELETE' });
      const corpo = await resp.json().catch(() => null);
      if (!resp.ok) { exibirMensagem('erro', mensagemDeErro(resp.status, corpo)); return; }
      window.showToast?.('NF-e de fora removida.', 'success');
      avisarQuemEstaAberto('nfe:externa');
      await carregar();
    } finally {
      emAndamento = false;
    }
  }

  const botao = (elemento, fn) => {
    if (!elemento) return;
    if (typeof window.BotaoAcao?.bind === 'function') window.BotaoAcao.bind(elemento, fn);
    else elemento.addEventListener('click', fn);
  };
  botao(el('gravarNotaExterna'), gravarNota);
  botao(el('removerNotaExterna'), removerNota);

  // --------------------------------------------------------- boletos
  function celula(conteudo, classe = 'px-4 py-3 text-left text-white') {
    const td = document.createElement('td');
    td.className = classe;
    if (conteudo instanceof Node) td.appendChild(conteudo);
    else td.textContent = conteudo ?? '';
    return td;
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
    const saiu = situacao === 'enviado' || situacao === 'entregue';
    const motivo = el('dadosExternosBoletosMotivo');
    const textoMotivo = !linhas.length ? 'O pedido não tem parcelas cadastradas.'
      : (!saiu ? 'Só pedido enviado ou entregue recebe boleto de fora.' : (!podeInformar ? 'Informar boleto pede a permissão de gerar boletos.' : ''));
    motivo.textContent = textoMotivo;
    motivo.classList.toggle('hidden', !textoMotivo);

    let livres = 0;
    for (const linha of linhas) {
      const p = linha.parcela || {};
      const estado = estadoDaParcela(linha);
      const tr = document.createElement('tr');
      const conteudo = document.createElement('div');
      conteudo.className = 'flex flex-col gap-1 min-w-0';
      if (estado.tipo === 'externo') {
        const topo = document.createElement('div');
        topo.className = 'flex flex-wrap items-center gap-2';
        const tag = document.createElement('span');
        tag.className = 'badge-info px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap';
        tag.textContent = estado.texto;
        topo.appendChild(tag);
        const copiar = document.createElement('button');
        copiar.type = 'button';
        copiar.className = 'btn-neutral px-3 py-1 rounded-md text-xs font-medium text-white';
        copiar.textContent = 'Copiar linha';
        copiar.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(soDigitos(estado.linha)); window.showToast?.('Linha digitável copiada.', 'success'); } catch (_) { window.showToast?.('Não foi possível copiar.', 'error'); }
        });
        topo.appendChild(copiar);
        if (podeInformar) {
          const remover = document.createElement('button');
          remover.type = 'button';
          remover.className = 'btn-danger px-3 py-1 rounded-md text-xs font-medium text-white';
          remover.dataset.perm = 'financeiro.boleto.emit';
          remover.textContent = 'Remover';
          remover.addEventListener('click', () => removerBoleto(linha));
          topo.appendChild(remover);
        }
        const linhaTexto = document.createElement('span');
        linhaTexto.className = 'text-xs text-gray-400 break-all';
        linhaTexto.textContent = estado.linha;
        conteudo.append(topo, linhaTexto);
      } else if (estado.tipo === 'bb') {
        const tag = document.createElement('span');
        tag.className = 'badge-success px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap self-start';
        tag.textContent = estado.texto;
        conteudo.appendChild(tag);
      } else if (saiu && podeInformar) {
        livres += 1;
        const campo = document.createElement('input');
        campo.type = 'text';
        campo.inputMode = 'numeric';
        campo.autocomplete = 'off';
        campo.maxLength = 60;
        campo.dataset.parcelaId = String(p.id);
        campo.className = 'w-full ctl-campo ctl-campo--pequeno bg-input border border-inputBorder text-white placeholder-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/50 transition';
        campo.placeholder = 'Cole a linha digitável (47 números)';
        campo.setAttribute('aria-label', `Linha digitável da parcela ${p.numero_parcela}`);
        const saida = document.createElement('span');
        saida.className = 'text-xs';
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
        conteudo.append(campo, saida);
      } else {
        const vazio = document.createElement('span');
        vazio.className = 'text-gray-400';
        vazio.textContent = 'Sem boleto';
        conteudo.appendChild(vazio);
      }
      tr.append(
        celula(p.numero_parcela ? `${p.numero_parcela}ª` : '—'),
        celula(diaBR(p.data_vencimento) || '—'),
        celula(moedaBR(p.valor)),
        celula(conteudo, 'px-4 py-3 text-left')
      );
      tbody.appendChild(tr);
    }
    el('gravarBoletosExternos').classList.toggle('hidden', !livres);
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
      const resp = await fetchApi(`/api/cobranca/boletos-externos/${encodeURIComponent(b.id)}`, { method: 'DELETE' });
      const corpo = await resp.json().catch(() => null);
      if (!resp.ok) { exibirMensagem('erro', mensagemDeErro(resp.status, corpo)); return; }
      window.showToast?.('Boleto de fora removido.', 'success');
      avisarQuemEstaAberto('boletos:alterados');
      await carregar();
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
    const [nota, boletos] = await Promise.all([
      lerJson(`/api/fiscal/pedidos/${id}/nfe-externa`),
      lerJson(`/api/cobranca/pedidos/${id}/boletos`)
    ]);
    el('dadosExternosCarregando').classList.add('hidden');
    // Sem permissão para ver notas (403) a seção da nota some; sem o SQL, a tela diz o que fazer.
    estadoNota = nota.ok ? nota.corpo : null;
    estadoBoletos = boletos.ok ? boletos.corpo : null;
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

  overlay.classList.remove('hidden');
  overlay.removeAttribute('aria-hidden');
  window.Modal?.signalReady?.(overlayId);
  carregar();
})();
