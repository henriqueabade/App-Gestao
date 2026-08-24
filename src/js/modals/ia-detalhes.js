(function () {
  const OVERLAY = 'iaDetalhes';

  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }

  const close = () => Modal.close(OVERLAY);
  const revelar = () =>
    window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: OVERLAY }));

  const get = id => document.getElementById(id);

  // Sem devolver a leitura selecionada, o modal reabre depois de uma queda sem
  // saber o que carregar (ver docs/restauracao-de-trabalho.md).
  window.EstadoTrabalho?.registrarContexto?.(OVERLAY,
    () => ({ iaLeituraSelecionada: window.iaLeituraSelecionada }));

  const resumo = window.iaLeituraSelecionada;

  const ROTULO_ACAO = { criar: 'Cadastrar', atualizar: 'Atualizar', ignorar: 'Ignorar' };
  const ROTULO_STATUS = {
    pendente: 'Pendente', aplicado: 'Aplicado', erro: 'Erro', ignorado: 'Ignorado'
  };
  const COR_STATUS = {
    aplicado: 'var(--color-green)',
    erro: 'var(--color-red)',
    ignorado: 'rgba(255,255,255,0.45)',
    pendente: 'var(--color-primary-light)'
  };

  function formatarDataHora(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  function formatarTamanho(bytes) {
    const n = Number(bytes) || 0;
    if (!n) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  const ICONE_ORIGEM = { planilha: 'fa-file-excel', pdf: 'fa-file-pdf', imagem: 'fa-file-image' };

  // ---------------------------------------------------------------------------
  // Abas
  // ---------------------------------------------------------------------------

  function trocarAba(nome) {
    document.querySelectorAll('[data-aba-ia]').forEach(botao => {
      const ativa = botao.dataset.abaIa === nome;
      botao.setAttribute('aria-selected', String(ativa));
      // Sem classe de "aba ativa" no build offline do Tailwind, a distinção
      // vem do próprio botão: a ativa fica com a cor primária.
      botao.classList.toggle('btn-primary', ativa);
      botao.classList.toggle('btn-neutral', !ativa);
    });
    document.querySelectorAll('[data-painel-ia]').forEach(painel => {
      painel.classList.toggle('hidden', painel.dataset.painelIa !== nome);
    });
  }

  document.querySelectorAll('[data-aba-ia]').forEach(botao => {
    botao.addEventListener('click', () => trocarAba(botao.dataset.abaIa));
  });

  // ---------------------------------------------------------------------------
  // Desenho
  // ---------------------------------------------------------------------------

  function pintarCabecalho(d) {
    const titulo = get('iaDetTitulo');
    if (titulo) titulo.textContent = d.titulo || `Leitura #${d.id}`;

    const set = (id, valor) => { const el = get(id); if (el) el.textContent = valor; };
    set('iaDetDestino', d.destino_rotulo || d.destino || '—');
    set('iaDetData', formatarDataHora(d.criado_em));
    set('iaDetUsuario', d.usuario_nome || 'sem responsável');

    const status = get('iaDetStatus');
    if (status) {
      status.className = `badge-ia badge-ia--${d.status} flex-shrink-0`;
      status.textContent = d.status_rotulo || d.status || '—';
    }

    const erro = get('iaDetErro');
    if (erro) {
      erro.classList.toggle('hidden', !d.erro);
      erro.textContent = d.erro || '';
    }
  }

  /**
   * Resumo legível do item.
   *
   * `dados` tem forma diferente por destino (insumo, cliente, item de
   * orçamento…). Em vez de um renderizador por destino — que teria de ser
   * mantido em cinco lugares —, mostramos os primeiros campos preenchidos.
   * Serve para conferir de relance; a revisão campo a campo é outra tela.
   */
  function resumirDados(dados) {
    const partes = [];
    for (const [chave, valor] of Object.entries(dados || {})) {
      if (valor === null || valor === undefined || valor === '') continue;
      if (typeof valor === 'object') continue;
      partes.push(`${chave}: ${valor}`);
      if (partes.length >= 4) break;
    }
    return partes.length ? partes.join('  ·  ') : '(vazio)';
  }

  function pintarItens(itens) {
    const corpo = get('iaDetItensCorpo');
    const vazio = get('iaDetItensVazio');
    const tabela = get('iaDetItensTabela');
    const contador = document.querySelector('[data-contador-ia="itens"]');
    if (contador) contador.textContent = itens.length ? `(${itens.length})` : '';

    if (!corpo) return;
    vazio?.classList.toggle('hidden', itens.length > 0);
    tabela?.classList.toggle('hidden', itens.length === 0);
    if (!itens.length) { corpo.replaceChildren(); return; }

    // replaceChildren + textContent em vez de innerHTML: `dados` veio de um
    // documento enviado pelo usuário e passou por um modelo de linguagem —
    // é a última coisa que deveria virar marcação sem escape.
    corpo.replaceChildren(...itens.map(item => {
      const tr = document.createElement('tr');

      const celula = (texto, classe) => {
        const td = document.createElement('td');
        td.className = classe;
        td.textContent = texto;
        return td;
      };

      tr.appendChild(celula(String(item.linha ?? '—'), 'px-3 py-2 text-sm text-white/50'));

      const conteudo = celula(
        item.dados_corrompidos ? 'Conteúdo ilegível' : resumirDados(item.dados),
        'px-3 py-2 text-sm text-white/85'
      );
      if (item.dados_corrompidos) conteudo.style.color = 'var(--color-red)';
      tr.appendChild(conteudo);

      const acao = celula(ROTULO_ACAO[item.acao] || item.acao || '—', 'px-3 py-2 text-sm text-white/70');
      if (item.acao === 'atualizar' && item.alvo_id) {
        acao.textContent = `Atualizar #${item.alvo_id}`;
      }
      tr.appendChild(acao);

      const status = celula(ROTULO_STATUS[item.status] || item.status || '—', 'px-3 py-2 text-sm');
      status.style.color = COR_STATUS[item.status] || 'rgba(255,255,255,0.7)';
      if (item.mensagem) status.title = item.mensagem;
      tr.appendChild(status);

      return tr;
    }));
  }

  /** Mostra/esconde o texto lido de um arquivo, buscando só quando pedido. */
  async function alternarTexto(botao, extracaoId, arquivoId, alvo) {
    if (!alvo.classList.contains('hidden')) {
      alvo.classList.add('hidden');
      botao.textContent = 'Ver o que foi lido';
      return;
    }

    if (!alvo.dataset.carregado) {
      botao.disabled = true;
      botao.textContent = 'Carregando…';
      try {
        const resp = await fetchApi(`/api/ia/${extracaoId}/arquivos/${arquivoId}/texto`);
        const dados = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(dados.error || `Erro ${resp.status}`);
        alvo.textContent = dados.texto || '(nada foi extraído deste arquivo)';
        alvo.dataset.carregado = '1';
      } catch (err) {
        console.error('Falha ao ler o texto extraído', err);
        showToast(err.message || 'Não foi possível carregar o texto', 'error');
        botao.disabled = false;
        botao.textContent = 'Ver o que foi lido';
        return;
      }
      botao.disabled = false;
    }

    alvo.classList.remove('hidden');
    botao.textContent = 'Ocultar';
  }

  function pintarArquivos(extracaoId, arquivos) {
    const lista = get('iaDetArquivosLista');
    const vazio = get('iaDetArquivosVazio');
    const contador = document.querySelector('[data-contador-ia="arquivos"]');
    if (contador) contador.textContent = arquivos.length ? `(${arquivos.length})` : '';

    if (!lista) return;
    vazio?.classList.toggle('hidden', arquivos.length > 0);
    if (!arquivos.length) { lista.replaceChildren(); return; }

    lista.replaceChildren(...arquivos.map(a => {
      const card = document.createElement('div');
      card.className = 'ia-provedor';

      const topo = document.createElement('div');
      topo.className = 'flex items-center justify-between gap-4';

      const esquerda = document.createElement('div');
      esquerda.className = 'flex items-center gap-3 min-w-0';

      const icone = document.createElement('i');
      icone.className = `fas ${ICONE_ORIGEM[a.origem] || 'fa-file'} text-[var(--color-primary)]`;
      esquerda.appendChild(icone);

      const nome = document.createElement('div');
      nome.className = 'min-w-0';
      const linha1 = document.createElement('p');
      linha1.className = 'text-sm text-white truncate';
      // O nome do arquivo vem de fora do sistema: textContent, sempre.
      linha1.textContent = a.nome_arquivo;
      const linha2 = document.createElement('p');
      linha2.className = 'text-xs text-white/45';
      linha2.textContent = [
        formatarTamanho(a.tamanho_bytes),
        a.paginas ? `${a.paginas} página${a.paginas > 1 ? 's' : ''}` : null,
        a.texto_tamanho ? `${a.texto_tamanho.toLocaleString('pt-BR')} caracteres lidos` : 'nada foi lido'
      ].filter(Boolean).join('  ·  ');
      nome.append(linha1, linha2);
      esquerda.appendChild(nome);
      topo.appendChild(esquerda);

      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'btn-neutral text-white rounded-lg px-3 py-1.5 text-xs font-medium flex-shrink-0';
      botao.textContent = 'Ver o que foi lido';
      topo.appendChild(botao);
      card.appendChild(topo);

      if (a.erro) {
        const erro = document.createElement('p');
        erro.className = 'text-xs mt-2';
        erro.style.color = 'var(--color-red)';
        erro.textContent = a.erro;
        card.appendChild(erro);
      }

      const texto = document.createElement('pre');
      texto.className = 'hidden mt-3 text-xs text-white/70 ia-lista-modelos';
      // `whitespace-pre-wrap` não existe no build offline do Tailwind, e um
      // <pre> preserva o espaço mas NÃO quebra a linha: o texto de um PDF
      // virava uma linha só com rolagem horizontal.
      texto.style.whiteSpace = 'pre-wrap';
      texto.style.wordBreak = 'break-word';
      texto.style.padding = '10px';
      texto.style.maxHeight = '220px';
      card.appendChild(texto);

      botao.addEventListener('click', () => alternarTexto(botao, extracaoId, a.id, texto));
      if (!a.texto_tamanho) botao.disabled = true;

      return card;
    }));
  }

  // ---------------------------------------------------------------------------
  // Início
  // ---------------------------------------------------------------------------

  get('iaDetFechar')?.addEventListener('click', close);
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });

  // Pinta o que já se sabe pela grade, para o modal nunca aparecer em branco
  // caso a requisição demore.
  if (resumo) pintarCabecalho(resumo);

  (async () => {
    if (!resumo?.id) {
      showToast('Leitura não encontrada', 'error');
      revelar();
      return;
    }
    try {
      const resp = await fetchApi(`/api/ia/${resumo.id}`);
      const dados = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(dados.error || `Erro ${resp.status}`);

      pintarCabecalho({ ...resumo, ...dados });
      pintarItens(Array.isArray(dados.itens) ? dados.itens : []);
      pintarArquivos(dados.id, Array.isArray(dados.arquivos) ? dados.arquivos : []);
      trocarAba('itens');
    } catch (err) {
      console.error('Falha ao abrir a leitura de IA', err);
      showToast(err.message || 'Não foi possível abrir a leitura', 'error');
    } finally {
      // Sempre revela: um erro aqui não pode deixar o spinner girando para
      // sempre com a tela em branco por trás.
      revelar();
    }
  })();
})();
