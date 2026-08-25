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

  /**
   * Quais sub-listas estão abertas, por `${itemId}:${chave}`.
   *
   * Fica FORA do desenho de propósito: a grade é redesenhada inteira a cada
   * mudança de ação, e sem guardar isto a lista de contatos que o revisor
   * acabou de abrir se fecharia sozinha no meio da conferência.
   */
  const listasAbertas = new Set();

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
    const gravarTodos = get('iaDetGravarTodos');
    const aviso = get('iaDetRodapeAviso');
    if (!leitura) return;

    const temTexto = (leitura.arquivos || []).some(a => a.texto_tamanho > 0);
    const mostrarExtrair = leitura.pode_estruturar && temTexto
      && (leitura.status === 'rascunho' || leitura.status === 'revisao' || leitura.status === 'erro');
    const emRevisao = leitura.status === 'revisao' && leitura.pode_aplicar_destino;
    const pendentes = itensPendentes().length;
    const temFormulario = Boolean(MODULOS_DE_DESTINO[leitura.destino]);

    extrair?.classList.toggle('hidden', !mostrarExtrair);
    aplicar?.classList.toggle('hidden', !(emRevisao && pendentes > 0 && temFormulario));

    // Gravar tudo de uma vez só aparece quando abrir um formulário por linha
    // seria inviável. Com uma linha só, o caminho normal já dá conta e um
    // segundo botão ao lado dele seria só um jeito de errar.
    gravarTodos?.classList.toggle('hidden', !(emRevisao && pendentes > 1));

    if (aplicar && emRevisao && pendentes > 0 && temFormulario) {
      const rotulo = MODULOS_DE_DESTINO[leitura.destino].rotulo;
      aplicar.innerHTML = '<i class="fas fa-up-right-from-square mr-2"></i>'
        + (pendentes > 1 ? `Abrir a 1ª de ${pendentes} em ${rotulo}` : `Abrir em ${rotulo}`);
      aplicar.title = `Abre ${rotulo} com os dados preenchidos. Nada é gravado aqui: quem salva é você.`;
    }

    if (gravarTodos && emRevisao && pendentes > 1) {
      gravarTodos.title = `Grava ${pendentes} linha(s) direto em ${leitura.destino_rotulo}, `
        + 'sem passar pelo formulário. Use quando conferir uma a uma não for prático.';
    }

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

  /** "Ana Paula · Compras", para caber numa célula. */
  function resumirSubItem(sub, subcampos) {
    const partes = subcampos
      .map(sc => sub?.[sc.chave])
      .filter(v => v !== null && v !== undefined && String(v).trim());
    return partes.slice(0, 2).join(' · ') || '(em branco)';
  }

  /** Grava a lista inteira do campo: o backend valida entrada por entrada. */
  async function salvarLista(item, campo, lista) {
    const salvo = await salvarItem(item.id, { dados: { [campo.chave]: lista } });
    atualizarEmMemoria(salvo);
    desenharItens();
  }

  /**
   * Célula de um campo `lista`: quantos são, e um botão que abre a sub-tabela.
   *
   * Mostrar os contatos abertos em todas as linhas encheria a tela — vinte
   * empresas com três contatos cada viram oitenta linhas. Fechado por padrão,
   * o revisor abre o que quer conferir.
   */
  function criarCelulaDeLista(item, campo, editavel) {
    const caixa = document.createElement('div');
    caixa.className = 'ia-lista-resumo';

    const lista = Array.isArray(item.dados?.[campo.chave]) ? item.dados[campo.chave] : [];
    const chaveAberta = `${item.id}:${campo.chave}`;

    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'ia-lista-abrir';
    const seta = listasAbertas.has(chaveAberta) ? 'fa-chevron-down' : 'fa-chevron-right';
    botao.innerHTML = `<i class="fas ${seta}"></i>`;
    const rotulo = document.createElement('span');
    rotulo.textContent = lista.length
      ? `${lista.length} ${campo.rotulo.toLowerCase()}`
      : `sem ${campo.rotulo.toLowerCase()}`;
    botao.appendChild(rotulo);
    botao.title = lista.length
      ? lista.map(sub => resumirSubItem(sub, campo.subcampos || [])).join(' | ')
      : `Nenhum ${campo.rotulo.toLowerCase()} lido para esta linha`;

    botao.addEventListener('click', () => {
      if (listasAbertas.has(chaveAberta)) listasAbertas.delete(chaveAberta);
      else listasAbertas.add(chaveAberta);
      desenharItens();
    });
    caixa.appendChild(botao);

    if (editavel) {
      const adicionar = document.createElement('button');
      adicionar.type = 'button';
      adicionar.className = 'ia-lista-adicionar';
      adicionar.title = `Acrescentar ${campo.rotulo.toLowerCase()}`;
      adicionar.innerHTML = '<i class="fas fa-plus"></i>';
      adicionar.addEventListener('click', async () => {
        const vazio = {};
        for (const sc of campo.subcampos || []) vazio[sc.chave] = null;
        listasAbertas.add(chaveAberta);
        try { await salvarLista(item, campo, [...lista, vazio]); }
        catch (err) { showToast(err.message || 'Não foi possível acrescentar', 'error'); }
      });
      caixa.appendChild(adicionar);
    }

    return caixa;
  }

  /**
   * Sub-tabela de um campo `lista`, na linha logo abaixo do item.
   *
   * As colunas saem de `subcampos`, pelo mesmo caminho que desenha as de cima:
   * um destino novo com sub-lista funciona sem tocar aqui.
   */
  function criarSubTabela(item, campo, colunas, editavel) {
    const lista = Array.isArray(item.dados?.[campo.chave]) ? item.dados[campo.chave] : [];
    const subcampos = campo.subcampos || [];

    const tr = document.createElement('tr');
    tr.className = 'ia-sublinha';
    const td = document.createElement('td');
    td.colSpan = colunas;

    if (!lista.length) {
      td.className = 'ia-sublista-vazia';
      td.textContent = `Nenhum ${campo.rotulo.toLowerCase()} nesta linha.`;
      tr.appendChild(td);
      return tr;
    }

    const tabela = document.createElement('table');
    tabela.className = 'ia-sublista';

    const cabecalho = document.createElement('tr');
    for (const sc of subcampos) {
      const th = document.createElement('th');
      th.textContent = sc.rotulo;
      cabecalho.appendChild(th);
    }
    if (editavel) cabecalho.appendChild(document.createElement('th'));
    tabela.appendChild(cabecalho);

    lista.forEach((sub, indice) => {
      const linha = document.createElement('tr');

      for (const sc of subcampos) {
        const celula = document.createElement('td');
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'ia-campo';
        const valor = sub?.[sc.chave];
        input.value = valor === null || valor === undefined ? '' : String(valor);
        input.title = sc.rotulo;

        if (!editavel) input.readOnly = true;
        else {
          if (sc.obrigatorio && !String(input.value).trim()) input.classList.add('ia-campo--faltando');
          input.addEventListener('change', async () => {
            const copia = lista.map((x, i) => (i === indice ? { ...x, [sc.chave]: input.value } : x));
            try { await salvarLista(item, campo, copia); }
            catch (err) {
              showToast(err.message || 'Não foi possível salvar', 'error');
              input.value = valor === null || valor === undefined ? '' : String(valor);
            }
          });
        }
        celula.appendChild(input);
        linha.appendChild(celula);
      }

      if (editavel) {
        const celula = document.createElement('td');
        const remover = document.createElement('button');
        remover.type = 'button';
        remover.className = 'ia-arquivo__remover';
        remover.title = 'Remover';
        remover.innerHTML = '<i class="fas fa-xmark"></i>';
        remover.addEventListener('click', async () => {
          try { await salvarLista(item, campo, lista.filter((_, i) => i !== indice)); }
          catch (err) { showToast(err.message || 'Não foi possível remover', 'error'); }
        });
        celula.appendChild(remover);
        linha.appendChild(celula);
      }

      tabela.appendChild(linha);
    });

    td.appendChild(tabela);
    tr.appendChild(td);
    return tr;
  }

  function criarSeletorDeAcao(item, editavel) {
    const select = document.createElement('select');
    select.className = 'ia-acao-select';
    select.disabled = !editavel;

    const explicacoes = leitura.explicacoes || {};
    const alvo = (leitura.alvos || []).find(a => String(a.id) === String(item.alvo_id));

    // O vínculo muda o sentido de "cadastrar": no orçamento, o alvo é o
    // CLIENTE a quem o orçamento novo se prende, não um orçamento existente.
    const vinculo = Boolean(leitura.alvo_eh_vinculo);
    const rotuloAlvo = leitura.rotulo_alvo || 'registro';

    const todas = {
      criar: {
        valor: 'criar',
        rotulo: vinculo
          ? (alvo ? `Criar para: ${alvo.nome}` : `Criar (escolha o ${rotuloAlvo.toLowerCase()})`)
          : 'Cadastrar',
        titulo: explicacoes.criar,
        // Onde o alvo é vínculo, "criar" sem alvo não tem a quem se prender.
        desabilitada: vinculo && !item.alvo_id
      },
      atualizar: {
        valor: 'atualizar',
        rotulo: alvo ? `Dar entrada em: ${alvo.nome}` : 'Dar entrada no existente',
        titulo: explicacoes.atualizar,
        // Sem alvo escolhido, "dar entrada" não tem onde entrar. Deixar a
        // opção clicável só produziria erro na hora de aplicar.
        desabilitada: !item.alvo_id
      },
      ignorar: { valor: 'ignorar', rotulo: 'Descartar', titulo: 'O item não é gravado' }
    };

    // Só as ações que fazem sentido no destino. Oferecer uma que ele não sabe
    // executar só produziria erro na hora de aplicar — e o revisor descobriria
    // depois de conferir a lista inteira.
    const oferecidas = Array.isArray(leitura.acoes) && leitura.acoes.length
      ? leitura.acoes
      : ['criar', 'atualizar', 'ignorar'];
    const opcoes = oferecidas.map(a => todas[a]).filter(Boolean);

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
   * Escolher para QUAL registro o item vai.
   *
   * Sem isto, o único jeito de apontar um item era o atalho "É o mesmo" — que
   * só aparece quando a reconciliação achou um parecido. Num destino que só
   * atualiza (a ficha técnica de um produto), um nome que não casou ficaria
   * sem saída nenhuma.
   *
   * `datalist` e não `select`: o catálogo de produtos e o de insumos têm
   * centenas de linhas, e uma caixa de seleção com centenas de opções é pior
   * do que digitar as três primeiras letras.
   */
  function criarSeletorDeAlvo(item, editavel) {
    const alvos = leitura.alvos || [];
    if (!alvos.length) return null;

    // Só aparece quando há o que resolver: o item já aponta para alguém (e o
    // revisor pode querer corrigir), o destino exige alvo, ou o alvo é o
    // vínculo do registro novo — caso em que ele é obrigatório sempre.
    const precisa = item.acao === 'atualizar'
      || leitura.exige_alvo
      || leitura.alvo_eh_vinculo;
    if (!precisa || !editavel) return null;

    const lista = get('iaDetAlvos');
    if (lista && !lista.dataset.montada) {
      lista.replaceChildren(...alvos.map(a => {
        const o = document.createElement('option');
        o.value = a.nome;
        return o;
      }));
      lista.dataset.montada = '1';
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ia-campo ia-alvo';
    input.setAttribute('list', 'iaDetAlvos');
    input.placeholder = leitura.rotulo_alvo
      ? `escolher ${String(leitura.rotulo_alvo).toLowerCase()}…`
      : 'escolher…';
    const atual = alvos.find(a => String(a.id) === String(item.alvo_id));
    input.value = atual ? atual.nome : '';
    input.title = 'Para qual registro este item vai';

    input.addEventListener('change', async () => {
      const digitado = normalizarNome(input.value);
      if (!digitado) {
        input.value = atual ? atual.nome : '';
        return;
      }
      const achado = alvos.find(a => normalizarNome(a.nome) === digitado);
      if (!achado) {
        // Nome que não está no catálogo não vira alvo: apontar para o que não
        // existe daria erro só na hora de gravar.
        showToast('Escolha um registro da lista', 'error');
        input.value = atual ? atual.nome : '';
        return;
      }
      await apontarPara(item, achado.id, achado.tabela);
    });

    return input;
  }

  /** Caixa e acento não distinguem registro na hora de casar o que foi digitado. */
  const normalizarNome = valor => String(valor ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();

  /**
   * Aponta o item para um registro que já existe.
   *
   * É a saída do caso em que a reconciliação avisou "parecido com X" mas não
   * decidiu sozinha: com um clique o revisor confirma que é o mesmo, e o item
   * deixa de cadastrar um quase-duplicado.
   */
  async function apontarPara(item, alvoId, tabela) {
    try {
      // A tabela vai junto: no orçamento o alvo pode ser cliente OU
      // prospecção, e o id sozinho é ambíguo — apontar para a errada criaria o
      // orçamento na série errada, preso a outra empresa.
      const salvo = await salvarItem(item.id, {
        alvo_id: alvoId,
        acao: 'atualizar',
        ...(tabela ? { alvo_tabela: tabela } : {})
      });
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
        } else if (campo.tipo === 'lista') {
          td.appendChild(criarCelulaDeLista(item, campo, editavelAqui));
        } else {
          td.appendChild(criarCampo(item, campo, editavelAqui));
        }
        tr.appendChild(td);
      }

      const tdAcao = document.createElement('td');
      tdAcao.appendChild(criarSeletorDeAcao(item, editavelAqui));
      const seletorAlvo = criarSeletorDeAlvo(item, editavelAqui);
      if (seletorAlvo) tdAcao.appendChild(seletorAlvo);

      // Caminho alternativo ao "Aplicar": abre o formulário do módulo já
      // preenchido, para quem prefere conferir e salvar por lá.
      if (editavelAqui && MODULOS_DE_DESTINO[leitura.destino] && item.acao !== 'ignorar') {
        const abrir = document.createElement('button');
        abrir.type = 'button';
        abrir.className = 'ia-abrir-modulo';
        abrir.dataset.abrirModulo = String(item.id);
        const icone = document.createElement('i');
        icone.className = 'fas fa-up-right-from-square';
        const rotulo = document.createElement('span');
        rotulo.textContent = `Abrir em ${MODULOS_DE_DESTINO[leitura.destino].rotulo}`;
        abrir.append(icone, rotulo);
        abrir.title = 'Abre o formulário do módulo com estes dados preenchidos. Quem salva é você.';
        abrir.addEventListener('click', () => abrirNoModulo(item));
        tdAcao.appendChild(abrir);
      }

      tr.appendChild(tdAcao);

      const tdStatus = document.createElement('td');
      tdStatus.className = 'text-sm';
      tdStatus.style.color = COR_STATUS[item.status] || 'rgba(255,255,255,0.7)';
      tdStatus.textContent = ROTULO_STATUS[item.status] || item.status || '—';
      tr.appendChild(tdStatus);

      linhas.push(tr);

      for (const campo of campos) {
        if (campo.tipo !== 'lista') continue;
        if (!listasAbertas.has(`${item.id}:${campo.chave}`)) continue;
        linhas.push(criarSubTabela(item, campo, colunas, editavelAqui));
      }

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

    /**
     * Vazio depende do tipo. Para uma LISTA, vazio é não ter entrada nenhuma —
     * e `String([])` sendo `''` só acerta isso por coincidência: `String([{}])`
     * vira "[object Object]", que passa mesmo com a entrada em branco.
     */
    const emBranco = (campo, valor) => {
      if (campo.tipo === 'lista') return !Array.isArray(valor) || valor.length === 0;
      return valor === null || valor === undefined || String(valor).trim() === '';
    };

    const incompletos = pendentes.filter(i =>
      i.acao !== 'ignorar'
      && obrigatorios.some(c => emBranco(c, i.dados?.[c.chave]))).length;

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
    // A trava vale para quem GRAVA. Abrir o formulário com um obrigatório
    // vazio não só é inofensivo como é o caminho certo: é lá que o campo vai
    // ser preenchido, com a validação do próprio módulo cobrando.
    const gravarTodos = get('iaDetGravarTodos');
    if (gravarTodos) {
      gravarTodos.disabled = incompletos > 0 || (criar + atualizar) === 0;
      gravarTodos.title = incompletos
        ? 'Preencha os campos obrigatórios em vermelho antes de gravar'
        : (criar + atualizar) === 0
          ? 'Não há item para gravar — todos estão descartados ou já aplicados'
          : 'Grava todas as linhas direto, sem passar pelo formulário';
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
  // Abrir o módulo de destino, já preenchido
  //
  // É o que a leitura FAZ. Ela não grava: prepara o formulário que a pessoa já
  // conhece — com a validação, os selects e as travas do próprio módulo — e
  // devolve o controle. Quem confere e salva é o usuário.
  //
  // O preenchimento tem duas metades, e a divisão não é arbitrária:
  //
  //   CAMPOS SIMPLES   caixas de texto, por id. Este mapa é a única coisa aqui
  //                    que depende do HTML dos outros módulos, e existe um
  //                    teste que confere cada id contra o arquivo de cada modal.
  //
  //   CONTEÚDO         tudo o que NÃO é caixa de texto: a lista de contatos, a
  //                    tabela de insumos por processo, os itens do orçamento, e
  //                    os selects que só têm opções depois de um `fetch`.
  //
  // A segunda metade é a que estava faltando, e era ela que fazia o formulário
  // abrir pela metade. Ela não é preenchida daqui: cada modal já declara, para
  // a restauração de trabalho, COMO repor o próprio conteúdo — e declarou bem,
  // porque teve de acertar as ordens difíceis (o cliente antes do contato, o
  // país antes do estado, os itens antes do total). `EstadoTrabalho.preencher`
  // reaproveita exatamente esse contrato. Escrever um segundo mecanismo aqui
  // significaria redescobrir cada uma dessas ordens, e descobrir errado em
  // silêncio.
  //
  // As IDENTIDADES (insumo_id, produto_id, o cliente) vêm resolvidas do
  // backend, por `GET /api/ia/:id/itens/:itemId/preenchimento`. Resolver isso
  // aqui exigiria baixar a matéria-prima e o catálogo inteiros e repetir, em
  // JavaScript de tela, a normalização de nome que o backend já faz e testa.
  // ---------------------------------------------------------------------------

  const MODULOS_DE_DESTINO = {
    materia_prima: {
      rotulo: 'Novo Insumo',
      html: 'modals/materia-prima/novo.html',
      script: '../js/modals/materia-prima-novo.js',
      overlay: 'novoInsumo',
      campos: {
        nome: 'nome',
        quantidade: 'quantidade',
        preco_unitario: 'preco',
        descricao: 'descricao'
      }
    },
    clientes: {
      rotulo: 'Novo Cliente',
      html: 'modals/clientes/novo.html',
      script: '../js/modals/cliente-novo.js',
      overlay: 'novoCliente',
      campos: {
        nome_fantasia: 'empresaNomeFantasia',
        razao_social: 'empresaRazaoSocial',
        cnpj: 'empresaCnpj',
        inscricao_estadual: 'empresaInscricaoEstadual',
        site: 'empresaSite',
        end_logradouro: 'regRua',
        end_numero: 'regNumero',
        end_complemento: 'regComplemento',
        end_bairro: 'regBairro',
        end_cidade: 'regCidade',
        end_cep: 'regCep'
      }
    },
    prospeccoes: {
      rotulo: 'Nova Prospecção',
      html: 'modals/prospeccoes/novo.html',
      script: '../js/modals/prospeccao-novo.js',
      overlay: 'novaProspeccao',
      campos: {
        nome_fantasia: 'prosNomeFantasia',
        razao_social: 'prosRazaoSocial',
        segmento: 'prosSegmento',
        cnpj: 'prosCnpj',
        inscricao_estadual: 'prosInscricaoEstadual',
        site: 'prosSite',
        end_logradouro: 'endRua',
        end_numero: 'endNumero',
        end_complemento: 'endComplemento',
        end_bairro: 'endBairro',
        end_cidade: 'endCidade',
        end_cep: 'endCep'
      }
    },
    produto_insumos: {
      rotulo: 'Novo Produto',
      html: 'modals/produtos/novo.html',
      script: '../js/modals/produto-novo.js',
      overlay: 'novoProduto',
      campos: {
        nome: 'nomeInput',
        codigo: 'codigoInput'
      }
    },
    orcamentos: {
      rotulo: 'Novo Orçamento',
      html: 'modals/orcamentos/novo.html',
      script: '../js/modals/orcamento-novo.js',
      overlay: 'novoOrcamento',
      campos: {
        validade: 'novoValidade',
        observacoes: 'novoObservacoes'
      }
    }
  };

  /**
   * O valor de "Brasil" no <select> de país, lido das opções que ele tem.
   *
   * A lista de países vem de um serviço de geografia internacional, e o rótulo
   * pode ser "Brasil" ou "Brazil" conforme o idioma que ele devolver. Escrever
   * um dos dois aqui funcionaria até o dia em que não funcionasse — calado,
   * porque select que recebe valor inexistente não reclama, só fica vazio.
   */
  function valorDoBrasil(idSelect) {
    const select = document.getElementById(idSelect);
    const achado = Array.from(select?.options || [])
      .find(o => /^bra[sz]il$/i.test(String(o.value).trim()));
    return achado ? achado.value : '';
  }

  /**
   * O conteúdo dinâmico, na forma que o `capturar` de cada modal produz.
   *
   * É um acoplamento real com cada módulo, e é o mesmo que a restauração de
   * trabalho já tem: são as duas pontas do contrato que aquele modal declarou.
   */
  const CONTEUDO_DO_DESTINO = {
    // Categoria, unidade e processo são selects montados por requisição — o
    // `restaurar` do módulo sabe esperar as opções chegarem.
    materia_prima: carga => ({
      categoria: carga.campos.categoria || '',
      unidade: carga.campos.unidade || '',
      processo: ''
    }),

    clientes: carga => ({
      contatos: carga.contatos || [],
      // O estado só carrega depois do país, e as opções dele são nomes por
      // extenso — "Rio Grande do Sul", não "RS". O backend manda os dois.
      enderecos: {
        reg: {
          pais: carga.campos.end_estado_nome ? valorDoBrasil('regPais') : '',
          estado: carga.campos.end_estado_nome || ''
        },
        cob: { pais: '', estado: '' },
        ent: { pais: '', estado: '' }
      }
    }),

    prospeccoes: carga => ({
      contatos: carga.contatos || [],
      pais: carga.campos.end_estado_nome ? valorDoBrasil('endPais') : '',
      estado: carga.campos.end_estado_nome || ''
    }),

    // A tabela de insumos do produto agrupa por processo e ordena pela posição.
    // O backend já mandou os dois resolvidos, junto com o id e o preço.
    produto_insumos: carga => ({ itens: (carga.insumos || []).map(i => ({ ...i })) }),

    orcamentos: carga => ({
      // A tabela do orçamento guarda os valores como texto simples, e é assim
      // que ela é relida para recalcular o total: número com ponto decimal,
      // sem símbolo de moeda.
      itens: (carga.itens || []).map(i => ({
        id: String(i.produto_id),
        nome: i.nome,
        qtd: String(i.quantidade),
        valor: String(i.valor_unitario),
        valorDesc: String(i.valor_unitario),
        desc: '0'
      })),
      // O cliente é o primeiro select a ser reposto: é o `change` dele que
      // carrega contato e transportadora.
      selects: { novoCliente: carga.alvo ? String(carga.alvo.id) : '' }
    })
  };

  /** Abre o modal por cima e espera ele terminar de montar. */
  function abrirPorCima(config) {
    const pronto = new Promise(resolve => {
      function aoAbrir(e) {
        if (e.detail !== config.overlay) return;
        window.removeEventListener('modalSpinnerLoaded', aoAbrir);
        document.getElementById(`${config.overlay}Overlay`)?.classList.remove('hidden');
        resolve();
      }
      window.addEventListener('modalSpinnerLoaded', aoAbrir);
      // Nem todo modal anuncia; depois de um tempo, segue assim mesmo.
      setTimeout(() => { window.removeEventListener('modalSpinnerLoaded', aoAbrir); resolve(); }, 2500);
    });

    // O modal de destino abre POR CIMA do de IA: fechar o de baixo perderia a
    // revisão, e quem salva do outro lado quer voltar para ela.
    Modal.open(config.html, config.script, config.overlay, true);
    return pronto;
  }

  /** Quantos itens o preenchimento levou para o formulário. */
  function contarConteudo(destino, conteudo) {
    if (destino === 'clientes' || destino === 'prospeccoes') {
      return { quantos: (conteudo.contatos || []).length, oQue: 'contato(s)' };
    }
    if (destino === 'produto_insumos') {
      return { quantos: (conteudo.itens || []).length, oQue: 'insumo(s)' };
    }
    if (destino === 'orcamentos') {
      return { quantos: (conteudo.itens || []).length, oQue: 'item(ns)' };
    }
    return { quantos: 0, oQue: '' };
  }

  async function abrirNoModulo(item) {
    const config = MODULOS_DE_DESTINO[leitura?.destino];
    if (!config) {
      showToast('Este destino ainda não abre o módulo preenchido', 'info');
      return;
    }

    let carga;
    try {
      const resp = await fetchApi(`/api/ia/${leitura.id}/itens/${item.id}/preenchimento`);
      carga = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(carga.error || `Erro ${resp.status}`);
    } catch (err) {
      showToast(err?.message || 'Não foi possível preparar o formulário', 'error');
      return;
    }

    await abrirPorCima(config);

    // Os campos simples, por id. `EstadoTrabalho` aplica o valor E avisa a tela
    // pelos dois eventos — sem isso o formulário fica com o valor à mostra e o
    // estado interno vazio.
    const campos = [];
    for (const [chave, id] of Object.entries(config.campos)) {
      const valor = carga.campos[chave];
      if (valor === null || valor === undefined || valor === '') continue;
      campos.push({ chave: `#${id}`, valor: String(valor) });
    }

    const conteudo = (CONTEUDO_DO_DESTINO[leitura.destino] || (() => null))(carga);

    let resultado = { campos: 0, conteudo: false };
    try {
      resultado = await window.EstadoTrabalho.preencher(config.overlay, { campos, conteudo });
    } catch (err) {
      console.error('Falha ao preencher o formulário', err);
    }

    const { quantos, oQue } = contarConteudo(leitura.destino, conteudo || {});
    const partes = [`${resultado.campos} campo(s) preenchido(s)`];
    if (quantos) partes.push(`${quantos} ${oQue}`);
    if (!resultado.campos && !quantos) {
      showToast('Nada do que foi lido coube neste formulário', 'info');
      return;
    }

    // O que o backend não conseguiu casar aparece AGORA, antes de a pessoa
    // salvar. Depois vira material errado numa receita, ou item faltando num
    // preço que já foi para o cliente.
    if (carga.avisos?.length) partes.push(carga.avisos.join(' · '));
    showToast(`${partes.join(' · ')} — confira e salve`, carga.avisos?.length ? 'info' : 'success');
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

  /** Linhas que ainda não viraram cadastro e não foram descartadas. */
  const itensPendentes = () => (leitura?.itens || [])
    .filter(i => i.status !== 'aplicado' && i.acao !== 'ignorar');

  /**
   * O caminho normal: abre o formulário do módulo com a primeira linha
   * pendente. Nada é gravado daqui.
   *
   * Com várias linhas, abre uma de cada vez. Abrir dez formulários de uma vez
   * não é uma tela, é uma pilha — e o modal de IA continua embaixo, então
   * voltar para a próxima é um clique.
   */
  async function abrirPrimeiroPendente() {
    const pendentes = itensPendentes();
    if (!pendentes.length) {
      showToast('Nenhuma linha pendente nesta leitura', 'info');
      return;
    }
    await abrirNoModulo(pendentes[0]);
  }

  async function gravarTodos() {
    const pendentes = itensPendentes().length;

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

  // Extrair consome crédito e gravar mexe em estoque: os dois passam pela
  // trava de duplo clique, que segura o botão até a ação terminar. Abrir o
  // formulário entra na mesma trava para não empilhar dois modais iguais.
  for (const [id, acao] of [
    ['iaDetExtrair', extrair],
    ['iaDetAplicar', abrirPrimeiroPendente],
    ['iaDetGravarTodos', gravarTodos]
  ]) {
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
