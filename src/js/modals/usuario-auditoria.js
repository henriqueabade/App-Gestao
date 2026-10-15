/** Auditoria por usuário/período. O PDF consulta todas as páginas do snapshot. */
(async () => {
  const overlayId = 'usuarioAuditoria';
  const overlay = document.getElementById(`${overlayId}Overlay`);
  if (!overlay) return;
  const contexto = window.usuarioAuditoriaContext || {};
  delete window.usuarioAuditoriaContext;
  const usuarioId = contexto.usuarioId;
  const el = id => document.getElementById(`usuarioAuditoria${id}`);
  const PDF_MAXIMO = 5000;
  const FUSO = 'America/Sao_Paulo';
  const CAMPOS = ['Inicio', 'Fim', 'Modulo', 'Acao', 'Origem', 'Resultado', 'Limite'];
  let fechado = false;
  let ocupado = false;
  let filtros = null;
  let snapshot = null;
  let dados = null;
  let alterado = false;

  const criar = (tag, classe, texto) => {
    const no = document.createElement(tag);
    if (classe) no.className = classe;
    if (texto !== undefined) no.textContent = String(texto ?? '');
    return no;
  };
  const escapar = texto => String(texto ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const dataHora = valor => {
    const data = new Date(valor);
    return valor && !Number.isNaN(data.getTime()) ? data.toLocaleString('pt-BR', { timeZone: FUSO }) : 'Data não registrada';
  };
  const valor = v => v === undefined ? 'Não informado' : v === null ? 'Vazio' : typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
  const dia = data => new Intl.DateTimeFormat('sv-SE', { timeZone: FUSO }).format(data);
  const periodo = f => `${f.inicio.split('-').reverse().join('/')} a ${f.fim.split('-').reverse().join('/')}`;

  function aviso(texto, erro = false) {
    if (fechado) return;
    el('Aviso').textContent = texto || '';
    el('Aviso').style.color = erro ? 'var(--color-red)' : 'var(--color-primary)';
    el('Aviso').classList.toggle('hidden', !texto);
  }

  function atualizarBotoes() {
    if (fechado) return;
    CAMPOS.forEach(c => { el(c).disabled = ocupado; });
    el('Consultar').disabled = ocupado;
    el('Anterior').disabled = ocupado || alterado || !dados || dados.pagina <= 1;
    el('Proxima').disabled = ocupado || alterado || !dados?.tem_mais;
    el('Pdf').disabled = ocupado || alterado || !dados || dados.total === 0;
  }

  function lerFiltros() {
    const inicio = el('Inicio').value;
    const fim = el('Fim').value;
    const dataValida = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T12:00:00Z`).getTime()) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v;
    if (!dataValida(inicio) || !dataValida(fim)) throw new Error('Informe as duas datas do período.');
    if (inicio > fim) throw new Error('A data inicial deve ser anterior ou igual à data final.');
    if (!Number.isSafeInteger(Number(usuarioId)) || Number(usuarioId) < 1) throw new Error('Usuário não identificado.');
    return { usuario_id: String(usuarioId), inicio, fim, modulo: el('Modulo').value.trim(), acao: el('Acao').value.trim(), origem: el('Origem').value, resultado: el('Resultado').value };
  }

  async function consultar(pagina, limite, corte = snapshot) {
    const query = new URLSearchParams({ ...filtros, pagina: String(pagina), limite: String(limite) });
    if (corte !== null && corte !== undefined) query.set('snapshot', String(corte));
    const base = await window.apiConfig.getApiBaseUrl();
    const resposta = await fetch(`${base}/api/auditoria-usuarios?${query}`);
    const corpo = await resposta.json().catch(() => null);
    if (!resposta.ok || corpo?.sql_pendente) {
      if (resposta.status === 403) throw new Error('Acesso negado. O relatório de atividades é restrito ao Sup Admin.');
      if (resposta.status === 401) throw new Error('Sua sessão expirou. Entre novamente para consultar a auditoria.');
      if (corpo?.sql_pendente) throw new Error(`O registro de auditoria ainda não está disponível. Execute ${corpo.arquivo || 'backend/scripts/ddl_usuarios_auditoria.sql'} no banco e reinicie a API.`);
      throw new Error(corpo?.error || corpo?.message || `Não foi possível consultar a auditoria (HTTP ${resposta.status}).`);
    }
    if (!Array.isArray(corpo?.registros) || !Number.isSafeInteger(corpo.total) || corpo.total < 0 || corpo.pagina !== pagina || corpo.limite !== limite || corpo.registros.length > limite || corpo.completo === false || corpo.export_incompleta) {
      throw new Error('A API devolveu uma auditoria incompleta. A consulta e o PDF foram interrompidos.');
    }
    return corpo;
  }

  function tabelaRegistros(registros, titulo, explicacao) {
    const tabela = criar('table', 'rp-tabela rp-tabela-larga ua-tabela');
    const cabeca = criar('thead');
    const faixa = criar('tr', 'rp-faixa-processo');
    const th = criar('th', null, titulo);
    th.setAttribute('colspan', '2');
    faixa.appendChild(th);
    cabeca.appendChild(faixa);
    tabela.appendChild(cabeca);
    const corpo = criar('tbody');
    for (const r of registros) {
      const linha = criar('tr');
      const quando = criar('td');
      quando.appendChild(criar('strong', null, dataHora(r.criado_em)));
      quando.appendChild(criar('span', 'rp-detalhe', [r.modulo, r.acao].filter(Boolean).join(' · ')));
      quando.appendChild(criar('span', 'rp-detalhe', [r.entidade || r.entidade_tipo, r.entidade_id].filter(v => v !== null && v !== undefined && v !== '').join(' #')));
      const descricao = criar('td');
      const origem = ['manual', 'automatico', 'sistema', 'nao_confirmada'].includes(r.origem) ? r.origem : 'desconhecida';
      const rotulo = { manual: 'Ação do usuário', automatico: 'Automático', sistema: 'Sistema', nao_confirmada: 'Origem não confirmada', desconhecida: 'Origem não informada' }[origem];
      descricao.appendChild(criar('span', `ua-origem ua-origem--${origem}`, rotulo));
      const resultado = ['sucesso', 'falha', 'cancelado'].includes(r.resultado) ? r.resultado : 'não informado';
      descricao.appendChild(criar('span', `ua-resultado ua-resultado--${['sucesso', 'falha', 'cancelado'].includes(resultado) ? resultado : 'desconhecido'}`, { sucesso: 'Sucesso', falha: 'Falha', cancelado: 'Cancelado' }[resultado] || 'Resultado não informado'));
      descricao.appendChild(criar('p', null, r.descricao || 'Sem descrição registrada.'));
      if (origem !== 'manual') descricao.appendChild(criar('p', 'rp-detalhe', ['desconhecida', 'nao_confirmada'].includes(origem) ? 'O registro não confirma se a ação foi manual ou automática.' : 'Evento automático ou do sistema; não representa uma alteração manual deste usuário.'));
      if (r.acao_id) descricao.appendChild(criar('p', 'rp-detalhe', `Vínculo da ação: ${r.acao_id}`));
      if (r.contexto && typeof r.contexto === 'object') {
        const campos = [['Tela', r.contexto.tela], ['Evento', r.contexto.evento], ['Alvo', r.contexto.alvo_id], ['Canal', r.contexto.canal], ['Rota', r.contexto.rota]];
        const informados = campos.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}: ${valor(v)}`);
        if (informados.length) descricao.appendChild(criar('p', 'rp-detalhe', informados.join(' · ')));
      }
      const mudancas = Array.isArray(r.mudancas) ? r.mudancas : [];
      if (mudancas.length) {
        const lista = criar('dl', 'ua-mudancas');
        for (const m of mudancas) {
          lista.appendChild(criar('dt', null, m.campo || 'Campo'));
          const dd = criar('dd');
          dd.append(criar('pre', null, `Antes: ${valor(m.antes)}`), criar('pre', null, `Depois: ${valor(m.depois)}`));
          lista.appendChild(dd);
        }
        descricao.appendChild(lista);
      }
      if (r.detalhes !== undefined && r.detalhes !== null) descricao.appendChild(criar('pre', 'rp-detalhe', valor(r.detalhes)));
      linha.append(quando, descricao);
      corpo.appendChild(linha);
    }
    tabela.appendChild(corpo);
    const bloco = criar('div');
    bloco.append(criar('p', 'rp-detalhe', explicacao), tabela);
    return bloco;
  }

  function folha(registros, completo = false) {
    const secao = criar('section', 'rp-folha');
    const cabecalho = criar('header', 'rp-cabecalho');
    const titulo = criar('div');
    titulo.append(criar('h2', null, `Atividades de ${contexto.nome || contexto.email || `usuário ${usuarioId}`}`), criar('p', null, `${periodo(filtros)} · Horário de Brasília · ${completo ? `${registros.length} registros · período completo` : `Página ${dados.pagina} de ${dados.paginas || 1}`}`));
    const filtrosTexto = [['Módulo', filtros.modulo], ['Ação', filtros.acao], ['Origem', filtros.origem], ['Resultado', filtros.resultado]].filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' · ');
    if (filtrosTexto) titulo.appendChild(criar('p', null, filtrosTexto));
    cabecalho.appendChild(titulo);
    secao.appendChild(cabecalho);
    if (!registros.length) secao.appendChild(criar('p', 'rp-vazio', 'Nenhuma atividade registrada para este usuário nos filtros e período consultados.'));
    const manuais = registros.filter(r => r.origem === 'manual');
    const automaticos = registros.filter(r => r.origem === 'automatico' || r.origem === 'sistema');
    const desconhecidos = registros.filter(r => !['manual', 'automatico', 'sistema'].includes(r.origem));
    if (manuais.length) secao.appendChild(tabelaRegistros(manuais, 'Ações do usuário', 'Ações atribuídas ao usuário no registro de auditoria.'));
    if (automaticos.length) secao.appendChild(tabelaRegistros(automaticos, 'Eventos automáticos e do sistema', 'Efeitos automáticos são apresentados separadamente das ações do usuário.'));
    if (desconhecidos.length) secao.appendChild(tabelaRegistros(desconhecidos, 'Origem não confirmada ou não informada', 'Estes registros não permitem atribuir uma alteração manual ao usuário.'));
    return secao;
  }

  async function carregarPagina(pagina, novaConsulta = false) {
    if (ocupado || fechado) return;
    try {
      if (novaConsulta) { filtros = lerFiltros(); snapshot = null; alterado = false; }
      ocupado = true;
      atualizarBotoes();
      aviso('Consultando atividades…');
      const resposta = await consultar(pagina, Number(el('Limite').value));
      if (fechado) return;
      dados = resposta;
      snapshot = resposta.snapshot ?? snapshot;
      el('Corpo').replaceChildren(folha(dados.registros));
      el('Contagem').textContent = `${dados.total} registro(s) · Página ${dados.pagina} de ${dados.paginas || 1}`;
      aviso('');
    } catch (e) {
      if (fechado) return;
      dados = null;
      el('Corpo').replaceChildren();
      el('Contagem').textContent = '';
      aviso(e.message || 'Não foi possível consultar a auditoria.', true);
    } finally { ocupado = false; atualizarBotoes(); }
  }

  async function gerarPdf() {
    if (ocupado || alterado || !dados || !window.VisualizadorPdf) {
      if (!window.VisualizadorPdf) aviso('O visualizador de PDF não está disponível nesta janela.', true);
      return;
    }
    ocupado = true;
    atualizarBotoes();
    try {
      const registros = [];
      const ids = new Set();
      let pagina = 1;
      let total = null;
      let corte = snapshot;
      do {
        aviso(`Preparando PDF completo: página ${pagina}…`);
        const parte = await consultar(pagina, 500, corte);
        if (fechado) return;
        if (parte.total > PDF_MAXIMO) throw new Error(`O período contém ${parte.total} registros. O PDF completo aceita até ${PDF_MAXIMO}. Reduza o período ou os filtros; nenhum PDF parcial foi gerado.`);
        if (total !== null && parte.total !== total) throw new Error('O total da auditoria mudou durante a exportação. Consulte novamente; nenhum PDF parcial foi gerado.');
        total = parte.total;
        if (pagina > Math.max(1, Math.ceil(total / 500))) throw new Error('A paginação da auditoria está inconsistente. Nenhum PDF parcial foi gerado.');
        if (corte !== null && parte.snapshot !== null && parte.snapshot !== undefined && String(corte) !== String(parte.snapshot)) throw new Error('A consulta mudou durante a exportação. Consulte novamente; nenhum PDF parcial foi gerado.');
        corte = parte.snapshot ?? corte;
        for (const r of parte.registros) {
          if (r.id === undefined || r.id === null || ids.has(String(r.id))) throw new Error('A API devolveu registros sem identificação ou repetidos. Nenhum PDF parcial foi gerado.');
          ids.add(String(r.id));
          registros.push(r);
        }
        if (registros.length > total || (!parte.tem_mais && registros.length !== total) || (!parte.registros.length && registros.length < total)) throw new Error('Faltam páginas na resposta da auditoria. Nenhum PDF parcial foi gerado.');
        if (registros.length < total && corte === null) throw new Error('A API não forneceu uma consulta estável para todas as páginas. Nenhum PDF parcial foi gerado.');
        pagina += 1;
      } while (registros.length < total);
      const css = ['folha-relatorio.css', 'usuario-auditoria.css'].map(arquivo => `<link rel="stylesheet" href="${escapar(new URL(`../css/${arquivo}`, document.baseURI).href)}">`).join('');
      const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Atividades de ${escapar(contexto.nome || usuarioId)}</title>${css}<style>body{background:#fff;margin:0;font-family:Arial,Helvetica,sans-serif}.rp-folha{box-shadow:none;border-radius:0}</style></head><body>${folha(registros, true).outerHTML}</body></html>`;
      window.VisualizadorPdf.abrir({ titulo: `Atividades de ${contexto.nome || contexto.email || usuarioId}`, nomeArquivo: `atividades-usuario-${usuarioId}-${filtros.inicio}-${filtros.fim}`, tituloSalvar: 'Salvar relatório completo de atividades', gerar: window.VisualizadorPdf.deHtml(html) });
      aviso(`PDF completo preparado: ${registros.length} registro(s) do período consultado.`);
    } catch (e) { aviso(e.message || 'Não foi possível gerar o PDF completo.', true); }
    finally { ocupado = false; atualizarBotoes(); }
  }

  function fechar() {
    fechado = true;
    document.removeEventListener('keydown', aoTeclar);
    Modal.close(overlayId);
  }
  function aoTeclar(evento) {
    if (evento.key === 'Escape' && !document.querySelector('.app-message-overlay, dialog[data-dialog-padrao][open]')) fechar();
  }
  document.addEventListener('keydown', aoTeclar);
  el('Voltar').addEventListener('click', fechar);
  el('Fechar').addEventListener('click', fechar);
  el('Consultar').addEventListener('click', () => carregarPagina(1, true));
  el('Anterior').addEventListener('click', () => carregarPagina(dados.pagina - 1));
  el('Proxima').addEventListener('click', () => carregarPagina(dados.pagina + 1));
  el('Pdf').addEventListener('click', gerarPdf);
  CAMPOS.forEach(c => el(c).addEventListener('change', () => {
    alterado = true;
    aviso('Filtros alterados. Clique em Consultar para atualizar o relatório.');
    atualizarBotoes();
  }));
  el('Usuario').textContent = [contexto.nome, contexto.email].filter(Boolean).join(' · ');
  const agora = new Date();
  const inicio = new Date(agora.getTime() - 29 * 86400000);
  el('Inicio').value = dia(inicio);
  el('Fim').value = dia(agora);
  await carregarPagina(1, true);
  if (!fechado) {
    Modal.signalReady?.(overlayId);
    window.dispatchEvent(new CustomEvent('usuarioAuditoriaLoaded'));
    // O aviso que o spinner da casa espera para revelar o modal (openModuleModal).
    window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: overlayId }));
  }
})();
