/**
 * Modais da Contabilidade — Fechamento do mês (etapas 1, 2 e 3).
 *
 * Um script para os modais do módulo: a anatomia é a mesma — Voltar,
 * Cancelar/Fechar e Esc fecham; a ação principal fica no rodapé — e o que
 * muda é a leitura e a gravação. Quem abre diz qual é o modal por
 * `window.contabilidadeModalContexto.overlayId` (ver `ctbAbrirModal` em
 * contabilidade.js); um modal abre outro POR CIMA pelo mesmo caminho.
 *
 *   ctbFechar               Fechar competência — relê o checklist e grava (POST /fechar)
 *   ctbReabrir              Reabrir competência — justificativa (POST /reabrir)
 *   ctbIgnorarPendencia     Ignorar pendência — justificativa (POST /pendencias/ignorar)
 *   ctbContasPagar          Contas a pagar — as parcelas da visão e os totais (GET /titulos)
 *   ctbContaPagar           A conta — parcelas, pagamentos, arquivos, histórico (GET /titulos/:id)
 *   ctbContaPagarForm       Nova conta / editar (POST /titulos, PUT /titulos/:id)
 *   ctbPagarParcela         Registrar pagamento, com o comprovante (POST /parcelas/:id/pagar)
 *   ctbDocumentosRecebidos  NF-e de entrada, NFS-e e recibos (GET /documentos)
 *   ctbRegistrarDocumento   Registrar documento — XML, chave, NFS-e, recibo (POST /documentos)
 *   ctbDocumentoRecebido    A ficha do documento (GET /documentos/:id)
 *   ctbEvidencias           Documentos da competência (GET /evidencias)
 *
 * Toda gravação avisa os outros modais abertos (`contabilidade:alterado`),
 * que se releem; ao fechar, a tela relê o painel (ContabilidadeRecarregar).
 * Datas são texto 'YYYY-MM-DD' (new Date volta um dia em São Paulo).
 */
