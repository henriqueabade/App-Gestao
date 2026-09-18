/**
 * Ações Rápidas de planilha (Clientes e Prospecções): exportar, importar e
 * salvar o modelo em CSV, mais o relatório final da importação.
 *
 *   window.AcoesCsv.ligarMenu({ container, botao, menu })
 *   window.AcoesCsv.exportar({ modulo: 'clientes', ids, rotulo: 'clientes' })
 *   window.AcoesCsv.salvarModelo({ modulo: 'prospeccoes', rotulo: 'prospecções' })
 *   window.AcoesCsv.importar({ modulo, rotulo, singular, feminino, aoConcluir })
 *
 * `feminino`: a concordância das frases ("3 prospecções registradas").
 *
 * O backend (backend/importacaoCsv.js) confere linha a linha e NUNCA para no
 * primeiro erro: cada linha volta como registrada, registrada com dados
 * faltantes, pendente de registro (não gravada) ou ignorada — com o porquê.
 * Esta tela só mostra esse relatório.
 *
 * Visual: reaproveita a caixa de diálogo padrão (dlg-*, dialogo-padrao.css) e
 * acrescenta a lista de linhas (src/styles/acoes-csv.css). Nada de innerHTML.
 */
(() => {
  if (window.AcoesCsv) return;

  const LIMITE_ARQUIVO = 20 * 1024 * 1024;

  const SITUACAO = {
    registrado: { rotulo: 'Registrado', tom: 'sucesso', icone: 'fa-circle-check' },
    registrado_com_pendencias: { rotulo: 'Registrado com dados faltantes', tom: 'aviso', icone: 'fa-triangle-exclamation' },
    nao_registrado: { rotulo: 'Pendente de registro', tom: 'erro', icone: 'fa-circle-xmark' },
    ignorado: { rotulo: 'Ignorada', tom: 'neutro', icone: 'fa-forward' }
  };

  // ------------------------------------------------------------ puras

  /** "Registrado" → "Registrada" quando o registro é feminino (prospecção). */
  const concordar = (texto, feminino) => (feminino ? texto.replace(/\b(Registrad|registrad|exportad)o/g, '$1a') : texto);
  const rotuloDaSituacao = (situacao, feminino = false) => concordar(SITUACAO[situacao]?.rotulo || situacao, feminino);

  /**
   * Bytes do arquivo → texto. UTF-8 primeiro; se não for UTF-8 válido, é o
   * "CSV (separado por vírgulas)" do Excel, gravado em Windows-1252.
   */
  function decodificar(buffer) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch (_) {
      return new TextDecoder('windows-1252').decode(buffer);
    }
  }

  /** Linhas do relatório de um filtro ('todas', 'problemas' ou uma situação). */
  function filtrarLinhas(linhas = [], filtro = 'todas') {
    if (filtro === 'todas') return linhas.slice();
    if (filtro === 'problemas') return linhas.filter(l => l.situacao === 'nao_registrado' || l.situacao === 'registrado_com_pendencias');
    return linhas.filter(l => l.situacao === filtro);
  }

  /** Tom do relatório inteiro: tudo certo, algo a conferir, ou nada gravado. */
  function tomDoResultado(resumo = {}) {
    const gravados = (resumo.registrados || 0) + (resumo.com_pendencias || 0);
    if (!gravados && (resumo.nao_registrados || 0)) return 'erro';
    if ((resumo.nao_registrados || 0) || (resumo.com_pendencias || 0)) return 'aviso';
    return gravados ? 'sucesso' : 'info';
  }

  const celula = v => {
    const s = String(v ?? '');
    return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  /** O relatório em CSV (para guardar ou corrigir a planilha com ele ao lado). */
  function relatorioCsv(resultado = {}, { feminino = false } = {}) {
    const linhas = [['Linha', 'Identificação', 'Situação', concordar('Por que não foi registrado', feminino), 'Dados faltantes / ajustados', 'Avisos']]
      .concat((resultado.linhas || []).map(l => [
        l.linha, l.identificacao || '', rotuloDaSituacao(l.situacao, feminino),
        (l.bloqueios || []).join(' | '), (l.pendencias || []).join(' | '), (l.avisos || []).join(' | ')
      ]));
    return `\uFEFF${linhas.map(l => l.map(celula).join(';')).join('\r\n')}\r\n`;
  }

  // ------------------------------------------------------------ apoio

  const criar = (tag, classe, texto) => {
    const el = document.createElement(tag);
    if (classe) el.className = classe;
    if (texto !== undefined && texto !== null) el.textContent = texto;
    return el;
  };
  const icone = nome => {
    const i = criar('i', `fas ${nome}`);
    i.setAttribute('aria-hidden', 'true');
    return i;
  };
  const avisar = (texto, tipo = 'info') => window.showToast?.(texto, tipo);

  async function chamar(caminho, { method = 'GET', corpo } = {}) {
    const base = (await window.apiConfig?.getApiBaseUrl?.()) || '';
    const resp = await fetch(`${base}${caminho}`, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: corpo ? JSON.stringify(corpo) : undefined
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const e = new Error(json.error || `Erro ${resp.status}`);
      e.status = resp.status;
      throw e;
    }
    return json;
  }

  /** Salva o texto: diálogo "Salvar como" do app; no navegador, download. */
  async function salvarTexto(conteudo, nome, titulo, descricao = 'Planilha CSV') {
    if (window.electronAPI?.salvarTextoComoArquivo) {
      const r = await window.electronAPI.salvarTextoComoArquivo({ conteudo, nomeSugerido: nome, extensao: 'csv', titulo, descricao });
      if (r?.canceled) return null;
      if (!r?.success) throw new Error(r?.message || 'Não foi possível salvar o arquivo.');
      return r.filePath || `${nome}.csv`;
    }
    const url = URL.createObjectURL(new Blob([conteudo], { type: 'text/csv;charset=utf-8' }));
    const a = criar('a');
    a.href = url;
    a.download = `${nome}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return `${nome}.csv`;
  }

  const nomeDoArquivo = caminho => String(caminho || '').split(/[\\/]/).pop();

  // ------------------------------------------------------------ menu

  /** O botão "Ações Rápidas" abre/fecha a lista; clique fora ou Esc fecha. */
  function ligarMenu({ container, botao, menu }) {
    if (!container || !botao || !menu) return () => {};
    const fechar = (devolverFoco = false) => {
      menu.hidden = true;
      botao.setAttribute('aria-expanded', 'false');
      if (devolverFoco) botao.focus();
    };
    botao.addEventListener('click', () => {
      const abrir = menu.hidden;
      menu.hidden = !abrir;
      botao.setAttribute('aria-expanded', String(abrir));
      if (abrir) menu.querySelector('[role="menuitem"]:not([hidden]):not([disabled])')?.focus();
    });
    menu.addEventListener('click', e => { if (e.target.closest('[role="menuitem"]')) fechar(); });
    const fora = e => { if (!container.isConnected) return limpar(); if (!container.contains(e.target)) fechar(); };
    const tecla = e => { if (e.key === 'Escape' && !menu.hidden) fechar(true); };
    document.addEventListener('click', fora);
    document.addEventListener('keydown', tecla);
    function limpar() {
      document.removeEventListener('click', fora);
      document.removeEventListener('keydown', tecla);
    }
    return limpar;
  }

  // ------------------------------------------------------------ exportar / modelo

  async function exportar({ modulo, ids, rotulo = 'registros', feminino = false }) {
    if (Array.isArray(ids) && !ids.length) {
      window.DialogPadrao?.info({ title: 'Nada para exportar', tom: 'aviso', icone: 'fa-filter-circle-xmark', message: `Nenhum registro na lista com os filtros atuais. Limpe os filtros para exportar todos os ${rotulo}.` });
      return;
    }
    try {
      avisar(`Gerando a planilha de ${rotulo}…`);
      const r = await chamar(`/api/${modulo}/csv/exportar`, { method: 'POST', corpo: { ids: Array.isArray(ids) ? ids : [] } });
      const caminho = await salvarTexto(r.conteudo, r.nome, `Exportar ${rotulo} (CSV)`);
      if (caminho) avisar(concordar(`${r.total} ${rotulo} exportado${r.total === 1 ? '' : 's'} em ${nomeDoArquivo(caminho)}.`, feminino), 'success');
    } catch (err) {
      window.DialogPadrao?.info({ title: 'Não foi possível exportar', tom: 'erro', message: err.message });
    }
  }

  async function salvarModelo({ modulo, rotulo = 'registros' }) {
    try {
      const r = await chamar(`/api/${modulo}/csv/modelo`);
      const caminho = await salvarTexto(r.conteudo, r.nome, `Salvar modelo CSV de ${rotulo}`);
      if (!caminho) return;
      window.DialogPadrao?.info({
        title: 'Modelo salvo',
        subtitle: nomeDoArquivo(caminho),
        tom: 'sucesso',
        icone: 'fa-file-csv',
        secoes: [{
          titulo: 'Como preencher', icone: 'fa-list-check',
          lista: [
            'As colunas com * são obrigatórias; sem elas a linha fica pendente de registro.',
            'A linha de exemplo pode ficar — a importação ignora.',
            'Datas em dd/mm/aaaa, valores como 1.234,56 e Sim/Não nas colunas de marcar.',
            'No Excel, salve como "CSV UTF-8" ou "CSV (separado por vírgulas)" — os dois funcionam.'
          ]
        }],
        nota: `Depois, use "Importar CSV": cada linha é conferida e, no fim, aparece o relatório com o que foi registrado, o que ficou com dados faltantes e o que ficou pendente (e por quê).`
      });
    } catch (err) {
      window.DialogPadrao?.info({ title: 'Não foi possível gerar o modelo', tom: 'erro', message: err.message });
    }
  }

  // ------------------------------------------------------------ importar

  function escolherArquivo() {
    return new Promise(resolve => {
      const input = criar('input');
      input.type = 'file';
      input.accept = '.csv,text/csv,text/plain';
      input.style.display = 'none';
      input.addEventListener('change', () => { resolve(input.files?.[0] || null); input.remove(); }, { once: true });
      input.addEventListener('cancel', () => { resolve(null); input.remove(); }, { once: true });
      document.body.appendChild(input);
      input.click();
    });
  }

  async function importar({ modulo, rotulo = 'registros', singular = 'registro', feminino = false, aoConcluir } = {}) {
    const arquivo = await escolherArquivo();
    if (!arquivo) return;
    if (arquivo.size > LIMITE_ARQUIVO) {
      window.DialogPadrao?.info({ title: 'Planilha grande demais', tom: 'erro', message: `O arquivo tem ${(arquivo.size / 1048576).toFixed(1).replace('.', ',')} MB; o limite é 20 MB. Divida a planilha em partes e importe uma de cada vez.` });
      return;
    }
    const janela = abrirJanela({ titulo: 'Importando planilha', subtitulo: arquivo.name });
    try {
      const conteudo = decodificar(await arquivo.arrayBuffer());
      const resultado = await chamar(`/api/${modulo}/csv/importar`, { method: 'POST', corpo: { conteudo, nome_arquivo: arquivo.name } });
      janela.mostrarResultado(resultado, { modulo, rotulo, singular, feminino });
      const gravados = (resultado.resumo?.registrados || 0) + (resultado.resumo?.com_pendencias || 0);
      if (gravados) aoConcluir?.(resultado);
    } catch (err) {
      janela.mostrarErro(err, { modulo, rotulo });
    }
  }

  /**
   * A janela do relatório: abre esperando (a importação pode levar alguns
   * segundos — não fecha no meio) e depois vira o resultado ou o erro.
   */
  function abrirJanela({ titulo, subtitulo }) {
    document.querySelectorAll('dialog[data-importacao-csv]').forEach(d => d.remove());
    const dialog = criar('dialog');
    dialog.setAttribute('data-importacao-csv', 'true');
    dialog.setAttribute('aria-modal', 'true');
    dialog.className = 'csv-janela';
    let ocupado = true;
    dialog.addEventListener('cancel', e => { e.preventDefault(); if (!ocupado) fechar(); });

    const cartao = criar('div', 'dlg-cartao dlg-cartao--info csv-cartao');
    dialog.appendChild(cartao);
    document.body.appendChild(dialog);

    function topo(tom, nomeIcone, textoTitulo, textoSub) {
      cartao.className = `dlg-cartao dlg-cartao--${tom} csv-cartao`;
      const t = criar('div', 'dlg-topo');
      const c = criar('div', 'dlg-icone');
      c.appendChild(icone(nomeIcone));
      const h = criar('h3', 'dlg-titulo', textoTitulo);
      h.id = `csvTitulo${Date.now()}`;
      dialog.setAttribute('aria-labelledby', h.id);
      t.append(c, h);
      if (textoSub) t.appendChild(criar('p', 'dlg-subtitulo', textoSub));
      return t;
    }

    function rodape(botoes) {
      const r = criar('div', 'dlg-rodape');
      botoes.forEach(b => r.appendChild(b));
      return r;
    }

    function botao(rotulo, classe, aoClicar, nomeIcone) {
      const b = criar('button', classe);
      b.type = 'button';
      if (nomeIcone) b.append(icone(nomeIcone), document.createTextNode(` ${rotulo}`));
      else b.textContent = rotulo;
      b.addEventListener('click', aoClicar);
      return b;
    }

    function fechar() {
      dialog.close();
      dialog.remove();
    }

    // Esperando
    const espera = criar('div', 'dlg-corpo csv-espera');
    const giro = criar('div', 'app-loading-indicator app-loading-indicator--compact');
    giro.setAttribute('aria-hidden', 'true');
    const nucleo = criar('span', 'module-loading-core');
    const logo = criar('img');
    logo.src = '../assets/Logo.ico';
    logo.alt = '';
    nucleo.appendChild(logo);
    giro.append(criar('span', 'module-loading-orbit'), nucleo);
    espera.append(giro, criar('p', 'dlg-lead', 'Conferindo e gravando linha a linha. Uma linha com problema não interrompe as outras.'));
    cartao.append(topo('info', 'fa-file-import', titulo, subtitulo), espera);
    dialog.showModal();

    function mostrarErro(err, { modulo, rotulo }) {
      ocupado = false;
      const corpo = criar('div', 'dlg-corpo');
      corpo.appendChild(criar('p', 'dlg-lead', err.message || 'Falha na importação.'));
      const nota = criar('div', 'dlg-nota');
      nota.append(icone('fa-circle-info'), criar('span', null, 'Nada foi gravado. Confira se o arquivo é a planilha do modelo (com o cabeçalho na primeira linha) e tente de novo.'));
      corpo.appendChild(nota);
      const modelo = botao('Salvar modelo CSV', 'btn-neutral', () => { fechar(); salvarModelo({ modulo, rotulo }); }, 'fa-file-csv');
      const ok = botao('Fechar', 'btn-primary', fechar);
      cartao.replaceChildren(topo('erro', 'fa-circle-xmark', 'A importação não começou', subtitulo), corpo, rodape([modelo, ok]));
      ok.focus();
    }

    function mostrarResultado(resultado, { rotulo, singular, feminino = false }) {
      ocupado = false;
      const resumo = resultado.resumo || {};
      const tom = tomDoResultado(resumo);
      const gravados = (resumo.registrados || 0) + (resumo.com_pendencias || 0);
      const titulos = {
        sucesso: 'Importação concluída',
        aviso: 'Importação concluída com ressalvas',
        erro: 'Nenhuma linha foi registrada',
        info: 'Nada para importar'
      };
      const icones = { sucesso: 'fa-circle-check', aviso: 'fa-triangle-exclamation', erro: 'fa-circle-xmark', info: 'fa-circle-info' };
      const corpo = criar('div', 'dlg-corpo');

      corpo.appendChild(criar('p', 'dlg-lead',
        concordar(`${resumo.linhas || 0} linha${resumo.linhas === 1 ? '' : 's'} lida${resumo.linhas === 1 ? '' : 's'}; ${gravados} ${gravados === 1 ? `${singular} registrado` : `${rotulo} registrados`}.`, feminino)));

      // Cartões do resumo — clicar filtra a lista.
      const cartoes = criar('div', 'dlg-resumo csv-resumo');
      const CARTOES = [
        { filtro: 'registrado', rotulo: feminino ? 'Registradas' : 'Registrados', valor: resumo.registrados, tom: 'sucesso', dica: feminino ? 'completas' : 'completos' },
        { filtro: 'registrado_com_pendencias', rotulo: 'Com dados faltantes', valor: resumo.com_pendencias, tom: 'aviso', dica: `${feminino ? 'gravadas' : 'gravados'}; completar na ficha` },
        { filtro: 'nao_registrado', rotulo: 'Pendentes de registro', valor: resumo.nao_registrados, tom: 'erro', dica: feminino ? 'não gravadas' : 'não gravados' },
        { filtro: 'ignorado', rotulo: 'Ignoradas', valor: resumo.ignorados, tom: 'neutro', dica: 'linha de exemplo' }
      ];
      let filtro = (resumo.nao_registrados || resumo.com_pendencias) ? 'problemas' : 'todas';
      const botoesFiltro = new Map();
      CARTOES.forEach(c => {
        const b = criar('button', `dlg-resumo__cartao csv-resumo__cartao csv-resumo__cartao--${c.tom}`);
        b.type = 'button';
        b.append(criar('span', 'dlg-resumo__rotulo', c.rotulo), criar('span', 'dlg-resumo__valor', String(c.valor || 0)), criar('span', 'dlg-resumo__dica', c.dica));
        b.disabled = !c.valor;
        b.addEventListener('click', () => { filtro = filtro === c.filtro ? 'todas' : c.filtro; desenharLista(); });
        botoesFiltro.set(c.filtro, b);
        cartoes.appendChild(b);
      });
      corpo.appendChild(cartoes);

      if (resultado.colunas_desconhecidas?.length) {
        const nota = criar('div', 'dlg-nota');
        nota.append(icone('fa-table-columns'), criar('span', null, `Colunas que não são do modelo (ignoradas): ${resultado.colunas_desconhecidas.join(', ')}.`));
        corpo.appendChild(nota);
      }

      // Lista das linhas
      const secao = criar('div', 'dlg-secao csv-secao');
      const cabeca = criar('div', 'csv-secao__topo');
      const tituloSecao = criar('div', 'dlg-secao__titulo');
      tituloSecao.append(icone('fa-list'), criar('span', null, 'Linha a linha'));
      const chips = criar('div', 'csv-filtros');
      const CHIPS = [['problemas', 'Com problema'], ['todas', 'Todas']];
      const chipsEl = new Map();
      CHIPS.forEach(([valor, texto]) => {
        const chip = criar('button', 'csv-filtro', texto);
        chip.type = 'button';
        chip.addEventListener('click', () => { filtro = valor; desenharLista(); });
        chipsEl.set(valor, chip);
        chips.appendChild(chip);
      });
      cabeca.append(tituloSecao, chips);
      const lista = criar('div', 'csv-linhas');
      secao.append(cabeca, lista);
      corpo.appendChild(secao);

      function blocoDeMotivos(titulo, itens, tom) {
        const b = criar('div', `csv-motivos csv-motivos--${tom}`);
        b.appendChild(criar('span', 'csv-motivos__titulo', titulo));
        const ul = criar('ul');
        itens.forEach(t => ul.appendChild(criar('li', null, t)));
        b.appendChild(ul);
        return b;
      }

      function desenharLista() {
        chipsEl.forEach((el, valor) => el.setAttribute('aria-pressed', String(filtro === valor)));
        botoesFiltro.forEach((el, valor) => el.setAttribute('aria-pressed', String(filtro === valor)));
        const linhas = filtrarLinhas(resultado.linhas || [], filtro);
        lista.replaceChildren();
        if (!linhas.length) {
          lista.appendChild(criar('p', 'csv-vazio', filtro === 'problemas' ? 'Nenhuma linha com problema.' : 'Nenhuma linha neste filtro.'));
          return;
        }
        linhas.forEach(l => {
          const meta = { ...(SITUACAO[l.situacao] || { tom: 'neutro', icone: 'fa-circle' }), rotulo: rotuloDaSituacao(l.situacao, feminino) };
          const cartaoLinha = criar('div', `csv-linha csv-linha--${meta.tom}`);
          const topoLinha = criar('div', 'csv-linha__topo');
          topoLinha.append(criar('span', 'csv-linha__numero', `Linha ${l.linha}`), criar('span', 'csv-linha__nome', l.identificacao || '(sem identificação)'));
          const tag = criar('span', `csv-tag csv-tag--${meta.tom}`);
          tag.append(icone(meta.icone), document.createTextNode(` ${meta.rotulo}`));
          topoLinha.appendChild(tag);
          cartaoLinha.appendChild(topoLinha);
          if (l.bloqueios?.length) cartaoLinha.appendChild(blocoDeMotivos(concordar('Por que não foi registrado', feminino), l.bloqueios, 'erro'));
          if (l.pendencias?.length) {
            cartaoLinha.appendChild(blocoDeMotivos(
              l.situacao === 'nao_registrado' ? 'Também falta' : concordar('Registrado assim — complete na ficha', feminino),
              l.pendencias, 'aviso'));
          }
          if (l.avisos?.length) cartaoLinha.appendChild(blocoDeMotivos('Observações', l.avisos, 'neutro'));
          lista.appendChild(cartaoLinha);
        });
      }
      desenharLista();

      if (resumo.nao_registrados) {
        const nota = criar('div', 'dlg-nota');
        nota.append(icone('fa-rotate'), criar('span', null, 'As linhas pendentes de registro não foram gravadas: corrija-as na planilha e importe de novo só essas linhas (as já registradas voltariam como duplicadas).'));
        corpo.appendChild(nota);
      }
      if (resumo.com_pendencias) {
        const nota = criar('div', 'dlg-nota');
        nota.append(icone('fa-clock-rotate-left'), criar('span', null, concordar(`${feminino ? 'As' : 'Os'} ${rotulo} registrados com dados faltantes já estão na lista; o que ficou faltando também aparece no histórico de cada um.`, feminino)));
        corpo.appendChild(nota);
      }

      const salvarRelatorio = botao('Salvar relatório', 'btn-neutral', async () => {
        try {
          const base = String(resultado.arquivo || 'planilha').replace(/\.[^.]+$/, '');
          const caminho = await salvarTexto(relatorioCsv(resultado, { feminino }), `relatorio-importacao-${base}`, 'Salvar relatório da importação');
          if (caminho) avisar(`Relatório salvo em ${nomeDoArquivo(caminho)}.`, 'success');
        } catch (err) {
          avisar(err.message, 'error');
        }
      }, 'fa-file-arrow-down');
      const ok = botao('Fechar', 'btn-primary', fechar);
      cartao.replaceChildren(topo(tom, icones[tom], titulos[tom], resultado.arquivo || subtitulo), corpo, rodape([salvarRelatorio, ok]));
      ok.focus();
    }

    return { mostrarResultado, mostrarErro, fechar };
  }

  window.AcoesCsv = {
    ligarMenu, exportar, salvarModelo, importar,
    decodificar, filtrarLinhas, tomDoResultado, relatorioCsv, rotuloDaSituacao, concordar, SITUACAO
  };
})();
