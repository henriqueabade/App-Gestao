/**
 * Modais da Contabilidade — Fechamento do mês (etapas 1 a 9).
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
 *   ctbExtrato              Extrato bancário do mês — lançamentos, saldo, cobertura, importações (GET /extrato)
 *   ctbImportarExtrato      Importar OFX — prévia sem gravar e importação (POST /extrato/previa, /extrato/importar)
 *   ctbContasFinanceiras    Contas do banco — lista e cadastro (GET/POST/PUT /contas-financeiras)
 *   ctbConciliacao          Conciliação do mês — lançamentos, sugestões, lote (GET /conciliacao, POST /conciliacao/automatica)
 *   ctbConciliarMovimento   Um lançamento — escolher o par, ignorar, desfazer, lançar conta paga (/conciliacao/movimentos/:id)
 *   ctbClassificacao        Classificação do mês — a conta do plano de cada lançamento, lote, total por conta (GET /classificacao)
 *   ctbPlanoContas          Plano de contas — lista e cadastro (GET/POST/PUT /plano-contas)
 *   ctbRegras               Regras de classificação — lista, sugeridas, testar, cadastro (/regras)
 *   ctbFechamentos          Histórico dos fechamentos — versões, comparação, diferenças desde o fechamento (GET /fechamentos)
 *   ctbRelatorio            Relatório mensal — resumo, livro-caixa, resultado, conciliação, pendências, documentos; PDF e planilha (GET /relatorio)
 *   ctbDossie               Dossiê — tudo o que está ligado a um lançamento, conta ou documento, navegando entre eles (GET /dossie)
 *   ctbPacote               Pacote para a contabilidade — o ZIP (relatório + originais), os gerados e o envio (GET/POST /pacote)
 *   ctbAtividade            Atividade recente inteira — linha do tempo com foto, busca, tipo e quem fez (GET /atividade)
 *   ctbMensagens            Mensagens e comentários — o social do módulo em tamanho grande (/api/historico-social/contabilidade/1)
 *   ctbConfiguracao         Configurações — as integrações automáticas (SEFAZ, BB, ADN): ligar, parâmetros, credenciais, testar (/integracoes)
 *   ctbEntradaDfe           NF-e e NFS-e encontradas — a caixa de entrada das buscas: ciência, registrar, ignorar (/entrada)
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
  // O estado da conciliação (etapa 5) de cada lançamento do extrato.
  const ROTULO_CONCILIACAO = { pendente: 'A conciliar', conciliado: 'Conciliado', ignorado: 'Ignorado' };
  const TOM_CONCILIACAO = { pendente: 'badge-warning', conciliado: 'badge-success', ignorado: 'badge-neutral' };
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
  function pedirTexto({ titulo, mensagem, placeholder = 'Motivo (obrigatório)', confirmar = 'Confirmar', minimo = 5, erro = null }) {
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
      const erroEl = criar('p', 'hidden text-sm', erro || `Escreva o motivo (ao menos ${minimo} letras).`);
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
    let previa = null;
    let leitura = 0;

    /** Etapa 7: a foto que o fechamento vai guardar (e o que mudou desde a última versão). */
    function pintarFoto() {
      const p = previa;
      el('ctbFecharFoto').classList.toggle('hidden', !p || !painel?.pode?.fechar);
      if (!p) return;
      const r = p.resultado;
      el('ctbFecharVersao').textContent = p.versao ? (p.versao === 1 ? 'Versão 1 (a primeira)' : `Versão ${p.versao} (a anterior fica guardada)`) : 'Sem o SQL da etapa 7: só a foto resumida';
      const linhas = [['Lançamentos do extrato', `${p.lancamentos}${p.sem_classificacao ? ` · ${p.sem_classificacao} sem classificação` : ''}`]];
      if (r) {
        linhas.push(['Receitas', formatarMoeda(r.receitas)], ['Deduções', formatarMoeda(r.deducoes)], ['Custos', formatarMoeda(r.custos)], ['Despesas', formatarMoeda(r.despesas)]);
        linhas.push(['Resultado do mês', formatarMoeda(r.resultado)], ['Fora do resultado', formatarMoeda(r.fora_do_resultado)]);
        if (r.sem_classificacao) linhas.push(['Sem classificação', formatarMoeda(r.sem_classificacao)]);
      } else linhas.push(['Resultado do mês', 'Sem a classificação (etapa 6)']);
      for (const x of p.extrato || []) {
        linhas.push([`Saldo do banco · ${x.conta}`, x.saldo_banco ? `${formatarMoeda(x.saldo_banco.valor)} em ${formatarData(x.saldo_banco.data)}` : 'o extrato não trouxe']);
      }
      preencherDados(el('ctbFecharFotoDados'), linhas);
      const cmp = p.comparacao;
      const alvo = el('ctbFecharComparacao');
      alvo.classList.toggle('hidden', !cmp);
      if (cmp) {
        const partes = [];
        if (cmp.resultado.antes !== cmp.resultado.depois) partes.push(`resultado ${formatarMoeda(cmp.resultado.antes)} → ${formatarMoeda(cmp.resultado.depois)}`);
        if (cmp.reclassificados) partes.push(plural(cmp.reclassificados, 'lançamento mudou de conta', 'lançamentos mudaram de conta'));
        if (cmp.novos) partes.push(plural(cmp.novos, 'lançamento novo', 'lançamentos novos'));
        if (cmp.sairam) partes.push(plural(cmp.sairam, 'lançamento saiu', 'lançamentos saíram'));
        alvo.textContent = `Em relação à versão ${cmp.de}: ${partes.length ? partes.join('; ') : 'nada mudou'}.`;
      }
    }

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
      pintarFoto();
    }

    async function carregar() {
      const minha = ++leitura;
      mostrarMensagem('ctbFecharMensagem', '');
      el('ctbFecharCarregando').classList.remove('hidden');
      try {
        const comp = encodeURIComponent(compSel.value || '');
        const [r, foto] = await Promise.all([
          fetchApi(`/api/contabilidade/painel?competencia=${comp}`),
          fetchApi(`/api/contabilidade/fechar/previa?competencia=${comp}`).catch(() => null)
        ]);
        if (minha !== leitura) return;
        painel = r;
        previa = foto;
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
        const r = await enviar('/api/contabilidade/fechar', 'POST', { competencia: compSel.value });
        window.showToast?.(`Competência ${painel.rotulo} fechada${r?.versao ? ` (versão ${r.versao})` : ''}.`, 'success');
        processando = false;
        avisarAlteracao();
        if (r?.aviso && window.DialogPadrao?.info) await window.DialogPadrao.info({ title: 'Fechada, com aviso', tom: 'aviso', message: r.aviso });
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
    el('ctbContaPagarDossie').addEventListener('click', () => abrirOutro('dossie', { tipo: 'titulo', id }));
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
      // A regra do fornecedor/CFOP (etapa 6) sugere a categoria; o que foi digitado vale.
      if (p.categoria_sugerida && !el('ctbDocContaCategoria').value.trim()) el('ctbDocContaCategoria').value = p.categoria_sugerida;
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
    el('ctbDocDetDossie').addEventListener('click', () => abrirOutro('dossie', { tipo: 'documento', id }));
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

  // ------------------------------------------------------------ extrato bancário (etapa 4)

  const faixaDeDatas = f => (f.de === f.ate ? formatarData(f.de) : `${formatarData(f.de)} a ${formatarData(f.ate)}`);

  function montarExtrato() {
    const contaSel = el('ctbExtratoConta');
    const compCampo = el('ctbExtratoCompetencia');
    const tipoSel = el('ctbExtratoTipo');
    const busca = el('ctbExtratoBusca');
    const corpo = el('ctbExtratoLista');
    const corpoImp = el('ctbExtratoImportacoes');
    montarCompetencias(compCampo, contexto.competencia);
    let dados = null;
    let leitura = 0;
    let contaEscolhida = contexto.conta_id ?? null;

    function pintarContas() {
      const contas = dados?.contas || [];
      if (!contas.length) {
        contaSel.replaceChildren(opcao('', 'Nenhuma conta cadastrada'));
        contaSel.disabled = true;
        return;
      }
      contaSel.disabled = false;
      contaSel.replaceChildren(...contas.map(c => opcao(String(c.id), `${c.nome}${c.ativa ? '' : ' (desativada)'}`)));
      if (dados.conta) contaSel.value = String(dados.conta.id);
    }

    function pintarTotais() {
      const t = dados?.totais || { entradas: { quantidade: 0, total: 0 }, saidas: { quantidade: 0, total: 0 }, resultado: 0 };
      const pinta = (chave, valor, nota) => {
        const card = overlay.querySelector(`#ctbExtratoTotais [data-total="${chave}"]`);
        card.querySelector('.ctb-total__valor').textContent = valor;
        if (nota !== undefined) card.querySelector('.ctb-total__nota').textContent = nota;
      };
      pinta('entradas', formatarMoeda(t.entradas.total), plural(t.entradas.quantidade, 'lançamento', 'lançamentos'));
      pinta('saidas', formatarMoeda(t.saidas.total), plural(t.saidas.quantidade, 'lançamento', 'lançamentos'));
      pinta('resultado', formatarMoeda(t.resultado));
      const saldo = dados?.saldo_banco;
      pinta('saldo', saldo ? formatarMoeda(saldo.valor) : '—', saldo ? `Em ${formatarData(saldo.data)}` : 'O extrato do mês não trouxe saldo');
    }

    function pintarCobertura() {
      const alvo = el('ctbExtratoCobertura');
      const cob = dados?.cobertura;
      alvo.style.color = '';
      if (!dados?.conta) { alvo.textContent = 'Cadastre a conta do banco (botão "Contas do banco") para importar o extrato.'; return; }
      if (!cob) { alvo.textContent = ''; return; }
      const falta = cob.faltas?.length ? `Falta: ${cob.faltas.map(faixaDeDatas).join(', ')}.` : '';
      if (cob.de) alvo.textContent = `O extrato importado cobre de ${formatarData(cob.de)} a ${formatarData(cob.ate)}. ${falta || 'Nada faltando.'}`;
      else alvo.textContent = falta ? `Nenhum extrato importado neste mês. ${falta}` : 'Ainda não há o que importar neste mês.';
      if (falta) alvo.style.color = 'var(--color-primary-light)';
    }

    function pintarLista() {
      const termo = normalizar(busca.value.trim());
      const tipo = tipoSel.value;
      const linhas = (dados?.linhas || [])
        .filter(l => !tipo || l.tipo === tipo)
        .filter(l => !termo || normalizar([l.descricao, l.documento, l.identificador, formatarMoeda(l.valor), numeroBr(Math.abs(l.valor))].join(' ')).includes(termo));
      if (!linhas.length) {
        linhaVazia(corpo, 5, !dados?.conta ? 'Nenhuma conta cadastrada.' : (termo || tipo ? 'Nenhum lançamento com este filtro.' : 'Nenhum lançamento neste mês.'));
        return;
      }
      corpo.replaceChildren();
      for (const l of linhas) {
        const valor = celula(formatarMoeda(l.valor), 'px-4 py-3 ctb-num');
        valor.style.color = l.valor < 0 ? '#e08aa6' : 'var(--color-green)';
        const tr = criar('tr');
        tr.dataset.ctbLinha = '1';
        tr.title = 'Abrir a conciliação deste lançamento';
        tr.append(
          celula(formatarData(l.data), 'px-4 py-3 ctb-nowrap'),
          celula(l.descricao || '—', 'px-4 py-3', l.contrapartida_documento || null),
          celula(l.documento || '—', 'px-4 py-3 ctb-nowrap'),
          valor,
          celula(tag(ROTULO_CONCILIACAO[l.estado_conciliacao] || l.estado_conciliacao, TOM_CONCILIACAO[l.estado_conciliacao] || 'badge-neutral'), 'px-4 py-3')
        );
        tr.addEventListener('click', () => abrirOutro('conciliar-movimento', { movimento_id: l.id, competencia: compCampo.value }));
        corpo.appendChild(tr);
      }
    }

    async function desfazer(i) {
      const periodo = `${formatarData(i.periodo_inicio)} a ${formatarData(i.periodo_fim)}`;
      const quantos = i.novos === 1 ? 'O lançamento novo que ela trouxe sai' : `Os ${i.novos} lançamentos novos que ela trouxe saem`;
      const motivo = await pedirTexto({
        titulo: 'Desfazer a importação?',
        mensagem: i.novos
          ? `${quantos} do extrato (${periodo}) e o OFX sai dos documentos. O histórico fica.`
          : `Ela não trouxe lançamento novo: o período ${periodo} deixa de contar como importado. O histórico fica.`,
        confirmar: 'Desfazer'
      });
      if (motivo === null) return;
      try {
        const r = await enviar(`/api/contabilidade/extrato/importacoes/${encodeURIComponent(i.id)}/desfazer`, 'POST', { motivo });
        window.showToast?.(`Importação desfeita: ${plural(r.retirados, 'lançamento retirado', 'lançamentos retirados')}.`, 'success');
        avisarAlteracao();
        await carregar();
      } catch (e) {
        window.showToast?.(textoDoErro(e, 'Você não tem permissão para desfazer importações.'), 'error');
      }
    }

    function pintarImportacoes() {
      const lista = dados?.importacoes || [];
      if (!lista.length) { linhaVazia(corpoImp, 6, dados?.conta ? 'Nenhuma importação neste mês.' : '—'); return; }
      corpoImp.replaceChildren();
      for (const i of lista) {
        const viva = i.status !== 'desfeita';
        const acoes = criar('div', 'ctb-celula-acoes');
        if (viva && i.arquivo_id) acoes.appendChild(botaoPequeno('Salvar OFX', 'btn-neutral', () => baixarArquivo(`/api/contabilidade/arquivos/${encodeURIComponent(i.arquivo_id)}`)));
        if (viva) acoes.appendChild(botaoPequeno('Desfazer', 'btn-warning', () => desfazer(i), { perm: 'contabilidade.extrato.importar' }));
        const situacao = !viva ? tag('Desfeita', 'badge-neutral') : (i.status === 'completa' ? tag('Completa', 'badge-success') : tag('Incompleta', 'badge-warning', 'A importação parou no meio: desfaça e importe de novo.'));
        const tr = criar('tr');
        tr.append(
          celula(`${formatarData(i.periodo_inicio)} a ${formatarData(i.periodo_fim)}`, 'px-4 py-3 ctb-nowrap', i.saldo_final !== null ? `Saldo ${formatarMoeda(i.saldo_final)} em ${formatarData(i.saldo_final_data)}` : null),
          celula(i.nome_arquivo || i.origem_rotulo, 'px-4 py-3', i.origem_rotulo),
          celula(plural(i.novos, 'novo', 'novos'), 'px-4 py-3 ctb-nowrap', i.repetidos ? plural(i.repetidos, 'já importado', 'já importados') : null),
          celula(formatarInstante(i.criado_em), 'px-4 py-3 ctb-nowrap', i.criado_por),
          celula(situacao, 'px-4 py-3', viva ? null : [formatarInstante(i.desfeita_em), i.motivo_desfazer].filter(Boolean).join(' · ')),
          celula(acoes, 'px-4 py-3')
        );
        corpoImp.appendChild(tr);
      }
      try { window.Permissoes?.aplicarAcoesEColunas?.(corpoImp); } catch (_) { /* sem permissões carregadas */ }
    }

    async function carregar() {
      const minha = ++leitura;
      mostrarMensagem('ctbExtratoMensagem', '');
      try {
        const q = new URLSearchParams({ competencia: compCampo.value || '' });
        if (contaEscolhida) q.set('conta_id', String(contaEscolhida));
        const r = await fetchApi(`/api/contabilidade/extrato?${q.toString()}`);
        if (minha !== leitura) return;
        dados = r;
        contaEscolhida = r.conta?.id ?? null;
        el('ctbExtratoRotulo').textContent = r.rotulo || rotuloCompetencia(r.competencia);
        pintarContas();
        pintarTotais();
        pintarCobertura();
        pintarLista();
        pintarImportacoes();
      } catch (e) {
        if (minha !== leitura) return;
        dados = null;
        linhaVazia(corpo, 5, 'O extrato não pôde ser lido.');
        linhaVazia(corpoImp, 6, '—');
        mostrarMensagem('ctbExtratoMensagem', textoDoErro(e, 'Você não tem permissão para ver a Contabilidade.'));
      }
    }

    contaSel.addEventListener('change', () => { contaEscolhida = contaSel.value || null; carregar(); });
    compCampo.addEventListener('change', carregar);
    tipoSel.addEventListener('change', pintarLista);
    busca.addEventListener('input', pintarLista);
    el('ctbExtratoImportar').addEventListener('click', () => abrirOutro('importar-extrato', { conta_id: contaEscolhida, competencia: compCampo.value }));
    el('ctbExtratoContas').addEventListener('click', () => abrirOutro('contas-financeiras', { competencia: compCampo.value }));
    el('ctbExtratoConciliacao').addEventListener('click', () => abrirOutro('conciliacao', { conta_id: contaEscolhida, competencia: compCampo.value }));
    // Etapa 11: o extrato da competência pela API de Extratos do BB (a conta é a da integração, em Configurações).
    acionar(el('ctbExtratoBuscarBB'), async () => {
      mostrarMensagem('ctbExtratoMensagem', '');
      try {
        const r = await enviar('/api/contabilidade/integracoes/bb_extrato/sincronizar', 'POST', { competencia: compCampo.value });
        window.showToast?.(r.resumo || 'Extrato buscado no BB.', r.gravou === false ? 'info' : 'success');
        if (r.avisos?.length) mostrarMensagem('ctbExtratoMensagem', r.avisos.join(' '), 'aviso');
        avisarAlteracao();
        await carregar();
      } catch (e) {
        const faltas = Array.isArray(e?.corpo?.pendencias) && e.corpo.pendencias.length
          ? `Antes de buscar no BB: ${e.corpo.pendencias.join(' ')} (Contabilidade › Configurações).` : null;
        mostrarMensagem('ctbExtratoMensagem', faltas || textoDoErro(e, 'Buscar no BB pede a permissão "Importar extrato".'));
      }
    });
    ouvirAlteracoes(carregar);
    return carregar();
  }

  function montarImportarExtrato() {
    const contaSel = el('ctbImpExtConta');
    const campo = el('ctbImpExtArquivo');
    const confirmarBtn = el('ctbImpExtConfirmar');
    const situacao = el('ctbImpExtSituacao');
    let arquivo = null;
    let previa = null;
    let leitura = 0;

    async function carregarContas(preferida = null) {
      const r = await fetchApi('/api/contabilidade/contas-financeiras');
      const contas = (r?.contas || []).filter(c => c.ativa);
      if (!contas.length) {
        contaSel.replaceChildren(opcao('', 'Cadastre a conta do banco primeiro'));
        contaSel.disabled = true;
        mostrarMensagem('ctbImpExtMensagem', 'Nenhuma conta ativa cadastrada: use "Contas do banco" para cadastrar a conta corrente.');
        return;
      }
      contaSel.disabled = false;
      contaSel.replaceChildren(...contas.map(c => opcao(String(c.id), c.conta ? `${c.nome} · c/c ${c.conta}` : c.nome)));
      const alvo = [preferida, contexto.conta_id].find(v => v && contas.some(c => String(c.id) === String(v)));
      contaSel.value = String(alvo ?? (contas.find(c => c.tipo === 'corrente') || contas[0]).id);
      if (el('ctbImpExtMensagem').textContent.startsWith('Nenhuma conta ativa')) mostrarMensagem('ctbImpExtMensagem', '');
    }

    function pintarPrevia() {
      const p = previa;
      const arq = p.arquivo || {};
      // O banco diferente já vira aviso; aqui só agência e conta, para caber na linha.
      const contaDoArquivo = [arq.agencia ? `ag. ${arq.agencia}` : null, arq.conta ? `c/c ${arq.conta}` : null].filter(Boolean).join(' · ') || '—';
      const confere = p.confere === true ? tag('Confere', 'badge-success') : (p.confere === false ? tag('Não confere', 'badge-danger') : tag('Sem o número no arquivo', 'badge-neutral'));
      preencherDados(el('ctbImpExtDados'), [
        ['Conta do arquivo', contaDoArquivo],
        ['Com a conta escolhida', confere],
        ['Período', `${formatarData(p.periodo?.inicio)} a ${formatarData(p.periodo?.fim)}`],
        ['Saldo informado', p.saldo ? `${formatarMoeda(p.saldo.valor)} em ${formatarData(p.saldo.data)}` : '—'],
        ['Lançamentos no arquivo', String(p.lidos)],
        ['Novos (entram agora)', String(p.novos)],
        ['Já importados (ficam de fora)', String(p.repetidos)],
        ['Entradas e saídas novas', `${formatarMoeda(p.creditos)} · ${formatarMoeda(p.debitos)}`]
      ]);
      const bloqueios = el('ctbImpExtBloqueios');
      bloqueios.replaceChildren(...(p.bloqueios || []).map(t => itemDaLista(t, 'fa-ban')));
      bloqueios.classList.toggle('hidden', !p.bloqueios?.length);
      const avisos = el('ctbImpExtAvisos');
      avisos.replaceChildren(...(p.avisos || []).map(t => itemDaLista(t, 'fa-info-circle')));
      avisos.classList.toggle('hidden', !p.avisos?.length);

      const corpo = el('ctbImpExtLinhas');
      const linhas = p.linhas || [];
      el('ctbImpExtContagem').textContent = p.lidos > linhas.length ? `Mostrando ${linhas.length} de ${p.lidos}` : plural(p.lidos, 'lançamento', 'lançamentos');
      if (!linhas.length) linhaVazia(corpo, 5, 'O arquivo não tem lançamentos (só o saldo).');
      else {
        corpo.replaceChildren();
        for (const l of linhas) {
          const valor = celula(formatarMoeda(l.valor), 'px-4 py-3 ctb-num');
          valor.style.color = l.valor < 0 ? '#e08aa6' : 'var(--color-green)';
          const tr = criar('tr');
          tr.append(
            celula(formatarData(l.data), 'px-4 py-3 ctb-nowrap'),
            celula(l.descricao || '—', 'px-4 py-3'),
            celula(l.documento || '—', 'px-4 py-3 ctb-nowrap'),
            valor,
            celula(tag(l.novo ? 'Novo' : 'Já importado', l.novo ? 'badge-success' : 'badge-neutral'), 'px-4 py-3')
          );
          corpo.appendChild(tr);
        }
      }
      el('ctbImpExtPrevia').classList.remove('hidden');
      const bloqueado = Boolean(p.bloqueios?.length);
      if (bloqueado) pintarEtiqueta(situacao, 'Não dá para importar', 'badge-danger');
      else if (!p.novos) pintarEtiqueta(situacao, 'Nada novo', 'badge-neutral');
      else pintarEtiqueta(situacao, plural(p.novos, 'lançamento novo', 'lançamentos novos'), 'badge-info');
      if (!bloqueado && !p.novos) {
        mostrarMensagem('ctbImpExtMensagem', `Nenhum lançamento novo: importar só registra que o período de ${formatarData(p.periodo?.inicio)} a ${formatarData(p.periodo?.fim)} já tem extrato.`, 'info');
      }
      confirmarBtn.disabled = bloqueado;
    }

    async function lerPrevia() {
      const minha = ++leitura;
      previa = null;
      confirmarBtn.disabled = true;
      mostrarMensagem('ctbImpExtMensagem', '');
      el('ctbImpExtPrevia').classList.add('hidden');
      if (!arquivo || !contaSel.value) {
        pintarEtiqueta(situacao, 'Escolha o arquivo', 'badge-neutral');
        return;
      }
      pintarEtiqueta(situacao, 'Lendo o arquivo…', 'badge-info');
      try {
        const r = await enviar('/api/contabilidade/extrato/previa', 'POST', { conta_id: contaSel.value, base64: arquivo.base64 });
        if (minha !== leitura) return;
        previa = r;
        pintarPrevia();
      } catch (e) {
        if (minha !== leitura) return;
        pintarEtiqueta(situacao, 'Arquivo recusado', 'badge-danger');
        mostrarMensagem('ctbImpExtMensagem', textoDoErro(e, 'Você não tem permissão para importar extratos.'));
      }
    }

    async function confirmar() {
      if (!previa || !arquivo) return;
      mostrarMensagem('ctbImpExtMensagem', '');
      processando = true;
      try {
        const r = await enviar('/api/contabilidade/extrato/importar', 'POST', { conta_id: contaSel.value, nome: arquivo.nome, base64: arquivo.base64 });
        window.showToast?.(r.novos ? `${plural(r.novos, 'lançamento novo importado', 'lançamentos novos importados')}.` : 'Período registrado: nenhum lançamento novo.', 'success');
        processando = false;
        avisarAlteracao();
        // Os avisos da prévia já foram vistos; aqui só o que apareceu ao gravar.
        const novos = (r.avisos || []).filter(a => !(previa.avisos || []).includes(a));
        if (novos.length && window.DialogPadrao?.info) await window.DialogPadrao.info({ title: 'Importado, com avisos', tom: 'aviso', message: novos.join('\n') });
        fechar();
      } catch (e) {
        mostrarMensagem('ctbImpExtMensagem', textoDoErro(e, 'Você não tem permissão para importar extratos.'));
      } finally {
        processando = false;
      }
    }

    campo.addEventListener('change', async () => {
      try {
        arquivo = await arquivoDoCampo(campo);
      } catch (e) {
        arquivo = null;
        mostrarMensagem('ctbImpExtMensagem', e.message);
        return;
      }
      await lerPrevia();
    });
    contaSel.addEventListener('change', lerPrevia);
    el('ctbImpExtContas').addEventListener('click', () => abrirOutro('contas-financeiras', {}));
    acionar(confirmarBtn, confirmar);
    // Conta cadastrada no modal de cima: a lista se relê (e a prévia, se a conta mudou).
    ouvirAlteracoes(async () => {
      const antes = contaSel.value;
      await carregarContas(antes).catch(() => null);
      if (contaSel.value !== antes) await lerPrevia();
    });
    return carregarContas(contexto.conta_id).catch(e => {
      contaSel.replaceChildren(opcao('', '—'));
      contaSel.disabled = true;
      mostrarMensagem('ctbImpExtMensagem', textoDoErro(e, 'Você não tem permissão para ver a Contabilidade.'));
    });
  }

  const BANCOS = { '001': 'Banco do Brasil', '104': 'Caixa Econômica', '237': 'Bradesco', '341': 'Itaú', '033': 'Santander', '756': 'Sicoob', '748': 'Sicredi', '077': 'Inter', '260': 'Nubank' };
  const soDigitos = v => String(v ?? '').replace(/\D/g, '');

  function montarContasFinanceiras() {
    const nome = el('ctbContasFinNome');
    const tipo = el('ctbContasFinTipo');
    const banco = el('ctbContasFinBanco');
    const agencia = el('ctbContasFinAgencia');
    const agenciaDv = el('ctbContasFinAgenciaDv');
    const conta = el('ctbContasFinConta');
    const saldo = el('ctbContasFinSaldo');
    const saldoData = el('ctbContasFinSaldoData');
    const ativa = el('ctbContasFinAtiva');
    const observacao = el('ctbContasFinObservacao');
    const corpo = el('ctbContasFinLista');
    const salvarBtn = el('ctbContasFinSalvar');
    let dados = null;
    let editando = null;

    function pintarBanco() {
      const caixa = tipo.value === 'caixa';
      for (const c of [banco, agencia, agenciaDv, conta]) c.disabled = caixa;
      const cod = soDigitos(banco.value).padStart(3, '0');
      el('ctbContasFinBancoNome').textContent = caixa ? 'O caixa não tem banco.' : (soDigitos(banco.value) ? (BANCOS[cod] || 'Banco fora da lista: confira o código.') : '001 = Banco do Brasil');
    }

    function preencher(c = {}) {
      nome.value = c.nome || '';
      tipo.value = c.tipo || 'corrente';
      banco.value = c.banco_codigo || (c.tipo === 'caixa' ? '' : '001');
      agencia.value = c.agencia || '';
      agenciaDv.value = c.agencia_dv || '';
      conta.value = c.conta || '';
      saldo.value = c.saldo_inicial === null || c.saldo_inicial === undefined ? '' : numeroBr(c.saldo_inicial);
      saldoData.value = c.saldo_inicial_data || '';
      ativa.checked = c.ativa !== false;
      observacao.value = c.observacao || '';
      pintarBanco();
    }

    function limpar() {
      editando = null;
      preencher({});
      el('ctbContasFinFormTitulo').textContent = 'Nova conta';
      el('ctbContasFinNova').classList.add('hidden');
    }

    function editar(c) {
      editando = c.id;
      preencher(c);
      el('ctbContasFinFormTitulo').textContent = `Editar: ${c.nome}`;
      el('ctbContasFinNova').classList.remove('hidden');
      mostrarMensagem('ctbContasFinMensagem', '');
      nome.focus();
    }

    function pintar() {
      const contas = dados?.contas || [];
      el('ctbContasFinRotulo').textContent = plural(contas.length, 'conta', 'contas');
      const s = dados?.sugestao_cobranca;
      const caixaSugestao = el('ctbContasFinSugestao');
      caixaSugestao.classList.toggle('hidden', !s);
      // O atributo também: o espaço entre blocos (space-y) só pula o que tem [hidden].
      caixaSugestao.hidden = !s;
      if (s) el('ctbContasFinSugestaoTexto').textContent = `Banco do Brasil · ag. ${s.agencia}${s.agencia_dv ? `-${s.agencia_dv}` : ''} · c/c ${s.conta} (da Configuração de cobrança do Financeiro)`;
      if (!contas.length) { linhaVazia(corpo, 5, 'Nenhuma conta cadastrada ainda.'); return; }
      corpo.replaceChildren();
      for (const c of contas) {
        const acoes = criar('div', 'ctb-celula-acoes');
        acoes.appendChild(botaoPequeno('Editar', 'btn-neutral', () => editar(c), { perm: 'contabilidade.contas.gerir' }));
        const tr = criar('tr');
        tr.append(
          celula(c.nome, 'px-4 py-3', c.observacao),
          celula(c.tipo === 'caixa' ? '—' : c.rotulo, 'px-4 py-3', c.saldo_inicial !== null ? `Saldo inicial ${formatarMoeda(c.saldo_inicial)} em ${formatarData(c.saldo_inicial_data)}` : null),
          celula(c.tipo_rotulo, 'px-4 py-3'),
          celula(c.ativa ? tag('Ativa', 'badge-success') : tag('Desativada', 'badge-neutral'), 'px-4 py-3'),
          celula(acoes, 'px-4 py-3')
        );
        corpo.appendChild(tr);
      }
      try { window.Permissoes?.aplicarAcoesEColunas?.(corpo); } catch (_) { /* sem permissões carregadas */ }
    }

    async function carregar() {
      try {
        dados = await fetchApi('/api/contabilidade/contas-financeiras');
        pintar();
      } catch (e) {
        dados = null;
        linhaVazia(corpo, 5, 'A lista não pôde ser lida.');
        salvarBtn.disabled = true;
        mostrarMensagem('ctbContasFinMensagem', textoDoErro(e, 'Você não tem permissão para ver a Contabilidade.'));
      }
    }

    async function salvar() {
      mostrarMensagem('ctbContasFinMensagem', '');
      const caixa = tipo.value === 'caixa';
      const corpoConta = {
        nome: nome.value.trim(), tipo: tipo.value,
        banco_codigo: caixa ? null : banco.value, agencia: caixa ? null : agencia.value, agencia_dv: caixa ? null : agenciaDv.value, conta: caixa ? null : conta.value,
        saldo_inicial: lerMoeda(saldo.value), saldo_inicial_data: saldoData.value || null, ativa: ativa.checked, observacao: observacao.value
      };
      const erro = corpoConta.nome.length < 2 ? 'Dê um nome à conta (ex.: BB — conta corrente).'
        : (!caixa && (!soDigitos(banco.value) || !soDigitos(agencia.value) || !soDigitos(conta.value))) ? 'Informe banco, agência e conta.'
          : (corpoConta.saldo_inicial !== null && !corpoConta.saldo_inicial_data) ? 'Informe a data do saldo inicial.' : '';
      if (erro) { mostrarMensagem('ctbContasFinMensagem', erro); return; }
      processando = true;
      try {
        if (editando) await enviar(`/api/contabilidade/contas-financeiras/${encodeURIComponent(editando)}`, 'PUT', corpoConta);
        else await enviar('/api/contabilidade/contas-financeiras', 'POST', corpoConta);
        window.showToast?.(editando ? 'Conta alterada.' : 'Conta cadastrada.', 'success');
        processando = false;
        avisarAlteracao();
        limpar();
        await carregar();
      } catch (e) {
        mostrarMensagem('ctbContasFinMensagem', textoDoErro(e, 'Você não tem permissão para cadastrar contas.'));
      } finally {
        processando = false;
      }
    }

    tipo.addEventListener('change', pintarBanco);
    banco.addEventListener('input', pintarBanco);
    ligarCampoMoeda(saldo);
    el('ctbContasFinNova').addEventListener('click', limpar);
    el('ctbContasFinUsarSugestao').addEventListener('click', () => {
      const s = dados?.sugestao_cobranca;
      if (!s) return;
      editando = null;
      preencher(s);
      el('ctbContasFinFormTitulo').textContent = 'Nova conta';
      mostrarMensagem('ctbContasFinMensagem', 'Confira os dados e clique em "Salvar conta".', 'info');
      nome.focus();
    });
    acionar(salvarBtn, salvar);
    limpar();
    return carregar();
  }

  // ------------------------------------------------------------ conciliação (etapa 5)

  const rotuloDaLiq = l => (l ? `${l.rotulo}${l.nome ? ` · ${l.nome}` : ''}` : '—');
  const corDoValor = (td, valor) => { td.style.color = Number(valor) < 0 ? '#e08aa6' : 'var(--color-green)'; return td; };
  const CRITERIO_DA_SUGESTAO = { automatico: 'automatico', sugestao: 'sugestao', composicao: 'composicao' };

  function montarConciliacao() {
    const contaSel = el('ctbConcConta');
    const compCampo = el('ctbConcCompetencia');
    const visaoSel = el('ctbConcVisao');
    const busca = el('ctbConcBusca');
    const corpo = el('ctbConcLista');
    const corpoSem = el('ctbConcSemLancamento');
    montarCompetencias(compCampo, contexto.competencia);
    visaoSel.value = contexto.visao && [...visaoSel.options].some(o => o.value === contexto.visao) ? contexto.visao : 'pendentes';
    let dados = null;
    let leitura = 0;
    let contaEscolhida = contexto.conta_id ?? null;
    let destaque = contexto.movimento_id ? String(contexto.movimento_id) : null;

    function pintarContas() {
      const contas = dados?.contas || [];
      if (!contas.length) { contaSel.replaceChildren(opcao('', 'Nenhuma conta cadastrada')); contaSel.disabled = true; return; }
      contaSel.disabled = false;
      contaSel.replaceChildren(...contas.map(x => opcao(String(x.id), `${x.nome}${x.ativa ? '' : ' (desativada)'}`)));
      if (dados.conta) contaSel.value = String(dados.conta.id);
    }

    function pintarTotais() {
      const t = dados?.totais || { total: 0, a_conciliar: { quantidade: 0, total: 0 }, com_sugestao: 0, conciliados: 0, ignorados: 0 };
      const pinta = (chave, valor, nota) => {
        const card = overlay.querySelector(`#ctbConcTotais [data-total="${chave}"]`);
        card.querySelector('.ctb-total__valor').textContent = valor;
        if (nota !== undefined) card.querySelector('.ctb-total__nota').textContent = nota;
      };
      pinta('a_conciliar', formatarMoeda(t.a_conciliar.total), plural(t.a_conciliar.quantidade, 'lançamento', 'lançamentos'));
      pinta('com_sugestao', String(t.com_sugestao));
      pinta('conciliados', String(t.conciliados), `de ${plural(t.total, 'lançamento', 'lançamentos')} no mês`);
      pinta('ignorados', String(t.ignorados));
    }

    function pintarNota() {
      const alvo = el('ctbConcNota');
      alvo.style.color = '';
      if (!dados?.conta) { alvo.textContent = 'Cadastre a conta do banco e importe o extrato do mês (Extrato bancário).'; return; }
      if (dados.fechada) {
        alvo.textContent = 'Competência fechada: a conciliação dela só muda depois de reabrir.';
        alvo.style.color = 'var(--color-primary-light)';
        return;
      }
      const faltas = dados.cobertura?.faltas || [];
      alvo.textContent = faltas.length ? `O extrato do mês ainda não está completo (falta ${faltas.map(faixaDeDatas).join(', ')}): o que cair nesses dias ainda não aparece.` : '';
    }

    function casaCom(l) {
      if (l.estado === 'conciliado') {
        const partes = l.vinculos.map(v => (v.liquidacao ? rotuloDaLiq(v.liquidacao) : `${v.alvo_tipo} ${v.alvo_id}`));
        const criterios = [...new Set(l.vinculos.map(v => v.criterio_rotulo))].join(', ');
        const sub = `${criterios}${l.diferenca ? ` · diferença de ${formatarMoeda(l.diferenca)}${l.observacao ? `: ${l.observacao}` : ''}` : ''}`;
        const td = celula(partes.join(' + ') || '—', 'px-4 py-3', sub);
        const invalido = l.vinculos.find(v => v.invalido);
        if (invalido) {
          const aviso = criar('span', 'ctb-sub', `Atenção: ${invalido.invalido}. Desfaça e concilie de novo.`);
          aviso.style.color = 'var(--color-red)';
          td.appendChild(aviso);
        }
        return td;
      }
      if (l.estado === 'ignorado') return celula(l.observacao || '—', 'px-4 py-3', 'Sem par, com justificativa');
      const s = l.sugestao;
      if (!s) return celula('—', 'px-4 py-3', 'Nada no app com este valor por perto');
      const texto = s.tipo === 'composicao' ? `Soma de ${s.itens.length}: ${s.itens.map(i => i.rotulo).join(' + ')}` : rotuloDaLiq(s.itens[0]);
      const tipo = s.tipo === 'automatico' ? 'Automático' : (s.tipo === 'composicao' ? 'Sugestão (soma)'
        : (s.unica ? 'Sugestão' : `Sugestão (há mais ${plural(s.alternativas, 'registro', 'registros')} de mesmo valor)`));
      return celula(texto, 'px-4 py-3', `${tipo} · ${s.motivos.join(', ')}`);
    }

    function abrirMovimento(l) {
      abrirOutro('conciliar-movimento', { movimento_id: l.id, competencia: compCampo.value });
    }

    async function aceitar(l) {
      const s = l.sugestao;
      if (s.tipo === 'composicao' || !s.unica) {
        const confirmado = await (window.DialogPadrao?.confirm
          ? window.DialogPadrao.confirm({
            title: s.tipo === 'composicao' ? 'Aceitar a soma?' : 'Aceitar esta sugestão?',
            message: `${formatarData(l.data)} · ${formatarMoeda(l.valor)} com:\n${s.itens.map(i => `${rotuloDaLiq(i)} (${formatarData(i.data)}) — ${formatarMoeda(i.restante)}`).join('\n')}`,
            confirmText: 'Conciliar'
          })
          : Promise.resolve(window.confirm('Aceitar a sugestão?')));
        if (!confirmado) return;
      }
      try {
        await enviar(`/api/contabilidade/conciliacao/movimentos/${encodeURIComponent(l.id)}/conciliar`, 'POST', {
          itens: s.itens.map(i => ({ tipo: i.tipo, id: i.id })), criterio: CRITERIO_DA_SUGESTAO[s.tipo] || 'sugestao'
        });
        window.showToast?.('Lançamento conciliado.', 'success');
        avisarAlteracao();
        await carregar();
      } catch (e) {
        window.showToast?.(textoDoErro(e, 'Você não tem permissão para conciliar.'), 'error');
      }
    }

    async function ignorar(l) {
      const motivo = await pedirTexto({
        titulo: 'Ignorar o lançamento?',
        mensagem: `${formatarData(l.data)} · ${formatarMoeda(l.valor)}${l.descricao ? ` · ${l.descricao}` : ''}. Ele fica sem par, com a justificativa (tarifa, aplicação, aporte…).`,
        placeholder: 'Por que fica sem par (obrigatório)', confirmar: 'Ignorar'
      });
      if (motivo === null) return;
      try {
        await enviar(`/api/contabilidade/conciliacao/movimentos/${encodeURIComponent(l.id)}/ignorar`, 'POST', { motivo });
        window.showToast?.('Lançamento ignorado.', 'success');
        avisarAlteracao();
        await carregar();
      } catch (e) {
        window.showToast?.(textoDoErro(e, 'Você não tem permissão para conciliar.'), 'error');
      }
    }

    async function desfazer(l) {
      const motivo = await pedirTexto({ titulo: 'Desfazer a conciliação?', mensagem: `${formatarData(l.data)} · ${formatarMoeda(l.valor)} volta a ficar a conciliar. O histórico fica.`, confirmar: 'Desfazer' });
      if (motivo === null) return;
      try {
        const r = await enviar(`/api/contabilidade/conciliacao/movimentos/${encodeURIComponent(l.id)}/desfazer`, 'POST', { motivo });
        window.showToast?.('Conciliação desfeita.', 'success');
        if (r?.conta_criada_continua) window.showToast?.('A conta lançada do extrato continua: estorne-a em Contas a pagar, se foi engano.', 'info');
        avisarAlteracao();
        await carregar();
      } catch (e) {
        window.showToast?.(textoDoErro(e, 'Você não tem permissão para conciliar.'), 'error');
      }
    }

    async function reativar(l) {
      try {
        await enviar(`/api/contabilidade/conciliacao/movimentos/${encodeURIComponent(l.id)}/reativar`, 'POST', {});
        window.showToast?.('O lançamento voltou a ficar a conciliar.', 'success');
        avisarAlteracao();
        await carregar();
      } catch (e) {
        window.showToast?.(textoDoErro(e, 'Você não tem permissão para conciliar.'), 'error');
      }
    }

    function pintarLista() {
      const termo = normalizar(busca.value.trim());
      const texto = l => [
        l.descricao, l.documento, formatarMoeda(l.valor), numeroBr(Math.abs(l.valor)), l.observacao,
        ...(l.vinculos || []).map(v => rotuloDaLiq(v.liquidacao)), ...(l.sugestao?.itens || []).map(rotuloDaLiq)
      ].join(' ');
      const linhas = (dados?.linhas || []).filter(l => !termo || normalizar(texto(l)).includes(termo));
      if (!linhas.length) {
        linhaVazia(corpo, 6, !dados?.conta ? 'Nenhuma conta cadastrada.' : (termo ? 'Nada com esta busca.' : 'Nada nesta visão.'));
        return;
      }
      corpo.replaceChildren();
      const podeMexer = !dados.fechada;
      let alvoDestaque = null;
      for (const l of linhas) {
        const acoes = criar('div', 'ctb-celula-acoes');
        if (!podeMexer) acoes.appendChild(botaoPequeno('Ver', 'btn-neutral', () => abrirMovimento(l)));
        else if (l.estado === 'pendente') {
          if (l.sugestao) acoes.appendChild(botaoPequeno('Aceitar', 'btn-success', () => aceitar(l), { perm: 'contabilidade.conciliar' }));
          acoes.appendChild(botaoPequeno('Escolher', 'btn-neutral', () => abrirMovimento(l)));
          acoes.appendChild(botaoPequeno('Ignorar', 'btn-warning', () => ignorar(l), { perm: 'contabilidade.conciliar' }));
        } else if (l.estado === 'conciliado') {
          acoes.appendChild(botaoPequeno('Desfazer', 'btn-warning', () => desfazer(l), { perm: 'contabilidade.conciliar' }));
        } else {
          acoes.appendChild(botaoPequeno('Reativar', 'btn-neutral', () => reativar(l), { perm: 'contabilidade.conciliar' }));
        }
        const tr = criar('tr');
        tr.dataset.ctbLinha = '1';
        if (destaque && String(l.id) === destaque) { tr.classList.add('ctb-linha-destaque'); alvoDestaque = tr; }
        tr.append(
          celula(formatarData(l.data), 'px-4 py-3 ctb-nowrap'),
          celula(l.descricao || '—', 'px-4 py-3', l.documento ? `Doc. ${l.documento}` : null),
          corDoValor(celula(formatarMoeda(l.valor), 'px-4 py-3 ctb-num'), l.valor),
          celula(tag(l.estado_rotulo, TOM_CONCILIACAO[l.estado] || 'badge-neutral'), 'px-4 py-3'),
          casaCom(l),
          celula(acoes, 'px-4 py-3')
        );
        tr.addEventListener('click', e => { if (!e.target.closest('button')) abrirMovimento(l); });
        corpo.appendChild(tr);
      }
      try { window.Permissoes?.aplicarAcoesEColunas?.(corpo); } catch (_) { /* sem permissões carregadas */ }
      if (alvoDestaque) { alvoDestaque.scrollIntoView?.({ block: 'center' }); destaque = null; }
    }

    function pintarSemLancamento() {
      const lista = dados?.sem_lancamento || [];
      if (!lista.length) { linhaVazia(corpoSem, 5, dados?.conta ? 'Nada: o que foi registrado pelo banco tem lançamento (ou sugestão).' : '—'); return; }
      corpoSem.replaceChildren(...lista.map(l => {
        const tr = criar('tr');
        tr.append(
          celula(formatarData(l.data), 'px-4 py-3 ctb-nowrap'),
          celula(l.rotulo, 'px-4 py-3', l.tipo_rotulo),
          celula(l.nome || '—', 'px-4 py-3'),
          celula(l.forma || '—', 'px-4 py-3'),
          corDoValor(celula(formatarMoeda(l.valor), 'px-4 py-3 ctb-num'), l.valor)
        );
        return tr;
      }));
    }

    async function carregar() {
      const minha = ++leitura;
      mostrarMensagem('ctbConcMensagem', '');
      try {
        const q = new URLSearchParams({ competencia: compCampo.value || '', visao: visaoSel.value });
        if (contaEscolhida) q.set('conta_id', String(contaEscolhida));
        const r = await fetchApi(`/api/contabilidade/conciliacao?${q.toString()}`);
        if (minha !== leitura) return;
        dados = r;
        contaEscolhida = r.conta?.id ?? null;
        el('ctbConcRotulo').textContent = r.rotulo || rotuloCompetencia(r.competencia);
        const semAcao = !r.conta || r.fechada;
        el('ctbConcAutomatica').disabled = semAcao;
        el('ctbConcAceitarUnicas').disabled = semAcao;
        pintarContas();
        pintarTotais();
        pintarNota();
        pintarLista();
        pintarSemLancamento();
      } catch (e) {
        if (minha !== leitura) return;
        dados = null;
        linhaVazia(corpo, 6, 'A conciliação não pôde ser lida.');
        linhaVazia(corpoSem, 5, '—');
        mostrarMensagem('ctbConcMensagem', textoDoErro(e, 'Você não tem permissão para ver a Contabilidade.'));
      }
    }

    async function lote(aceitarSugestoes) {
      if (!dados?.conta) return;
      const confirmado = await (window.DialogPadrao?.confirm
        ? window.DialogPadrao.confirm({
          title: aceitarSugestoes ? 'Aceitar as sugestões únicas?' : 'Conciliar automaticamente?',
          message: aceitarSugestoes
            ? 'Grava o que tem chave exata e as sugestões de mesmo valor que só servem para um lançamento (e vice-versa). A soma de vários fica para você conferir.'
            : 'Grava só o que tem chave exata: o CNPJ/CPF da contrapartida ou o número do documento batem. O resto continua como sugestão.',
          confirmText: 'Conciliar'
        })
        : Promise.resolve(window.confirm('Conciliar em lote?')));
      if (!confirmado) return;
      processando = true;
      try {
        const r = await enviar('/api/contabilidade/conciliacao/automatica', 'POST', { conta_id: contaEscolhida, competencia: compCampo.value, aceitar_sugestoes: aceitarSugestoes });
        processando = false;
        window.showToast?.(r.total ? `${plural(r.total, 'lançamento conciliado', 'lançamentos conciliados')}.` : 'Nada para conciliar em lote: confira as sugestões uma a uma.', r.total ? 'success' : 'info');
        avisarAlteracao();
        await carregar();
      } catch (e) {
        mostrarMensagem('ctbConcMensagem', textoDoErro(e, 'Você não tem permissão para conciliar.'));
      } finally {
        processando = false;
      }
    }

    contaSel.addEventListener('change', () => { contaEscolhida = contaSel.value || null; carregar(); });
    compCampo.addEventListener('change', carregar);
    visaoSel.addEventListener('change', carregar);
    busca.addEventListener('input', pintarLista);
    acionar(el('ctbConcAutomatica'), () => lote(false));
    acionar(el('ctbConcAceitarUnicas'), () => lote(true));
    el('ctbConcExtrato').addEventListener('click', () => abrirOutro('extrato', { conta_id: contaEscolhida, competencia: compCampo.value }));
    ouvirAlteracoes(carregar);
    return carregar();
  }

  function montarConciliarMovimento() {
    const id = contexto.movimento_id;
    const diasSel = el('ctbConcMovDias');
    const busca = el('ctbConcMovBusca');
    const corpo = el('ctbConcMovCandidatos');
    const confirmarBtn = el('ctbConcMovConfirmar');
    const marcadas = new Set();
    let dados = null;
    let leitura = 0;
    let primeira = true;
    let contaPronta = false;

    const pendente = () => dados?.movimento?.estado === 'pendente' && !dados?.fechada;
    const candidata = chave => (dados?.candidatos || []).find(x => x.chave === chave) || null;

    function pintarCabeca() {
      const m = dados.movimento;
      pintarEtiqueta(el('ctbConcMovSituacao'), m.estado_rotulo, TOM_CONCILIACAO[m.estado] || 'badge-neutral');
      const valor = corDoValor(criar('span', null, formatarMoeda(m.valor)), m.valor);
      preencherDados(el('ctbConcMovDados'), [
        ['Data', formatarData(m.data)], ['Valor', valor],
        ['Descrição do banco', m.descricao || '—'], ['Documento', m.documento || '—'],
        ['Conta', m.conta || '—'], ['Situação', m.estado === 'ignorado' ? `Ignorado: ${m.observacao || 'sem justificativa'}` : m.estado_rotulo]
      ]);
    }

    function pintarLigados() {
      const bloco = el('ctbConcMovLigados');
      const lista = dados.vinculos || [];
      bloco.classList.toggle('hidden', dados.movimento.estado !== 'conciliado');
      el('ctbConcMovLigadosLista').replaceChildren(...lista.map(v => {
        const li = criar('li', 'ctb-arquivo');
        const texto = criar('div', 'ctb-arquivo__texto');
        texto.append(
          criar('span', 'ctb-arquivo__nome', rotuloDaLiq(v.liquidacao)),
          criar('span', 'ctb-arquivo__nota', [v.liquidacao?.tipo_rotulo, v.liquidacao ? formatarData(v.liquidacao.data) : null, formatarMoeda(v.valor), v.criterio_rotulo].filter(Boolean).join(' · '))
        );
        li.append(icone('fa-link'), texto);
        return li;
      }));
      if (dados.movimento.estado === 'conciliado' && dados.movimento.observacao) {
        const li = criar('li', 'ctb-arquivo');
        li.append(icone('fa-comment'), criar('div', 'ctb-arquivo__texto', `Justificativa: ${dados.movimento.observacao}`));
        el('ctbConcMovLigadosLista').appendChild(li);
      }
    }

    function pintarSoma() {
      const alvo = Math.abs(Number(dados?.movimento?.valor) || 0);
      const soma = Math.round([...marcadas].reduce((s, k) => s + (candidata(k)?.restante || 0), 0) * 100) / 100;
      const dif = Math.round((alvo - soma) * 100) / 100;
      const p = el('ctbConcMovSoma');
      if (!marcadas.size) { p.textContent = `Marque o que forma ${formatarMoeda(alvo)}.`; delete p.dataset.ok; }
      else {
        p.textContent = `Marcado: ${formatarMoeda(soma)} de ${formatarMoeda(alvo)}${dif ? ` · diferença de ${formatarMoeda(dif)}` : ' · bate'}`;
        p.dataset.ok = dif ? '0' : '1';
      }
      el('ctbConcMovJustificativaBloco').classList.toggle('hidden', !marcadas.size || !dif);
      confirmarBtn.disabled = !marcadas.size || !pendente();
      return dif;
    }

    function pintarCandidatos() {
      const termo = normalizar(busca.value.trim());
      const todas = dados?.candidatos || [];
      el('ctbConcMovContagem').textContent = `${plural(todas.length, 'registro', 'registros')} do app em até ${dados?.dias ?? diasSel.value} dias`;
      const lista = todas.filter(x => !termo || normalizar([x.rotulo, x.nome, x.tipo_rotulo, x.forma, formatarMoeda(x.restante), numeroBr(Math.abs(x.restante))].join(' ')).includes(termo));
      if (!lista.length) {
        linhaVazia(corpo, 5, termo ? 'Nada com esta busca.' : 'Nada no app deste lado (entrada ou saída) por perto: aumente os dias ou, se for débito, lance a conta abaixo.');
        pintarSoma();
        return;
      }
      corpo.replaceChildren();
      for (const x of lista) {
        const tr = criar('tr');
        tr.dataset.ctbLinha = '1';
        const caixa = criar('input', 'w-4 h-4');
        caixa.type = 'checkbox';
        caixa.checked = marcadas.has(x.chave);
        caixa.disabled = !pendente();
        caixa.setAttribute('aria-label', `Escolher ${x.rotulo}`);
        const alternar = () => {
          if (!pendente()) return;
          if (marcadas.has(x.chave)) marcadas.delete(x.chave); else marcadas.add(x.chave);
          caixa.checked = marcadas.has(x.chave);
          pintarSoma();
        };
        caixa.addEventListener('click', e => { e.stopPropagation(); alternar(); caixa.checked = marcadas.has(x.chave); });
        tr.addEventListener('click', alternar);
        const porque = x.exato ? [tag('Mesmo valor', 'badge-success')] : [];
        const outros = x.motivos.filter(m => m !== 'mesmo valor').join(', ');
        const celPorque = celula(porque.length ? porque : outros || '—', 'px-4 py-3', porque.length ? outros : null);
        tr.append(
          celula(caixa, 'px-4 py-3'),
          celula(formatarData(x.data), 'px-4 py-3 ctb-nowrap', x.data_credito && x.data_credito !== x.data ? `crédito ${formatarData(x.data_credito)}` : null),
          celula(x.rotulo, 'px-4 py-3', [x.tipo_rotulo, x.nome, x.forma].filter(Boolean).join(' · ')),
          corDoValor(celula(formatarMoeda(x.valor < 0 ? -x.restante : x.restante), 'px-4 py-3 ctb-num', Math.abs(x.valor) !== x.restante ? `de ${formatarMoeda(x.valor)}` : null), x.valor),
          celPorque
        );
        corpo.appendChild(tr);
      }
      pintarSoma();
    }

    async function prepararConta() {
      if (contaPronta) return;
      contaPronta = true;
      el('ctbConcMovContaDescricao').value = dados.movimento.descricao || '';
      el('ctbConcMovContaForma').replaceChildren(...(dados.formas || []).map(f => opcao(f, f)));
      el('ctbConcMovContaForma').value = (dados.formas || []).includes('Débito automático') ? 'Débito automático' : (dados.formas || [])[0] || '';
      try {
        const r = await fetchApi('/api/contabilidade/categorias');
        el('ctbConcMovCategorias').replaceChildren(...(r?.categorias || []).map(cat => opcao(cat, cat)));
      } catch (_) { /* a lista de categorias é só ajuda */ }
      await carregarFornecedores(el('ctbConcMovContaFornecedor'), { vazio: 'Sem fornecedor (tarifa, imposto…)' }).catch(() => null);
    }

    function pintarRodape() {
      const m = dados.movimento;
      const aberto = !dados.fechada;
      el('ctbConcMovEscolha').classList.toggle('hidden', m.estado !== 'pendente');
      confirmarBtn.classList.toggle('hidden', m.estado !== 'pendente');
      el('ctbConcMovIgnorar').classList.toggle('hidden', m.estado !== 'pendente');
      el('ctbConcMovDesfazer').classList.toggle('hidden', m.estado !== 'conciliado');
      el('ctbConcMovReativar').classList.toggle('hidden', m.estado !== 'ignorado');
      for (const botao of ['ctbConcMovIgnorar', 'ctbConcMovDesfazer', 'ctbConcMovReativar']) el(botao).disabled = !aberto;
      const conta = m.estado === 'pendente' && Number(m.valor) < 0 && aberto;
      el('ctbConcMovConta').classList.toggle('hidden', !conta);
      if (conta) prepararConta();
      if (!aberto) mostrarMensagem('ctbConcMovMensagem', 'Competência fechada: a conciliação dela só muda depois de reabrir.', 'info');
    }

    async function carregar() {
      const minha = ++leitura;
      try {
        const r = await fetchApi(`/api/contabilidade/conciliacao/movimentos/${encodeURIComponent(id)}?dias=${encodeURIComponent(diasSel.value)}`);
        if (minha !== leitura) return;
        dados = r;
        // Na primeira leitura, a sugestão já vem marcada (é só conferir e conciliar).
        if (primeira && r.sugestao && r.movimento.estado === 'pendente') r.sugestao.itens.forEach(i => marcadas.add(i.chave));
        primeira = false;
        for (const k of [...marcadas]) if (!candidata(k)) marcadas.delete(k);
        pintarCabeca();
        pintarLigados();
        pintarCandidatos();
        pintarRodape();
      } catch (e) {
        if (minha !== leitura) return;
        confirmarBtn.classList.add('hidden');
        el('ctbConcMovIgnorar').classList.add('hidden');
        linhaVazia(corpo, 5, 'O lançamento não pôde ser lido.');
        mostrarMensagem('ctbConcMovMensagem', textoDoErro(e, 'Você não tem permissão para ver a Contabilidade.'));
      }
    }

    const mesmoConjunto = (a, b2) => a.length === b2.length && a.every(x => b2.includes(x));

    async function confirmar() {
      mostrarMensagem('ctbConcMovMensagem', '');
      const dif = pintarSoma();
      const justificativa = el('ctbConcMovJustificativa').value.trim();
      if (dif && justificativa.length < 5) { mostrarMensagem('ctbConcMovMensagem', 'A soma não bate: justifique a diferença (ao menos 5 letras).'); return; }
      const chaves = [...marcadas];
      const sug = dados.sugestao;
      const criterio = sug && mesmoConjunto(chaves, sug.itens.map(i => i.chave)) ? (CRITERIO_DA_SUGESTAO[sug.tipo] || 'sugestao') : 'manual';
      processando = true;
      try {
        await enviar(`/api/contabilidade/conciliacao/movimentos/${encodeURIComponent(id)}/conciliar`, 'POST', {
          itens: chaves.map(k => candidata(k)).filter(Boolean).map(x => ({ tipo: x.tipo, id: x.id })), justificativa: dif ? justificativa : '', criterio
        });
        processando = false;
        window.showToast?.('Lançamento conciliado.', 'success');
        avisarAlteracao();
        fechar();
      } catch (e) {
        mostrarMensagem('ctbConcMovMensagem', textoDoErro(e, 'Você não tem permissão para conciliar.'));
      } finally {
        processando = false;
      }
    }

    async function ignorar() {
      const m = dados.movimento;
      const motivo = await pedirTexto({
        titulo: 'Ignorar o lançamento?', mensagem: `${formatarData(m.data)} · ${formatarMoeda(m.valor)}. Ele fica sem par, com a justificativa (tarifa, aplicação, aporte…).`,
        placeholder: 'Por que fica sem par (obrigatório)', confirmar: 'Ignorar'
      });
      if (motivo === null) return;
      try {
        await enviar(`/api/contabilidade/conciliacao/movimentos/${encodeURIComponent(id)}/ignorar`, 'POST', { motivo });
        window.showToast?.('Lançamento ignorado.', 'success');
        avisarAlteracao();
        fechar();
      } catch (e) {
        mostrarMensagem('ctbConcMovMensagem', textoDoErro(e, 'Você não tem permissão para conciliar.'));
      }
    }

    async function desfazer() {
      const motivo = await pedirTexto({ titulo: 'Desfazer a conciliação?', mensagem: 'O lançamento volta a ficar a conciliar. O histórico fica.', confirmar: 'Desfazer' });
      if (motivo === null) return;
      try {
        const r = await enviar(`/api/contabilidade/conciliacao/movimentos/${encodeURIComponent(id)}/desfazer`, 'POST', { motivo });
        window.showToast?.('Conciliação desfeita.', 'success');
        if (r?.conta_criada_continua) window.showToast?.('A conta lançada do extrato continua: estorne-a em Contas a pagar, se foi engano.', 'info');
        avisarAlteracao();
        primeira = true;
        await carregar();
      } catch (e) {
        mostrarMensagem('ctbConcMovMensagem', textoDoErro(e, 'Você não tem permissão para conciliar.'));
      }
    }

    async function reativar() {
      try {
        await enviar(`/api/contabilidade/conciliacao/movimentos/${encodeURIComponent(id)}/reativar`, 'POST', {});
        window.showToast?.('O lançamento voltou a ficar a conciliar.', 'success');
        avisarAlteracao();
        primeira = true;
        await carregar();
      } catch (e) {
        mostrarMensagem('ctbConcMovMensagem', textoDoErro(e, 'Você não tem permissão para conciliar.'));
      }
    }

    async function criarConta() {
      mostrarMensagem('ctbConcMovMensagem', '');
      const descricao = el('ctbConcMovContaDescricao').value.trim();
      if (descricao.length < 3) { mostrarMensagem('ctbConcMovMensagem', 'Descreva a conta (ao menos 3 letras).'); return; }
      processando = true;
      try {
        await enviar(`/api/contabilidade/conciliacao/movimentos/${encodeURIComponent(id)}/criar-conta`, 'POST', {
          descricao, categoria: el('ctbConcMovContaCategoria').value.trim() || null,
          contato_id: el('ctbConcMovContaFornecedor').value || null, forma: el('ctbConcMovContaForma').value
        });
        processando = false;
        window.showToast?.('Conta lançada, paga e conciliada.', 'success');
        avisarAlteracao();
        fechar();
      } catch (e) {
        mostrarMensagem('ctbConcMovMensagem', textoDoErro(e, 'Você não tem permissão para lançar contas e conciliar.'));
      } finally {
        processando = false;
      }
    }

    diasSel.addEventListener('change', carregar);
    busca.addEventListener('input', pintarCandidatos);
    acionar(confirmarBtn, confirmar);
    acionar(el('ctbConcMovIgnorar'), ignorar);
    acionar(el('ctbConcMovDesfazer'), desfazer);
    acionar(el('ctbConcMovReativar'), reativar);
    acionar(el('ctbConcMovCriarConta'), criarConta);
    el('ctbConcMovDossie').addEventListener('click', () => abrirOutro('dossie', { tipo: 'movimento', id }));
    ouvirAlteracoes(carregar);
    return carregar();
  }

  // ------------------------------------------------------------ classificação (etapa 6)

  const ROTULO_ESTADO_CONC = { pendente: 'a conciliar', conciliado: 'conciliado', ignorado: 'ignorado' };

  /** As contas do plano num select, agrupadas pelo tipo (Receita, Custo, Despesa…). */
  function opcoesDoPlano(select, plano, { vazio = null, selecionada = null } = {}) {
    const grupos = new Map();
    for (const p of plano || []) {
      if (!grupos.has(p.tipo_rotulo)) grupos.set(p.tipo_rotulo, []);
      grupos.get(p.tipo_rotulo).push(p);
    }
    const filhos = vazio !== null ? [opcao('', vazio)] : [];
    for (const [rotulo, contas] of grupos) {
      const g = document.createElement('optgroup');
      g.label = rotulo;
      g.append(...contas.map(p => opcao(String(p.id), p.codigo ? `${p.codigo} · ${p.nome}` : p.nome)));
      filhos.push(g);
    }
    select.replaceChildren(...filhos);
    if (selecionada !== null && selecionada !== undefined) select.value = String(selecionada);
  }

  function montarClassificacao() {
    const contaSel = el('ctbClassConta');
    const compCampo = el('ctbClassCompetencia');
    const visaoSel = el('ctbClassVisao');
    const busca = el('ctbClassBusca');
    const corpo = el('ctbClassLista');
    const loteConta = el('ctbClassLoteConta');
    const aplicarBtn = el('ctbClassAplicar');
    const todos = el('ctbClassTodos');
    montarCompetencias(compCampo, contexto.competencia);
    visaoSel.value = contexto.visao && [...visaoSel.options].some(o => o.value === contexto.visao) ? contexto.visao : 'todos';
    let dados = null;
    let leitura = 0;
    const marcados = new Set();
    const podeClassificar = () => !dados?.fechada && (!window.Permissoes?.pode || window.Permissoes.pode('contabilidade.classificar'));

    function pintarFiltros() {
      const atual = contaSel.value;
      contaSel.replaceChildren(opcao('', 'Todas as contas'), ...(dados?.contas_financeiras || []).map(x => opcao(String(x.id), `${x.nome}${x.ativa ? '' : ' (desativada)'}`)));
      contaSel.value = dados?.conta_id ? String(dados.conta_id) : atual;
      const lote = loteConta.value;
      opcoesDoPlano(loteConta, dados?.plano, { vazio: 'Escolha a conta' });
      if (lote && [...loteConta.querySelectorAll('option')].some(o => o.value === lote)) loteConta.value = lote;
    }

    function pintarTotais() {
      const t = dados?.totais || { total: 0, classificados: 0, sem: 0, sem_valor: 0, manuais: 0, automaticos: 0 };
      const pinta = (chave, valor, nota) => {
        const card = overlay.querySelector(`#ctbClassTotais [data-total="${chave}"]`);
        card.querySelector('.ctb-total__valor').textContent = valor;
        if (nota !== undefined) card.querySelector('.ctb-total__nota').textContent = nota;
      };
      pinta('total', String(t.total), 'no extrato do mês');
      pinta('classificados', String(t.classificados), `${plural(t.automaticos, 'sozinho', 'sozinhos')}, ${t.manuais} à mão`);
      pinta('sem', String(t.sem), t.sem ? formatarMoeda(t.sem_valor) : 'Nada faltando');
      pinta('manuais', String(t.manuais));
    }

    function pintarNota() {
      const alvo = el('ctbClassNota');
      alvo.style.color = '';
      if (dados?.fechada) {
        alvo.textContent = `Competência fechada: vale a classificação congelada${dados.versao ? ` na versão ${dados.versao}` : ''}. Ela só muda depois de reabrir.`;
        alvo.style.color = 'var(--color-primary-light)';
        return;
      }
      alvo.textContent = dados && !dados.totais.total ? 'Nenhum lançamento do extrato neste mês: importe o extrato (Extrato bancário).' : '';
    }

    function pintarLote() {
      const visiveis = linhasVisiveis();
      el('ctbClassMarcados').textContent = marcados.size ? plural(marcados.size, 'lançamento marcado', 'lançamentos marcados') : 'Nenhum marcado';
      aplicarBtn.disabled = !marcados.size || !loteConta.value || !podeClassificar();
      todos.checked = visiveis.length > 0 && visiveis.every(l => marcados.has(String(l.id)));
      todos.disabled = !podeClassificar();
    }

    function linhasVisiveis() {
      const termo = normalizar(busca.value.trim());
      return (dados?.linhas || []).filter(l => !termo || normalizar([l.descricao, l.documento, formatarMoeda(l.valor), numeroBr(Math.abs(l.valor)), l.classificacao?.conta, l.conta_financeira].join(' ')).includes(termo));
    }

    function celulaDaConta(l) {
      const cls = l.classificacao || {};
      const sub = cls.criterio === 'sem' ? (cls.detalhe || (dados?.fechada ? 'Sem conta no fechamento' : 'Sem conta: escolha uma ou crie uma regra')) : [cls.criterio_rotulo, cls.detalhe].filter(Boolean).join(' · ');
      if (!podeClassificar()) {
        const td = celula(cls.conta || '—', 'px-4 py-3', sub);
        // Mês fechado: a de hoje, quando é outra (vira diferença; reabra para refazer).
        if (l.atual) {
          const hoje = criar('span', 'ctb-sub', `Hoje seria: ${l.atual.conta || 'sem classificação'}`);
          hoje.style.color = 'var(--color-primary-light)';
          td.appendChild(hoje);
        }
        return td;
      }
      const select = criar('select', 'w-full appearance-none select-arrow ctl-campo bg-input border border-inputBorder text-white ctb-conta-linha');
      select.setAttribute('aria-label', `Conta do plano do lançamento de ${formatarData(l.data)}`);
      opcoesDoPlano(select, dados.plano, { vazio: '— sem classificação —', selecionada: cls.conta_id ?? '' });
      select.addEventListener('change', () => {
        if (!select.value) { select.value = String(cls.conta_id ?? ''); return; }
        classificar([l.id], select.value, '');
      });
      const td = celula(select, 'px-4 py-3', sub);
      if (cls.criterio === 'sem') td.querySelector('.ctb-sub').style.color = 'var(--color-primary-light)';
      return td;
    }

    function pintarLista() {
      const linhas = linhasVisiveis();
      if (!linhas.length) {
        linhaVazia(corpo, 6, busca.value.trim() ? 'Nada com esta busca.' : (visaoSel.value === 'sem' ? 'Nada sem classificação neste mês.' : 'Nada nesta visão.'));
        pintarLote();
        return;
      }
      corpo.replaceChildren();
      for (const l of linhas) {
        const caixa = criar('input', 'w-4 h-4');
        caixa.type = 'checkbox';
        caixa.checked = marcados.has(String(l.id));
        caixa.disabled = !podeClassificar();
        caixa.setAttribute('aria-label', `Marcar o lançamento de ${formatarData(l.data)}`);
        caixa.addEventListener('change', () => { if (caixa.checked) marcados.add(String(l.id)); else marcados.delete(String(l.id)); pintarLote(); });
        const acoes = criar('div', 'ctb-celula-acoes');
        if (!dados.fechada && l.classificacao?.criterio === 'manual') {
          acoes.appendChild(botaoPequeno('Automático', 'btn-neutral', () => automatico(l), { perm: 'contabilidade.classificar', titulo: 'Tira a classificação à mão: vale a conciliação ou a regra' }));
        }
        acoes.appendChild(botaoPequeno('Regra', 'btn-secondary', () => abrirOutro('regras-classificacao', {
          competencia: compCampo.value,
          preencher: { condicao_tipo: 'descricao', valor: l.chave_regra || l.descricao || '', sentido: Number(l.valor) < 0 ? 'debito' : 'credito', conta_id: l.classificacao?.conta_id ?? null }
        }), { perm: 'contabilidade.plano.gerir', titulo: 'Criar uma regra a partir deste lançamento' }));
        const tr = criar('tr');
        tr.append(
          celula(caixa, 'px-4 py-3'),
          celula(formatarData(l.data), 'px-4 py-3 ctb-nowrap'),
          celula(l.descricao || '—', 'px-4 py-3', [l.conta_financeira, ROTULO_ESTADO_CONC[l.estado_conciliacao]].filter(Boolean).join(' · ')),
          corDoValor(celula(formatarMoeda(l.valor), 'px-4 py-3 ctb-num'), l.valor),
          celulaDaConta(l),
          celula(acoes, 'px-4 py-3')
        );
        corpo.appendChild(tr);
      }
      try { window.Permissoes?.aplicarAcoesEColunas?.(corpo); } catch (_) { /* sem permissões carregadas */ }
      pintarLote();
    }

    function pintarPorConta() {
      const grupos = dados?.por_conta || [];
      const alvo = el('ctbClassPorConta');
      if (!grupos.length) { linhaVazia(alvo, 5, 'Nada no mês.'); el('ctbClassResultado').textContent = ''; return; }
      alvo.replaceChildren(...grupos.map(g => {
        const tr = criar('tr');
        const nome = celula(g.conta, 'px-4 py-3', plural(g.quantidade, 'lançamento', 'lançamentos'));
        if (!g.conta_id) nome.style.color = 'var(--color-primary-light)';
        tr.append(
          nome, celula(g.tipo_rotulo || '—', 'px-4 py-3'),
          celula(g.entradas ? formatarMoeda(g.entradas) : '—', 'px-4 py-3 ctb-num'),
          celula(g.saidas ? formatarMoeda(g.saidas) : '—', 'px-4 py-3 ctb-num'),
          corDoValor(celula(formatarMoeda(g.resultado), 'px-4 py-3 ctb-num'), g.resultado)
        );
        return tr;
      }));
      const resultado = Math.round(grupos.filter(g => g.do_resultado).reduce((s, g) => s + g.resultado, 0) * 100) / 100;
      el('ctbClassResultado').textContent = `Resultado do mês (receitas − deduções − custos − despesas): ${formatarMoeda(resultado)}`;
    }

    async function classificar(ids, contaId, observacao) {
      mostrarMensagem('ctbClassMensagem', '');
      processando = true;
      try {
        const r = await enviar('/api/contabilidade/classificacao/classificar', 'POST', { ids, conta_id: contaId, observacao });
        processando = false;
        window.showToast?.(`${plural(ids.length, 'lançamento classificado', 'lançamentos classificados')} em "${r.conta}".`, 'success');
        ids.forEach(id => marcados.delete(String(id)));
        avisarAlteracao();
        await carregar();
      } catch (e) {
        mostrarMensagem('ctbClassMensagem', textoDoErro(e, 'Você não tem permissão para classificar.'));
        await carregar();
      } finally {
        processando = false;
      }
    }

    async function automatico(l) {
      try {
        await enviar(`/api/contabilidade/classificacao/movimentos/${encodeURIComponent(l.id)}/automatico`, 'POST', {});
        window.showToast?.('O lançamento voltou à classificação automática.', 'success');
        avisarAlteracao();
        await carregar();
      } catch (e) {
        window.showToast?.(textoDoErro(e, 'Você não tem permissão para classificar.'), 'error');
      }
    }

    async function carregar() {
      const minha = ++leitura;
      try {
        const q = new URLSearchParams({ competencia: compCampo.value || '', visao: visaoSel.value });
        if (contaSel.value) q.set('conta_id', contaSel.value);
        const r = await fetchApi(`/api/contabilidade/classificacao?${q.toString()}`);
        if (minha !== leitura) return;
        dados = r;
        const ids = new Set((r.linhas || []).map(l => String(l.id)));
        for (const id of [...marcados]) if (!ids.has(id)) marcados.delete(id);
        el('ctbClassRotulo').textContent = r.rotulo || rotuloCompetencia(r.competencia);
        pintarFiltros();
        pintarTotais();
        pintarNota();
        pintarLista();
        pintarPorConta();
      } catch (e) {
        if (minha !== leitura) return;
        dados = null;
        linhaVazia(corpo, 6, 'A classificação não pôde ser lida.');
        linhaVazia(el('ctbClassPorConta'), 5, '—');
        mostrarMensagem('ctbClassMensagem', textoDoErro(e, 'Você não tem permissão para ver a Contabilidade.'));
      }
    }

    todos.addEventListener('change', () => {
      for (const l of linhasVisiveis()) { if (todos.checked) marcados.add(String(l.id)); else marcados.delete(String(l.id)); }
      pintarLista();
    });
    loteConta.addEventListener('change', pintarLote);
    acionar(aplicarBtn, () => classificar([...marcados].map(Number), loteConta.value, el('ctbClassLoteObs').value.trim()));
    contaSel.addEventListener('change', carregar);
    compCampo.addEventListener('change', () => { marcados.clear(); carregar(); });
    visaoSel.addEventListener('change', carregar);
    busca.addEventListener('input', pintarLista);
    el('ctbClassPlano').addEventListener('click', () => abrirOutro('plano-contas', {}));
    el('ctbClassRegras').addEventListener('click', () => abrirOutro('regras-classificacao', { competencia: compCampo.value }));
    ouvirAlteracoes(carregar);
    return carregar();
  }

  function montarPlanoContas() {
    const nome = el('ctbPlanoNome');
    const codigo = el('ctbPlanoCodigo');
    const tipo = el('ctbPlanoTipo');
    const ativa = el('ctbPlanoAtiva');
    const observacao = el('ctbPlanoObservacao');
    const corpo = el('ctbPlanoLista');
    const salvarBtn = el('ctbPlanoSalvar');
    let dados = null;
    let editando = null;

    function limpar() {
      editando = null;
      nome.value = '';
      codigo.value = '';
      tipo.value = 'despesa';
      ativa.checked = true;
      observacao.value = '';
      el('ctbPlanoFormTitulo').textContent = 'Nova conta';
      el('ctbPlanoNova').classList.add('hidden');
    }

    function editar(p) {
      editando = p.id;
      nome.value = p.nome;
      codigo.value = p.codigo || '';
      tipo.value = p.tipo;
      ativa.checked = p.ativa;
      observacao.value = p.observacao || '';
      el('ctbPlanoFormTitulo').textContent = `Editar: ${p.nome}`;
      el('ctbPlanoNova').classList.remove('hidden');
      mostrarMensagem('ctbPlanoMensagem', '');
      nome.focus();
    }

    function pintar() {
      const contas = dados?.contas || [];
      el('ctbPlanoRotulo').textContent = plural(contas.filter(p => p.ativa).length, 'conta ativa', 'contas ativas');
      if (!tipo.options.length) tipo.replaceChildren(...Object.entries(dados?.tipos || {}).map(([k, v]) => opcao(k, v)));
      if (!contas.length) { linhaVazia(corpo, 5, 'Nenhuma conta ainda.'); return; }
      corpo.replaceChildren();
      for (const p of contas) {
        const uso = p.uso || {};
        const partes = [uso.titulos ? plural(uso.titulos, 'conta a pagar', 'contas a pagar') : null, uso.regras ? plural(uso.regras, 'regra', 'regras') : null,
          uso.classificacoes ? plural(uso.classificacoes, 'lançamento à mão', 'lançamentos à mão') : null].filter(Boolean);
        const acoes = criar('div', 'ctb-celula-acoes');
        acoes.appendChild(botaoPequeno('Editar', 'btn-neutral', () => editar(p), { perm: 'contabilidade.plano.gerir' }));
        const tr = criar('tr');
        tr.append(
          celula(p.codigo ? `${p.codigo} · ${p.nome}` : p.nome, 'px-4 py-3', p.observacao),
          celula(p.tipo_rotulo, 'px-4 py-3', p.do_resultado ? null : 'fora do resultado'),
          celula(partes.join(' · ') || '—', 'px-4 py-3'),
          celula(p.ativa ? tag('Ativa', 'badge-success') : tag('Desativada', 'badge-neutral'), 'px-4 py-3', p.origem === 'padrao' ? 'veio com o app' : null),
          celula(acoes, 'px-4 py-3')
        );
        corpo.appendChild(tr);
      }
      try { window.Permissoes?.aplicarAcoesEColunas?.(corpo); } catch (_) { /* sem permissões carregadas */ }
    }

    async function carregar() {
      try {
        dados = await fetchApi('/api/contabilidade/plano-contas');
        pintar();
      } catch (e) {
        dados = null;
        linhaVazia(corpo, 5, 'O plano não pôde ser lido.');
        salvarBtn.disabled = true;
        mostrarMensagem('ctbPlanoMensagem', textoDoErro(e, 'Você não tem permissão para ver a Contabilidade.'));
      }
    }

    async function salvar() {
      mostrarMensagem('ctbPlanoMensagem', '');
      if (nome.value.trim().length < 2) { mostrarMensagem('ctbPlanoMensagem', 'Dê um nome à conta.'); return; }
      const corpoConta = { nome: nome.value.trim(), codigo: codigo.value.trim(), tipo: tipo.value, ativa: ativa.checked, observacao: observacao.value };
      processando = true;
      try {
        const r = editando
          ? await enviar(`/api/contabilidade/plano-contas/${encodeURIComponent(editando)}`, 'PUT', corpoConta)
          : await enviar('/api/contabilidade/plano-contas', 'POST', corpoConta);
        processando = false;
        window.showToast?.(editando ? `Conta alterada${r?.renomeadas ? ` (${plural(r.renomeadas, 'conta a pagar acompanhou', 'contas a pagar acompanharam')} o nome novo)` : ''}.` : 'Conta cadastrada.', 'success');
        avisarAlteracao();
        limpar();
        await carregar();
      } catch (e) {
        mostrarMensagem('ctbPlanoMensagem', textoDoErro(e, 'Você não tem permissão para mexer no plano de contas.'));
      } finally {
        processando = false;
      }
    }

    el('ctbPlanoNova').addEventListener('click', limpar);
    acionar(salvarBtn, salvar);
    return carregar().then(() => { if (!editando) limpar(); });
  }

  const AJUDA_DA_REGRA = {
    descricao: 'Palavras inteiras, sem acento. Ex.: TARIFA pega "Tarifa pacote de serviços". Vale para os lançamentos do extrato.',
    contrapartida: 'O CNPJ/CPF de quem pagou ou recebeu. O extrato pela API do BB (etapa 11) traz; o OFX não.',
    fornecedor: 'Vale para as contas a pagar novas desse fornecedor sem categoria e para os lançamentos conciliados com contas dele.',
    cfop: 'Vale para as contas a pagar novas de NF-e de entrada com um destes CFOPs (separe com vírgula).',
    origem: 'Vale para os lançamentos conciliados com recebimento de pedido, reembolso, comissão ou produção.'
  };

  function montarRegras() {
    const condicao = el('ctbRegraCondicao');
    const valor = el('ctbRegraValor');
    const valorLista = el('ctbRegraValorLista');
    const conta = el('ctbRegraConta');
    const sentido = el('ctbRegraSentido');
    const prioridade = el('ctbRegraPrioridade');
    const observacao = el('ctbRegraObservacao');
    const ativa = el('ctbRegraAtiva');
    const corpo = el('ctbRegrasLista');
    let dados = null;
    let editando = null;
    let preenchida = false;
    let fornecedoresProntos = false;

    const usaLista = () => ['fornecedor', 'origem'].includes(condicao.value);

    async function pintarValor(selecionado = null) {
      const lista = usaLista();
      valor.classList.toggle('hidden', lista);
      valorLista.classList.toggle('hidden', !lista);
      el('ctbRegraAjuda').textContent = AJUDA_DA_REGRA[condicao.value] || '';
      valor.placeholder = { descricao: 'Ex.: TARIFA', contrapartida: 'CNPJ ou CPF', cfop: 'Ex.: 5101, 5102' }[condicao.value] || '';
      if (condicao.value === 'origem') {
        valorLista.replaceChildren(...Object.entries(dados?.origens || {}).map(([k, v]) => opcao(k, v)));
        if (selecionado) valorLista.value = selecionado;
      } else if (condicao.value === 'fornecedor') {
        if (!fornecedoresProntos) {
          fornecedoresProntos = true;
          await carregarFornecedores(valorLista, { vazio: 'Escolha o fornecedor' }).catch(() => null);
        }
        valorLista.value = selecionado ?? '';
      }
    }

    function valorDoForm() { return usaLista() ? valorLista.value : valor.value.trim(); }

    async function preencher(r = {}) {
      condicao.value = r.condicao_tipo || 'descricao';
      await pintarValor(r.valor ?? null);
      if (!usaLista()) valor.value = r.valor || '';
      sentido.value = r.sentido || 'ambos';
      if (r.conta_id !== null && r.conta_id !== undefined) conta.value = String(r.conta_id); else conta.value = '';
      prioridade.value = String(r.prioridade ?? 0);
      observacao.value = r.observacao || '';
      ativa.checked = r.ativa !== false;
      el('ctbRegraTeste').textContent = '';
    }

    async function limpar() {
      editando = null;
      await preencher({});
      el('ctbRegraFormTitulo').textContent = 'Nova regra';
      el('ctbRegraNova').classList.add('hidden');
    }

    async function editar(r) {
      editando = r.id;
      await preencher(r);
      el('ctbRegraFormTitulo').textContent = `Editar: ${r.condicao_rotulo} ${r.valor_rotulo}`;
      el('ctbRegraNova').classList.remove('hidden');
      mostrarMensagem('ctbRegrasMensagem', '');
    }

    function pintar() {
      const regras = dados?.regras || [];
      el('ctbRegrasRotulo').textContent = plural(regras.filter(r => r.ativa).length, 'regra ativa', 'regras ativas');
      if (!regras.length) linhaVazia(corpo, 5, 'Nenhuma regra ainda.');
      else {
        corpo.replaceChildren();
        for (const r of regras) {
          const acoes = criar('div', 'ctb-celula-acoes');
          acoes.appendChild(botaoPequeno('Editar', 'btn-neutral', () => editar(r), { perm: 'contabilidade.plano.gerir' }));
          const tr = criar('tr');
          tr.append(
            celula(`${r.condicao_rotulo}: ${r.valor_rotulo}`, 'px-4 py-3', [r.prioridade ? `prioridade ${r.prioridade}` : null, r.observacao].filter(Boolean).join(' · ') || null),
            celula(r.conta || '—', 'px-4 py-3', r.conta_ativa ? null : 'conta desativada'),
            celula(r.sentido_rotulo, 'px-4 py-3'),
            celula(r.ativa ? tag('Ativa', 'badge-success') : tag('Desativada', 'badge-neutral'), 'px-4 py-3', r.origem === 'padrao' ? 'veio com o app' : null),
            celula(acoes, 'px-4 py-3')
          );
          corpo.appendChild(tr);
        }
      }
      const sugeridas = dados?.sugeridas || [];
      el('ctbRegrasSugeridasBloco').classList.toggle('hidden', !sugeridas.length);
      el('ctbRegrasSugeridas').replaceChildren(...sugeridas.map(s => {
        const li = criar('li', 'ctb-arquivo');
        const texto = criar('div', 'ctb-arquivo__texto');
        texto.append(
          criar('span', 'ctb-arquivo__nome', `Descrição contém "${s.valor}" → ${s.conta || '—'}`),
          criar('span', 'ctb-arquivo__nota', `${plural(s.quantidade, 'classificação à mão', 'classificações à mão')} · ${dados?.sentidos?.[s.sentido] || s.sentido} · ex.: ${s.exemplos.join(' | ')}`)
        );
        const acoes = criar('div', 'ctb-arquivo__acoes');
        acoes.appendChild(botaoPequeno('Usar', 'btn-secondary', async () => {
          editando = null;
          await preencher({ ...s, ativa: true });
          el('ctbRegraFormTitulo').textContent = 'Nova regra (sugerida)';
          mostrarMensagem('ctbRegrasMensagem', 'Confira e clique em "Salvar regra".', 'info');
        }, { perm: 'contabilidade.plano.gerir' }));
        li.append(icone('fa-lightbulb'), texto, acoes);
        return li;
      }));
      try { window.Permissoes?.aplicarAcoesEColunas?.(overlay); } catch (_) { /* sem permissões carregadas */ }
    }

    async function carregar() {
      try {
        dados = await fetchApi('/api/contabilidade/regras');
        if (!condicao.options.length) {
          condicao.replaceChildren(...Object.entries(dados.condicoes || {}).map(([k, v]) => opcao(k, v)));
          sentido.replaceChildren(...Object.entries(dados.sentidos || {}).map(([k, v]) => opcao(k, v)));
        }
        const atual = conta.value;
        opcoesDoPlano(conta, dados.plano, { vazio: 'Escolha a conta' });
        if (atual) conta.value = atual;
        pintar();
        if (!preenchida) {
          preenchida = true;
          if (contexto.preencher) {
            await preencher({ ...contexto.preencher, ativa: true });
            el('ctbRegraFormTitulo').textContent = 'Nova regra (a partir do lançamento)';
          } else await limpar();
        }
      } catch (e) {
        dados = null;
        linhaVazia(corpo, 5, 'As regras não puderam ser lidas.');
        el('ctbRegraSalvar').disabled = true;
        mostrarMensagem('ctbRegrasMensagem', textoDoErro(e, 'Você não tem permissão para ver a Contabilidade.'));
      }
    }

    const doForm = () => ({
      condicao_tipo: condicao.value, valor: valorDoForm(), sentido: sentido.value, conta_id: conta.value,
      prioridade: prioridade.value, ativa: ativa.checked, observacao: observacao.value
    });

    async function testar() {
      mostrarMensagem('ctbRegrasMensagem', '');
      try {
        const r = await enviar('/api/contabilidade/regras/testar', 'POST', { ...doForm(), competencia: contexto.competencia || '' });
        const exemplos = (r.exemplos || []).slice(0, 3).map(x => `${formatarData(x.data)} (${formatarMoeda(x.valor)})`).join(', ');
        el('ctbRegraTeste').textContent = r.quantidade
          ? `Em ${r.rotulo}, pega ${plural(r.quantidade, 'lançamento', 'lançamentos')}: ${r.mudariam} ${r.mudariam === 1 ? 'mudaria' : 'mudariam'} para "${r.conta}"${r.a_mao ? `, ${r.a_mao} à mão (não ${r.a_mao === 1 ? 'muda' : 'mudam'})` : ''}. Ex.: ${exemplos}.`
          : `Em ${r.rotulo}, não pega nenhum lançamento do extrato.`;
      } catch (e) {
        el('ctbRegraTeste').textContent = '';
        mostrarMensagem('ctbRegrasMensagem', textoDoErro(e, 'Você não tem permissão para ver a Contabilidade.'));
      }
    }

    async function salvar() {
      mostrarMensagem('ctbRegrasMensagem', '');
      if (!valorDoForm()) { mostrarMensagem('ctbRegrasMensagem', 'Informe o valor da regra.'); return; }
      if (!conta.value) { mostrarMensagem('ctbRegrasMensagem', 'Escolha a conta do plano.'); return; }
      processando = true;
      try {
        if (editando) await enviar(`/api/contabilidade/regras/${encodeURIComponent(editando)}`, 'PUT', doForm());
        else await enviar('/api/contabilidade/regras', 'POST', doForm());
        processando = false;
        window.showToast?.(editando ? 'Regra alterada.' : 'Regra criada.', 'success');
        avisarAlteracao();
        await limpar();
        await carregar();
      } catch (e) {
        mostrarMensagem('ctbRegrasMensagem', textoDoErro(e, 'Você não tem permissão para mexer nas regras.'));
      } finally {
        processando = false;
      }
    }

    condicao.addEventListener('change', () => { valor.value = ''; pintarValor(); });
    el('ctbRegraNova').addEventListener('click', limpar);
    acionar(el('ctbRegraTestar'), testar);
    acionar(el('ctbRegraSalvar'), salvar);
    return carregar();
  }

  // ------------------------------------------------------------ histórico dos fechamentos (etapa 7)

  function montarFechamentos() {
    const compCampo = el('ctbFechHistCompetencia');
    montarCompetencias(compCampo, contexto.competencia);
    let dados = null;
    let leitura = 0;
    let escolhida = null;

    function pintarDetalhe() {
      const v = (dados?.versoes || []).find(x => x.versao === escolhida) || null;
      el('ctbFechHistDetalhe').classList.toggle('hidden', !v);
      if (!v) return;
      el('ctbFechHistDetalheTitulo').textContent = `Congelado na versão ${v.versao}`;
      const r = v.resultado;
      el('ctbFechHistDetalheResultado').textContent = r ? `Resultado do mês: ${formatarMoeda(r.resultado)}${r.sem_classificacao ? ` · sem classificação: ${formatarMoeda(r.sem_classificacao)}` : ''}` : 'Sem a classificação na época';
      const corpo = el('ctbFechHistPorConta');
      const grupos = r?.por_conta || [];
      if (!grupos.length) linhaVazia(corpo, 4, 'Nada classificado nesta versão.');
      else {
        corpo.replaceChildren(...grupos.map(g => {
          const tr = criar('tr');
          const nome = celula(g.conta, 'px-4 py-3', plural(g.quantidade, 'lançamento', 'lançamentos'));
          if (!g.conta_id) nome.style.color = 'var(--color-primary-light)';
          tr.append(nome, celula(g.entradas ? formatarMoeda(g.entradas) : '—', 'px-4 py-3 ctb-num'), celula(g.saidas ? formatarMoeda(g.saidas) : '—', 'px-4 py-3 ctb-num'),
            corDoValor(celula(formatarMoeda(g.resultado), 'px-4 py-3 ctb-num'), g.resultado));
          return tr;
        }));
      }
      preencherDados(el('ctbFechHistExtrato'), (v.extrato || []).map(x => [
        `Extrato · ${x.conta}`,
        `${plural(x.lancamentos, 'lançamento', 'lançamentos')} · ${formatarMoeda(x.resultado)}${x.saldo_banco ? ` · saldo ${formatarMoeda(x.saldo_banco.valor)} em ${formatarData(x.saldo_banco.data)}` : ''}${x.completo === false ? ' · extrato incompleto' : ''}`
      ]));
    }

    function textoDaComparacao(x) {
      if (x.mesmo_hash && x.resultado.antes === x.resultado.depois) return `Da versão ${x.de} para a ${x.para}: os mesmos lançamentos, nas mesmas contas.`;
      const partes = [];
      if (x.resultado.antes !== x.resultado.depois) partes.push(`resultado ${formatarMoeda(x.resultado.antes)} → ${formatarMoeda(x.resultado.depois)}`);
      if (x.contas.length) partes.push(x.contas.slice(0, 4).map(c => `${c.conta} ${c.diferenca > 0 ? '+' : ''}${formatarMoeda(c.diferenca)}`).join(', '));
      if (x.novos) partes.push(plural(x.novos, 'lançamento novo', 'lançamentos novos'));
      if (x.sairam) partes.push(plural(x.sairam, 'lançamento saiu', 'lançamentos saíram'));
      if (x.reclassificados) partes.push(plural(x.reclassificados, 'mudou de conta', 'mudaram de conta'));
      return `Da versão ${x.de} para a ${x.para}: ${partes.join('; ') || 'nada que mude o resultado'}.`;
    }

    function pintar() {
      const d = dados;
      pintarSituacao(el('ctbFechHistSituacao'), d?.status || 'aberta');
      const versoes = d?.versoes || [];
      const nota = el('ctbFechHistNota');
      if (!d) nota.textContent = '';
      else if (d.status === 'fechada') nota.textContent = versoes.length ? `Fechada: vale a versão ${versoes[0].versao}.` : 'Fechada antes da etapa 7: sem a foto completa.';
      else if (d.status === 'reaberta') nota.textContent = 'Reaberta: o mês voltou a mudar. Ao fechar de novo, nasce a próxima versão.';
      else nota.textContent = versoes.length ? '' : 'Esta competência ainda não foi fechada.';

      const itens = (d?.diferencas || []).map(x => itemDaLista(`${x.titulo}${x.descricao ? ` — ${x.descricao}` : ''}`, 'fa-exclamation-triangle', 'var(--color-primary-light)'));
      if (d?.criticos_depois) itens.unshift(itemDaLista(`${plural(d.criticos_depois, 'erro crítico novo', 'erros críticos novos')} desde o fechamento (veja a lista de pendências)`, 'fa-ban', 'var(--color-red)'));
      el('ctbFechHistDiferencasBloco').classList.toggle('hidden', !itens.length);
      el('ctbFechHistDiferencas').replaceChildren(...itens);

      const corpo = el('ctbFechHistVersoes');
      if (!versoes.length) linhaVazia(corpo, 6, 'Nenhuma versão guardada.');
      else {
        corpo.replaceChildren();
        versoes.forEach((v, i) => {
          const vale = i === 0 && d.status === 'fechada';
          const tr = criar('tr');
          tr.dataset.ctbLinha = '1';
          if (v.versao === escolhida) tr.classList.add('ctb-linha-destaque');
          const sobrou = v.pendencias.filter(p => !p.ignorada);
          const ignoradas = v.pendencias.length - sobrou.length;
          tr.append(
            celula(vale ? [criar('span', null, `Versão ${v.versao} `), tag('Vale', 'badge-success')] : `Versão ${v.versao}`, 'px-4 py-3 ctb-nowrap'),
            celula(formatarInstante(v.fechada_em), 'px-4 py-3', v.fechada_por),
            celula(v.reaberta_em ? formatarInstante(v.reaberta_em) : '—', 'px-4 py-3', [v.reaberta_por, v.justificativa_reabertura].filter(Boolean).join(' · ') || null),
            corDoValor(celula(v.resultado ? formatarMoeda(v.resultado.resultado) : '—', 'px-4 py-3 ctb-num'), v.resultado?.resultado ?? 0),
            celula(String(v.lancamentos), 'px-4 py-3', v.sem_classificacao ? `${v.sem_classificacao} sem classificação` : null),
            celula(sobrou.length ? plural(sobrou.length, 'pendência', 'pendências') : 'nada', 'px-4 py-3', ignoradas ? plural(ignoradas, 'ignorada', 'ignoradas') : null)
          );
          tr.addEventListener('click', () => { escolhida = v.versao; pintar(); });
          corpo.appendChild(tr);
        });
      }
      el('ctbFechHistComparacoes').replaceChildren(...(d?.comparacoes || []).map(x => itemDaLista(textoDaComparacao(x), 'fa-code-branch')));
      el('ctbFechHistReabrir').classList.toggle('hidden', d?.status !== 'fechada');
      el('ctbFechHistFechar').classList.toggle('hidden', !d || d.status === 'fechada');
      pintarDetalhe();
    }

    async function carregar() {
      const minha = ++leitura;
      mostrarMensagem('ctbFechHistMensagem', '');
      try {
        const r = await fetchApi(`/api/contabilidade/fechamentos?competencia=${encodeURIComponent(compCampo.value || '')}`);
        if (minha !== leitura) return;
        dados = r;
        if (!r.versoes.some(v => v.versao === escolhida)) escolhida = r.versoes[0]?.versao ?? null;
        pintar();
      } catch (e) {
        if (minha !== leitura) return;
        dados = null;
        pintar();
        mostrarMensagem('ctbFechHistMensagem', textoDoErro(e, 'Você não tem permissão para ver a Contabilidade.'));
      }
    }

    compCampo.addEventListener('change', () => { escolhida = null; carregar(); });
    el('ctbFechHistReabrir').addEventListener('click', () => abrirOutro('reabrir', { competencia: compCampo.value }));
    el('ctbFechHistFechar').addEventListener('click', () => abrirOutro('fechar', { competencia: compCampo.value }));
    ouvirAlteracoes(carregar);
    return carregar();
  }

  // ------------------------------------------------------------ relatório mensal e dossiê (etapa 8)

  /** As abas do modal: `[data-ctb-aba]` mostra o `[data-ctb-painel]` de mesmo nome. */
  function ligarAbas() {
    const abas = [...overlay.querySelectorAll('[data-ctb-aba]')];
    const trocar = nome => {
      abas.forEach(b => b.setAttribute('aria-selected', String(b.dataset.ctbAba === nome)));
      overlay.querySelectorAll('[data-ctb-painel]').forEach(p => p.classList.toggle('hidden', p.dataset.ctbPainel !== nome));
    };
    abas.forEach(b => b.addEventListener('click', () => trocar(b.dataset.ctbAba)));
    return trocar;
  }

  /** Célula de dinheiro que fica em branco quando não há valor (débito/crédito do livro). */
  function celulaValor(v, classe = 'px-4 py-3 ctb-num') {
    const td = criar('td', classe);
    if (v !== null && v !== undefined && v !== '' && Number(v) !== 0) td.textContent = formatarMoeda(v);
    return td;
  }

  const TOM_NIVEL = { critico: 'badge-danger', documental: 'badge-warning', aviso: 'badge-info' };

  function montarRelatorio() {
    const compCampo = el('ctbRelCompetencia');
    montarCompetencias(compCampo, contexto.competencia);
    let dados = null;
    let leitura = 0;
    ligarAbas();

    function total(chave, valor, nota) {
      const card = el('ctbRelTotais').querySelector(`[data-total="${chave}"]`);
      card.querySelector('.ctb-total__valor').textContent = valor;
      if (nota !== undefined) card.querySelector('.ctb-total__nota').textContent = nota;
    }

    function pintarResumo() {
      const d = dados;
      const r = d?.resultado || null;
      total('receitas', r ? formatarMoeda(r.receitas) : '—', r?.deducoes ? `deduções ${formatarMoeda(r.deducoes)}` : 'Nas contas de receita');
      total('gastos', r ? formatarMoeda(Math.round((r.custos + r.despesas) * 100) / 100) : '—', r ? `custos ${formatarMoeda(r.custos)} · despesas ${formatarMoeda(r.despesas)}` : '—');
      total('resultado', r ? formatarMoeda(r.resultado) : '—');
      total('sem', r ? formatarMoeda(r.sem_classificacao) : '—',
        d?.resumo?.sem_classificacao ? plural(d.resumo.sem_classificacao, 'lançamento', 'lançamentos') : (r ? 'Tudo classificado' : 'Sem a classificação'));
      const corpo = el('ctbRelContas');
      const contas = d?.resumo?.contas || [];
      if (!contas.length) linhaVazia(corpo, 6, d ? 'Nenhuma conta do banco (ou falta o SQL do extrato).' : 'Não foi possível ler o relatório.');
      else {
        corpo.replaceChildren(...contas.map(x => {
          const tr = criar('tr');
          tr.append(
            celula(x.conta, 'px-4 py-3', x.completo === false ? 'o extrato não cobre o mês inteiro' : null),
            celula(x.saldo_inicial === null ? '—' : formatarMoeda(x.saldo_inicial), 'px-4 py-3 ctb-num'),
            celula(formatarMoeda(x.entradas), 'px-4 py-3 ctb-num'), celula(formatarMoeda(x.saidas), 'px-4 py-3 ctb-num'),
            celula(x.saldo_final === null ? '—' : formatarMoeda(x.saldo_final), 'px-4 py-3 ctb-num'),
            celula(x.saldo_banco ? formatarMoeda(x.saldo_banco.valor) : '—', 'px-4 py-3 ctb-num', x.saldo_banco ? `em ${formatarData(x.saldo_banco.data)}` : null)
          );
          return tr;
        }));
      }
      if (!d) { preencherDados(el('ctbRelResumo'), []); return; }
      const cc = d.resumo.conciliacao;
      const p = d.resumo.pendencias;
      const docs = d.resumo.documentos;
      preencherDados(el('ctbRelResumo'), [
        ['Lançamentos no extrato', String(d.resumo.lancamentos)],
        ['Sem classificação', d.resumo.sem_classificacao === null ? 'sem a classificação' : String(d.resumo.sem_classificacao)],
        ['Conciliados', cc ? String(cc.conciliados) : '—'],
        ['Ignorados (com justificativa)', cc ? String(cc.ignorados) : '—'],
        ['A conciliar', cc ? `${cc.a_conciliar.quantidade} · ${formatarMoeda(cc.a_conciliar.total)}` : '—'],
        ['Registrados sem lançamento no extrato', cc ? String(cc.sem_lancamento) : '—'],
        [d.pendencias.origem === 'fechamento' ? 'Pendências no fechamento' : 'Pendências', `${p.critico} críticas · ${p.documental} documentais · ${p.aviso} avisos · ${p.ignoradas} ignoradas`],
        ['Documentos da competência', docs ? `${docs.total}${docs.falta ? ` (${docs.falta} faltando)` : ''}` : '—']
      ]);
    }

    function pintarLivro() {
      const livros = dados?.livro || [];
      const sel = el('ctbRelConta');
      const antes = sel.value;
      sel.replaceChildren(...livros.map(l => opcao(String(l.conta_id), l.conta)));
      if (livros.some(l => String(l.conta_id) === antes)) sel.value = antes;
      sel.disabled = livros.length < 2;
      const livro = livros.find(l => String(l.conta_id) === sel.value) || livros[0] || null;
      const corpo = el('ctbRelLivro');
      el('ctbRelSaldoInicial').textContent = !livro ? '' : (livro.saldo_conhecido
        ? `Saldo inicial ${formatarMoeda(livro.saldo_inicial)} (pelo saldo do banco em ${formatarData(livro.saldo_banco.data)})`
        : 'Sem o saldo do banco: a coluna Saldo é o acumulado do mês.');
      if (!livro) { linhaVazia(corpo, 8, dados ? 'Nenhuma conta do banco (ou falta o SQL do extrato).' : '—'); return; }
      const busca = normalizar(el('ctbRelBusca').value.trim());
      const linhas = busca
        ? livro.linhas.filter(l => normalizar([l.descricao, l.numero, l.conta_plano, l.observacao, numeroBr(Math.abs(l.valor))].join(' ')).includes(busca))
        : livro.linhas;
      if (!linhas.length) { linhaVazia(corpo, 8, busca ? 'Nenhum lançamento com esta busca.' : 'Nenhum lançamento no mês.'); return; }
      const porDia = new Map(livro.dias.map(x => [x.data, x]));
      const trs = [];
      const linhaTotal = (rotulo, sub, saidas, entradas, saldo) => {
        const tr = criar('tr', 'ctb-linha-total');
        tr.append(celula(rotulo, 'px-4 py-2 ctb-nowrap'), celula(sub, 'px-4 py-2'), celulaValor(saidas ? -saidas : null, 'px-4 py-2 ctb-num'),
          celulaValor(entradas, 'px-4 py-2 ctb-num'), celula(formatarMoeda(saldo), 'px-4 py-2 ctb-num'), criar('td'), criar('td'), criar('td'));
        return tr;
      };
      linhas.forEach((l, i) => {
        const tr = criar('tr');
        tr.dataset.ctbLinha = '1';
        tr.title = 'Ver o dossiê do lançamento';
        const conta = celula(l.conta_plano || 'Sem classificação', 'px-4 py-3');
        if (!l.conta_plano) conta.style.color = 'var(--color-primary-light)';
        const saldo = celula(formatarMoeda(l.saldo), 'px-4 py-3 ctb-num');
        if (l.saldo < 0) saldo.style.color = '#e08aa6';
        tr.append(
          celula(formatarData(l.data), 'px-4 py-3 ctb-nowrap'), celula(l.descricao, 'px-4 py-3', l.numero ? `nº ${l.numero}` : null),
          celulaValor(l.debito), celulaValor(l.credito), saldo, conta,
          // "A conciliar" e "Ignorado" já estão na observação; embaixo só o "Conciliado".
          celula(l.observacao, 'px-4 py-3', l.estado === 'conciliado' ? l.estado_rotulo : null),
          l.vencimento ? celula(formatarData(l.vencimento), 'px-4 py-3 ctb-nowrap') : criar('td', 'px-4 py-3')
        );
        tr.addEventListener('click', () => abrirOutro('dossie', { tipo: 'movimento', id: l.id }));
        trs.push(tr);
        const proxima = linhas[i + 1];
        if (!busca && (!proxima || proxima.data !== l.data)) {
          const dia = porDia.get(l.data);
          trs.push(linhaTotal(`Total do dia ${formatarData(l.data).slice(0, 5)}`, plural(dia.quantidade, 'lançamento', 'lançamentos'), dia.saidas, dia.entradas, dia.saldo));
        }
      });
      if (!busca) {
        const t = livro.totais;
        trs.push(linhaTotal('Total do período', plural(t.quantidade, 'lançamento', 'lançamentos'), t.saidas, t.entradas, livro.saldo_final ?? t.resultado));
      }
      corpo.replaceChildren(...trs);
    }

    function pintarResultado() {
      const corpo = el('ctbRelResultado');
      const r = dados?.resultado || null;
      if (!r) { linhaVazia(corpo, 6, dados ? 'Sem a classificação (falta o SQL da etapa 6): o resultado não pôde ser calculado.' : '—'); return; }
      if (!r.por_conta.length) { linhaVazia(corpo, 6, 'Nenhum lançamento no mês.'); return; }
      const trs = r.por_conta.map(g => {
        const tr = criar('tr');
        const nome = celula(g.conta, 'px-4 py-3');
        if (!g.conta_id) nome.style.color = 'var(--color-primary-light)';
        tr.append(nome, celula(g.tipo_rotulo || '—', 'px-4 py-3'), celula(String(g.quantidade), 'px-4 py-3'),
          celulaValor(g.entradas), celulaValor(g.saidas), corDoValor(celula(formatarMoeda(g.resultado), 'px-4 py-3 ctb-num'), g.resultado));
        return tr;
      });
      const pe = criar('tr', 'ctb-linha-total');
      pe.append(celula('Resultado do mês', 'px-4 py-2'), celula('receitas − deduções − custos − despesas', 'px-4 py-2'), criar('td'), criar('td'), criar('td'),
        corDoValor(celula(formatarMoeda(r.resultado), 'px-4 py-2 ctb-num'), r.resultado));
      corpo.replaceChildren(...trs, pe);
    }

    function pintarConciliacao() {
      const alvo = el('ctbRelConciliacao');
      const lista = dados?.conciliacao;
      if (!lista) {
        alvo.replaceChildren(criar('p', 'text-sm text-gray-300', dados ? 'Sem a conciliação (falta o SQL da etapa 5 ou do extrato).' : ''));
        return;
      }
      if (!lista.length) { alvo.replaceChildren(criar('p', 'text-sm text-gray-300', 'Nenhuma conta do banco.')); return; }
      alvo.replaceChildren(...lista.map(x => {
        const bloco = criar('div', 'ctb-secao-modal');
        const cabeca = criar('div', 'ctb-secao-modal__cabeca');
        const t = x.totais;
        cabeca.append(criar('h3', 'ctl-secao text-[var(--color-primary)]', x.conta),
          criar('span', 'text-sm text-gray-300', `${t.conciliados} conciliados · ${t.ignorados} ignorados · ${t.a_conciliar.quantidade} a conciliar (${formatarMoeda(t.a_conciliar.total)})${x.cobertura?.completa === false ? ' · o extrato não cobre o mês inteiro' : ''}`));
        bloco.appendChild(cabeca);
        const itens = [
          ...x.a_conciliar.map(i => ({ ...i, rotulo: 'A conciliar', tom: 'badge-warning', texto: i.sugestao ? 'tem sugestão' : '' })),
          ...x.ignorados.map(i => ({ ...i, rotulo: 'Ignorado', tom: 'badge-neutral', texto: i.observacao || '' })),
          ...x.com_diferenca.map(i => ({ ...i, rotulo: 'Com diferença', tom: 'badge-info', texto: `diferença ${formatarMoeda(i.diferenca)}${i.observacao ? ` — ${i.observacao}` : ''}` })),
          ...x.sem_lancamento.map(i => ({ ...i, id: null, descricao: i.rotulo, rotulo: 'Sem lançamento no extrato', tom: 'badge-danger', texto: [i.tipo, i.nome, i.forma].filter(Boolean).join(' · ') }))
        ];
        if (!itens.length) {
          bloco.appendChild(criar('p', 'text-sm text-gray-300', 'Tudo conciliado.'));
          return bloco;
        }
        const quadro = criar('div', 'ctb-tabela ctb-tabela--curta glass-surface rounded-xl border border-white/10');
        const tabela = criar('table', 'w-full text-sm');
        const cab = criar('tr');
        for (const [texto, classe] of [['Situação', ''], ['Data', ''], ['Valor', ' ctb-num'], ['Descrição', ''], ['Observação', '']]) cab.appendChild(criar('th', `px-4 py-3 text-left text-xs${classe}`, texto));
        const thead = criar('thead');
        thead.appendChild(cab);
        const tbody = criar('tbody');
        for (const i of itens) {
          const tr = criar('tr');
          if (i.id) {
            tr.dataset.ctbLinha = '1';
            tr.title = 'Ver o dossiê do lançamento';
            tr.addEventListener('click', () => abrirOutro('dossie', { tipo: 'movimento', id: i.id }));
          }
          tr.append(celula(tag(i.rotulo, i.tom), 'px-4 py-3'), celula(formatarData(i.data), 'px-4 py-3 ctb-nowrap'),
            corDoValor(celula(formatarMoeda(i.valor), 'px-4 py-3 ctb-num'), i.valor), celula(i.descricao, 'px-4 py-3'), celula(i.texto, 'px-4 py-3'));
          tbody.appendChild(tr);
        }
        tabela.append(thead, tbody);
        quadro.appendChild(tabela);
        bloco.appendChild(quadro);
        return bloco;
      }));
    }

    function pintarPendencias() {
      const corpo = el('ctbRelPendencias');
      const p = dados?.pendencias;
      el('ctbRelPendNota').textContent = !p ? '' : (p.origem === 'fechamento'
        ? 'O que sobrou (ou foi ignorado com justificativa) quando a competência fechou.'
        : 'As pendências de hoje (a competência não está fechada).');
      if (!p?.lista?.length) { linhaVazia(corpo, 3, p ? 'Nenhuma pendência.' : '—'); return; }
      corpo.replaceChildren(...p.lista.map(x => {
        const tr = criar('tr');
        tr.append(celula(tag(x.nivel_rotulo, TOM_NIVEL[x.nivel] || 'badge-neutral'), 'px-4 py-3'), celula(x.titulo, 'px-4 py-3', x.descricao),
          celula(x.ignorada ? `Ignorada${x.justificativa ? `: ${x.justificativa}` : ''}` : 'Em aberto', 'px-4 py-3'));
        return tr;
      }));
    }

    function pintarDocumentos() {
      const corpo = el('ctbRelDocumentos');
      const docs = dados?.documentos;
      if (!docs?.itens?.length) { linhaVazia(corpo, 5, docs ? 'Nenhum documento na competência.' : (dados ? 'Sem os documentos (falta o SQL das etapas 2 e 3).' : '—')); return; }
      corpo.replaceChildren(...docs.itens.map(i => {
        const tr = criar('tr');
        tr.append(celula(i.grupo_rotulo, 'px-4 py-3'), celula(formatarData(i.data), 'px-4 py-3 ctb-nowrap'), celula(i.titulo, 'px-4 py-3', i.detalhe),
          celulaValor(i.valor), celula(i.falta ? tag(i.falta_rotulo || 'Falta o arquivo', 'badge-danger') : [i.categoria, i.origem_rotulo].filter(Boolean).join(' · '), 'px-4 py-3'));
        return tr;
      }));
    }

    function pintar() {
      const d = dados;
      const badge = el('ctbRelSituacao');
      if (!d) pintarEtiqueta(badge, '—', 'badge-neutral');
      else if (d.situacao.previa) pintarEtiqueta(badge, 'Prévia', 'badge-warning');
      else pintarEtiqueta(badge, `Fechada${d.situacao.versao ? ` · v${d.situacao.versao}` : ''}`, 'badge-success');
      el('ctbRelNota').textContent = d?.situacao?.nota || '';
      const avisos = [...(d?.avisos || []), ...(d?.situacao?.diferencas_lista || []).slice(0, 5).map(x => `${x.titulo}${x.descricao ? ` — ${x.descricao}` : ''}`)];
      el('ctbRelAvisos').classList.toggle('hidden', !avisos.length);
      el('ctbRelAvisos').replaceChildren(...avisos.map(t => itemDaLista(t, 'fa-exclamation-triangle', 'var(--color-primary-light)')));
      pintarResumo();
      pintarLivro();
      pintarResultado();
      pintarConciliacao();
      pintarPendencias();
      pintarDocumentos();
    }

    async function carregar() {
      const minha = ++leitura;
      mostrarMensagem('ctbRelMensagem', '');
      try {
        const r = await fetchApi(`/api/contabilidade/relatorio?competencia=${encodeURIComponent(compCampo.value || '')}`);
        if (minha !== leitura) return;
        dados = r;
      } catch (e) {
        if (minha !== leitura) return;
        dados = null;
        mostrarMensagem('ctbRelMensagem', textoDoErro(e, 'Você não tem permissão para ver a Contabilidade.'));
      }
      pintar();
    }

    acionar(el('ctbRelPdf'), async () => {
      try {
        if (!window.electronAPI?.salvarHtmlComoPdf) throw new Error('O PDF só é gerado dentro do aplicativo.');
        const r = await fetchApi(`/api/contabilidade/relatorio/documento?competencia=${encodeURIComponent(compCampo.value || '')}`);
        const s = await window.electronAPI.salvarHtmlComoPdf({ html: r.html, nomeSugerido: r.nome, titulo: 'Salvar o relatório mensal em PDF' });
        if (s?.canceled) return;
        if (!s?.success) throw new Error(s?.message || 'Não foi possível salvar o PDF.');
        window.showToast?.(r.previa ? 'Prévia do relatório salva em PDF.' : `Relatório (versão ${r.versao}) salvo em PDF.`, 'success');
      } catch (e) {
        window.showToast?.(textoDoErro(e, 'Salvar o relatório pede a permissão "Gerar relatório e pacote".'), 'error');
      }
    });
    acionar(el('ctbRelPlanilha'), async () => {
      try {
        if (!window.electronAPI?.salvarArquivoBinario) throw new Error('A planilha só é salva dentro do aplicativo.');
        const r = await fetchApi(`/api/contabilidade/relatorio/planilha?competencia=${encodeURIComponent(compCampo.value || '')}`);
        const s = await window.electronAPI.salvarArquivoBinario({ base64: r.base64, nomeSugerido: r.nome, titulo: 'Salvar a planilha do relatório mensal' });
        if (s?.canceled) return;
        if (!s?.success) throw new Error(s?.message || 'Não foi possível salvar a planilha.');
        window.showToast?.(r.previa ? 'Prévia do relatório salva em planilha.' : `Relatório (versão ${r.versao}) salvo em planilha.`, 'success');
      } catch (e) {
        window.showToast?.(textoDoErro(e, 'Salvar o relatório pede a permissão "Gerar relatório e pacote".'), 'error');
      }
    });
    compCampo.addEventListener('change', carregar);
    el('ctbRelConta').addEventListener('change', pintarLivro);
    el('ctbRelBusca').addEventListener('input', pintarLivro);
    ouvirAlteracoes(carregar);
    return carregar();
  }

  const TOM_DOSSIE = { movimento: 'badge-info', titulo: 'badge-warning', documento: 'badge-neutral' };
  const ICONE_LIGACAO = { movimento: 'fa-university', titulo: 'fa-file-invoice-dollar', documento: 'fa-file-alt' };

  function montarDossie() {
    const pilha = [];
    let atual = { tipo: contexto.tipo || 'movimento', id: contexto.id ?? null };
    let leitura = 0;

    function secao(s) {
      const bloco = criar('div', 'ctb-secao-modal');
      const cabeca = criar('div', 'ctb-secao-modal__cabeca');
      const h = criar('h3', 'ctl-secao text-[var(--color-primary)]');
      h.append(icone(`${s.icone || 'fa-circle'} mr-2`), document.createTextNode(s.titulo));
      cabeca.appendChild(h);
      bloco.appendChild(cabeca);
      if (s.linhas?.length) {
        const dl = criar('dl', 'ctb-dados glass-surface rounded-xl border border-white/10');
        preencherDados(dl, s.linhas);
        bloco.appendChild(dl);
      }
      if (s.ligacoes?.length) {
        const ul = criar('ul', 'ctb-arquivos');
        for (const l of s.ligacoes) {
          const li = criar('li', 'ctb-arquivo');
          const texto = criar('div', 'ctb-arquivo__texto');
          texto.append(criar('span', 'ctb-arquivo__nome', l.rotulo), criar('span', 'ctb-arquivo__nota', l.detalhe || ''));
          li.append(icone(ICONE_LIGACAO[l.tipo] || 'fa-link'), texto);
          if (l.tipo && l.id !== null && l.id !== undefined) {
            const acoes = criar('div', 'ctb-arquivo__acoes');
            acoes.appendChild(botaoPequeno('Ver dossiê', 'btn-secondary', () => ir({ tipo: l.tipo, id: l.id })));
            li.appendChild(acoes);
          }
          ul.appendChild(li);
        }
        bloco.appendChild(ul);
      }
      if (s.vazio) bloco.appendChild(criar('p', 'text-sm text-gray-400', s.vazio));
      return bloco;
    }

    function pintar(d) {
      pintarEtiqueta(el('ctbDossieTipo'), d?.tipo_rotulo || '—', TOM_DOSSIE[d?.tipo] || 'badge-neutral');
      el('ctbDossieNome').textContent = d?.titulo || '';
      el('ctbDossieSub').textContent = [d?.subtitulo, d?.competencia ? `competência ${rotuloCompetencia(d.competencia)}` : null].filter(Boolean).join(' · ');
      el('ctbDossieSecoes').replaceChildren(...(d?.secoes || []).map(secao));
      arquivosEm(el('ctbDossieArquivos'), d?.arquivos || [], { aoMudar: carregar });
      historicoEm(el('ctbDossieHistorico'), d?.historico || []);
      el('ctbDossieAnterior').classList.toggle('hidden', !pilha.length);
    }

    async function carregar() {
      const minha = ++leitura;
      mostrarMensagem('ctbDossieMensagem', '');
      try {
        const d = await fetchApi(`/api/contabilidade/dossie?tipo=${encodeURIComponent(atual.tipo)}&id=${encodeURIComponent(atual.id ?? '')}`);
        if (minha !== leitura) return;
        pintar(d);
      } catch (e) {
        if (minha !== leitura) return;
        pintar(null);
        mostrarMensagem('ctbDossieMensagem', textoDoErro(e, 'Você não tem permissão para ver a Contabilidade.'));
      }
    }

    /** Abre o dossiê de um item ligado aqui mesmo; "← Anterior" volta. */
    function ir(alvo) {
      pilha.push(atual);
      atual = alvo;
      const rolagem = overlay.querySelector('.modal-scroll');
      if (rolagem) rolagem.scrollTop = 0;
      return carregar();
    }

    el('ctbDossieAnterior').addEventListener('click', () => {
      if (!pilha.length) return;
      atual = pilha.pop();
      carregar();
    });
    ouvirAlteracoes(carregar);
    return carregar();
  }

  // ------------------------------------------------------------ pacote para a contabilidade (etapa 9)

  /** Salva um arquivo que veio em base64 (o app pergunta onde; no navegador, download). null = desistiu. */
  async function salvarBase64(base64, nome, titulo, tipo = 'application/octet-stream') {
    if (window.electronAPI?.salvarArquivoBinario) {
      const s = await window.electronAPI.salvarArquivoBinario({ base64, nomeSugerido: nome, titulo });
      if (s?.canceled) return null;
      if (!s?.success) throw new Error(s?.message || 'Não foi possível salvar o arquivo.');
      return s.filePath || nome;
    }
    const binario = atob(base64);
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: tipo }));
    const link = criar('a');
    link.href = url;
    link.download = nome;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return nome;
  }

  function montarPacote() {
    const compCampo = el('ctbPacoteCompetencia');
    montarCompetencias(compCampo, contexto.competencia);
    let dados = null;
    let leitura = 0;
    let primeira = true;
    // O pacote que o "Marcar como enviado" marca: o mais novo que ainda não foi.
    const alvoDoEnvio = () => (dados?.pacotes || []).find(p => !p.enviado_em) || null;

    function pintar() {
      const d = dados;
      const badge = el('ctbPacoteSituacao');
      if (!d) pintarEtiqueta(badge, '—', 'badge-neutral');
      else if (d.status === 'fechada') pintarEtiqueta(badge, `Fechada${d.versao ? ` · v${d.versao}` : ''}`, 'badge-success');
      else pintarEtiqueta(badge, SITUACOES[d.status] || 'Aberta', 'badge-warning');
      let nota = '';
      if (d) {
        nota = d.pode
          ? `Pronto para gerar ${d.nome}.zip: o relatório${d.versao ? ` da versão ${d.versao}` : ''} e os originais do mês. O que faltar vai listado no LEIA-ME.`
          : 'O pacote só sai com a competência fechada e sem pendência documental.';
        if (!d.sql_pacotes) nota += ' Falta rodar sql/contabilidade_pacote.sql: o pacote sai, mas não fica registrado.';
      }
      el('ctbPacoteNota').textContent = nota;
      el('ctbPacoteBloqueiosBloco').classList.toggle('hidden', !d || d.pode);
      el('ctbPacoteBloqueios').replaceChildren(...(d?.bloqueios || []).map(t => itemDaLista(t, 'fa-ban', 'var(--color-red)')));
      el('ctbPacoteNome').textContent = d ? `${d.nome}.zip` : '';

      const pastas = el('ctbPacotePastas');
      if (!d) linhaVazia(pastas, 3, '—');
      else {
        pastas.replaceChildren(...d.pastas.map(p => {
          const tr = criar('tr');
          const exemplos = p.itens.slice(0, 3).map(i => i.titulo).join(' · ') + (p.itens.length > 3 ? ` e mais ${p.itens.length - 3}` : '');
          tr.append(celula(p.pasta, 'px-4 py-3 ctb-nowrap'), celula(p.rotulo, 'px-4 py-3', exemplos || null), celula(String(p.quantidade), 'px-4 py-3'));
          if (!p.quantidade) tr.style.opacity = '0.55';
          return tr;
        }));
      }
      const faltando = d?.faltando || [];
      el('ctbPacoteFaltando').classList.toggle('hidden', !faltando.length);
      el('ctbPacoteFaltando').replaceChildren(...faltando.map(f => itemDaLista(`Falta: ${f.titulo}${f.detalhe ? ` — ${f.detalhe}` : ''} (${f.motivo})`, 'fa-exclamation-triangle', 'var(--color-primary-light)')));

      const lista = el('ctbPacoteLista');
      const pacotes = d?.pacotes || [];
      if (!pacotes.length) linhaVazia(lista, 6, d && !d.sql_pacotes ? 'Sem o SQL da etapa 9, os pacotes não ficam registrados.' : 'Nenhum pacote gerado ainda.');
      else {
        lista.replaceChildren(...pacotes.map(p => {
          const tr = criar('tr');
          const hash = celula(`${p.hash.slice(0, 12)}…`, 'px-4 py-3 ctb-nowrap');
          hash.title = p.hash;
          tr.append(
            celula(formatarInstante(p.gerado_em), 'px-4 py-3', p.gerado_por), celula(p.versao ? `v${p.versao}` : '—', 'px-4 py-3'),
            celula(String(p.arquivos), 'px-4 py-3', p.faltando ? `${p.faltando} faltando` : null), celula(p.tamanho_rotulo, 'px-4 py-3 ctb-nowrap'), hash,
            celula(p.enviado_em ? tag('Enviado', 'badge-success') : tag('Não enviado', 'badge-warning'), 'px-4 py-3',
              p.enviado_em ? `${formatarInstante(p.enviado_em)} · ${p.enviado_para} (${p.envio_meio})` : null)
          );
          return tr;
        }));
      }

      const alvo = alvoDoEnvio();
      el('ctbPacoteEnvioBloco').classList.toggle('hidden', !d?.sql_pacotes || !alvo);
      if (alvo) {
        el('ctbPacoteEnvioAlvo').textContent = `Do pacote gerado em ${formatarInstante(alvo.gerado_em)} (${alvo.nome})`;
        const meio = el('ctbPacoteEnvioMeio');
        if (!meio.options.length) meio.replaceChildren(...(d.meios || []).map(m => opcao(m, m)));
        if (!el('ctbPacoteEnvioPara').value && d.ultimo_destinatario) el('ctbPacoteEnvioPara').value = d.ultimo_destinatario;
        if (primeira && d.ultimo_meio) meio.value = d.ultimo_meio;
      }
      el('ctbPacoteGerar').disabled = !d?.pode;
    }

    async function carregar() {
      const minha = ++leitura;
      mostrarMensagem('ctbPacoteMensagem', '');
      try {
        const r = await fetchApi(`/api/contabilidade/pacote?competencia=${encodeURIComponent(compCampo.value || '')}`);
        if (minha !== leitura) return;
        dados = r;
      } catch (e) {
        if (minha !== leitura) return;
        dados = null;
        mostrarMensagem('ctbPacoteMensagem', textoDoErro(e, 'Você não tem permissão para ver a Contabilidade.'));
      }
      pintar();
      // Veio do "Registrar o envio" do painel: mostra o quadro do envio.
      if (primeira && contexto.enviar) el('ctbPacoteEnvioBloco').scrollIntoView?.({ block: 'center' });
      primeira = false;
    }

    acionar(el('ctbPacoteGerar'), async () => {
      if (!dados?.pode) return;
      const comp = compCampo.value || '';
      mostrarMensagem('ctbPacoteMensagem', '');
      try {
        // O relatório em PDF: o Electron imprime o HTML do relatório (sem perguntar onde salvar).
        let pdf = null;
        if (window.electronAPI?.gerarPdfDeHtml) {
          const doc = await fetchApi(`/api/contabilidade/relatorio/documento?competencia=${encodeURIComponent(comp)}`);
          const impresso = await window.electronAPI.gerarPdfDeHtml({ html: doc.html });
          if (!impresso?.success) throw new Error(impresso?.message || 'Não foi possível gerar o PDF do relatório.');
          pdf = impresso.base64;
        }
        const p = await enviar('/api/contabilidade/pacote', 'POST', { competencia: comp, pdf_base64: pdf });
        const salvo = await salvarBase64(p.base64, p.nome, 'Salvar o pacote da contabilidade', p.tipo);
        if (salvo) window.showToast?.(`Pacote salvo: ${plural(p.arquivos, 'arquivo', 'arquivos')}, ${p.tamanho_rotulo}.`, 'success');
        else window.showToast?.('O pacote foi gerado, mas não foi salvo: gere de novo para salvar.', 'info');
        avisarAlteracao();
        await carregar();
        // Depois de reler (a leitura limpa a mensagem): o aviso do que faltou (sem PDF, sem o SQL).
        if (p.aviso) mostrarMensagem('ctbPacoteMensagem', p.aviso, 'aviso');
      } catch (e) {
        mostrarMensagem('ctbPacoteMensagem', textoDoErro(e, 'Gerar o pacote pede a permissão "Gerar relatório e pacote".'));
      }
    });

    acionar(el('ctbPacoteEnviado'), async () => {
      const alvo = alvoDoEnvio();
      if (!alvo) return;
      mostrarMensagem('ctbPacoteMensagem', '');
      try {
        await enviar(`/api/contabilidade/pacote/${encodeURIComponent(alvo.id)}/enviado`, 'POST', {
          para: el('ctbPacoteEnvioPara').value.trim(), meio: el('ctbPacoteEnvioMeio').value, observacao: el('ctbPacoteEnvioObs').value.trim()
        });
        el('ctbPacoteEnvioObs').value = '';
        window.showToast?.('Envio registrado.', 'success');
        avisarAlteracao();
        await carregar();
      } catch (e) {
        mostrarMensagem('ctbPacoteMensagem', textoDoErro(e, 'Registrar o envio pede a permissão "Gerar relatório e pacote".'));
      }
    });

    compCampo.addEventListener('change', carregar);
    ouvirAlteracoes(carregar);
    return carregar();
  }

  // ------------------------------------------------------------ configurações (integrações)

  const cnpjFormatado = v => {
    const d = String(v || '').replace(/\D/g, '');
    return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : (d || '—');
  };

  /** Uma caixa de marcar com o texto ao lado (o padrão da casa para sim/não). */
  function caixaDeMarcar(texto, marcada, ajuda = null) {
    const rotulo = criar('label', 'ctb-integracao__marcar');
    const caixa = criar('input');
    caixa.type = 'checkbox';
    caixa.checked = Boolean(marcada);
    rotulo.append(caixa, criar('span', null, texto));
    if (ajuda) rotulo.append(criar('small', 'ctb-integracao__ajuda', ajuda));
    return { rotulo, caixa };
  }

  const classeDoCampo = 'w-full ctl-campo bg-input border border-inputBorder text-white placeholder-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/50 transition';

  function campoDeTexto(valor, { tipo = 'text', placeholder = '', min = null, max = null } = {}) {
    const input = criar('input', classeDoCampo);
    input.type = tipo;
    input.value = valor === null || valor === undefined ? '' : String(valor);
    if (placeholder) input.placeholder = placeholder;
    if (min !== null) input.min = String(min);
    if (max !== null) input.max = String(max);
    input.autocomplete = 'off';
    return input;
  }

  function campoDeEscolha(opcoes, valor) {
    const s = criar('select', `${classeDoCampo} appearance-none select-arrow`);
    for (const [v, t] of opcoes) s.appendChild(opcao(v, t));
    s.value = valor === null || valor === undefined ? '' : String(valor);
    return s;
  }

  function blocoDeCampo(rotulo, controle, ajuda = null) {
    const wrap = criar('div', 'ctb-integracao__campo');
    const r = criar('label', 'ctl-rotulo text-gray-300', rotulo);
    wrap.append(r, controle);
    if (ajuda) wrap.append(criar('small', 'ctb-integracao__ajuda', ajuda));
    return wrap;
  }

  /** O valor de um controle, no tipo do campo. */
  function valorDoControle(controle, tipo) {
    if (controle.type === 'checkbox') return controle.checked;
    const v = String(controle.value ?? '').trim();
    if (tipo === 'inteiro' || tipo === 'conta') return v === '' ? null : Number(v);
    return v === '' ? null : v;
  }

  /*
   * Cartões contraídos das Configurações (pedido do dono em 02/10/2026):
   * contraído, o cartão mostra só o título e as etiquetas. Fica lembrado
   * neste computador; sem nada guardado, abre só o que tem pendência ou erro.
   */
  const CHAVE_CONTRAIDOS = 'ctb.configuracao.contraidos';
  function lerContraidos() {
    try { return JSON.parse(window.localStorage.getItem(CHAVE_CONTRAIDOS) || '{}') || {}; } catch (_) { return {}; }
  }
  function gravarContraidos(mapa) {
    try { window.localStorage.setItem(CHAVE_CONTRAIDOS, JSON.stringify(mapa)); } catch (_) { /* sem armazenamento: vale só nesta tela */ }
  }
  /** Contraído? O que a pessoa deixou ou, sem nada, fechado quando não há o que fazer nele. Pura. */
  function cartaoContraido(i, mapa) {
    if (Object.prototype.hasOwnProperty.call(mapa || {}, i.chave)) return Boolean(mapa[i.chave]);
    return Boolean(i.fora_de_uso) || (i.pronta && !i.estado?.ultimo_erro);
  }

  /**
   * Configurações: o certificado da empresa e um cartão por integração
   * (o que falta, o que se fornece, ligar, ambiente, busca automática,
   * parâmetros, credenciais do BB, testar e buscar agora, execuções).
   */
  function montarConfiguracao() {
    const lista = el('ctbConfigIntegracoes');
    let dados = null;
    const avancadosAbertos = new Set();
    const resultados = new Map();
    const contraidos = lerContraidos();

    function pintarCertificado() {
      const cert = dados?.certificado || {};
      preencherDados(el('ctbConfigCertificado'), cert.configurado ? [
        ['Titular', cert.titular || '—'], ['CNPJ', cnpjFormatado(cert.cnpj)],
        ['Válido até', `${formatarData(cert.validoAte)}${cert.vencido ? ' — VENCIDO' : (cert.venceEmBreve ? ` — vence em ${cert.diasRestantes} dias` : '')}`],
        ['Guardado', cert.origem === 'banco' ? 'No banco (vale para todas as máquinas)' : 'Neste computador']
      ] : [['Situação', cert.erro || 'Certificado não encontrado'], ['Onde cadastrar', 'Financeiro › Configuração fiscal']]);
      el('ctbConfigBaixarCer').classList.toggle('hidden', !dados?.pode_editar || !cert.configurado);
      pintarEtiqueta(el('ctbConfigPerfil'), dados?.pode_editar ? 'Sup Admin: pode mudar' : 'Só leitura', dados?.pode_editar ? 'badge-success' : 'badge-neutral');
    }

    /** O bloco das credenciais do BB: as da cobrança (só mostra) ou as próprias (guardar o secret de cada ambiente). */
    function blocoDeCredenciais(i, podeEditar, controles) {
      const bloco = criar('div', 'ctb-integracao__credenciais');
      const cr = i.credenciais || {};
      const usaCobranca = () => valorDoControle(controles.get('usar_credenciais_da_cobranca'), 'booleano') !== false;
      const desenharBloco = () => {
        bloco.replaceChildren(criar('h4', 'ctb-integracao__subtitulo', 'Credenciais do BB'));
        if (usaCobranca()) {
          bloco.append(criar('p', 'text-sm text-gray-300', cr.origem === 'cobranca'
            ? `Da Configuração de cobrança (${i.ambiente === 'producao' ? 'produção' : 'homologação'}): client_id ${cr.client_id ? 'ok' : 'FALTA'}, app key ${cr.app_key ? 'ok' : 'FALTA'}, client_secret ${cr.secret_guardado ? `guardado (${cr.secret_origem === 'banco' ? 'no banco' : (cr.secret_origem === 'env' ? 'no .env' : 'neste computador')})` : 'FALTA'}.`
            : 'Salve para passar a usar as credenciais da Configuração de cobrança.'));
          return;
        }
        if (!cr.ambientes) bloco.append(criar('p', 'text-sm text-gray-400', 'Salve com esta caixa desmarcada para usar credenciais próprias; depois guarde o client_secret de cada ambiente aqui.'));
        for (const amb of ['homologacao', 'producao']) {
          const estado = cr.ambientes?.[amb] || {};
          const linha = criar('div', 'ctb-integracao__secret');
          const nome = amb === 'producao' ? 'produção' : 'homologação';
          linha.append(criar('span', 'text-sm text-gray-300', `client_secret (${nome}): ${estado.secret_guardado ? `guardado ${estado.origem === 'banco' ? 'no banco' : (estado.origem === 'env' ? 'no .env' : 'neste computador')}` : 'não guardado'}${estado.erro ? ` — ${estado.erro}` : ''}`));
          if (podeEditar) {
            const campo = campoDeTexto('', { tipo: 'password', placeholder: `Cole o client_secret de ${nome}` });
            const destino = campoDeEscolha([['banco', 'No banco (todas as máquinas)'], ['computador', 'Só neste computador']], dados?.banco_chave_mestra ? 'banco' : 'computador');
            const guardar = botaoPequeno('Guardar', 'btn-primary', async () => {
              if (!campo.value.trim()) { campo.focus(); return; }
              try {
                dados = await enviar(`/api/contabilidade/integracoes/${i.chave}/credenciais`, 'POST', { ambiente: amb, client_secret: campo.value.trim(), destino: destino.value });
                campo.value = '';
                window.showToast?.(`client_secret de ${nome} guardado.`, 'success');
                pintar();
              } catch (e) { mostrarMensagem('ctbConfigMensagem', textoDoErro(e, 'Guardar o segredo é do Sup Admin.')); }
            });
            const remover = botaoPequeno('Remover', 'btn-danger', async () => {
              const ok = window.DialogPadrao?.confirm ? await window.DialogPadrao.confirm({ title: 'Remover o client_secret?', message: `O de ${nome} sai do banco e deste computador.`, confirmText: 'Remover', confirmVariant: 'danger' }) : window.confirm('Remover?');
              if (!ok) return;
              try {
                dados = await fetchApi(`/api/contabilidade/integracoes/${i.chave}/credenciais?ambiente=${amb}&destino=ambos`, { method: 'DELETE' });
                pintar();
              } catch (e) { mostrarMensagem('ctbConfigMensagem', textoDoErro(e, 'Remover o segredo é do Sup Admin.')); }
            });
            const controlesLinha = criar('div', 'ctb-integracao__secret-controles');
            controlesLinha.append(campo, destino, guardar);
            if (estado.secret_guardado) controlesLinha.append(remover);
            linha.append(controlesLinha);
          }
          bloco.append(linha);
        }
      };
      desenharBloco();
      bloco.repintar = desenharBloco;
      return bloco;
    }

    function cartao(i) {
      const podeEditar = Boolean(dados?.pode_editar) && i.sql_pronto;
      const art = criar('article', 'ctb-integracao');
      art.dataset.integracao = i.chave;
      art.dataset.estado = !i.sql_pronto ? 'sql' : (!i.ativa ? 'desligada' : (!i.pronta ? 'pendente' : (i.estado?.ultimo_erro ? 'erro' : 'pronta')));

      const topo = criar('header', 'ctb-integracao__topo');
      const simbolo = criar('span', 'ctb-integracao__icone');
      simbolo.appendChild(icone(i.icone));
      const titulo = criar('div', 'ctb-integracao__titulo');
      titulo.append(criar('h3', null, i.nome), criar('span', 'ctb-integracao__etapa', `Etapa ${i.etapa}`));
      const etiquetas = criar('div', 'ctb-integracao__etiquetas');
      if (i.fora_de_uso) {
        etiquetas.append(tag('Fora de uso', 'badge-neutral'));
      } else {
        etiquetas.append(
          tag(i.ativa ? 'Ligada' : 'Desligada', i.ativa ? 'badge-success' : 'badge-neutral'),
          tag(i.ambiente === 'producao' ? 'Produção' : 'Homologação', i.ambiente === 'producao' ? 'badge-warning' : 'badge-info'),
          i.pronta ? tag('Pronta', 'badge-success') : tag(plural(i.pendencias.length, 'pendência', 'pendências'), 'badge-danger')
        );
        if (i.travada_em_homologacao) etiquetas.append(tag('Máquina presa em homologação', 'badge-neutral', 'O .env desta máquina prende as integrações em homologação'));
      }
      // Expandir/contrair: contraído, fica só o topo (título e etiquetas).
      const alternarCartao = criar('button', 'ctb-integracao__alternar');
      alternarCartao.type = 'button';
      alternarCartao.appendChild(icone('fa-chevron-down'));
      const aplicarContraido = contraido => {
        art.classList.toggle('is-contraido', contraido);
        alternarCartao.setAttribute('aria-expanded', String(!contraido));
        alternarCartao.title = contraido ? 'Expandir' : 'Contrair';
        alternarCartao.setAttribute('aria-label', `${contraido ? 'Expandir' : 'Contrair'} o cartão ${i.nome}`);
      };
      aplicarContraido(cartaoContraido(i, contraidos));
      alternarCartao.addEventListener('click', () => {
        const contraido = !art.classList.contains('is-contraido');
        contraidos[i.chave] = contraido;
        gravarContraidos(contraidos);
        aplicarContraido(contraido);
      });
      topo.append(simbolo, titulo, etiquetas, alternarCartao);
      art.append(topo, criar('p', 'ctb-integracao__descricao', i.descricao));
      // Fora de uso: o motivo e mais nada (não liga, não testa, não cobra pendência).
      if (i.fora_de_uso) {
        art.dataset.estado = 'desligada';
        art.append(criar('p', 'ctb-integracao__fora-de-uso', i.fora_de_uso));
        return art;
      }

      const grade = criar('div', 'ctb-integracao__grade');
      // ---- a situação: o que falta, o que se fornece, o estado e as execuções
      const situacao = criar('div', 'ctb-integracao__coluna');
      situacao.append(criar('h4', 'ctb-integracao__subtitulo', i.pronta ? 'Pronta para usar' : 'O que falta'));
      const faltas = criar('ul', 'ctb-lista-modal text-gray-300');
      if (i.pronta) faltas.append(itemDaLista('Nada: dá para testar e buscar.', 'fa-circle-check', 'var(--color-green)'));
      for (const p of i.pendencias) faltas.append(itemDaLista(p, 'fa-circle-exclamation', 'var(--color-red)'));
      situacao.append(faltas, criar('h4', 'ctb-integracao__subtitulo', 'O que você fornece'));
      const fornecer = criar('ul', 'ctb-lista-modal text-gray-300');
      for (const f of i.fornecer || []) fornecer.append(itemDaLista(f, 'fa-hand-point-right', 'var(--color-primary)'));
      situacao.append(fornecer);
      const est = i.estado || {};
      const linhasEstado = [];
      if (est.ultima_execucao_em) linhasEstado.push(['Última busca', formatarInstante(est.ultima_execucao_em)]);
      if (est.ultimo_sucesso_em) linhasEstado.push(['Último sucesso', formatarInstante(est.ultimo_sucesso_em)]);
      if (est.ultimo_nsu) linhasEstado.push(['NSU', `${est.ultimo_nsu}${est.max_nsu ? ` (máximo ${est.max_nsu})` : ''}`]);
      if (est.proxima_consulta_apos) linhasEstado.push(['Próxima consulta à SEFAZ', formatarInstante(est.proxima_consulta_apos)]);
      if (est.ultimo_erro) linhasEstado.push(['Último erro', est.ultimo_erro]);
      if (!i.grava_no_banco) linhasEstado.push(['Atenção', 'Homologação num banco de produção: busca e teste só contam, nada é gravado.']);
      if (linhasEstado.length) {
        const dl = criar('dl', 'ctb-dados');
        preencherDados(dl, linhasEstado);
        situacao.append(criar('h4', 'ctb-integracao__subtitulo', 'Situação'), dl);
      }
      if (i.execucoes?.length) {
        const ol = criar('ol', 'ctb-historico');
        for (const x of i.execucoes.slice(0, 5)) {
          const li = criar('li');
          const texto = criar('div', 'ctb-historico__texto');
          texto.append(criar('strong', null, x.tipo_rotulo), criar('span', null, x.erro ? `Falhou: ${x.erro}` : (x.resumo || 'Em andamento…')));
          li.append(criar('span', 'ctb-historico__quando', formatarInstante(x.iniciado_em)), texto);
          ol.appendChild(li);
        }
        situacao.append(criar('h4', 'ctb-integracao__subtitulo', 'Últimas execuções'), ol);
      }

      // ---- o formulário
      const form = criar('div', 'ctb-integracao__coluna ctb-integracao__form');
      const controles = new Map();
      const ativa = caixaDeMarcar('Ligada (a busca só roda com a integração ligada)', i.ativa);
      form.append(ativa.rotulo);
      const ambiente = campoDeEscolha([['homologacao', 'Homologação (testes)'], ['producao', 'Produção']], i.ambiente_no_banco);
      form.append(blocoDeCampo('Ambiente', ambiente, i.travada_em_homologacao ? 'Nesta máquina vale homologação (trava do .env).' : null));
      let automatica = null;
      let intervalo = null;
      if (i.tem_automatica) {
        automatica = caixaDeMarcar('Buscar sozinha (a agenda do app)', i.automatica);
        intervalo = campoDeTexto(i.intervalo_min, { tipo: 'number', min: i.intervalo_limites.min, max: i.intervalo_limites.max });
        form.append(automatica.rotulo, blocoDeCampo(`A cada quantos minutos (${i.intervalo_limites.min} a ${i.intervalo_limites.max})`, intervalo));
      }
      const basicos = criar('div', 'ctb-integracao__campos');
      const avancados = criar('div', 'ctb-integracao__campos ctb-integracao__avancado');
      avancados.hidden = !avancadosAbertos.has(i.chave);
      const blocos = [];
      for (const campo of i.campos) {
        const variantes = campo.porAmbiente ? [['homologacao', ' (homologação)'], ['producao', ' (produção)']] : [[null, '']];
        for (const [amb, sufixo] of variantes) {
          const nome = amb ? `${campo.chave}_${amb}` : campo.chave;
          const valor = i.parametros?.[nome];
          let controle;
          let bloco;
          if (campo.tipo === 'booleano') {
            const m = caixaDeMarcar(`${campo.rotulo}${sufixo}`, valor === true || (valor === undefined && campo.padrao === true), campo.ajuda || null);
            controle = m.caixa;
            bloco = m.rotulo;
          } else {
            if (campo.tipo === 'opcao') controle = campoDeEscolha(Object.entries(campo.opcoes), valor ?? campo.padrao ?? '');
            else if (campo.tipo === 'conta') controle = campoDeEscolha([['', 'Escolha a conta'], ...(dados?.contas || []).map(x => [String(x.id), `${x.nome}${x.ativa ? '' : ' (desativada)'}`])], valor ?? '');
            else if (campo.tipo === 'competencia') controle = campoDeTexto(valor ?? campo.padrao ?? '', { tipo: 'month' });
            else controle = campoDeTexto(valor ?? '', { tipo: campo.tipo === 'inteiro' ? 'number' : 'text', placeholder: campo.tipo === 'url' ? 'Vazio = o endereço padrão' : '', min: campo.min ?? null, max: campo.tipo === 'inteiro' ? campo.max : null });
            bloco = blocoDeCampo(`${campo.rotulo}${sufixo}`, controle, campo.ajuda || null);
          }
          controle.dataset.tipo = campo.tipo;
          controles.set(nome, controle);
          bloco.dataset.quando = campo.quando ? JSON.stringify(campo.quando) : '';
          blocos.push(bloco);
          (campo.avancado ? avancados : basicos).append(bloco);
        }
      }
      form.append(basicos);
      let credenciais = null;
      const aplicarQuando = () => {
        for (const bloco of blocos) {
          if (!bloco.dataset.quando) continue;
          const q = JSON.parse(bloco.dataset.quando);
          bloco.hidden = !Object.entries(q).every(([k, v]) => valorDoControle(controles.get(k), 'booleano') === v);
        }
        credenciais?.repintar?.();
      };
      if (i.banco) {
        credenciais = blocoDeCredenciais(i, podeEditar, controles);
        form.append(credenciais);
        controles.get('usar_credenciais_da_cobranca')?.addEventListener('change', aplicarQuando);
      }
      if (avancados.children.length) {
        const textoAvancado = i.banco ? 'Mostrar o avançado (endereços, conta de teste…)' : 'Mostrar o avançado (endereços, NSU inicial…)';
        const alternar = criar('button', 'ctb-link', avancados.hidden ? textoAvancado : 'Esconder o avançado');
        alternar.type = 'button';
        alternar.addEventListener('click', () => {
          avancados.hidden = !avancados.hidden;
          if (avancados.hidden) avancadosAbertos.delete(i.chave); else avancadosAbertos.add(i.chave);
          alternar.textContent = avancados.hidden ? textoAvancado : 'Esconder o avançado';
        });
        form.append(alternar, avancados);
      }
      aplicarQuando();
      // Quem não é Sup Admin vê, mas não muda.
      if (!podeEditar) form.querySelectorAll('input, select').forEach(x => { x.disabled = true; });
      grade.append(situacao, form);
      art.append(grade);

      // ---- o resultado do teste/busca e os botões
      // O resultado fica guardado por integração: recarregar redesenha os
      // cartões e o cartão novo mostra o último. A amostra (teste do CDB) vem
      // num bloco rolável, para copiar e mandar para o mapeamento.
      const resultado = criar('div', 'ctb-integracao__resultado hidden');
      const desenharResultado = () => {
        const r = resultados.get(i.chave);
        resultado.replaceChildren();
        if (r?.texto) resultado.append(criar('p', null, r.texto));
        if (r?.amostra) resultado.append(criar('pre', 'ctb-integracao__amostra', r.amostra));
        resultado.dataset.tom = r?.tom || 'ok';
        resultado.classList.toggle('hidden', !r?.texto);
      };
      const mostrarResultado = (texto, tom = 'ok', amostra = null) => {
        if (texto) resultados.set(i.chave, { texto, tom, amostra }); else resultados.delete(i.chave);
        desenharResultado();
      };
      desenharResultado();
      const rodape = criar('footer', 'ctl-acoes justify-end ctb-integracao__rodape');
      if (podeEditar) {
        rodape.append(botaoPequeno('Salvar', 'btn-primary', async () => {
          const parametros = {};
          for (const [nome, controle] of controles) parametros[nome] = valorDoControle(controle, controle.dataset.tipo);
          const corpo = { ativa: ativa.caixa.checked, ambiente: ambiente.value, parametros };
          if (automatica) { corpo.automatica = automatica.caixa.checked; corpo.intervalo_min = Number(intervalo.value) || null; }
          if (corpo.ambiente === 'producao' && i.ambiente_no_banco !== 'producao') {
            const palavra = await pedirTexto({ titulo: `Ligar a produção — ${i.nome}`, mensagem: 'Em produção a integração busca os documentos reais da empresa (e a SEFAZ registra as manifestações). Digite PRODUCAO para confirmar.', placeholder: 'PRODUCAO', confirmar: 'Ligar produção', minimo: 8, erro: 'Digite PRODUCAO para confirmar.' });
            if (!palavra) return;
            corpo.confirmacao = palavra;
          }
          try {
            dados = await enviar(`/api/contabilidade/integracoes/${i.chave}`, 'PUT', corpo);
            window.showToast?.(`${i.nome}: configuração salva.`, 'success');
            resultados.delete(i.chave);
            avisarAlteracao();
            pintar();
          } catch (e) { mostrarResultado(textoDoErro(e, 'Mudar a configuração é do Sup Admin.'), 'erro'); }
        }, { titulo: 'Grava a configuração desta integração' }));
      }
      rodape.append(botaoPequeno('Testar conexão', i.banco ? 'btn-bb' : 'btn-secondary', async () => {
        mostrarResultado('Testando…', 'aviso');
        try {
          const r = await enviar(`/api/contabilidade/integracoes/${i.chave}/testar`, 'POST', {});
          mostrarResultado(r.resumo || 'Conexão ok.', 'ok', r.amostra || null);
          await recarregar();
        } catch (e) {
          const faltas = Array.isArray(e?.corpo?.pendencias) ? e.corpo.pendencias.join(' ') : null;
          mostrarResultado(faltas ? `Antes de testar: ${faltas}` : textoDoErro(e, 'Testar pede "Configurações da contabilidade".'), 'erro');
          await recarregar();
        }
      }, { titulo: 'Fala com o serviço e não grava nada' }));
      if (i.tem_automatica) {
        rodape.append(botaoPequeno('Buscar agora', 'btn-success', async () => {
          mostrarResultado('Buscando…', 'aviso');
          try {
            const r = await enviar(`/api/contabilidade/integracoes/${i.chave}/sincronizar`, 'POST', {});
            mostrarResultado(r.resumo || 'Busca feita.', r.situacao === 'aguardando' ? 'aviso' : 'ok');
            avisarAlteracao();
            await recarregar();
          } catch (e) {
            const faltas = Array.isArray(e?.corpo?.pendencias) ? e.corpo.pendencias.join(' ') : null;
            mostrarResultado(faltas ? `Antes de buscar: ${faltas}` : textoDoErro(e, 'Buscar pede a permissão desta integração.'), 'erro');
            await recarregar();
          }
        }, { perm: i.permissao_executar, titulo: 'A busca de verdade (a mesma da agenda)' }));
      }
      art.append(resultado, rodape);
      return art;
    }

    function pintar() {
      pintarCertificado();
      lista.replaceChildren();
      if (dados?.sql_pendente) mostrarMensagem('ctbConfigMensagem', 'As integrações ainda não estão ativadas: rode sql/contabilidade_integracoes.sql no banco e reinicie a API.', 'aviso');
      for (const i of dados?.integracoes || []) lista.appendChild(cartao(i));
      try { window.Permissoes?.aplicarAcoesEColunas?.(lista); } catch (_) { /* sem permissões carregadas */ }
    }

    async function recarregar() {
      try {
        dados = await fetchApi('/api/contabilidade/integracoes');
        pintar();
      } catch (e) {
        mostrarMensagem('ctbConfigMensagem', textoDoErro(e, 'Ver as configurações pede "Configurações da contabilidade".'));
      }
    }

    acionar(el('ctbConfigBaixarCer'), async () => {
      try {
        const r = await fetchApi('/api/contabilidade/integracoes/certificado/publico');
        const onde = await salvarBase64(r.base64, r.nome, 'Salvar o certificado público', 'application/x-x509-ca-cert');
        if (onde) window.showToast?.('Certificado público salvo: cadastre-o na aplicação do Portal Developers do BB.', 'success');
      } catch (e) { mostrarMensagem('ctbConfigMensagem', textoDoErro(e, 'Baixar o certificado público é do Sup Admin.')); }
    });
    el('ctbConfigEntrada').addEventListener('click', () => abrirOutro('entrada-dfe', {}));
    ouvirAlteracoes(recarregar);
    return recarregar();
  }

  // ------------------------------------------------------------ caixa de entrada (NF-e e NFS-e)

  const TOM_ENTRADA = { nova: 'badge-warning', completa: 'badge-info', registrada: 'badge-success', ignorada: 'badge-neutral' };
  const MANIFESTACOES_TELA = [
    ['confirmacao', 'Confirmação da operação', 'A compra aconteceu e a mercadoria chegou.'],
    ['desconhecimento', 'Desconhecimento da operação', 'A empresa não fez esta compra (a nota foi emitida contra o CNPJ sem pedido).'],
    ['nao_realizada', 'Operação não realizada', 'Houve o pedido, mas a compra não se concretizou (devolvida, recusada): pede justificativa.']
  ];

  /** Escolher a manifestação (e a justificativa, quando pede). null = desistiu. */
  function pedirManifestacao(linha) {
    return new Promise(resolver => {
      const fundo = criar('div', 'app-message-overlay fixed inset-0 bg-black/50 flex items-center justify-center p-4');
      const caixa = criar('div', 'w-full max-w-md glass-surface backdrop-blur-xl rounded-2xl border border-white/10 p-6 space-y-4');
      caixa.setAttribute('role', 'dialog');
      caixa.setAttribute('aria-modal', 'true');
      caixa.appendChild(criar('h3', 'ctl-modal-titulo text-white', 'Manifestar na SEFAZ'));
      caixa.appendChild(criar('p', 'text-sm text-gray-300', `NF-e ${linha.numero || ''} de ${linha.emitente_nome || 'emitente'} (${formatarMoeda(linha.valor)}). A manifestação é uma declaração à SEFAZ e fica registrada.`));
      const escolha = campoDeEscolha(MANIFESTACOES_TELA.map(([v, t]) => [v, t]), 'confirmacao');
      const explicacao = () => MANIFESTACOES_TELA.find(([v]) => v === escolha.value)?.[2] || '';
      const justificativa = criar('textarea', classeDoCampo);
      justificativa.rows = 3;
      justificativa.maxLength = 255;
      justificativa.placeholder = 'Justificativa (15 a 255 letras)';
      const blocoJust = blocoDeCampo('Justificativa', justificativa);
      blocoJust.style.display = 'none';
      const blocoEscolha = blocoDeCampo('Manifestação', escolha, explicacao());
      escolha.addEventListener('change', () => {
        blocoJust.style.display = escolha.value === 'nao_realizada' ? '' : 'none';
        blocoEscolha.querySelector('.ctb-integracao__ajuda').textContent = explicacao();
      });
      caixa.append(blocoEscolha, blocoJust);
      const erroEl = criar('p', 'hidden text-sm', 'Escreva a justificativa (de 15 a 255 letras).');
      erroEl.style.color = 'var(--color-red)';
      caixa.appendChild(erroEl);
      const rodape = criar('div', 'ctl-acoes justify-end');
      const voltar = criar('button', 'btn-danger ctl-botao text-white', 'Cancelar');
      const ok = criar('button', 'btn-success ctl-botao', 'Manifestar');
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
        const t = justificativa.value.trim();
        if (escolha.value === 'nao_realizada' && (t.length < 15 || t.length > 255)) { erroEl.classList.remove('hidden'); justificativa.focus(); return; }
        sair({ tipo: escolha.value, justificativa: escolha.value === 'nao_realizada' ? t : null });
      });
      document.addEventListener('keydown', aoTecla, true);
      filhoAberto = true;
      document.body.appendChild(fundo);
      escolha.focus();
    });
  }

  /** A caixa de entrada: o que a SEFAZ e o ADN acharam e o que dá para fazer com cada um. */
  function montarEntradaDfe() {
    const corpo = el('ctbEntradaLista');
    const origemSel = el('ctbEntradaOrigem');
    const visaoSel = el('ctbEntradaVisao');
    const busca = el('ctbEntradaBusca');
    let dados = null;

    const acao = (id, caminho, sucesso, corpoEnvio = {}) => async () => {
      mostrarMensagem('ctbEntradaMensagem', '');
      try {
        const r = await enviar(`/api/contabilidade/entrada/${encodeURIComponent(id)}/${caminho}`, 'POST', corpoEnvio);
        window.showToast?.(typeof sucesso === 'function' ? sucesso(r) : sucesso, 'success');
        if (r?.avisos?.length) mostrarMensagem('ctbEntradaMensagem', r.avisos.join(' '), 'aviso');
        avisarAlteracao();
        await carregar();
      } catch (e) {
        mostrarMensagem('ctbEntradaMensagem', textoDoErro(e, 'Isto pede a permissão "Registrar documentos".'));
      }
    };

    function acoesDaLinha(l) {
      const botoes = [];
      // Ciência só faz sentido para a que veio só com o resumo (é ela que libera o XML).
      if (l.pode.manifestar && !l.manifestacao && l.so_resumo) botoes.push(botaoPequeno('Ciência', 'btn-secondary', acao(l.id, 'manifestar', 'Ciência registrada na SEFAZ: o XML completo chega na próxima busca.', { tipo: 'ciencia' }),
        { perm: 'contabilidade.documento.registrar', titulo: 'Ciência da operação: libera o XML completo' }));
      if (l.pode.baixar_xml) botoes.push(botaoPequeno('Baixar XML', 'btn-secondary', acao(l.id, 'baixar-xml', 'XML completo recebido.'), { perm: 'contabilidade.documento.registrar' }));
      if (l.pode.registrar) botoes.push(botaoPequeno('Registrar', 'btn-success', acao(l.id, 'registrar', r => (r.ligado ? 'Já estava registrado: foi ligado.' : 'Registrado em Documentos recebidos.')), { perm: 'contabilidade.documento.registrar' }));
      // A nota do mês anterior ao início: ou registra, ou guarda como histórico (é da empresa, mas não entra).
      if (l.pode.historico) botoes.push(botaoPequeno('Guardar como histórico', 'btn-neutral', acao(l.id, 'historico', 'Guardada como histórico: saiu das pendências.'),
        { perm: 'contabilidade.documento.registrar', titulo: 'É da empresa, mas é de antes do início da Contabilidade: não entra nos documentos' }));
      if (l.pode.manifestar) {
        botoes.push(botaoPequeno('Manifestar…', 'btn-neutral', async () => {
          const escolha = await pedirManifestacao(l);
          if (!escolha) return;
          await acao(l.id, 'manifestar', 'Manifestação registrada na SEFAZ.', escolha)();
        }, { perm: 'contabilidade.documento.registrar', titulo: 'Confirmação, desconhecimento ou operação não realizada' }));
      }
      if (l.pode.ignorar) {
        botoes.push(botaoPequeno('Ignorar', 'btn-neutral', async () => {
          const motivo = await pedirTexto({ titulo: 'Ignorar este documento?', mensagem: 'Ele sai das pendências (não é despesa da empresa, é repetido…). Diga o motivo.', confirmar: 'Ignorar' });
          if (!motivo) return;
          await acao(l.id, 'ignorar', 'Documento ignorado.', { motivo })();
        }, { perm: 'contabilidade.documento.registrar' }));
      }
      if (l.pode.restaurar) botoes.push(botaoPequeno('Restaurar', 'btn-neutral', acao(l.id, 'restaurar', 'Documento restaurado.'), { perm: 'contabilidade.documento.registrar' }));
      if (l.documento_recebido_id) botoes.push(botaoPequeno('Abrir documento', 'btn-secondary', () => abrirOutro('documento-recebido', { documento_id: l.documento_recebido_id })));
      if (!l.so_resumo) botoes.push(botaoPequeno('XML', 'btn-neutral', () => baixarArquivo(`/api/contabilidade/entrada/${encodeURIComponent(l.id)}/xml`, { abrir: false }), { titulo: 'Salvar o XML' }));
      return botoes;
    }

    function desenhar() {
      const termo = normalizar(busca.value).trim();
      const linhas = (dados?.linhas || []).filter(l => !termo || normalizar(`${l.emitente_nome || ''} ${l.emitente_documento || ''} ${l.numero || ''} ${l.chave || ''} ${l.municipio || ''}`).includes(termo));
      if (!linhas.length) {
        linhaVazia(corpo, 6, dados?.sql_pendente ? 'As integrações ainda não estão ativadas (falta o SQL).' : 'Nada por aqui. As buscas automáticas trazem as notas assim que forem ligadas em Configurações.');
        return;
      }
      corpo.replaceChildren(...linhas.map(l => {
        const tr = criar('tr');
        const doc = `${l.tipo_rotulo} ${l.numero || ''}${l.serie ? `/${l.serie}` : ''}`.trim();
        const situacao = [tag(l.status_rotulo, l.historico ? 'badge-info' : (TOM_ENTRADA[l.status] || 'badge-neutral'))];
        if (l.decidir) situacao.push(tag('Decidir', 'badge-warning', l.decidir_texto || ''));
        if (l.cancelada) situacao.push(tag('Cancelada pelo emitente', 'badge-danger'));
        const deuCiencia = ['ciencia', 'confirmacao'].includes(l.manifestacao);
        const sub = [
          l.decidir_texto || null,
          l.so_resumo && l.tipo === 'nfe' ? (deuCiencia ? 'só o resumo: o XML vem na próxima busca (ou em "Baixar XML")' : 'só o resumo (falta a ciência)') : null,
          l.manifestacao ? `manifestada: ${({ ciencia: 'ciência', confirmacao: 'confirmação', desconhecimento: 'desconhecimento', nao_realizada: 'operação não realizada' })[l.manifestacao] || l.manifestacao}` : null,
          l.manifestacao_erro ? `manifestação falhou: ${l.manifestacao_erro}` : null,
          l.erro ? `registro falhou: ${l.erro}` : null,
          l.ignorado_motivo && !l.historico ? `motivo: ${l.ignorado_motivo}` : null,
          l.historico ? l.ignorado_motivo.replace(/^Histórico:\s*/, '') : null
        ].filter(Boolean).join(' · ');
        tr.append(
          celula(formatarData(l.data_emissao)),
          celula(doc, 'px-4 py-3', `${l.origem_rotulo}${l.municipio ? ` · ${l.municipio}` : ''} · ${String(l.chave || '').slice(0, 22)}…`),
          celula(l.emitente_nome || '—', 'px-4 py-3', l.emitente_documento || null),
          celula(formatarMoeda(l.valor), 'px-4 py-3 text-right ctb-num'),
          celula(situacao, 'px-4 py-3', sub || null),
          celula(criarAcoes(acoesDaLinha(l)), 'px-4 py-3 text-right')
        );
        return tr;
      }));
      try { window.Permissoes?.aplicarAcoesEColunas?.(corpo); } catch (_) { /* sem permissões carregadas */ }
    }

    function criarAcoes(botoes) {
      const d = criar('div', 'ctb-celula-acoes ctb-celula-acoes--quebra');
      d.append(...botoes);
      return d;
    }

    async function carregar() {
      mostrarMensagem('ctbEntradaAviso', '');
      try {
        dados = await fetchApi(`/api/contabilidade/entrada?origem=${encodeURIComponent(origemSel.value)}&visao=${encodeURIComponent(visaoSel.value)}`);
        const c = dados.contagem || {};
        pintarEtiqueta(el('ctbEntradaContagem'), `${c.pendentes || 0} ${Number(c.pendentes) === 1 ? 'pendente' : 'pendentes'}`, c.pendentes ? 'badge-warning' : 'badge-success');
        if (dados.sql_pendente) mostrarMensagem('ctbEntradaAviso', 'As integrações ainda não estão ativadas: rode sql/contabilidade_integracoes.sql no banco e reinicie a API.', 'aviso');
      } catch (e) {
        dados = null;
        mostrarMensagem('ctbEntradaAviso', textoDoErro(e, 'Ver a caixa de entrada pede "Ver o fechamento".'));
      }
      desenhar();
    }

    const buscarAgora = chave => async () => {
      mostrarMensagem('ctbEntradaMensagem', '');
      try {
        const r = await enviar(`/api/contabilidade/integracoes/${chave}/sincronizar`, 'POST', {});
        window.showToast?.(r.resumo || 'Busca feita.', r.situacao === 'aguardando' ? 'info' : 'success');
        if (r.situacao === 'aguardando') mostrarMensagem('ctbEntradaMensagem', r.resumo, 'aviso');
        avisarAlteracao();
        await carregar();
      } catch (e) {
        const faltas = Array.isArray(e?.corpo?.pendencias) ? `Antes de buscar: ${e.corpo.pendencias.join(' ')} (Configurações).` : null;
        mostrarMensagem('ctbEntradaMensagem', faltas || textoDoErro(e, 'Buscar pede a permissão "Registrar documentos".'));
      }
    };
    acionar(el('ctbEntradaBuscarSefaz'), buscarAgora('sefaz_nfe'));
    acionar(el('ctbEntradaBuscarAdn'), buscarAgora('nfse_adn'));
    el('ctbEntradaConfig').addEventListener('click', () => abrirOutro('configuracao', {}));
    origemSel.addEventListener('change', carregar);
    visaoSel.addEventListener('change', carregar);
    busca.addEventListener('input', desenhar);
    ouvirAlteracoes(carregar);
    return carregar();
  }

  // ------------------------------------------------------------ atividade

  /* Os tipos do histórico (backend/contabilidade/eventos.js) em grupos, para o filtro e a cor da etiqueta. */
  const GRUPOS_ATIVIDADE = {
    competencia: { rotulo: 'Competência', badge: 'badge-success', tipos: ['competencia_fechada', 'competencia_reaberta'] },
    pendencia: { rotulo: 'Pendências', badge: 'badge-neutral', tipos: ['pendencia_ignorada', 'pendencia_restaurada'] },
    documento: { rotulo: 'Documentos e arquivos', badge: 'badge-info', tipos: ['documento_registrado', 'documento_excluido', 'arquivo_anexado', 'arquivo_excluido', 'fornecedor_cadastrado', 'nfe_manifestada', 'entrada_ignorada'] },
    integracao: { rotulo: 'Integrações', badge: 'badge-neutral', tipos: ['integracao_configurada'] },
    pagar: { rotulo: 'Contas a pagar', badge: 'badge-warning', tipos: ['titulo_criado', 'titulo_alterado', 'titulo_cancelado', 'pagamento_registrado', 'pagamento_estornado'] },
    extrato: { rotulo: 'Extrato', badge: 'badge-info', tipos: ['conta_financeira_criada', 'extrato_importado', 'extrato_desfeito'] },
    conciliacao: { rotulo: 'Conciliação', badge: 'badge-success', tipos: ['conciliacao_feita', 'conciliacao_desfeita', 'conciliacao_automatica', 'lancamento_ignorado', 'lancamento_reativado'] },
    classificacao: { rotulo: 'Classificação', badge: 'badge-neutral', tipos: ['lancamento_classificado', 'classificacao_removida', 'plano_conta_salva', 'regra_salva'] },
    pacote: { rotulo: 'Pacote', badge: 'badge-success', tipos: ['pacote_gerado', 'pacote_enviado'] }
  };
  const grupoDoTipo = tipo => Object.keys(GRUPOS_ATIVIDADE).find(g => GRUPOS_ATIVIDADE[g].tipos.includes(tipo)) || null;
  const iniciaisDe = nome => String(nome || '?').trim().split(/\s+/).filter(Boolean)
    .map((p, i, todos) => (i === 0 || i === todos.length - 1 ? p[0] : '')).join('').toUpperCase().slice(0, 2) || '?';

  /** A atividade inteira em linha do tempo, com a foto de quem fez e filtros (busca, tipo, quem). */
  function montarAtividade() {
    const linha = el('ctbAtividadeLinha');
    const busca = el('ctbAtividadeBusca');
    const tipoSel = el('ctbAtividadeTipo');
    const quemSel = el('ctbAtividadeQuem');
    const HS = window.HistoricoSocial || {};
    let itens = [];
    let fotos = new Map();

    for (const [chave, g] of Object.entries(GRUPOS_ATIVIDADE)) tipoSel.appendChild(opcao(chave, g.rotulo));

    function avatar(item) {
      const caixa = criar('span', 'ctb-avatar');
      if (!item.usuario_id && !item.usuario) {
        caixa.classList.add('ctb-avatar--sistema');
        caixa.title = 'Sistema';
        caixa.appendChild(icone('fa-gear'));
        return caixa;
      }
      const nome = item.usuario || `Usuário ${item.usuario_id}`;
      caixa.title = nome;
      const foto = fotos.get(String(item.usuario_id));
      if (foto) {
        const img = document.createElement('img');
        img.src = foto;
        img.alt = nome;
        img.loading = 'lazy';
        // Foto que não carrega volta para as iniciais.
        img.addEventListener('error', () => { img.remove(); caixa.textContent = iniciaisDe(nome); });
        caixa.appendChild(img);
      } else {
        caixa.textContent = iniciaisDe(nome);
        const cor = window.Beneficiarios?.cor?.(nome);
        if (cor) caixa.style.background = cor;
      }
      return caixa;
    }

    const diaDe = quando => (HS.diaLocal ? HS.diaLocal(quando) : String(quando || '').slice(0, 10));
    const rotuloDia = quando => (HS.rotuloDoDia ? HS.rotuloDoDia(quando) : formatarData(quando));
    const horaDe = quando => (HS.horaDe ? HS.horaDe(quando) : String(quando || '').slice(11, 16));

    function desenhar() {
      const termo = normalizar(busca.value).trim();
      const grupo = tipoSel.value;
      const quem = quemSel.value;
      const visiveis = itens.filter(i => (!grupo || i.grupo === grupo)
        && (!quem || (quem === 'sistema' ? !i.usuario_id : String(i.usuario_id) === quem))
        && (!termo || normalizar(`${i.rotulo} ${i.descricao} ${i.usuario || ''} ${rotuloCompetencia(i.competencia)}`).includes(termo)));
      el('ctbAtividadeContagem').textContent = plural(visiveis.length, 'movimento', 'movimentos');
      linha.replaceChildren();
      let diaAtual = null;
      for (const item of visiveis) {
        const dia = diaDe(item.quando);
        if (dia !== diaAtual) {
          diaAtual = dia;
          linha.appendChild(criar('li', 'ctb-linha-tempo__dia', rotuloDia(item.quando)));
        }
        const li = criar('li', 'ctb-linha-tempo__item');
        const corpo = criar('div', 'ctb-linha-tempo__corpo');
        const topo = criar('div', 'ctb-linha-tempo__topo');
        topo.append(criar('strong', 'ctb-linha-tempo__quem', item.usuario || (item.usuario_id ? `Usuário ${item.usuario_id}` : 'Sistema')), criar('span', 'ctb-linha-tempo__hora', horaDe(item.quando)));
        if (item.competencia) topo.appendChild(criar('span', 'ctb-linha-tempo__competencia', `· ${rotuloCompetencia(item.competencia)}`));
        topo.appendChild(tag(item.rotulo || item.tipo, `${GRUPOS_ATIVIDADE[item.grupo]?.badge || 'badge-neutral'} ctb-linha-tempo__tag`));
        corpo.append(topo, criar('p', 'ctb-linha-tempo__texto', item.descricao || '—'));
        li.append(avatar(item), corpo);
        linha.appendChild(li);
      }
      el('ctbAtividadeVazio').classList.toggle('hidden', visiveis.length > 0);
    }

    function montarQuem() {
      const pessoas = new Map();
      for (const i of itens) if (i.usuario_id !== null && i.usuario_id !== undefined) pessoas.set(String(i.usuario_id), i.usuario || `Usuário ${i.usuario_id}`);
      quemSel.replaceChildren(opcao('', 'Todos'));
      for (const [id, nome] of [...pessoas].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))) quemSel.appendChild(opcao(id, nome));
      if (itens.some(i => !i.usuario_id)) quemSel.appendChild(opcao('sistema', 'Sistema'));
    }

    async function carregar() {
      mostrarMensagem('ctbAtividadeMensagem', '');
      let base = '';
      try { base = (await window.apiConfig?.getApiBaseUrl?.()) || ''; } catch (_) { base = ''; }
      // A foto é enfeite: sem a lista de usuários, ficam as iniciais.
      const [lido, mapa] = await Promise.all([
        fetchApi('/api/contabilidade/atividade?limite=500').catch(e => ({ erro: e })),
        HS.carregarFotos ? HS.carregarFotos(base).catch(() => new Map()) : Promise.resolve(new Map())
      ]);
      if (lido?.erro) mostrarMensagem('ctbAtividadeMensagem', textoDoErro(lido.erro, 'Você não tem permissão para ver a Contabilidade.'));
      fotos = mapa instanceof Map ? mapa : new Map();
      itens = (Array.isArray(lido?.eventos) ? lido.eventos : []).map(e => ({ ...e, grupo: grupoDoTipo(e.tipo) }));
      montarQuem();
      desenhar();
    }

    busca.addEventListener('input', desenhar);
    tipoSel.addEventListener('change', desenhar);
    quemSel.addEventListener('change', desenhar);
    return carregar();
  }

  // ------------------------------------------------------------ mensagens

  /**
   * O social da Contabilidade em tamanho grande: as mesmas opções do cartão
   * da tela (ContabilidadeMensagensOpcoes), mas o objeto citado abre por
   * cima deste modal. Ao fechar, o cartão se relê.
   */
  function montarMensagens() {
    const alvo = el('ctbMensagensLinha');
    const opcoes = window.ContabilidadeMensagensOpcoes?.({ doModal: true, foco: contexto.foco || null });
    if (!alvo || !opcoes || typeof window.HistoricoSocial?.montar !== 'function') {
      alvo?.replaceChildren(criar('p', 'ctb-vazio', 'Não foi possível abrir as mensagens agora.'));
      return null;
    }
    const linha = window.HistoricoSocial.montar(alvo, opcoes);
    aoDesligar.push(() => {
      linha.destruir();
      document.querySelector('.modulo-container.contabilidade-module')?.ctbMensagens?.recarregar?.();
    });
    return linha.pronto;
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
    ctbEvidencias: montarEvidencias,
    ctbExtrato: montarExtrato,
    ctbImportarExtrato: montarImportarExtrato,
    ctbContasFinanceiras: montarContasFinanceiras,
    ctbConciliacao: montarConciliacao,
    ctbConciliarMovimento: montarConciliarMovimento,
    ctbClassificacao: montarClassificacao,
    ctbPlanoContas: montarPlanoContas,
    ctbRegras: montarRegras,
    ctbFechamentos: montarFechamentos,
    ctbRelatorio: montarRelatorio,
    ctbDossie: montarDossie,
    ctbPacote: montarPacote,
    ctbAtividade: montarAtividade,
    ctbMensagens: montarMensagens,
    ctbConfiguracao: montarConfiguracao,
    ctbEntradaDfe: montarEntradaDfe
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