(() => {
  const NIVEIS = { critico: 'Erro crítico', documental: 'Pendência documental', aviso: 'Aviso' };
  const ESTADOS = { ok: 'Em dia', pendente: 'Pendente', aviso: 'Com avisos', critico: 'Erro crítico', em_curso: 'Mês em curso', indisponivel: 'Ainda não integrado' };
  const SITUACOES = { aberta: 'Aberta', fechada: 'Fechada', reaberta: 'Reaberta' };
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const TOM_PARCELA = { a_vencer: 'badge-info', vence_hoje: 'badge-warning', vencida: 'badge-danger', paga: 'badge-success', cancelada: 'badge-neutral' };
  const TOM_TITULO = { aberto: 'badge-info', parcial: 'badge-warning', vencido: 'badge-danger', pago: 'badge-success', cancelado: 'badge-neutral' };
  const TOM_ORIGEM = { oficial: 'badge-success', interno: 'badge-info', fornecido: 'badge-neutral' };
  const ORIGENS_TITULO = { manual: 'Lançada à mão', nfe: 'NF-e de entrada', nfse: 'NFS-e', outro: 'Recibo ou guia' };
  const EVENTO_ALTERADO = 'contabilidade:alterado';

  const contexto = window.contabilidadeModalContexto || {};
  const overlayId = contexto.overlayId;
  const overlay = overlayId ? document.getElementById(`${overlayId}Overlay`) : null;
  if (!overlay) return;

  const el = id => overlay.querySelector(`#${id}`);
  let processando = false;
  // Uma caixa ou um modal de outro módulo (Novo contato) por cima: o Esc é dele.
  let filhoAberto = false;
  const aoDesligar = [];

  const fechar = () => {
    // Fechamento/pagamento em andamento não pode ser cancelado por engano.
    if (processando) return;
    desligar();
    window.Modal?.close(overlayId);
    window.ContabilidadeRecarregar?.();
  };
  const ehOModalDeCima = () => {
    const abertos = [...document.querySelectorAll('[data-ctb-modal]')].filter(o => !o.classList.contains('hidden'));
    return abertos[abertos.length - 1] === overlay;
  };
  const aoEsc = e => {
    if (e.key !== 'Escape' || filhoAberto || !ehOModalDeCima()) return;
    e.preventDefault();
    fechar();
  };
  const aoFecharPorFora = e => { if (e?.detail === overlayId) { desligar(); window.ContabilidadeRecarregar?.(); } };
  function desligar() {
    document.removeEventListener('keydown', aoEsc);
    window.removeEventListener('modalFechado', aoFecharPorFora);
    aoDesligar.splice(0).forEach(fn => fn());
  }
  document.addEventListener('keydown', aoEsc);
  window.addEventListener('modalFechado', aoFecharPorFora);
  overlay.querySelectorAll('[data-ctb-fechar]').forEach(b => b.addEventListener('click', fechar));

  // ------------------------------------------------------------ helpers

  /**
   * Botão que chama `BotaoAcao.run` no próprio clique precisa da marca
   * `data-acao-gerida`: sem ela a rede automática do BotaoAcao o marca como
   * ocupado antes deste handler e o `run` desiste achando que é um segundo clique.
   */
  function acionar(botao, fn) {
    if (!botao) return;
    botao.dataset.acaoGerida = 'true';
    botao.addEventListener('click', evento => {
      evento.stopPropagation();
      return window.BotaoAcao?.run ? window.BotaoAcao.run(botao, fn) : fn();
    });
  }

  async function fetchApi(caminho, opcoes) {
    const base = await window.apiConfig.getApiBaseUrl();
    const resposta = await fetch(`${base}${caminho}`, { ...opcoes, headers: { 'Content-Type': 'application/json', ...(opcoes?.headers || {}) } });
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

  const enviar = (caminho, metodo, corpo) => fetchApi(caminho, { method: metodo, body: JSON.stringify(corpo || {}) });

  function mostrarMensagem(id, texto, tipo = 'erro') {
    const alvo = el(id);
    if (!alvo) return;
    alvo.textContent = texto || '';
    alvo.style.color = tipo === 'erro' ? 'var(--color-red)' : 'var(--color-primary)';
    alvo.classList.toggle('hidden', !texto);
  }

  function textoDoErro(e, semPermissao) {
    if (e?.status === 403) return semPermissao;
    if (e?.corpo?.sql_pendente) return e.message || 'Falta rodar o SQL da Contabilidade no banco e reiniciar a API.';
    if (Array.isArray(e?.corpo?.bloqueios) && e.corpo.bloqueios.length) return `${e.message} ${e.corpo.bloqueios.filter(b => b !== e.message).join(' ')}`.trim();
    return e?.message || 'Erro inesperado.';
  }

  function criar(tag, classe, texto) {
    const n = document.createElement(tag);
    if (classe) n.className = classe;
    if (texto != null) n.textContent = texto;
    return n;
  }

  function icone(nome) {
    const i = criar('i', `fas ${nome}`);
    i.setAttribute('aria-hidden', 'true');
    return i;
  }

  function opcao(valor, texto) {
    const o = document.createElement('option');
    o.value = valor;
    o.textContent = texto;
    return o;
  }

  function tag(texto, classe, titulo = '') {
    const s = criar('span', `${classe} px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap`, texto);
    if (titulo) s.title = titulo;
    return s;
  }

  /** Uma célula: texto (vazio vira "—") ou nós; `sub` é a linha de baixo, menor. */
  function celula(conteudo, classe = 'px-4 py-3', sub = null) {
    const td = criar('td', classe);
    if (conteudo && typeof conteudo === 'object') td.append(...(Array.isArray(conteudo) ? conteudo : [conteudo]));
    else td.textContent = conteudo === null || conteudo === undefined || conteudo === '' ? '—' : String(conteudo);
    if (sub) td.appendChild(criar('span', 'ctb-sub', sub));
    return td;
  }

  function linhaVazia(corpo, colunas, texto) {
    const tr = criar('tr');
    const td = criar('td', 'px-4 py-6 ctb-vazio', texto);
    td.colSpan = colunas;
    tr.appendChild(td);
    corpo.replaceChildren(tr);
  }

  /** Botão pequeno de linha (Pagar, Estornar, Abrir…), no padrão. */
  function botaoPequeno(texto, cor, fn, { perm = null, titulo = '' } = {}) {
    const b = criar('button', `${cor} ctl-botao ctl-botao--pequeno${cor === 'btn-success' ? '' : ' text-white'}`, texto);
    b.type = 'button';
    if (perm) b.dataset.perm = perm;
    if (titulo) b.title = titulo;
    acionar(b, fn);
    return b;
  }

  function pintarSituacao(alvo, status) {
    if (!alvo) return;
    const classe = status === 'fechada' ? 'badge-success' : (status === 'reaberta' ? 'badge-danger' : 'badge-warning');
    alvo.className = `${classe} px-3 py-1 rounded-full text-xs font-medium justify-self-end`;
    alvo.textContent = SITUACOES[status] || '—';
  }

  function pintarEtiqueta(alvo, texto, classe) {
    if (!alvo) return;
    alvo.className = `${classe} px-3 py-1 rounded-full text-xs font-medium justify-self-end`;
    alvo.textContent = texto || '—';
  }

  /** Linhas rótulo → valor numa <dl class="ctb-dados">; o valor pode ser um nó. */
  function preencherDados(dl, linhas) {
    if (!dl) return;
    dl.replaceChildren();
    for (const [rotulo, valor] of linhas) {
      const div = criar('div', 'ctb-dados__linha');
      const dd = criar('dd', typeof valor === 'string' && valor.length > 40 ? 'ctb-dados__texto' : null);
      if (valor && typeof valor === 'object') dd.appendChild(valor);
      else dd.textContent = valor === null || valor === undefined || valor === '' ? '—' : String(valor);
      div.append(criar('dt', null, rotulo), dd);
      dl.appendChild(div);
    }
  }

  function itemDaLista(texto, nomeIcone, cor) {
    const li = criar('li');
    const i = icone(nomeIcone);
    if (cor) i.style.color = cor;
    li.append(i, criar('span', null, texto));
    return li;
  }

  const formatoMoeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  function formatarMoeda(v) {
    if (v === null || v === undefined || v === '') return '—';
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return n < 0 ? `- ${formatoMoeda.format(Math.abs(n))}` : formatoMoeda.format(n);
  }

  function formatarData(texto) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(texto || ''));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
  }

  const formatarInstante = instante => {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(instante || ''));
    if (!m) return '—';
    return m[4] ? `${m[3]}/${m[2]}/${m[1]} às ${m[4]}:${m[5]}` : `${m[3]}/${m[2]}/${m[1]}`;
  };

  const rotuloCompetencia = comp => (/^\d{4}-\d{2}$/.test(String(comp || '')) ? `${MESES[Number(comp.slice(5, 7)) - 1]}/${comp.slice(0, 4)}` : '—');
  const plural = (n, um, varios) => `${n} ${Number(n) === 1 ? um : varios}`;
  const normalizar = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  function hojeLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** "1.234,56", "1234.56" → 1234.56; vazio ou inválido → null (o mesmo do backend). */
  function lerMoeda(v) {
    const t = String(v ?? '').replace(/[R$\s ]/g, '');
    if (!t) return null;
    const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
    const n = Number(normal);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }

  const numeroBr = n => (Number.isFinite(Number(n)) ? Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');

  /** Ao sair do campo, o valor fica escrito como dinheiro ("1.234,56"). */
  function ligarCampoMoeda(campo, aoMudar = null) {
    if (!campo) return;
    campo.addEventListener('blur', () => {
      const n = lerMoeda(campo.value);
      if (n !== null) campo.value = numeroBr(n);
      aoMudar?.();
    });
    if (aoMudar) campo.addEventListener('input', aoMudar);
  }

  function montarCompetencias(campo, selecionada, { vazio = '' } = {}) {
    if (!campo) return;
    const alvo = /^\d{4}-\d{2}$/.test(String(selecionada || '')) ? selecionada : (window.Competencia?.atual?.() || hojeLocal().slice(0, 7));
    if (window.Competencia) {
      window.Competencia.montar(campo, { valor: alvo, vazio });
      return;
    }
    campo.value = alvo;
  }

  /** Avisa os outros modais abertos que algo mudou (eles se releem). */
  function avisarAlteracao() {
    window.dispatchEvent(new CustomEvent(EVENTO_ALTERADO, { detail: { origem: overlayId } }));
  }

  function ouvirAlteracoes(fn) {
    const ouvinte = e => { if (e?.detail?.origem !== overlayId) fn(); };
    window.addEventListener(EVENTO_ALTERADO, ouvinte);
    aoDesligar.push(() => window.removeEventListener(EVENTO_ALTERADO, ouvinte));
  }

  /** Abre outro modal do módulo por cima deste. */
  function abrirOutro(chave, extra = {}) {
    if (typeof window.ContabilidadeAbrirModal === 'function') {
      window.ContabilidadeAbrirModal(chave, null, { ...extra, empilhar: true, competencia: extra.competencia || contexto.competencia });
    }
  }

  /** Uma caixa com campo de texto (o motivo), acima dos modais. null = desistiu. */
  function pedirTexto({ titulo, mensagem, placeholder = 'Motivo (obrigatório)', confirmar = 'Confirmar', minimo = 5 }) {
    return new Promise(resolver => {
      const fundo = criar('div', 'app-message-overlay fixed inset-0 bg-black/50 flex items-center justify-center p-4');
      const caixa = criar('div', 'w-full max-w-md glass-surface backdrop-blur-xl rounded-2xl border border-white/10 p-6 space-y-4');
      caixa.setAttribute('role', 'dialog');
      caixa.setAttribute('aria-modal', 'true');
      caixa.appendChild(criar('h3', 'ctl-modal-titulo text-white', titulo));
      if (mensagem) caixa.appendChild(criar('p', 'text-sm text-gray-300', mensagem));
      const campo = criar('textarea', 'w-full ctl-campo bg-input border border-inputBorder text-white placeholder-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/50 transition');
      campo.rows = 3;
      campo.maxLength = 500;
      campo.placeholder = placeholder;
      caixa.appendChild(campo);
      const erroEl = criar('p', 'hidden text-sm', `Escreva o motivo (ao menos ${minimo} letras).`);
      erroEl.style.color = 'var(--color-red)';
      caixa.appendChild(erroEl);
      const rodape = criar('div', 'ctl-acoes justify-end');
      const voltar = criar('button', 'btn-neutral ctl-botao text-white', 'Voltar');
      const ok = criar('button', 'btn-warning ctl-botao text-white', confirmar);
      voltar.type = 'button';
      ok.type = 'button';
      rodape.append(voltar, ok);
      caixa.appendChild(rodape);
      fundo.appendChild(caixa);
      const sair = valor => {
        document.removeEventListener('keydown', aoTecla, true);
        filhoAberto = false;
        fundo.remove();
        resolver(valor);
      };
      const aoTecla = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); sair(null); } };
      voltar.addEventListener('click', () => sair(null));
      ok.addEventListener('click', () => {
        const texto = campo.value.trim();
        if (texto.length < minimo) { erroEl.classList.remove('hidden'); campo.focus(); return; }
        sair(texto);
      });
      document.addEventListener('keydown', aoTecla, true);
      filhoAberto = true;
      document.body.appendChild(fundo);
      campo.focus();
    });
  }

  /** O arquivo escolhido em base64 (sem o "data:…;base64,"). */
  function lerArquivo(arquivo) {
    return new Promise((ok, falhou) => {
      const leitor = new FileReader();
      leitor.onload = () => ok(String(leitor.result).split(',')[1] || '');
      leitor.onerror = () => falhou(leitor.error);
      leitor.readAsDataURL(arquivo);
    });
  }

  function lerTexto(arquivo) {
    return new Promise((ok, falhou) => {
      const leitor = new FileReader();
      leitor.onload = () => ok(String(leitor.result || ''));
      leitor.onerror = () => falhou(leitor.error);
      leitor.readAsText(arquivo);
    });
  }

  async function arquivoDoCampo(campo) {
    const arquivo = campo?.files?.[0] || null;
    if (!arquivo) return null;
    if (arquivo.size > 20 * 1024 * 1024) throw new Error('O arquivo passa do limite de 20 MB.');
    return { nome: arquivo.name, tipo: arquivo.type || null, base64: await lerArquivo(arquivo) };
  }

  /** Baixa (ou abre) um arquivo que a rota devolve como { nome, base64 }. */
  async function baixarArquivo(caminho, { abrir = false } = {}) {
    try {
      window.showToast?.('Baixando o arquivo…', 'info');
      const r = await fetchApi(caminho);
      if (window.electronAPI?.salvarArquivoBinario) {
        const s = await window.electronAPI.salvarArquivoBinario({ base64: r.base64, nomeSugerido: r.nome, abrir, titulo: 'Salvar arquivo' });
        if (s && !s.success && !s.canceled) window.showToast?.(s.message || 'Não foi possível salvar o arquivo.', 'error');
        else if (s?.success && !abrir) window.showToast?.('Arquivo salvo.', 'success');
        return;
      }
      const binario = atob(r.base64);
      const bytes = new Uint8Array(binario.length);
      for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: r.tipo || 'application/octet-stream' }));
      const link = criar('a');
      link.href = url;
      link.download = r.nome || 'arquivo';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      window.showToast?.(textoDoErro(e, 'Você não tem permissão para baixar este arquivo.'), 'error');
    }
  }

  const iconeDoArquivo = a => (/xml/i.test(`${a.tipo} ${a.nome}`) ? 'fa-file-code' : (/pdf/i.test(`${a.tipo} ${a.nome}`) ? 'fa-file-pdf' : (/image|png|jpe?g/i.test(`${a.tipo} ${a.nome}`) ? 'fa-file-image' : 'fa-file')));

  /** A lista de arquivos de uma ficha: abrir, salvar e excluir (com motivo). */
  function arquivosEm(ul, lista, { aoMudar } = {}) {
    if (!ul) return;
    ul.replaceChildren();
    if (!lista?.length) {
      ul.appendChild(criar('li', 'ctb-vazio', 'Nenhum arquivo ainda.'));
      return;
    }
    for (const a of lista) {
      const li = criar('li', 'ctb-arquivo');
      const texto = criar('div', 'ctb-arquivo__texto');
      texto.append(
        criar('span', 'ctb-arquivo__nome', a.descricao ? `${a.descricao} — ${a.nome}` : a.nome),
        criar('span', 'ctb-arquivo__nota', [a.categoria_rotulo, a.origem_rotulo, a.criado_em ? formatarInstante(a.criado_em) : null, a.criado_por].filter(Boolean).join(' · '))
      );
      const acoes = criar('div', 'ctb-arquivo__acoes');
      acoes.append(
        botaoPequeno('Abrir', 'btn-neutral', () => baixarArquivo(`/api/contabilidade/arquivos/${encodeURIComponent(a.id)}`, { abrir: true })),
        botaoPequeno('Salvar', 'btn-neutral', () => baixarArquivo(`/api/contabilidade/arquivos/${encodeURIComponent(a.id)}`)),
        botaoPequeno('Excluir', 'btn-warning', async () => {
          const motivo = await pedirTexto({ titulo: 'Excluir o arquivo?', mensagem: `${a.nome} sai da lista (o histórico fica).`, confirmar: 'Excluir' });
          if (motivo === null) return;
          try {
            await enviar(`/api/contabilidade/arquivos/${encodeURIComponent(a.id)}/excluir`, 'POST', { motivo });
            window.showToast?.('Arquivo excluído.', 'success');
            avisarAlteracao();
            aoMudar?.();
          } catch (e) {
            window.showToast?.(textoDoErro(e, 'Você não tem permissão para excluir arquivos.'), 'error');
          }
        }, { perm: 'contabilidade.documento.excluir' })
      );
      li.append(icone(iconeDoArquivo(a)), texto, acoes);
      ul.appendChild(li);
    }
  }

  /** O histórico de uma ficha (conta ou documento). */
  function historicoEm(ol, eventos) {
    if (!ol) return;
    ol.replaceChildren();
    if (!eventos?.length) {
      ol.appendChild(criar('li', 'ctb-vazio', 'Nada registrado ainda.'));
      return;
    }
    for (const e of eventos) {
      const li = criar('li');
      const texto = criar('div', 'ctb-historico__texto');
      texto.append(criar('strong', null, `${e.rotulo}${e.usuario ? ` · ${e.usuario}` : ''}`), criar('span', null, e.descricao || ''));
      li.append(criar('span', 'ctb-historico__quando', formatarInstante(e.quando)), texto);
      ol.appendChild(li);
    }
  }

  /** Anexa o arquivo do quadro "Anexar" ao alvo da ficha. */
  async function anexarDoQuadro({ campoArquivo, campoCategoria, campoDescricao, competencia, vinculos, mensagemId }) {
    mostrarMensagem(mensagemId, '');
    let arquivo;
    try {
      arquivo = await arquivoDoCampo(campoArquivo);
    } catch (e) {
      mostrarMensagem(mensagemId, e.message);
      return false;
    }
    if (!arquivo) { mostrarMensagem(mensagemId, 'Escolha o arquivo.'); return false; }
    try {
      const r = await enviar('/api/contabilidade/arquivos', 'POST', {
        ...arquivo, categoria: campoCategoria?.value || 'outro', descricao: campoDescricao?.value || null, competencia, vinculos
      });
      window.showToast?.(r?.reaproveitado ? 'Este arquivo já estava guardado: foi só ligado aqui.' : 'Arquivo anexado.', 'success');
      if (campoArquivo) campoArquivo.value = '';
      if (campoDescricao) campoDescricao.value = '';
      avisarAlteracao();
      return true;
    } catch (e) {
      mostrarMensagem(mensagemId, textoDoErro(e, 'Você não tem permissão para anexar arquivos.'));
      return false;
    }
  }

  /** Os contatos (fornecedores/prestadores) num select, com "Nenhum" no topo. */
  async function carregarFornecedores(select, { vazio = 'Sem fornecedor (guia, imposto…)', selecionado = null } = {}) {
    const r = await fetchApi('/api/contabilidade/fornecedores');
    const lista = Array.isArray(r?.fornecedores) ? r.fornecedores : [];
    if (select) {
      const atual = selecionado ?? select.value;
      select.replaceChildren(opcao('', vazio), ...lista.map(f => opcao(String(f.id), [f.nome, f.documento, f.tipo].filter(Boolean).join(' · '))));
      if (atual && lista.some(f => String(f.id) === String(atual))) select.value = String(atual);
    }
    return { lista, semContatos: Boolean(r?.sql_pendente_contatos) };
  }

  /**
   * "Novo contato": abre o cadastro de Contatos POR CIMA (o módulo dele, com
   * ctt.create) e, quando salva, relê a lista e escolhe o contato novo.
   */
  function ligarNovoContato(botao, select, aoEscolher = null) {
    if (!botao) return;
    botao.addEventListener('click', () => {
      if (typeof window.Modal?.open !== 'function') return;
      const antes = new Set([...(select?.options || [])].map(o => o.value));
      filhoAberto = true;
      const aoPronto = e => {
        if (e?.detail !== 'novoContato') return;
        window.removeEventListener('modalSpinnerLoaded', aoPronto);
        const alvo = document.getElementById('novoContatoOverlay');
        alvo?.classList.remove('hidden');
      };
      const aoSalvar = async () => {
        await carregarFornecedores(select).catch(() => null);
        const novo = [...(select?.options || [])].map(o => o.value).filter(v => v && !antes.has(v)).sort((x, y) => Number(y) - Number(x))[0];
        if (novo && select) { select.value = novo; aoEscolher?.(novo); }
      };
      const aoFechar = e => {
        if (e?.detail !== 'novoContato') return;
        filhoAberto = false;
        window.removeEventListener('modalFechado', aoFechar);
        window.removeEventListener('contatoAdicionado', aoSalvar);
        window.removeEventListener('modalSpinnerLoaded', aoPronto);
      };
      window.addEventListener('modalSpinnerLoaded', aoPronto);
      window.addEventListener('contatoAdicionado', aoSalvar);
      window.addEventListener('modalFechado', aoFechar);
      window.Modal.open('modals/contatos/novo.html', '../js/modals/contato-novo.js', 'novoContato', true);
    });
  }

  /** Parcelas mensais divididas em centavos (a sobra na última) — o mesmo do backend. */
  function dividirParcelas(quantidade, primeiro, total) {
    const q = Math.trunc(Number(quantidade));
    if (!(q >= 1 && q <= 60) || !/^\d{4}-\d{2}-\d{2}$/.test(String(primeiro || '')) || !(total > 0)) return null;
    const emCentavos = Math.round(total * 100);
    const base = Math.floor(emCentavos / q);
    const sobra = emCentavos - base * q;
    const [a, m, d] = primeiro.split('-').map(Number);
    return Array.from({ length: q }, (_, i) => {
      const t = a * 12 + (m - 1) + i;
      const ano = Math.floor(t / 12);
      const mes = (t % 12) + 1;
      const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
      return {
        vencimento: `${ano}-${String(mes).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`,
        valor: (base + (i === q - 1 ? sobra : 0)) / 100,
        linha_digitavel: ''
      };
    });
  }

  // ------------------------------------------------------------ fechar

  function montarFechar() {
    const compSel = el('ctbFecharCompetencia');
    montarCompetencias(compSel, contexto.competencia);
    const confirmarBtn = el('ctbFecharConfirmar');
    let painel = null;
    let leitura = 0;

    function pintar() {
      const p = painel;
      confirmarBtn.classList.toggle('hidden', !p || !p.pode?.fechar);
      pintarSituacao(el('ctbFecharSituacao'), p?.situacao?.status || 'aberta');
      el('ctbFecharInfo').textContent = p ? `${p.rotulo}${p.encerrada ? '' : ' — o mês ainda está em curso'}` : '';
      const linhas = [];
      if (p) {
        for (const f of p.fontes || []) linhas.push([f.titulo, ESTADOS[f.estado] || f.estado]);
        linhas.push(['Erros críticos', String(p.contagem?.critico ?? 0)]);
        linhas.push(['Pendências documentais', String(p.contagem?.documental ?? 0)]);
        linhas.push(['Avisos', String(p.contagem?.aviso ?? 0)]);
        linhas.push(['Ignoradas com justificativa', String(p.contagem?.ignoradas ?? 0)]);
      }
      preencherDados(el('ctbFecharDados'), linhas);

      const bloqueios = p?.bloqueios?.fechar || [];
      el('ctbFecharBloqueios').classList.toggle('hidden', !bloqueios.length);
      el('ctbFecharBloqueiosLista').replaceChildren(...bloqueios.map(t => itemDaLista(t, 'fa-ban')));

      const sobras = (p?.pendencias || []).filter(x => !x.ignorada && x.nivel !== 'critico');
      el('ctbFecharSobras').classList.toggle('hidden', !p || !p.pode?.fechar || !sobras.length);
      el('ctbFecharSobrasLista').replaceChildren(...sobras.map(x => itemDaLista(`${NIVEIS[x.nivel] || x.nivel}: ${x.titulo}`, x.nivel === 'documental' ? 'fa-file-alt' : 'fa-info-circle', x.nivel === 'documental' ? 'var(--color-primary-light)' : 'var(--color-violet)')));
    }

    async function carregar() {
      const minha = ++leitura;
      mostrarMensagem('ctbFecharMensagem', '');
      el('ctbFecharCarregando').classList.remove('hidden');
      try {
        const r = await fetchApi(`/api/contabilidade/painel?competencia=${encodeURIComponent(compSel.value || '')}`);
        if (minha !== leitura) return;
        painel = r;
        if (r?.sql_pendente) mostrarMensagem('ctbFecharMensagem', 'Falta rodar sql/contabilidade_base.sql no banco e reiniciar a API: o fechamento não será gravado.');
      } catch (e) {
        if (minha !== leitura) return;
        painel = null;
        mostrarMensagem('ctbFecharMensagem', textoDoErro(e, 'Você não tem permissão para ver a Contabilidade.'));
      } finally {
        if (minha === leitura) el('ctbFecharCarregando').classList.add('hidden');
      }
      pintar();
    }

    async function confirmar() {
      if (!painel?.pode?.fechar) return;
      const confirmado = await (window.DialogPadrao?.confirm
        ? window.DialogPadrao.confirm({
          title: 'Fechar a competência?',
          message: `${painel.rotulo}: ${painel.contagem?.documental || 0} pendência(s) documental(is) e ${painel.contagem?.aviso || 0} aviso(s) ficam registrados. Depois só com reabertura justificada.`,
          confirmText: 'Confirmar fechamento'
        })
        : Promise.resolve(window.confirm(`Fechar ${painel.rotulo}?`)));
      if (!confirmado) return;
      processando = true;
      try {
        await enviar('/api/contabilidade/fechar', 'POST', { competencia: compSel.value });
        window.showToast?.(`Competência ${painel.rotulo} fechada.`, 'success');
        processando = false;
        avisarAlteracao();
        fechar();
      } catch (e) {
        mostrarMensagem('ctbFecharMensagem', textoDoErro(e, 'Você não tem permissão para fechar a competência.'));
      } finally {
        processando = false;
      }
    }

    compSel.addEventListener('change', carregar);
    acionar(confirmarBtn, confirmar);
    return carregar();
  }

  // ------------------------------------------------------------ reabrir

  function montarReabrir() {
    const confirmarBtn = el('ctbReabrirConfirmar');
    const campo = el('ctbReabrirJustificativa');
    const competencia = contexto.competencia || '';
    let situacao = null;

    async function carregar() {
      try {
        const r = await fetchApi(`/api/contabilidade/painel?competencia=${encodeURIComponent(competencia)}`);
        situacao = r?.situacao || null;
        el('ctbReabrirRotulo').textContent = r?.rotulo || competencia;
        pintarSituacao(el('ctbReabrirSituacao'), situacao?.status || 'aberta');
        preencherDados(el('ctbReabrirDados'), [
          ['Fechada em', formatarInstante(situacao?.fechada_em)],
          ['Por', situacao?.fechada_por || '—'],
          ['Erros críticos novos desde então', String(situacao?.divergencias ?? 0)]
        ]);
        const podeReabrir = situacao?.status === 'fechada';
        confirmarBtn.classList.toggle('hidden', !podeReabrir);
        if (!podeReabrir) mostrarMensagem('ctbReabrirMensagem', 'Esta competência não está fechada.');
      } catch (e) {
        confirmarBtn.classList.add('hidden');
        mostrarMensagem('ctbReabrirMensagem', textoDoErro(e, 'Você não tem permissão para ver a Contabilidade.'));
      }
    }

    async function confirmar() {
      mostrarMensagem('ctbReabrirMensagem', '');
      const j = String(campo.value || '').trim();
      if (j.length < 10) { mostrarMensagem('ctbReabrirMensagem', 'Escreva a justificativa da reabertura (pelo menos 10 caracteres).'); campo.focus(); return; }
      const confirmado = await (window.DialogPadrao?.confirm
        ? window.DialogPadrao.confirm({ title: 'Reabrir a competência?', message: `${el('ctbReabrirRotulo').textContent} volta a aceitar lançamentos e precisará de um novo fechamento.`, confirmText: 'Reabrir' })
        : Promise.resolve(window.confirm('Reabrir a competência?')));
      if (!confirmado) return;
      processando = true;
      try {
        await enviar('/api/contabilidade/reabrir', 'POST', { competencia, justificativa: j });
        window.showToast?.('Competência reaberta.', 'success');
        processando = false;
        avisarAlteracao();
        fechar();
      } catch (e) {
        mostrarMensagem('ctbReabrirMensagem', textoDoErro(e, 'Você não tem permissão para reabrir a competência.'));
      } finally {
        processando = false;
      }
    }

    acionar(confirmarBtn, confirmar);
    return carregar();
  }

  // ------------------------------------------------------------ ignorar pendência

  function montarIgnorarPendencia() {
    const confirmarBtn = el('ctbIgnorarConfirmar');
    const campo = el('ctbIgnorarJustificativa');
    const p = contexto.pendencia || null;
    const competencia = contexto.competencia || '';

    function pintar() {
      if (!p) {
        confirmarBtn.classList.add('hidden');
        mostrarMensagem('ctbIgnorarMensagem', 'Escolha a pendência na lista da tela.');
        return;
      }
      pintarEtiqueta(el('ctbIgnorarSituacao'), NIVEIS[p.nivel] || p.nivel, p.nivel === 'documental' ? 'badge-warning' : 'badge-neutral');
      preencherDados(el('ctbIgnorarDados'), [
        ['Pendência', p.titulo || '—'],
        ['Detalhe', p.descricao || '—'],
        ['Severidade', NIVEIS[p.nivel] || p.nivel],
        ['Competência', competencia.split('-').reverse().join('/')]
      ]);
      confirmarBtn.classList.toggle('hidden', !p.ignoravel);
      if (!p.ignoravel) mostrarMensagem('ctbIgnorarMensagem', 'Erro crítico não se ignora: resolva-o no Financeiro.');
    }

    async function confirmar() {
      if (!p?.ignoravel) return;
      mostrarMensagem('ctbIgnorarMensagem', '');
      const j = String(campo.value || '').trim();
      if (j.length < 10) { mostrarMensagem('ctbIgnorarMensagem', 'Escreva a justificativa (pelo menos 10 caracteres).'); campo.focus(); return; }
      processando = true;
      try {
        await enviar('/api/contabilidade/pendencias/ignorar', 'POST', { competencia, chave: p.chave, justificativa: j });
        window.showToast?.('Pendência ignorada.', 'success');
        processando = false;
        avisarAlteracao();
        fechar();
      } catch (e) {
        mostrarMensagem('ctbIgnorarMensagem', textoDoErro(e, 'Você não tem permissão para mexer nas pendências.'));
      } finally {
        processando = false;
      }
    }

    acionar(confirmarBtn, confirmar);
    pintar();
    return Promise.resolve();
  }

  // ------------------------------------------------------------ contas a pagar (lista)

  function montarContasPagar() {
    const visaoSel = el('ctbContasPagarVisao');
    const compCampo = el('ctbContasPagarCompetencia');
    const busca = el('ctbContasPagarBusca');
    const corpo = el('ctbContasPagarLista');
    const DO_MES = new Set(['mes', 'pagas', 'todas', 'canceladas']);
    montarCompetencias(compCampo, contexto.competencia);
    if (contexto.visao && [...visaoSel.options].some(o => o.value === contexto.visao)) visaoSel.value = contexto.visao;
    let dados = null;
    let leitura = 0;

    function pintarTotais() {
      const t = dados?.totais || {};
      for (const card of overlay.querySelectorAll('#ctbContasPagarTotais [data-total]')) {
        const x = t[card.dataset.total] || { quantidade: 0, total: 0 };
        card.querySelector('.ctb-total__valor').textContent = formatarMoeda(x.total);
        card.querySelector('.ctb-total__nota').textContent = card.dataset.total === 'pago_no_mes' ? plural(x.quantidade, 'pagamento', 'pagamentos') : plural(x.quantidade, 'parcela', 'parcelas');
      }
    }

    function pintarLista() {
      const termo = normalizar(busca.value.trim());
      const linhas = (dados?.linhas || []).filter(l => !termo || normalizar([l.fornecedor, l.fornecedor_documento, l.descricao, l.numero_documento, l.categoria].join(' ')).includes(termo));
      if (!linhas.length) {
        linhaVazia(corpo, 7, termo ? 'Nenhuma parcela com esta busca.' : 'Nenhuma parcela nesta visão.');
        return;
      }
      corpo.replaceChildren();
      for (const l of linhas) {
        const tr = criar('tr');
        tr.dataset.ctbLinha = '1';
        const acoes = criar('div', 'ctb-celula-acoes');
        if (['a_vencer', 'vence_hoje', 'vencida'].includes(l.situacao)) {
          acoes.appendChild(botaoPequeno('Pagar', 'btn-success', () => abrirOutro('pagar-parcela', { parcela_id: l.parcela_id, titulo_id: l.titulo_id }), { perm: 'contabilidade.pagar.pagar' }));
        }
        acoes.appendChild(botaoPequeno('Abrir', 'btn-neutral', () => abrirOutro('conta-pagar', { titulo_id: l.titulo_id })));
        const pago = l.pagamento ? `Paga em ${formatarData(l.pagamento.data)} · ${formatarMoeda(l.pagamento.valor_pago)}` : null;
        tr.append(
          celula(formatarData(l.vencimento), 'px-4 py-3 ctb-nowrap'),
          celula(l.fornecedor || '—', 'px-4 py-3', l.fornecedor_documento),
          celula(l.descricao, 'px-4 py-3', [l.categoria, l.numero_documento ? `Doc. ${l.numero_documento}` : null].filter(Boolean).join(' · ') || null),
          celula(`${l.numero}/${l.de}`, 'px-4 py-3 ctb-nowrap'),
          celula(formatarMoeda(l.valor), 'px-4 py-3 ctb-num'),
          celula(tag(l.situacao_rotulo, TOM_PARCELA[l.situacao] || 'badge-neutral'), 'px-4 py-3', pago),
          celula(acoes, 'px-4 py-3')
        );
        tr.addEventListener('click', e => {
          if (e.target.closest('button')) return;
          abrirOutro('conta-pagar', { titulo_id: l.titulo_id });
        });
        corpo.appendChild(tr);
      }
      try { window.Permissoes?.aplicarAcoesEColunas?.(corpo); } catch (_) { /* sem permissões carregadas */ }
    }

    async function carregar() {
      const minha = ++leitura;
      mostrarMensagem('ctbContasPagarMensagem', '');
      const doMes = DO_MES.has(visaoSel.value);
      el('ctbContasPagarNota').textContent = doMes ? '' : 'Em aberto e vencidas mostram todas as competências; os quatro números são do mês escolhido.';
      try {
        const r = await fetchApi(`/api/contabilidade/titulos?visao=${encodeURIComponent(visaoSel.value)}&competencia=${encodeURIComponent(compCampo.value || '')}`);
        if (minha !== leitura) return;
        dados = r;
        el('ctbContasPagarRotulo').textContent = rotuloCompetencia(r.competencia);
        pintarTotais();
        pintarLista();
      } catch (e) {
        if (minha !== leitura) return;
        dados = null;
        linhaVazia(corpo, 7, 'A lista não pôde ser lida.');
        mostrarMensagem('ctbContasPagarMensagem', textoDoErro(e, 'Você não tem permissão para ver a Contabilidade.'));
      }
    }

    visaoSel.addEventListener('change', carregar);
    compCampo.addEventListener('change', carregar);
    busca.addEventListener('input', pintarLista);
    el('ctbContasPagarNova').addEventListener('click', () => abrirOutro('conta-pagar-form', { competencia: compCampo.value }));
    el('ctbContasPagarRegistrarDoc').addEventListener('click', () => abrirOutro('registrar-documento', { competencia: compCampo.value }));
    ouvirAlteracoes(carregar);
    return carregar();
  }

  // ------------------------------------------------------------ a conta a pagar

  function montarContaPagar() {
    const id = contexto.titulo_id;
    let dados = null;
    const seletorComprovante = criar('input');
    seletorComprovante.type = 'file';
    seletorComprovante.accept = '.pdf,.png,.jpg,.jpeg';
    seletorComprovante.className = 'hidden';
    overlay.appendChild(seletorComprovante);
    let pagamentoDoComprovante = null;

    function pintar() {
      const t = dados.titulo;
      pintarEtiqueta(el('ctbContaPagarSituacao'), t.situacao_rotulo, TOM_TITULO[t.situacao] || 'badge-neutral');
      el('ctbContaPagarTitulo').lastChild.textContent = t.descricao;
      let documento = 'Nenhum';
      if (dados.documento) {
        const d = dados.documento;
        const rotulo = d.tipo === 'nfe' ? `NF-e ${d.serie ? `${d.serie}/` : ''}${d.numero || ''}` : (d.tipo === 'nfse' ? `NFS-e ${d.numero || ''}` : `Documento ${d.numero || ''}`);
        const b = botaoPequeno(`${rotulo} — abrir`, 'btn-secondary', () => abrirOutro('documento-recebido', { documento_id: d.id }));
        documento = b;
      }
      const linhas = [
        ['Fornecedor', t.fornecedor ? `${t.fornecedor}${t.fornecedor_documento ? ` · ${t.fornecedor_documento}` : ''}` : '—'],
        ['Categoria', t.categoria || '—'],
        ['Nº do documento', t.numero_documento || '—'],
        ['Emissão', formatarData(t.data_emissao)],
        ['Competência', rotuloCompetencia(t.competencia)],
        ['Origem', ORIGENS_TITULO[t.origem] || t.origem],
        ['Valor', formatarMoeda(t.valor_total)],
        ['Pago', formatarMoeda(t.pago)],
        ['Em aberto', formatarMoeda(t.aberto)],
        ['Documento fiscal', documento]
      ];
      if (t.observacao) linhas.push(['Observação', t.observacao]);
      if (t.situacao === 'cancelado') linhas.push(['Cancelada', `${formatarInstante(t.cancelado_em)} — ${t.motivo_cancelamento || ''}`]);
      preencherDados(el('ctbContaPagarDados'), linhas);

      const corpo = el('ctbContaPagarParcelas');
      corpo.replaceChildren();
      const comComprovante = new Set((dados.arquivos || []).filter(a => a.categoria === 'comprovante').flatMap(a => (a.vinculos || []).filter(v => v.alvo_tipo === 'pagamento').map(v => String(v.alvo_id))));
      for (const p of t.parcelas) {
        const acoes = criar('div', 'ctb-celula-acoes');
        if (['a_vencer', 'vence_hoje', 'vencida'].includes(p.situacao)) {
          acoes.appendChild(botaoPequeno('Pagar', 'btn-success', () => abrirOutro('pagar-parcela', { parcela_id: p.id, titulo_id: t.id }), { perm: 'contabilidade.pagar.pagar' }));
        }
        if (p.pagamento) {
          if (!comComprovante.has(String(p.pagamento.id))) {
            acoes.appendChild(botaoPequeno('Comprovante', 'btn-neutral', () => { pagamentoDoComprovante = p.pagamento.id; seletorComprovante.value = ''; seletorComprovante.click(); }, { perm: 'contabilidade.documento.registrar', titulo: 'Anexar o comprovante deste pagamento' }));
          }
          acoes.appendChild(botaoPequeno('Estornar', 'btn-warning', async () => {
            const motivo = await pedirTexto({ titulo: 'Estornar o pagamento?', mensagem: `${formatarMoeda(p.pagamento.valor_pago)} de ${formatarData(p.pagamento.data)} deixa de valer e a parcela volta a ficar em aberto.`, confirmar: 'Estornar' });
            if (motivo === null) return;
            try {
              await enviar(`/api/contabilidade/pagamentos/${encodeURIComponent(p.pagamento.id)}/estornar`, 'POST', { motivo });
              window.showToast?.('Pagamento estornado.', 'success');
              avisarAlteracao();
              await carregar();
            } catch (e) {
              window.showToast?.(textoDoErro(e, 'Você não tem permissão para estornar pagamentos.'), 'error');
            }
          }, { perm: 'contabilidade.pagar.estornar' }));
        }
        if (p.linha_digitavel) {
          acoes.appendChild(botaoPequeno('Copiar linha', 'btn-neutral', async () => {
            try { await navigator.clipboard.writeText(p.linha_digitavel); window.showToast?.('Linha digitável copiada.', 'success'); } catch (_) { window.showToast?.('Não foi possível copiar.', 'error'); }
          }));
        }
        const pagamento = p.pagamento
          ? `${formatarData(p.pagamento.data)} · ${formatarMoeda(p.pagamento.valor_pago)} · ${p.pagamento.forma}`
          : (p.estornos?.length ? `${plural(p.estornos.length, 'pagamento estornado', 'pagamentos estornados')}` : '—');
        const extra = p.pagamento ? [p.pagamento.juros ? `${formatarMoeda(p.pagamento.juros)} de juros/multa` : null, p.pagamento.desconto ? `${formatarMoeda(p.pagamento.desconto)} de desconto` : null].filter(Boolean).join(' · ') || null : null;
        const tr = criar('tr');
        tr.append(
          celula(`${p.numero}/${p.de}`, 'px-4 py-3 ctb-nowrap'),
          celula(formatarData(p.vencimento), 'px-4 py-3 ctb-nowrap'),
          celula(formatarMoeda(p.valor), 'px-4 py-3 ctb-num'),
          celula(tag(p.situacao_rotulo, TOM_PARCELA[p.situacao] || 'badge-neutral'), 'px-4 py-3'),
          celula(pagamento, 'px-4 py-3', extra),
          celula(acoes, 'px-4 py-3')
        );
        corpo.appendChild(tr);
      }
      if (!t.parcelas.length) linhaVazia(corpo, 6, 'Sem parcelas.');
      arquivosEm(el('ctbContaPagarArquivos'), dados.arquivos, { aoMudar: carregar });
      historicoEm(el('ctbContaPagarHistorico'), dados.historico);
      el('ctbContaPagarCancelar').classList.toggle('hidden', t.situacao === 'cancelado' || t.tem_pagamento);
      el('ctbContaPagarEditar').classList.toggle('hidden', t.situacao === 'cancelado');
      try { window.Permissoes?.aplicarAcoesEColunas?.(overlay); } catch (_) { /* sem permissões carregadas */ }
    }

    async function carregar() {
      mostrarMensagem('ctbContaPagarMensagem', '');
      try {
        dados = await fetchApi(`/api/contabilidade/titulos/${encodeURIComponent(id)}`);
        pintar();
      } catch (e) {
        el('ctbContaPagarCancelar').classList.add('hidden');
        el('ctbContaPagarEditar').classList.add('hidden');
        mostrarMensagem('ctbContaPagarMensagem', textoDoErro(e, 'Você não tem permissão para ver a Contabilidade.'));
      }
    }

    seletorComprovante.addEventListener('change', async () => {
      if (!seletorComprovante.files?.[0] || !pagamentoDoComprovante || !dados) return;
      try {
        const arquivo = await arquivoDoCampo(seletorComprovante);
        const pagamento = dados.titulo.parcelas.map(p => p.pagamento).find(pg => pg && String(pg.id) === String(pagamentoDoComprovante));
        await enviar('/api/contabilidade/arquivos', 'POST', {
          ...arquivo, categoria: 'comprovante', competencia: pagamento?.competencia || dados.titulo.competencia,
          vinculos: [{ alvo_tipo: 'pagamento', alvo_id: String(pagamentoDoComprovante) }, { alvo_tipo: 'titulo', alvo_id: String(id) }]
        });
        window.showToast?.('Comprovante anexado.', 'success');
        avisarAlteracao();
        await carregar();
      } catch (e) {
        window.showToast?.(textoDoErro(e, 'Você não tem permissão para anexar arquivos.'), 'error');
      }
    });

    acionar(el('ctbContaPagarAnexar'), async () => {
      if (!dados) return;
      const ok = await anexarDoQuadro({
        campoArquivo: el('ctbContaPagarAnexoArquivo'), campoCategoria: el('ctbContaPagarAnexoCategoria'), campoDescricao: el('ctbContaPagarAnexoDescricao'),
        competencia: dados.titulo.competencia, vinculos: [{ alvo_tipo: 'titulo', alvo_id: String(id) }], mensagemId: 'ctbContaPagarMensagem'
      });
      if (ok) await carregar();
    });

    acionar(el('ctbContaPagarCancelar'), async () => {
      if (!dados) return;
      const motivo = await pedirTexto({ titulo: 'Cancelar a conta?', mensagem: `${dados.titulo.descricao} (${formatarMoeda(dados.titulo.valor_total)}) deixa de ser cobrada. O histórico fica.`, confirmar: 'Cancelar conta' });
      if (motivo === null) return;
      try {
        await enviar(`/api/contabilidade/titulos/${encodeURIComponent(id)}/cancelar`, 'POST', { motivo });
        window.showToast?.('Conta cancelada.', 'success');
        avisarAlteracao();
        await carregar();
      } catch (e) {
        mostrarMensagem('ctbContaPagarMensagem', textoDoErro(e, 'Você não tem permissão para cancelar contas.'));
      }
    });

    el('ctbContaPagarEditar').addEventListener('click', () => abrirOutro('conta-pagar-form', { titulo_id: id }));
    ouvirAlteracoes(carregar);
    return carregar();
  }

  // ------------------------------------------------------------ nova conta / editar

  function montarContaPagarForm() {
    const id = contexto.titulo_id || null;
    const documentoInicial = contexto.documento_id || null;
    const fornecedorSel = el('ctbContaFormFornecedor');
    const documentoSel = el('ctbContaFormDocumento');
    const valorCampo = el('ctbContaFormValor');
    const compCampo = el('ctbContaFormCompetencia');
    const corpoParcelas = el('ctbContaFormParcelas');
    const emissaoCampo = el('ctbContaFormEmissao');
    const primeiroCampo = el('ctbContaFormPrimeiro');
    let parcelas = [];
    let travada = false;
    montarCompetencias(compCampo, contexto.competencia);
    primeiroCampo.value = hojeLocal();

    function pintarSoma() {
      const total = lerMoeda(valorCampo.value) || 0;
      const soma = Math.round(parcelas.reduce((s, p) => s + (lerMoeda(p.valor) || 0), 0) * 100) / 100;
      const alvo = el('ctbContaFormSoma');
      alvo.textContent = parcelas.length ? `Soma das parcelas: ${formatarMoeda(soma)} de ${formatarMoeda(total)}` : 'Divida o valor em parcelas.';
      alvo.dataset.ok = parcelas.length && Math.abs(soma - total) < 0.01 ? '1' : '0';
    }

    function pintarParcelas() {
      corpoParcelas.replaceChildren();
      if (!parcelas.length) { linhaVazia(corpoParcelas, 4, 'Informe a quantidade e o 1º vencimento e clique em "Dividir em parcelas mensais".'); pintarSoma(); return; }
      parcelas.forEach((p, i) => {
        const tr = criar('tr');
        const venc = criar('input', 'w-full ctl-campo ctl-campo--pequeno bg-input border border-inputBorder text-white');
        venc.type = 'date';
        venc.value = p.vencimento || '';
        venc.disabled = travada;
        venc.addEventListener('input', () => { parcelas[i].vencimento = venc.value; });
        const valor = criar('input', 'w-full ctl-campo ctl-campo--pequeno bg-input border border-inputBorder text-white');
        valor.type = 'text';
        valor.inputMode = 'decimal';
        valor.value = typeof p.valor === 'number' ? numeroBr(p.valor) : (p.valor || '');
        valor.disabled = travada;
        valor.addEventListener('input', () => { parcelas[i].valor = valor.value; pintarSoma(); });
        ligarCampoMoeda(valor, () => { parcelas[i].valor = valor.value; pintarSoma(); });
        const linha = criar('input', 'w-full ctl-campo ctl-campo--pequeno bg-input border border-inputBorder text-white placeholder-gray-400');
        linha.type = 'text';
        linha.maxLength = 60;
        linha.placeholder = 'Opcional';
        linha.value = p.linha_digitavel || '';
        linha.addEventListener('input', () => { parcelas[i].linha_digitavel = linha.value; });
        tr.append(celula(`${i + 1}`, 'px-4 py-3 ctb-nowrap'), celula(venc), celula(valor), celula(linha));
        corpoParcelas.appendChild(tr);
      });
      pintarSoma();
    }

    function dividir() {
      mostrarMensagem('ctbContaFormMensagem', '');
      const lista = dividirParcelas(el('ctbContaFormQuantidade').value, primeiroCampo.value, lerMoeda(valorCampo.value));
      if (!lista) { mostrarMensagem('ctbContaFormMensagem', 'Para dividir: valor, quantidade (1 a 60) e o 1º vencimento.'); return; }
      parcelas = lista;
      pintarParcelas();
    }

    async function carregarDocumentos(selecionado) {
      const r = await fetchApi('/api/contabilidade/documentos').catch(() => ({ linhas: [] }));
      const livres = (r.linhas || []).filter(d => (!d.titulo && !d.financeiro_pagamento && !d.sem_pagamento) || String(d.id) === String(selecionado));
      documentoSel.replaceChildren(opcao('', 'Nenhum (a nota pode ser ligada depois)'),
        ...livres.map(d => opcao(String(d.id), `${d.rotulo} · ${d.emitente || 'emitente'} · ${formatarMoeda(d.valor_total)} · ${formatarData(d.data_emissao)}`)));
      if (selecionado) documentoSel.value = String(selecionado);
      return livres;
    }

    async function carregar() {
      try {
        const [, categorias] = await Promise.all([
          carregarFornecedores(fornecedorSel),
          fetchApi('/api/contabilidade/categorias').catch(() => ({ categorias: [] }))
        ]);
        el('ctbContaFormCategorias').replaceChildren(...(categorias.categorias || []).map(c => opcao(c, c)));
        if (id) {
          const r = await fetchApi(`/api/contabilidade/titulos/${encodeURIComponent(id)}`);
          const t = r.titulo;
          travada = Boolean(t.tem_pagamento);
          el('ctbContaFormTitulo').lastChild.textContent = 'Editar conta a pagar';
          pintarEtiqueta(el('ctbContaFormSituacao'), t.situacao_rotulo, TOM_TITULO[t.situacao] || 'badge-neutral');
          if (t.contato_id) fornecedorSel.value = String(t.contato_id);
          el('ctbContaFormDescricao').value = t.descricao || '';
          el('ctbContaFormCategoria').value = t.categoria || '';
          el('ctbContaFormNumero').value = t.numero_documento || '';
          emissaoCampo.value = t.data_emissao || '';
          if (window.Competencia) window.Competencia.definir(compCampo, t.competencia); else compCampo.value = t.competencia;
          valorCampo.value = numeroBr(t.valor_total);
          el('ctbContaFormObservacao').value = t.observacao || '';
          parcelas = t.parcelas.map(p => ({ vencimento: p.vencimento, valor: p.valor, linha_digitavel: p.linha_digitavel || '' }));
          await carregarDocumentos(t.documento_recebido_id);
          if (travada) {
            const aviso = el('ctbContaFormTravada');
            aviso.textContent = 'Esta conta já tem pagamento: valor, competência, emissão, documento e parcelas ficam como estão (estorne o pagamento para mudar). Descrição, categoria, fornecedor, observação e linha digitável mudam.';
            aviso.classList.remove('hidden');
            for (const campo of [valorCampo, emissaoCampo, documentoSel, el('ctbContaFormQuantidade'), primeiroCampo, el('ctbContaFormDividir')]) campo.disabled = true;
            window.Competencia?.desabilitar?.(compCampo, true);
          }
        } else if (documentoInicial) {
          const r = await fetchApi(`/api/contabilidade/documentos/${encodeURIComponent(documentoInicial)}`);
          const d = r.documento;
          el('ctbContaFormDescricao').value = `${d.rotulo} — ${d.emitente || 'fornecedor'}`;
          el('ctbContaFormNumero').value = d.numero || '';
          emissaoCampo.value = d.data_emissao || '';
          if (window.Competencia) window.Competencia.definir(compCampo, d.competencia); else compCampo.value = d.competencia;
          valorCampo.value = numeroBr(d.valor_total);
          if (d.contato_id) fornecedorSel.value = String(d.contato_id);
          primeiroCampo.value = d.data_emissao || hojeLocal();
          await carregarDocumentos(d.id);
          dividir();
        } else {
          await carregarDocumentos(null);
        }
        pintarParcelas();
      } catch (e) {
        el('ctbContaFormSalvar').classList.add('hidden');
        mostrarMensagem('ctbContaFormMensagem', textoDoErro(e, 'Você não tem permissão para ver a Contabilidade.'));
      }
    }

    async function salvar() {
      mostrarMensagem('ctbContaFormMensagem', '');
      const valor = lerMoeda(valorCampo.value);
      const descricao = el('ctbContaFormDescricao').value.trim();
      if (descricao.length < 3) { mostrarMensagem('ctbContaFormMensagem', 'Descreva a conta (ao menos 3 letras).'); return; }
      if (!(valor > 0)) { mostrarMensagem('ctbContaFormMensagem', 'Informe o valor da conta.'); return; }
      if (!parcelas.length) { mostrarMensagem('ctbContaFormMensagem', 'Divida o valor em parcelas.'); return; }
      if (el('ctbContaFormSoma').dataset.ok !== '1') { mostrarMensagem('ctbContaFormMensagem', 'A soma das parcelas não bate com o valor da conta.'); return; }
      const corpo = {
        descricao, categoria: el('ctbContaFormCategoria').value, numero_documento: el('ctbContaFormNumero').value,
        data_emissao: emissaoCampo.value || null, competencia: compCampo.value, valor_total: valor,
        contato_id: fornecedorSel.value || null, documento_recebido_id: documentoSel.value || null,
        observacao: el('ctbContaFormObservacao').value,
        parcelas: parcelas.map(p => ({ vencimento: p.vencimento, valor: lerMoeda(p.valor), linha_digitavel: p.linha_digitavel || null }))
      };
      processando = true;
      try {
        if (id) await enviar(`/api/contabilidade/titulos/${encodeURIComponent(id)}`, 'PUT', corpo);
        else await enviar('/api/contabilidade/titulos', 'POST', corpo);
        window.showToast?.(id ? 'Conta alterada.' : 'Conta lançada.', 'success');
        processando = false;
        avisarAlteracao();
        fechar();
      } catch (e) {
        mostrarMensagem('ctbContaFormMensagem', textoDoErro(e, 'Você não tem permissão para lançar contas a pagar.'));
      } finally {
        processando = false;
      }
    }

    ligarCampoMoeda(valorCampo, pintarSoma);
    el('ctbContaFormDividir').addEventListener('click', dividir);
    ligarNovoContato(el('ctbContaFormNovoContato'), fornecedorSel);
    acionar(el('ctbContaFormSalvar'), salvar);
    return carregar();
  }

  // ------------------------------------------------------------ pagar parcela

  function montarPagarParcela() {
    const parcelaId = contexto.parcela_id;
    const tituloId = contexto.titulo_id;
    const dataCampo = el('ctbPagarData');
    const valorCampo = el('ctbPagarValor');
    const formaSel = el('ctbPagarForma');
    const confirmarBtn = el('ctbPagarConfirmar');
    const hoje = hojeLocal();
    dataCampo.max = hoje;
    dataCampo.value = hoje;
    let parcela = null;
    let titulo = null;

    function pintarDiferenca() {
      const alvo = el('ctbPagarDiferenca');
      const pago = lerMoeda(valorCampo.value);
      if (!parcela || pago === null) { alvo.textContent = ''; return; }
      const dif = Math.round((pago - parcela.valor) * 100) / 100;
      alvo.textContent = dif > 0 ? `${formatarMoeda(dif)} acima da parcela: fica como juros/multa.` : (dif < 0 ? `${formatarMoeda(-dif)} abaixo da parcela: fica como desconto.` : 'O valor da parcela.');
    }

    async function carregar() {
      try {
        const r = await fetchApi(`/api/contabilidade/titulos/${encodeURIComponent(tituloId)}`);
        titulo = r.titulo;
        parcela = titulo.parcelas.find(p => String(p.id) === String(parcelaId)) || null;
        formaSel.replaceChildren(opcao('', 'Selecione'), ...(r.formas || []).map(f => opcao(f, f)));
        if (!parcela) throw new Error('Parcela não encontrada.');
        pintarEtiqueta(el('ctbPagarSituacao'), parcela.situacao_rotulo, TOM_PARCELA[parcela.situacao] || 'badge-neutral');
        preencherDados(el('ctbPagarDados'), [
          ['Conta', titulo.descricao],
          ['Fornecedor', titulo.fornecedor || '—'],
          ['Parcela', `${parcela.numero} de ${parcela.de}`],
          ['Vencimento', formatarData(parcela.vencimento)],
          ['Valor da parcela', formatarMoeda(parcela.valor)],
          ['Linha digitável', parcela.linha_digitavel || '—']
        ]);
        valorCampo.value = numeroBr(parcela.valor);
        if (parcela.pagamento || titulo.situacao === 'cancelado') {
          confirmarBtn.classList.add('hidden');
          mostrarMensagem('ctbPagarMensagem', parcela.pagamento ? `Esta parcela já foi paga em ${formatarData(parcela.pagamento.data)}.` : 'Esta conta foi cancelada.');
        }
        pintarDiferenca();
      } catch (e) {
        confirmarBtn.classList.add('hidden');
        mostrarMensagem('ctbPagarMensagem', textoDoErro(e, 'Você não tem permissão para ver a Contabilidade.'));
      }
    }

    async function confirmar() {
      mostrarMensagem('ctbPagarMensagem', '');
      const valor = lerMoeda(valorCampo.value);
      const erro = !dataCampo.value ? 'Informe a data do pagamento.'
        : dataCampo.value > hoje ? 'A data do pagamento não pode ser futura.'
          : !(valor > 0) ? 'Informe o valor pago.'
            : !formaSel.value ? 'Informe como foi pago.' : '';
      if (erro) { mostrarMensagem('ctbPagarMensagem', erro); return; }
      let comprovante = null;
      try {
        comprovante = await arquivoDoCampo(el('ctbPagarComprovante'));
      } catch (e) {
        mostrarMensagem('ctbPagarMensagem', e.message);
        return;
      }
      processando = true;
      try {
        const r = await enviar(`/api/contabilidade/parcelas/${encodeURIComponent(parcelaId)}/pagar`, 'POST', {
          data_pagamento: dataCampo.value, valor_pago: valor, forma: formaSel.value, observacao: el('ctbPagarObservacao').value, comprovante
        });
        window.showToast?.('Pagamento registrado.', 'success');
        if (r?.aviso) window.showToast?.(r.aviso, 'error');
        processando = false;
        avisarAlteracao();
        fechar();
      } catch (e) {
        mostrarMensagem('ctbPagarMensagem', textoDoErro(e, 'Você não tem permissão para registrar pagamentos.'));
      } finally {
        processando = false;
      }
    }

    ligarCampoMoeda(valorCampo, pintarDiferenca);
    acionar(confirmarBtn, confirmar);
    return carregar();
  }

  // ------------------------------------------------------------ documentos recebidos (lista)

  function montarDocumentosRecebidos() {
    const compCampo = el('ctbDocsCompetencia');
    const tipoSel = el('ctbDocsTipo');
    const busca = el('ctbDocsBusca');
    const corpo = el('ctbDocsLista');
    montarCompetencias(compCampo, contexto.competencia, { vazio: 'Todas' });
    let dados = null;
    let leitura = 0;

    function tagDoPagamento(d) {
      if (d.titulo) return tag('Com conta', 'badge-info', d.titulo.descricao);
      if (d.financeiro_pagamento) return tag('Fechamento', 'badge-info', d.financeiro_pagamento.rotulo);
      if (d.sem_pagamento) return tag('Sem pagamento', 'badge-neutral');
      return tag('Sem conta', 'badge-warning');
    }

    function tagDoArquivo(d) {
      if (d.falta_xml) return tag('Falta o XML', 'badge-danger');
      if (d.falta_arquivo) return tag('Falta o arquivo', 'badge-danger');
      return tag(d.tem_xml ? 'XML' : plural(d.arquivos, 'arquivo', 'arquivos'), 'badge-success');
    }

    function pintar() {
      const totais = dados?.totais || {};
      for (const card of overlay.querySelectorAll('#ctbDocsTotais [data-total]')) {
        const x = totais[card.dataset.total] || { quantidade: 0, total: 0 };
        card.querySelector('.ctb-total__valor').textContent = formatarMoeda(x.total);
        card.querySelector('.ctb-total__nota').textContent = plural(x.quantidade, 'documento', 'documentos');
      }
      const termo = normalizar(busca.value.trim());
      const linhas = (dados?.linhas || []).filter(d => !termo || normalizar([d.rotulo, d.emitente, d.emitente_documento, d.chave_acesso, d.numero, d.descricao].join(' ')).includes(termo));
      if (!linhas.length) { linhaVazia(corpo, 7, termo ? 'Nenhum documento com esta busca.' : 'Nenhum documento nesta competência.'); return; }
      corpo.replaceChildren();
      for (const d of linhas) {
        const tr = criar('tr');
        tr.dataset.ctbLinha = '1';
        const acoes = criar('div', 'ctb-celula-acoes');
        acoes.appendChild(botaoPequeno('Abrir', 'btn-neutral', () => abrirOutro('documento-recebido', { documento_id: d.id })));
        tr.append(
          celula(formatarData(d.data_emissao), 'px-4 py-3 ctb-nowrap'),
          celula(d.rotulo, 'px-4 py-3', d.tipo === 'nfse' ? d.municipio : (d.tipo === 'outro' ? d.descricao : d.origem_rotulo)),
          celula(d.emitente || '—', 'px-4 py-3', d.emitente_documento),
          celula(formatarMoeda(d.valor_total), 'px-4 py-3 ctb-num'),
          celula(tagDoPagamento(d), 'px-4 py-3'),
          celula(tagDoArquivo(d), 'px-4 py-3'),
          celula(acoes, 'px-4 py-3')
        );
        tr.addEventListener('click', e => { if (!e.target.closest('button')) abrirOutro('documento-recebido', { documento_id: d.id }); });
        corpo.appendChild(tr);
      }
    }

    async function carregar() {
      const minha = ++leitura;
      mostrarMensagem('ctbDocsMensagem', '');
      try {
        const consulta = new URLSearchParams();
        if (compCampo.value) consulta.set('competencia', compCampo.value);
        if (tipoSel.value) consulta.set('tipo', tipoSel.value);
        const r = await fetchApi(`/api/contabilidade/documentos?${consulta}`);
        if (minha !== leitura) return;
        dados = r;
        el('ctbDocsRotulo').textContent = compCampo.value ? rotuloCompetencia(compCampo.value) : 'Todas';
        pintar();
      } catch (e) {
        if (minha !== leitura) return;
        dados = null;
        linhaVazia(corpo, 7, 'A lista não pôde ser lida.');
        mostrarMensagem('ctbDocsMensagem', textoDoErro(e, 'Você não tem permissão para ver a Contabilidade.'));
      }
    }

    compCampo.addEventListener('change', carregar);
    tipoSel.addEventListener('change', carregar);
    busca.addEventListener('input', pintar);
    el('ctbDocsRegistrar').addEventListener('click', () => abrirOutro('registrar-documento', { competencia: compCampo.value || contexto.competencia }));
    ouvirAlteracoes(carregar);
    return carregar();
  }

  // ------------------------------------------------------------ registrar documento

  function montarRegistrarDocumento() {
    const hoje = hojeLocal();
    const gerarConta = el('ctbDocGerarConta');
    const semPagamento = el('ctbDocSemPagamento');
    const referenteSel = el('ctbDocNfseReferente');
    const registrarBtn = el('ctbDocRegistrar');
    let aba = contexto.tipo === 'nfse' ? 'nfse' : (['xml', 'chave', 'outro'].includes(contexto.aba) ? contexto.aba : 'xml');
    let previaXml = null;
    let xmlTexto = null;
    let pagamentos = [];
    for (const campo of ['ctbDocChaveData', 'ctbDocNfseData', 'ctbDocOutroData']) { el(campo).max = hoje; el(campo).value = hoje; }
    el('ctbDocContaVencimento').value = hoje;
    for (const campo of ['ctbDocChaveValor', 'ctbDocNfseValor', 'ctbDocNfseIss', 'ctbDocNfseRetencoes', 'ctbDocOutroValor']) ligarCampoMoeda(el(campo));
    if (window.Permissoes?.pode && !window.Permissoes.pode('contabilidade.pagar.lancar')) gerarConta.checked = false;

    const pagamentoEscolhido = () => pagamentos.find(p => String(p.id) === String(referenteSel.value)) || null;

    function pintarConta() {
      const ligadaAoFechamento = aba === 'nfse' && Boolean(referenteSel.value);
      el('ctbDocContaBloco').classList.toggle('hidden', ligadaAoFechamento);
      if (semPagamento.checked) gerarConta.checked = false;
      const mostraCampos = gerarConta.checked && !gerarConta.disabled && !ligadaAoFechamento;
      el('ctbDocContaCampos').classList.toggle('hidden', !mostraCampos);
      const dups = aba === 'xml' ? (previaXml?.duplicatas || []) : [];
      const nota = el('ctbDocContaDuplicatas');
      nota.classList.toggle('hidden', !(mostraCampos && dups.length));
      nota.textContent = dups.length ? `As parcelas seguem as ${plural(dups.length, 'duplicata', 'duplicatas')} da nota: ${dups.map(d => `${formatarData(d.vencimento)} ${formatarMoeda(d.valor)}`).join(' · ')}` : '';
      for (const campo of ['ctbDocContaQuantidade', 'ctbDocContaVencimento']) el(campo).closest('div').classList.toggle('hidden', Boolean(dups.length));
    }

    function trocarAba(nome) {
      aba = nome;
      for (const b of overlay.querySelectorAll('[data-ctb-aba]')) b.setAttribute('aria-selected', String(b.dataset.ctbAba === nome));
      for (const p of overlay.querySelectorAll('[data-ctb-painel]')) p.classList.toggle('hidden', p.dataset.ctbPainel !== nome);
      el('ctbDocArquivoBloco').classList.toggle('hidden', nome === 'xml');
      pintarConta();
      pintarCompetencia();
      mostrarMensagem('ctbDocMensagem', '');
    }

    function dataDaAba() {
      if (aba === 'xml') return previaXml?.data_emissao || null;
      return el({ chave: 'ctbDocChaveData', nfse: 'ctbDocNfseData', outro: 'ctbDocOutroData' }[aba]).value || null;
    }

    function pintarCompetencia() {
      const d = dataDaAba();
      el('ctbDocRegCompetencia').textContent = d ? rotuloCompetencia(d.slice(0, 7)) : '—';
    }

    function pintarPreviaXml() {
      const p = previaXml;
      el('ctbDocXmlPrevia').classList.toggle('hidden', !p);
      if (!p) return;
      const contato = p.contato ? `${p.contato.nome} (já cadastrado)` : 'Ainda não é contato';
      preencherDados(el('ctbDocXmlDados'), [
        ['Nota', `NF-e ${p.serie}/${p.numero}`],
        ['Emissão', formatarData(p.data_emissao)],
        ['Emitente', `${p.emitente?.nome || '—'}${p.emitente?.documento ? ` · ${p.emitente.documento}` : ''}`],
        ['Cidade', [p.emitente?.cidade, p.emitente?.estado].filter(Boolean).join(' / ') || '—'],
        ['Fornecedor', contato],
        ['Natureza', p.natureza_operacao || '—'],
        ['Valor total', formatarMoeda(p.valor_total)],
        ['Produtos', formatarMoeda(p.valor_produtos)],
        ['ICMS / IPI / frete', `${formatarMoeda(p.valor_icms)} / ${formatarMoeda(p.valor_ipi)} / ${formatarMoeda(p.valor_frete)}`],
        ['CFOPs', (p.cfops || []).join(', ') || '—'],
        ['Protocolo SEFAZ', p.protocolo || '—'],
        ['Chave', String(p.chave_acesso || '').replace(/(\d{4})/g, '$1 ').trim()]
      ]);
      const bloqueios = el('ctbDocXmlBloqueios');
      bloqueios.replaceChildren(...(p.bloqueios || []).map(t => itemDaLista(t, 'fa-ban')));
      bloqueios.classList.toggle('hidden', !(p.bloqueios || []).length);
      const avisos = el('ctbDocXmlAvisos');
      avisos.replaceChildren(...(p.avisos || []).map(t => itemDaLista(t, 'fa-info-circle')));
      avisos.classList.toggle('hidden', !(p.avisos || []).length);
      el('ctbDocXmlCriarBloco').classList.toggle('hidden', Boolean(p.contato));
      const corpo = el('ctbDocXmlItens');
      corpo.replaceChildren();
      for (const i of p.itens || []) {
        const tr = criar('tr');
        tr.append(celula(i.descricao), celula(i.ncm, 'px-4 py-3 ctb-nowrap'), celula(i.cfop, 'px-4 py-3 ctb-nowrap'),
          celula(`${Number(i.quantidade || 0).toLocaleString('pt-BR')} ${i.unidade || ''}`.trim(), 'px-4 py-3 ctb-num'), celula(formatarMoeda(i.valor_total), 'px-4 py-3 ctb-num'));
        corpo.appendChild(tr);
      }
      if (!(p.itens || []).length) linhaVazia(corpo, 5, 'A nota não tem itens.');
      registrarBtn.disabled = Boolean((p.bloqueios || []).length);
      pintarConta();
      pintarCompetencia();
    }

    async function lerXml() {
      mostrarMensagem('ctbDocMensagem', '');
      previaXml = null;
      xmlTexto = null;
      registrarBtn.disabled = false;
      pintarPreviaXml();
      const arquivo = el('ctbDocXmlArquivo').files?.[0];
      if (!arquivo) return;
      try {
        xmlTexto = await lerTexto(arquivo);
        previaXml = await enviar('/api/contabilidade/documentos/previa', 'POST', { xml: xmlTexto });
        pintarPreviaXml();
      } catch (e) {
        xmlTexto = null;
        mostrarMensagem('ctbDocMensagem', textoDoErro(e, 'Você não tem permissão para registrar documentos.'));
      }
    }

    async function conferirChave() {
      const alvo = el('ctbDocChaveResultado');
      alvo.textContent = '';
      mostrarMensagem('ctbDocMensagem', '');
      try {
        const r = await enviar('/api/contabilidade/documentos/previa', 'POST', {
          chave: el('ctbDocChave').value, data_emissao: el('ctbDocChaveData').value, valor_total: lerMoeda(el('ctbDocChaveValor').value), emitente_nome: el('ctbDocChaveNome').value
        });
        const partes = [`NF-e ${r.serie}/${r.numero}`, `emitente ${r.emitente?.documento || '—'}`, r.contato ? `fornecedor: ${r.contato.nome}` : 'ainda não é contato'];
        alvo.textContent = partes.join(' · ');
        if (r.bloqueios?.length) mostrarMensagem('ctbDocMensagem', r.bloqueios.join(' '));
        else if (r.contato && !el('ctbDocChaveNome').value) el('ctbDocChaveNome').value = r.contato.nome;
      } catch (e) {
        mostrarMensagem('ctbDocMensagem', textoDoErro(e, 'Você não tem permissão para registrar documentos.'));
      }
    }

    async function carregar() {
      try {
        const [forn, fech, cat] = await Promise.all([
          carregarFornecedores(el('ctbDocNfsePrestador'), { vazio: 'Não é contato (preencha CNPJ/CPF e nome abaixo)' }),
          fetchApi('/api/contabilidade/fechamentos-pagos').catch(() => ({ pagamentos: [] })),
          fetchApi('/api/contabilidade/categorias').catch(() => ({ categorias: [] }))
        ]);
        const outro = el('ctbDocOutroEmitente');
        outro.replaceChildren(opcao('', 'Não é contato (use o nome abaixo)'), ...forn.lista.map(f => opcao(String(f.id), [f.nome, f.documento].filter(Boolean).join(' · '))));
        pagamentos = Array.isArray(fech.pagamentos) ? fech.pagamentos : [];
        referenteSel.replaceChildren(opcao('', 'Não — é uma NFS-e avulsa (gera conta a pagar)'),
          ...pagamentos.map(p => opcao(String(p.id), `${p.rotulo} · ${formatarMoeda(p.valor)} pagos em ${formatarData(p.data)}${p.falta > 0 ? ` · falta NFS-e de ${formatarMoeda(p.falta)}` : ' · completo'}`)));
        el('ctbDocContaCategorias').replaceChildren(...(cat.categorias || []).map(c => opcao(c, c)));
        if (contexto.financeiro_pagamento_id) {
          referenteSel.value = String(contexto.financeiro_pagamento_id);
          const p = pagamentoEscolhido();
          if (p) el('ctbDocNfseValor').value = numeroBr(p.falta || p.valor);
        }
      } catch (e) {
        mostrarMensagem('ctbDocMensagem', textoDoErro(e, 'Você não tem permissão para ver a Contabilidade.'));
      }
      trocarAba(aba);
    }

    /** A entrada do POST /documentos, conforme a aba. null = faltou algo (a mensagem já está na tela). */
    async function montarEntrada() {
      const comum = {
        observacao: el('ctbDocObservacao').value, sem_pagamento: semPagamento.checked,
        gerar_titulo: gerarConta.checked && !gerarConta.disabled && !semPagamento.checked && !(aba === 'nfse' && referenteSel.value)
      };
      if (comum.gerar_titulo) {
        comum.titulo = { categoria: el('ctbDocContaCategoria').value };
        const dups = aba === 'xml' ? (previaXml?.duplicatas || []) : [];
        if (!dups.length) {
          const total = aba === 'xml' ? previaXml?.valor_total : lerMoeda(el({ chave: 'ctbDocChaveValor', nfse: 'ctbDocNfseValor', outro: 'ctbDocOutroValor' }[aba]).value);
          const lista = dividirParcelas(el('ctbDocContaQuantidade').value, el('ctbDocContaVencimento').value, total);
          if (!lista) { mostrarMensagem('ctbDocMensagem', 'Para lançar a conta: valor, parcelas (1 a 60) e o 1º vencimento.'); return null; }
          comum.titulo.parcelas = lista;
        }
      }
      let arquivo = null;
      if (aba !== 'xml') {
        try { arquivo = await arquivoDoCampo(el('ctbDocArquivo')); } catch (e) { mostrarMensagem('ctbDocMensagem', e.message); return null; }
      }
      if (aba === 'xml') {
        if (!xmlTexto || !previaXml) { mostrarMensagem('ctbDocMensagem', 'Escolha o XML da nota.'); return null; }
        return { ...comum, tipo: 'nfe', xml: xmlTexto, criar_fornecedor: el('ctbDocXmlCriarFornecedor').checked };
      }
      if (aba === 'chave') {
        return { ...comum, tipo: 'nfe', chave: el('ctbDocChave').value, data_emissao: el('ctbDocChaveData').value, valor_total: lerMoeda(el('ctbDocChaveValor').value), emitente_nome: el('ctbDocChaveNome').value, arquivo };
      }
      if (aba === 'nfse') {
        return {
          ...comum, tipo: 'nfse', contato_id: el('ctbDocNfsePrestador').value || null, emitente_documento: el('ctbDocNfseDocumento').value, emitente_nome: el('ctbDocNfseNome').value,
          numero: el('ctbDocNfseNumero').value, codigo_verificacao: el('ctbDocNfseVerificacao').value, data_emissao: el('ctbDocNfseData').value, municipio: el('ctbDocNfseMunicipio').value,
          valor_total: lerMoeda(el('ctbDocNfseValor').value), valor_iss: el('ctbDocNfseIss').value ? lerMoeda(el('ctbDocNfseIss').value) : null, iss_retido: el('ctbDocNfseIssRetido').checked,
          valor_retencoes: el('ctbDocNfseRetencoes').value ? lerMoeda(el('ctbDocNfseRetencoes').value) : null, descricao: el('ctbDocNfseDescricao').value,
          financeiro_pagamento_id: referenteSel.value || null, arquivo
        };
      }
      return {
        ...comum, tipo: 'outro', especie: el('ctbDocOutroEspecie').value, numero: el('ctbDocOutroNumero').value, descricao: el('ctbDocOutroDescricao').value,
        contato_id: el('ctbDocOutroEmitente').value || null, emitente_nome: el('ctbDocOutroNome').value, data_emissao: el('ctbDocOutroData').value,
        valor_total: lerMoeda(el('ctbDocOutroValor').value), arquivo
      };
    }

    async function registrar() {
      mostrarMensagem('ctbDocMensagem', '');
      const entrada = await montarEntrada();
      if (!entrada) return;
      processando = true;
      try {
        const r = await enviar('/api/contabilidade/documentos', 'POST', entrada);
        processando = false;
        const partes = ['Documento registrado'];
        if (r.contato_criado) partes.push('fornecedor cadastrado em Contatos');
        if (r.titulo_id) partes.push('conta a pagar lançada');
        window.showToast?.(`${partes.join(', ')}.`, 'success');
        if (r.avisos?.length && window.DialogPadrao?.info) {
          await window.DialogPadrao.info({ title: 'Registrado, com avisos', tom: 'aviso', message: r.avisos.join('\n') });
        }
        avisarAlteracao();
        fechar();
      } catch (e) {
        mostrarMensagem('ctbDocMensagem', textoDoErro(e, 'Você não tem permissão para registrar documentos (ou para lançar a conta junto).'));
      } finally {
        processando = false;
      }
    }

    for (const b of overlay.querySelectorAll('[data-ctb-aba]')) b.addEventListener('click', () => trocarAba(b.dataset.ctbAba));
    el('ctbDocXmlArquivo').addEventListener('change', lerXml);
    el('ctbDocChaveConferir').addEventListener('click', conferirChave);
    for (const campo of ['ctbDocChaveData', 'ctbDocNfseData', 'ctbDocOutroData']) el(campo).addEventListener('change', pintarCompetencia);
    referenteSel.addEventListener('change', () => {
      const p = pagamentoEscolhido();
      if (p && !el('ctbDocNfseValor').value) el('ctbDocNfseValor').value = numeroBr(p.falta || p.valor);
      pintarConta();
    });
    gerarConta.addEventListener('change', () => { if (gerarConta.checked) semPagamento.checked = false; pintarConta(); });
    semPagamento.addEventListener('change', pintarConta);
    ligarNovoContato(el('ctbDocNfseNovoContato'), el('ctbDocNfsePrestador'));
    acionar(registrarBtn, registrar);
    return carregar();
  }

  // ------------------------------------------------------------ a ficha do documento

  function montarDocumentoRecebido() {
    const id = contexto.documento_id;
    let dados = null;

    function pintar() {
      const d = dados.documento;
      pintarEtiqueta(el('ctbDocDetTipo'), d.tipo_rotulo, d.tipo === 'nfe' ? 'badge-info' : (d.tipo === 'nfse' ? 'badge-warning' : 'badge-neutral'));
      el('ctbDocDetTitulo').lastChild.textContent = d.rotulo;
      const linhas = [
        ['Documento', d.rotulo],
        ['Emitente', `${d.emitente || '—'}${d.emitente_documento ? ` · ${d.emitente_documento}` : ''}`],
        ['Emissão', formatarData(d.data_emissao)],
        ['Competência', rotuloCompetencia(d.competencia)],
        ['Valor', formatarMoeda(d.valor_total)],
        ['Origem', d.origem_rotulo]
      ];
      if (d.tipo === 'nfe') linhas.push(['Chave', d.chave_acesso ? d.chave_acesso.replace(/(\d{4})/g, '$1 ').trim() : '—'], ['CFOPs', d.cfops || '—'], ['Protocolo SEFAZ', d.protocolo || '—']);
      if (d.tipo === 'nfse') {
        linhas.push(['Município', d.municipio || '—'], ['Código de verificação', d.codigo_verificacao || '—'],
          ['ISS', d.valor_iss === null ? '—' : `${formatarMoeda(d.valor_iss)}${d.iss_retido ? ' (retido)' : ''}`], ['Outras retenções', formatarMoeda(d.valor_retencoes)]);
      }
      if (d.descricao) linhas.push(['Descrição', d.descricao]);
      if (d.observacao) linhas.push(['Observação', d.observacao]);
      preencherDados(el('ctbDocDetDados'), linhas);

      const texto = el('ctbDocDetContaTexto');
      const abrir = el('ctbDocDetAbrirConta');
      const lancar = el('ctbDocDetLancarConta');
      abrir.classList.add('hidden');
      lancar.classList.add('hidden');
      if (d.titulo) {
        texto.textContent = `Conta a pagar: ${d.titulo.descricao}.`;
        abrir.classList.remove('hidden');
      } else if (d.financeiro_pagamento) {
        texto.textContent = `Nota de serviço de ${d.financeiro_pagamento.rotulo}: ${formatarMoeda(d.financeiro_pagamento.valor)} pagos em ${formatarData(d.financeiro_pagamento.data)} (o pagamento está no Financeiro).`;
      } else if (d.sem_pagamento) {
        texto.textContent = 'Marcado como sem pagamento (bonificação, remessa, amostra).';
      } else {
        texto.textContent = 'Sem conta a pagar ainda.';
        lancar.classList.remove('hidden');
      }

      const itens = d.itens || [];
      el('ctbDocDetItensBloco').classList.toggle('hidden', !itens.length);
      const corpo = el('ctbDocDetItens');
      corpo.replaceChildren();
      for (const i of itens) {
        const tr = criar('tr');
        tr.append(celula(i.descricao), celula(i.ncm, 'px-4 py-3 ctb-nowrap'), celula(i.cfop, 'px-4 py-3 ctb-nowrap'),
          celula(`${Number(i.quantidade || 0).toLocaleString('pt-BR')} ${i.unidade || ''}`.trim(), 'px-4 py-3 ctb-num'), celula(formatarMoeda(i.valor_total), 'px-4 py-3 ctb-num'));
        corpo.appendChild(tr);
      }
      const categoria = el('ctbDocDetAnexoCategoria');
      categoria.value = d.falta_xml ? 'xml_nfe' : (d.tipo === 'nfse' ? 'nfse' : ({ recibo: 'recibo', guia: 'guia', contrato: 'contrato' }[d.especie] || (d.tipo === 'nfe' ? 'nota' : 'outro')));
      arquivosEm(el('ctbDocDetArquivos'), dados.arquivos, { aoMudar: carregar });
      historicoEm(el('ctbDocDetHistorico'), dados.historico);
    }

    async function carregar() {
      mostrarMensagem('ctbDocDetMensagem', '');
      try {
        dados = await fetchApi(`/api/contabilidade/documentos/${encodeURIComponent(id)}`);
        pintar();
      } catch (e) {
        el('ctbDocDetExcluir').classList.add('hidden');
        mostrarMensagem('ctbDocDetMensagem', textoDoErro(e, 'Você não tem permissão para ver a Contabilidade.'));
      }
    }

    acionar(el('ctbDocDetAnexar'), async () => {
      if (!dados) return;
      const ok = await anexarDoQuadro({
        campoArquivo: el('ctbDocDetAnexoArquivo'), campoCategoria: el('ctbDocDetAnexoCategoria'), campoDescricao: el('ctbDocDetAnexoDescricao'),
        competencia: dados.documento.competencia, vinculos: [{ alvo_tipo: 'documento_recebido', alvo_id: String(id) }], mensagemId: 'ctbDocDetMensagem'
      });
      if (ok) await carregar();
    });

    acionar(el('ctbDocDetExcluir'), async () => {
      if (!dados) return;
      const motivo = await pedirTexto({
        titulo: 'Excluir o documento?',
        mensagem: `${dados.documento.rotulo} sai da lista${dados.documento.titulo ? ' e a conta a pagar dele (sem pagamento) é cancelada junto' : ''}. O histórico fica.`,
        confirmar: 'Excluir'
      });
      if (motivo === null) return;
      try {
        await enviar(`/api/contabilidade/documentos/${encodeURIComponent(id)}/excluir`, 'POST', { motivo });
        window.showToast?.('Documento excluído.', 'success');
        avisarAlteracao();
        fechar();
      } catch (e) {
        mostrarMensagem('ctbDocDetMensagem', textoDoErro(e, 'Você não tem permissão para excluir documentos.'));
      }
    });

    el('ctbDocDetAbrirConta').addEventListener('click', () => { if (dados?.documento?.titulo) abrirOutro('conta-pagar', { titulo_id: dados.documento.titulo.id }); });
    el('ctbDocDetLancarConta').addEventListener('click', () => abrirOutro('conta-pagar-form', { documento_id: id }));
    ouvirAlteracoes(carregar);
    return carregar();
  }

  // ------------------------------------------------------------ documentos da competência

  function montarEvidencias() {
    const compCampo = el('ctbEvidCompetencia');
    const grupoSel = el('ctbEvidGrupo');
    const busca = el('ctbEvidBusca');
    const corpo = el('ctbEvidLista');
    montarCompetencias(compCampo, contexto.competencia);
    let dados = null;
    let leitura = 0;

    function caminhoDoItem(i) {
      if (!i.baixar) return null;
      return i.baixar.tipo === 'arquivo'
        ? `/api/contabilidade/arquivos/${encodeURIComponent(i.baixar.id)}`
        : `/api/contabilidade/evidencias/xml/${encodeURIComponent(i.baixar.tipo)}/${encodeURIComponent(i.baixar.id)}`;
    }

    function pintar() {
      const totais = dados?.totais || {};
      for (const card of overlay.querySelectorAll('#ctbEvidTotais [data-total]')) card.querySelector('.ctb-total__valor').textContent = String(totais[card.dataset.total] ?? 0);
      const termo = normalizar(busca.value.trim());
      const grupo = grupoSel.value;
      const linhas = (dados?.itens || [])
        .filter(i => !grupo || (grupo === 'falta' ? i.falta : i.grupo === grupo))
        .filter(i => !termo || normalizar([i.titulo, i.detalhe, i.categoria].join(' ')).includes(termo));
      if (!linhas.length) { linhaVazia(corpo, 6, termo || grupo ? 'Nada com este filtro.' : 'Nenhum documento nesta competência.'); return; }
      corpo.replaceChildren();
      for (const i of linhas) {
        const acoes = criar('div', 'ctb-celula-acoes');
        const caminho = caminhoDoItem(i);
        if (caminho) {
          acoes.append(botaoPequeno('Abrir', 'btn-neutral', () => baixarArquivo(caminho, { abrir: true })), botaoPequeno('Salvar', 'btn-neutral', () => baixarArquivo(caminho)));
        }
        if (i.documento_id) acoes.appendChild(botaoPequeno('Ficha', 'btn-secondary', () => abrirOutro('documento-recebido', { documento_id: i.documento_id })));
        const origem = i.falta ? tag(i.falta_rotulo || 'Falta', 'badge-danger') : tag(i.origem_rotulo || '—', TOM_ORIGEM[i.origem] || 'badge-neutral');
        const tr = criar('tr');
        tr.append(
          celula(formatarData(i.data), 'px-4 py-3 ctb-nowrap'),
          celula(i.grupo_rotulo, 'px-4 py-3'),
          celula(i.titulo, 'px-4 py-3', [i.detalhe, i.categoria].filter(Boolean).join(' · ') || null),
          celula(i.valor === null || i.valor === undefined ? '—' : formatarMoeda(i.valor), 'px-4 py-3 ctb-num'),
          celula(origem, 'px-4 py-3'),
          celula(acoes, 'px-4 py-3')
        );
        corpo.appendChild(tr);
      }
    }

    async function carregar() {
      const minha = ++leitura;
      mostrarMensagem('ctbEvidMensagem', '');
      try {
        const r = await fetchApi(`/api/contabilidade/evidencias?competencia=${encodeURIComponent(compCampo.value || '')}`);
        if (minha !== leitura) return;
        dados = r;
        el('ctbEvidRotulo').textContent = r.rotulo || rotuloCompetencia(r.competencia);
        if (r.sql_pendente) mostrarMensagem('ctbEvidMensagem', 'Falta rodar sql/contabilidade_contas_pagar.sql no banco e reiniciar a API: os documentos recebidos e os anexos não aparecem.');
        pintar();
      } catch (e) {
        if (minha !== leitura) return;
        dados = null;
        linhaVazia(corpo, 6, 'A lista não pôde ser lida.');
        mostrarMensagem('ctbEvidMensagem', textoDoErro(e, 'Você não tem permissão para ver a Contabilidade.'));
      }
    }

    acionar(el('ctbEvidAnexar'), async () => {
      const comp = compCampo.value;
      const ok = await anexarDoQuadro({
        campoArquivo: el('ctbEvidAnexoArquivo'), campoCategoria: el('ctbEvidAnexoCategoria'), campoDescricao: el('ctbEvidAnexoDescricao'),
        competencia: comp, vinculos: [{ alvo_tipo: 'competencia', alvo_id: comp }], mensagemId: 'ctbEvidMensagem'
      });
      if (ok) await carregar();
    });

    compCampo.addEventListener('change', carregar);
    grupoSel.addEventListener('change', pintar);
    busca.addEventListener('input', pintar);
    ouvirAlteracoes(carregar);
    return carregar();
  }

  const montadores = {
    ctbFechar: montarFechar,
    ctbReabrir: montarReabrir,
    ctbIgnorarPendencia: montarIgnorarPendencia,
    ctbContasPagar: montarContasPagar,
    ctbContaPagar: montarContaPagar,
    ctbContaPagarForm: montarContaPagarForm,
    ctbPagarParcela: montarPagarParcela,
    ctbDocumentosRecebidos: montarDocumentosRecebidos,
    ctbRegistrarDocumento: montarRegistrarDocumento,
    ctbDocumentoRecebido: montarDocumentoRecebido,
    ctbEvidencias: montarEvidencias
  };

  let montagem;
  try {
    montagem = Promise.resolve(montadores[overlayId]?.());
  } catch (erro) {
    montagem = Promise.reject(erro);
  }

  // Revela só depois da PRIMEIRA leitura: até lá fica o spinner da casa
  // (contabilidade.js, ctbSpinnerDoModal).
  const revelar = () => {
    overlay.classList.remove('hidden');
    overlay.removeAttribute('aria-hidden');
    window.Modal?.signalReady?.(overlayId);
  };
  montagem
    .catch(erro => console.error('[contabilidade] falha ao montar o modal', overlayId, erro))
    .finally(() => {
      if (typeof window.ContabilidadeModalPronto === 'function') window.ContabilidadeModalPronto(overlayId, revelar);
      else revelar();
    });
})();
