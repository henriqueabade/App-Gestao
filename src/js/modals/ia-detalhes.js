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

  /** Última leitura carregada. É a fonte para redesenhar sem ir ao servidor. */
  let leitura = null;

  const ROTULO_STATUS = {
    pendente: 'Pendente', aplicado: 'Aplicado', erro: 'Erro', ignorado: 'Descartado'
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

  const podeEditar = () => leitura?.status === 'revisao' || leitura?.status === 'rascunho';

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
  // Cabeçalho e rodapé
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
      // "3 linhas descartadas" é aviso, não falha: pintar de vermelho faria a
      // leitura boa parecer quebrada.
      erro.style.color = d.status === 'erro' ? 'var(--color-red)' : 'var(--color-primary-light)';
    }
  }

  /** Mostra só o botão que faz sentido para a situação atual da leitura. */
  function pintarRodape() {
    const extrair = get('iaDetExtrair');
    const aplicar = get('iaDetAplicar');
    const aviso = get('iaDetRodapeAviso');
    if (!leitura) return;

    const temTexto = (leitura.arquivos || []).some(a => a.texto_tamanho > 0);
    const mostrarExtrair = leitura.pode_estruturar && temTexto
      && (leitura.status === 'rascunho' || leitura.status === 'revisao' || leitura.status === 'erro');
    const mostrarAplicar = leitura.status === 'revisao' && leitura.pode_aplicar_destino;

    extrair?.classList.toggle('hidden', !mostrarExtrair);
    aplicar?.classList.toggle('hidden', !mostrarAplicar);

    // Extrair de novo REFAZ a lista. Dizer isso antes do clique evita a
    // surpresa de perder correções já feitas à mão.
    if (extrair && mostrarExtrair) {
      const refazendo = leitura.status === 'revisao';
      extrair.innerHTML = refazendo
        ? '<i class="fas fa-rotate-right mr-2"></i>Extrair de novo'
        : '<i class="fas fa-table-list mr-2"></i>Extrair os dados';
      extrair.title = refazendo
        ? 'Refaz a lista a partir do mesmo texto — as correções feitas à mão nos itens pendentes serão perdidas'
        : 'Lê o texto guardado e monta a lista de itens';
    }

    if (!aviso) return;
    if (leitura.status === 'rascunho') {
      aviso.textContent = 'O texto já está guardado: extrair não precisa dos arquivos de novo.';
    } else if (leitura.status === 'revisao' && !leitura.pode_aplicar_destino) {
      aviso.textContent = 'Este destino ainda não sabe gravar — chega numa próxima etapa.';
    } else if (leitura.status === 'aplicada') {
      aviso.textContent = 'Leitura aplicada. Os registros criados por ela estão no módulo de destino.';
    } else {
      aviso.textContent = '';
    }
  }

  // ---------------------------------------------------------------------------
  // Grade de revisão
  // ---------------------------------------------------------------------------

  function pintarCabecalhoDaGrade(campos) {
    const linha = get('iaDetItensCabecalho');
    if (!linha) return;

    const th = (texto, classe) => {
      const el = document.createElement('th');
      if (classe) el.className = classe;
      el.textContent = texto;
      return el;
    };

    linha.replaceChildren(
      th('#', 'ia-col-pequena'),
      ...campos.map(c => th(c.rotulo, `ia-col-${c.largura || 'media'}`)),
      th('O que fazer', 'ia-col-media'),
      th('Situação', 'ia-col-pequena')
    );
  }

  /** Grava uma correção do revisor e devolve o item como ficou. */
  async function salvarItem(itemId, payload) {
    const resp = await fetchApi(`/api/ia/${leitura.id}/itens/${itemId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const dados = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(dados.error || `Erro ${resp.status}`);
    return dados;
  }

  /** Sincroniza o item na lista em memória, para redesenhar sem ir ao servidor. */
  function atualizarEmMemoria(salvo) {
    const alvo = (leitura.itens || []).find(i => i.id === salvo.id);
    if (!alvo) return;
    Object.assign(alvo, salvo);
  }

  function criarCampo(item, campo, editavel) {
    const valor = item.dados?.[campo.chave];
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ia-campo';
    // `value` e não innerHTML/textContent: o valor veio de um documento
    // externo e passou por um modelo de linguagem.
    input.value = valor === null || valor === undefined ? '' : String(valor);
    input.dataset.chave = campo.chave;
    input.title = campo.rotulo;

    if (!editavel) {
      input.readOnly = true;
      return input;
    }

    const faltando = campo.obrigatorio && !String(input.value).trim();
    if (faltando) input.classList.add('ia-campo--faltando');

    // `change` e não `input`: salvar a cada tecla renderia uma requisição por
    // caractere digitado.
    input.addEventListener('change', async () => {
      const anterior = valor === null || valor === undefined ? '' : String(valor);
      if (input.value === anterior) return;
      try {
        const salvo = await salvarItem(item.id, { dados: { [campo.chave]: input.value } });
        atualizarEmMemoria(salvo);
        input.classList.remove('ia-campo--faltando');
        input.classList.add('ia-campo--salvo');
        setTimeout(() => input.classList.remove('ia-campo--salvo'), 900);
        // Redesenha só o resumo: refazer a grade inteira roubaria o foco de
        // quem está percorrendo as células com Tab.
        pintarResumoRevisao();
      } catch (err) {
        showToast(err.message || 'Não foi possível salvar a correção', 'error');
        input.value = anterior;
      }
    });

    return input;
  }

  function criarSeletorDeAcao(item, editavel) {
    const select = document.createElement('select');
    select.className = 'ia-acao-select';
    select.disabled = !editavel;

    const explicacoes = leitura.explicacoes || {};
    const alvo = (leitura.alvos || []).find(a => String(a.id) === String(item.alvo_id));

    const opcoes = [
      { valor: 'criar', rotulo: 'Cadastrar', titulo: explicacoes.criar },
      {
        valor: 'atualizar',
        rotulo: alvo ? `Dar entrada em: ${alvo.nome}` : 'Dar entrada no existente',
        titulo: explicacoes.atualizar,
        // Sem alvo escolhido, "dar entrada" não tem onde entrar. Deixar a
        // opção clicável só produziria erro na hora de aplicar.
        desabilitada: !item.alvo_id
      },
      { valor: 'ignorar', rotulo: 'Descartar', titulo: 'O item não é gravado' }
    ];

    for (const o of opcoes) {
      const option = document.createElement('option');
      option.value = o.valor;
      option.textContent = o.rotulo;
      if (o.titulo) option.title = o.titulo;
      if (o.desabilitada) option.disabled = true;
      if (item.acao === o.valor) option.selected = true;
      select.appendChild(option);
    }

    select.addEventListener('change', async () => {
      try {
        const salvo = await salvarItem(item.id, { acao: select.value });
        atualizarEmMemoria(salvo);
        desenharItens();
      } catch (err) {
        showToast(err.message || 'Não foi possível mudar a ação', 'error');
        select.value = item.acao;
      }
    });

    return select;
  }

  /**
   * Aponta o item para um registro que já existe.
   *
   * É a saída do caso em que a reconciliação avisou "parecido com X" mas não
   * decidiu sozinha: com um clique o revisor confirma que é o mesmo, e o item
   * deixa de cadastrar um quase-duplicado.
   */
  async function apontarPara(item, alvoId) {
    try {
      const salvo = await salvarItem(item.id, { alvo_id: alvoId, acao: 'atualizar' });
      atualizarEmMemoria(salvo);
      desenharItens();
      showToast('Item apontado para o registro existente', 'success');
    } catch (err) {
      showToast(err.message || 'Não foi possível apontar o item', 'error');
    }
  }

  function criarNota(item, colunas) {
    if (!item.mensagem) return null;

    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = colunas;
    td.className = 'ia-nota-item'
      + (item.status === 'erro' ? ' ia-nota-item--erro'
        : item.status === 'aplicado' ? ' ia-nota-item--ok'
          : ' ia-nota-item--alerta');
    td.textContent = item.mensagem;

    // A ressalva "Parecido com X (#7)" carrega o id do candidato. Oferecer o
    // atalho aqui é o que transforma um aviso em ação — sem ele, o revisor
    // teria de achar o insumo por conta própria.
    const sugestao = /\(#(\d+)\)/.exec(item.mensagem);
    if (sugestao && podeEditar() && item.status !== 'aplicado') {
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.textContent = 'É o mesmo';
      botao.title = 'Aponta este item para o registro existente e muda a ação para dar entrada';
      botao.addEventListener('click', () => apontarPara(item, Number(sugestao[1])));
      td.appendChild(botao);
    }

    tr.appendChild(td);
    return tr;
  }

  function desenharItens() {
    const corpo = get('iaDetItensCorpo');
    const vazio = get('iaDetItensVazio');
    const tabela = get('iaDetItensTabela');
    const itens = leitura?.itens || [];
    const campos = leitura?.campos || [];

    const contador = document.querySelector('[data-contador-ia="itens"]');
    if (contador) contador.textContent = itens.length ? `(${itens.length})` : '';

    if (!corpo) return;
    vazio?.classList.toggle('hidden', itens.length > 0);
    tabela?.classList.toggle('hidden', itens.length === 0);

    // Mensagem do estado vazio muda com a situação: "nada foi extraído" e
    // "ainda não extraí" mandam o usuário para lugares diferentes.
    if (vazio) {
      const texto = vazio.querySelector('p');
      if (texto) {
        texto.textContent = leitura?.status === 'rascunho'
          ? 'O texto já foi lido. Clique em "Extrair os dados" para montar a lista.'
          : 'Nenhum item foi extraído desta leitura.';
      }
    }

    pintarResumoRevisao();
    if (!itens.length) { corpo.replaceChildren(); return; }

    pintarCabecalhoDaGrade(campos);
    const colunas = campos.length + 3;
    const editavel = podeEditar();
    const linhas = [];

    for (const item of itens) {
      const tr = document.createElement('tr');
      tr.className = 'ia-linha-item'
        + (item.acao === 'ignorar' || item.status === 'ignorado' ? ' ia-linha-item--ignorada' : '')
        + (item.status === 'erro' ? ' ia-linha-item--erro' : '')
        + (item.status === 'aplicado' ? ' ia-linha-item--aplicada' : '');

      const numero = document.createElement('td');
      numero.className = 'text-sm text-white/40';
      numero.textContent = String(item.linha ?? '—');
      tr.appendChild(numero);

      // Item já gravado não volta a ser editável: mexer nele daria a impressão
      // de corrigir um estoque que já entrou.
      const editavelAqui = editavel && item.status !== 'aplicado';

      for (const campo of campos) {
        const td = document.createElement('td');
        if (item.dados_corrompidos) {
          td.className = 'text-sm';
          td.style.color = 'var(--color-red)';
          td.textContent = campo === campos[0] ? 'Conteúdo ilegível' : '';
        } else {
          td.appendChild(criarCampo(item, campo, editavelAqui));
        }
        tr.appendChild(td);
      }

      const tdAcao = document.createElement('td');
      tdAcao.appendChild(criarSeletorDeAcao(item, editavelAqui));
      tr.appendChild(tdAcao);

      const tdStatus = document.createElement('td');
      tdStatus.className = 'text-sm';
      tdStatus.style.color = COR_STATUS[item.status] || 'rgba(255,255,255,0.7)';
      tdStatus.textContent = ROTULO_STATUS[item.status] || item.status || '—';
      tr.appendChild(tdStatus);

      linhas.push(tr);
      const nota = criarNota(item, colunas);
      if (nota) linhas.push(nota);
    }

    corpo.replaceChildren(...linhas);
    pintarSugestoes();
  }

  /** Datalists de categoria/unidade, para o revisor encaixar no que já existe. */
  function pintarSugestoes() {
    const sugestoes = leitura?.sugestoes || {};
    for (const [chave, valores] of Object.entries(sugestoes)) {
      if (!Array.isArray(valores) || !valores.length) continue;
      const id = `iaDetSugestao-${chave}`;
      let lista = document.getElementById(id);
      if (!lista) {
        lista = document.createElement('datalist');
        lista.id = id;
        get('iaDetItensTabela')?.appendChild(lista);
      }
      lista.replaceChildren(...valores.map(v => {
        const o = document.createElement('option');
        o.value = v;
        return o;
      }));
      document.querySelectorAll(`.ia-campo[data-chave="${chave}"]`)
        .forEach(el => el.setAttribute('list', id));
    }
  }

  /**
   * O que vai acontecer ao aplicar, contado antes do clique.
   *
   * Sem isto, o revisor só descobre que 12 itens iam cadastrar em vez de dar
   * entrada depois que o estoque já ganhou 12 insumos novos.
   */
  function pintarResumoRevisao() {
    const caixa = get('iaDetResumoRevisao');
    if (!caixa) return;

    const itens = leitura?.itens || [];
    if (!itens.length || leitura.status !== 'revisao') {
      caixa.classList.add('hidden');
      return;
    }

    const conta = f => itens.filter(f).length;
    const pendentes = itens.filter(i => i.status !== 'aplicado');
    const criar = pendentes.filter(i => i.acao === 'criar').length;
    const atualizar = pendentes.filter(i => i.acao === 'atualizar').length;
    const ignorar = pendentes.filter(i => i.acao === 'ignorar').length;
    const jaAplicados = conta(i => i.status === 'aplicado');

    const campos = leitura.campos || [];
    const obrigatorios = campos.filter(c => c.obrigatorio);
    const incompletos = pendentes.filter(i =>
      i.acao !== 'ignorar'
      && obrigatorios.some(c => {
        const v = i.dados?.[c.chave];
        return v === null || v === undefined || String(v).trim() === '';
      })).length;

    caixa.classList.remove('hidden');
    caixa.replaceChildren();

    const pedaco = (texto, valor, cor) => {
      const span = document.createElement('span');
      const forte = document.createElement('strong');
      forte.textContent = String(valor);
      if (cor) forte.style.color = cor;
      span.append(forte, document.createTextNode(` ${texto}`));
      return span;
    };
    const separador = () => {
      const s = document.createElement('span');
      s.className = 'ia-resumo-revisao__separador';
      s.textContent = '•';
      return s;
    };

    const partes = [];
    if (criar) partes.push(pedaco('a cadastrar', criar));
    if (atualizar) partes.push(pedaco('a dar entrada', atualizar));
    if (ignorar) partes.push(pedaco('descartados', ignorar, 'rgba(255,255,255,0.45)'));
    if (jaAplicados) partes.push(pedaco('já aplicados', jaAplicados, 'var(--color-green)'));
    if (incompletos) partes.push(pedaco('sem campo obrigatório', incompletos, 'var(--color-red)'));
    if (!partes.length) partes.push(pedaco('itens', pendentes.length));

    for (const [i, p] of partes.entries()) {
      if (i) caixa.appendChild(separador());
      caixa.appendChild(p);
    }

    // Item incompleto falha na hora de gravar. Avisar aqui é o que evita
    // aplicar, ver o erro e ter de voltar.
    const aplicar = get('iaDetAplicar');
    if (aplicar) {
      aplicar.disabled = incompletos > 0 || (criar + atualizar) === 0;
      aplicar.title = incompletos
        ? 'Preencha os campos obrigatórios em vermelho antes de aplicar'
        : (criar + atualizar) === 0
          ? 'Não há item para gravar — todos estão descartados ou já aplicados'
          : '';
    }
  }

  // ---------------------------------------------------------------------------
  // Arquivos
  // ---------------------------------------------------------------------------

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
  // Extrair e aplicar
  // ---------------------------------------------------------------------------

  async function carregar() {
    const resp = await fetchApi(`/api/ia/${resumo.id}`);
    const dados = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(dados.error || `Erro ${resp.status}`);
    leitura = dados;
    pintarCabecalho({ ...resumo, ...dados });
    pintarRodape();
    desenharItens();
    pintarArquivos(dados.id, Array.isArray(dados.arquivos) ? dados.arquivos : []);
  }

  async function extrair() {
    // Refazer descarta as correções manuais dos itens pendentes. Perguntar
    // antes é mais barato do que refazer o trabalho de revisão.
    if (leitura?.status === 'revisao' && window.DialogPadrao?.confirm) {
      const seguir = await window.DialogPadrao.confirm({
        title: 'Extrair de novo',
        message: 'A lista atual será refeita a partir do mesmo texto. '
          + 'As correções feitas à mão nos itens ainda não aplicados serão perdidas.',
        confirmText: 'Extrair de novo',
        cancelText: 'Voltar'
      });
      if (!seguir) return;
    }

    try {
      const resp = await fetchApi(`/api/ia/${leitura.id}/estruturar`, { method: 'POST' });
      const dados = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(dados.error || `Erro ${resp.status}`);

      await carregar();
      trocarAba('itens');
      window.IaModulo?.carregar?.(true);

      if (dados.status === 'erro') showToast('A IA não encontrou itens neste documento', 'error');
      else if (dados.avisos?.length) showToast(`${dados.itens_qtd} itens extraídos — há ressalvas`, 'info');
      else showToast(`${dados.itens_qtd} itens extraídos`, 'success');
    } catch (err) {
      console.error('Falha ao extrair os dados', err);
      showToast(err.message || 'Não foi possível extrair os dados', 'error');
      await carregar().catch(() => {});
    }
  }

  async function aplicar() {
    const pendentes = (leitura.itens || [])
      .filter(i => i.status !== 'aplicado' && i.acao !== 'ignorar').length;

    // Sem o componente carregado, cai no confirm do navegador em vez de
    // seguir direto: gravar em estoque sem confirmação nenhuma é pior do que
    // uma caixa feia.
    if (!window.DialogPadrao?.confirm) {
      if (typeof confirm === 'function'
        && !confirm(`${pendentes} item(ns) vão ser gravados em ${leitura.destino_rotulo}. Continuar?`)) return;
    }
    if (window.DialogPadrao?.confirm) {
      const seguir = await window.DialogPadrao.confirm({
        title: 'Aplicar a leitura',
        message: `${pendentes} item(ns) vão ser gravados em ${leitura.destino_rotulo}. `
          + 'Isso mexe no estoque de verdade e não é desfeito automaticamente.',
        confirmText: 'Aplicar',
        cancelText: 'Revisar mais'
      });
      if (!seguir) return;
    }

    try {
      const resp = await fetchApi(`/api/ia/${leitura.id}/aplicar`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ destino: leitura.destino })
      });
      const dados = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(dados.error || `Erro ${resp.status}`);

      await carregar();
      window.IaModulo?.carregar?.(true);

      if (dados.com_erro) {
        showToast(`${dados.aplicados} gravados, ${dados.com_erro} com erro — veja as linhas em vermelho`, 'error');
      } else {
        showToast(`${dados.aplicados} item(ns) gravados em ${leitura.destino_rotulo}`, 'success');
      }
    } catch (err) {
      console.error('Falha ao aplicar a leitura', err);
      showToast(err.message || 'Não foi possível aplicar', 'error');
      await carregar().catch(() => {});
    }
  }

  // ---------------------------------------------------------------------------
  // Início
  // ---------------------------------------------------------------------------

  get('iaDetFechar')?.addEventListener('click', close);
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });

  // Extrair consome crédito e aplicar mexe em estoque: os dois passam pela
  // trava de duplo clique, que segura o botão até a ação terminar.
  for (const [id, acao] of [['iaDetExtrair', extrair], ['iaDetAplicar', aplicar]]) {
    const botao = get(id);
    if (!botao) continue;
    if (window.BotaoAcao?.bind) window.BotaoAcao.bind(botao, acao);
    else botao.addEventListener('click', acao);
  }

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
      await carregar();
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
