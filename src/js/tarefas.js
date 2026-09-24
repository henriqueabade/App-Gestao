// Módulo Tarefas (CRM): listas inteligentes, listas, marcadores, convites,
// lista agrupada por prazo e quadro (kanban), criação rápida por texto,
// estatísticas e tarefas automáticas. O editor, a conclusão e a linha de
// tarefa são globais (src/js/utils/tarefas-ui.js), os mesmos das fichas e
// do calendário.

const T = window.TarefasUI;
const { h, icone } = T;

const estado = {
  ctx: null,
  tarefas: [],
  convites: [],
  filtro: { tipo: 'inteligente', chave: 'hoje' },
  busca: '',
  pessoa: 'eu',
  visao: 'lista',
  ordem: 'prazo',
  recolhidos: new Set(['concluida']),
  sqlPendente: false,
  carregando: true
};

const INTELIGENTES = [
  { chave: 'entrada', rotulo: 'Caixa de entrada', icone: 'fa-inbox', dica: 'Abertas sem lista' },
  { chave: 'hoje', rotulo: 'Hoje', icone: 'fa-sun', dica: 'Para hoje e as atrasadas' },
  { chave: 'proximos7', rotulo: 'Próximos 7 dias', icone: 'fa-calendar-week' },
  { chave: 'atrasadas', rotulo: 'Atrasadas', icone: 'fa-triangle-exclamation', tom: 'perigo' },
  { chave: 'semdata', rotulo: 'Sem data', icone: 'fa-circle-question' },
  { chave: 'todas', rotulo: 'Todas abertas', icone: 'fa-layer-group' },
  { chave: 'concluidas', rotulo: 'Concluídas', icone: 'fa-circle-check', dica: 'Últimos 30 dias' }
];
const COLABORACAO = [
  { chave: 'convites', rotulo: 'Convites', icone: 'fa-envelope-open-text', dica: 'Tarefas em conjunto esperando sua resposta' },
  { chave: 'conjunto', rotulo: 'Em conjunto', icone: 'fa-user-group', dica: 'Tarefas com mais gente' },
  { chave: 'delegadas', rotulo: 'Delegadas por mim', icone: 'fa-share-from-square', dica: 'Criadas por você para outra pessoa' }
];
const GRUPOS = [
  ['atrasada', 'Atrasadas', 'fa-triangle-exclamation'], ['hoje', 'Hoje', 'fa-sun'], ['amanha', 'Amanhã', 'fa-cloud-sun'],
  ['semana', 'Próximos 7 dias', 'fa-calendar-week'], ['depois', 'Mais para frente', 'fa-calendar'], ['sem_data', 'Sem data', 'fa-circle-question'],
  ['concluida', 'Concluídas', 'fa-circle-check']
];
const COLUNAS_QUADRO = [
  ['a_fazer', 'A fazer', 'fa-circle'], ['em_andamento', 'Em andamento', 'fa-circle-half-stroke'],
  ['aguardando', 'Aguardando', 'fa-hourglass-half'], ['concluida', 'Concluída', 'fa-circle-check']
];

const $ = id => document.getElementById(id);
const aberta = t => ['a_fazer', 'em_andamento', 'aguardando'].includes(t.status);
const hojeDia = () => T.hoje();
const eu = () => Number(estado.ctx?.eu?.id);

// ------------------------------------------------------------ dados

async function carregar({ silencioso = false } = {}) {
  if (!silencioso) estado.carregando = true;
  try {
    estado.ctx = await T.carregarContexto({ forcar: true });
    if (estado.ctx.sql_pendente) {
      estado.sqlPendente = true;
      estado.tarefas = [];
    } else {
      const [lista, convites] = await Promise.all([
        T.api(`?usuario=${encodeURIComponent(estado.pessoa)}&dias_concluidas=30`),
        T.api('/convites').catch(() => ({ convites: [] }))
      ]);
      estado.sqlPendente = Boolean(lista.sql_pendente);
      estado.tarefas = lista.tarefas || [];
      estado.convites = convites.convites || [];
    }
  } catch (err) {
    estado.sqlPendente = Boolean(err.sql_pendente);
    if (!err.sql_pendente) window.showToast?.(`Não foi possível carregar as tarefas: ${err.message}`, 'error');
  } finally {
    estado.carregando = false;
  }
  await T.carregarFotos();
  desenhar();
}

// ------------------------------------------------------------ filtros

function grupoDaTarefa(t, agora = T.agoraEmBrasilia()) {
  if (!aberta(t)) return 'concluida';
  if (!t.data) return 'sem_data';
  if (T.atrasada(t, agora)) return 'atrasada';
  const faltam = T.diasEntre(agora.dia, t.data);
  if (faltam <= 0) return 'hoje';
  if (faltam === 1) return 'amanha';
  if (faltam <= 7) return 'semana';
  return 'depois';
}

function passaNoFiltro(t, filtro = estado.filtro) {
  const hoje = hojeDia();
  const agora = T.agoraEmBrasilia();
  if (filtro.tipo === 'lista') return aberta(t) && Number(t.lista_id) === Number(filtro.id);
  if (filtro.tipo === 'marcador') return aberta(t) && (t.marcadores || []).includes(Number(filtro.id));
  switch (filtro.chave) {
    case 'entrada': return aberta(t) && !t.lista_id;
    case 'hoje': return aberta(t) && Boolean(t.data) && (t.data <= hoje);
    case 'proximos7': return aberta(t) && Boolean(t.data) && t.data >= hoje && T.diasEntre(hoje, t.data) <= 7;
    case 'atrasadas': return aberta(t) && T.atrasada(t, agora);
    case 'semdata': return aberta(t) && !t.data;
    case 'todas': return aberta(t);
    case 'concluidas': return t.status === 'concluida';
    case 'conjunto': return aberta(t) && ((t.participantes || []).some(p => p.status === 'aceito') || t.minha_participacao === 'aceito');
    case 'delegadas': return aberta(t) && Number(t.criado_por) === eu() && Number(t.responsavel_id) !== eu();
    default: return aberta(t);
  }
}

function passaNaBusca(t) {
  const q = T.semAcento(estado.busca.trim());
  if (!q) return true;
  const marcadores = (t.marcadores || []).map(id => estado.ctx?.marcadores?.find(m => Number(m.id) === Number(id))?.nome || '').join(' ');
  return T.semAcento([t.titulo, t.descricao, t.responsavel, t.tipo, marcadores, ...(t.vinculos || []).map(v => v.nome)].join(' ')).includes(q);
}

const PESO = { urgente: 4, alta: 3, media: 2, baixa: 1 };
function ordenar(lista) {
  const porPrazo = (a, b) => (a.data || '9999').localeCompare(b.data || '9999') || (a.hora || '').localeCompare(b.hora || '') || (PESO[b.prioridade] || 0) - (PESO[a.prioridade] || 0) || a.id - b.id;
  const criterio = {
    prazo: porPrazo,
    prioridade: (a, b) => (PESO[b.prioridade] || 0) - (PESO[a.prioridade] || 0) || porPrazo(a, b),
    criacao: (a, b) => String(b.criado_em).localeCompare(String(a.criado_em)),
    titulo: (a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR')
  }[estado.ordem] || porPrazo;
  return lista.slice().sort(criterio);
}

const visiveisNoFiltro = () => estado.tarefas.filter(t => passaNoFiltro(t) && passaNaBusca(t));

// ------------------------------------------------------------ lateral

function botaoLateral({ rotulo, icone: ic, contagem, ativo, tom, cor, dica, aoClicar, extra }) {
  const b = h('button', { type: 'button', class: `tarefas-lado__item${ativo ? ' tarefas-lado__item--ativo' : ''}${tom ? ` tarefas-lado__item--${tom}` : ''}`, title: dica || null, on: { click: aoClicar } });
  if (cor) {
    const ponto = h('span', { class: 'tarefas-lado__ponto' });
    ponto.style.background = cor;
    b.append(ponto);
  } else {
    b.append(icone(ic));
  }
  b.append(h('span', { class: 'tarefas-lado__rotulo', text: rotulo }));
  if (contagem) b.append(h('span', { class: 'tarefas-lado__contagem', text: String(contagem) }));
  if (extra) b.append(extra);
  return b;
}

function desenharLateral() {
  const ativo = f => estado.filtro.tipo === f.tipo && (estado.filtro.chave === f.chave || (f.id !== undefined && Number(estado.filtro.id) === Number(f.id)));
  const conta = filtro => estado.tarefas.filter(t => passaNoFiltro(t, filtro)).length;
  $('tarefasInteligentes').replaceChildren(...INTELIGENTES.map(i => botaoLateral({
    ...i, contagem: i.chave === 'concluidas' ? null : conta({ tipo: 'inteligente', chave: i.chave }),
    tom: i.tom && conta({ tipo: 'inteligente', chave: i.chave }) ? i.tom : null,
    ativo: ativo({ tipo: 'inteligente', chave: i.chave }),
    aoClicar: () => escolher({ tipo: 'inteligente', chave: i.chave })
  })));
  $('tarefasColaboracao').replaceChildren(...COLABORACAO.map(i => botaoLateral({
    ...i, contagem: i.chave === 'convites' ? estado.convites.length : conta({ tipo: 'inteligente', chave: i.chave }),
    tom: i.chave === 'convites' && estado.convites.length ? 'info' : null,
    ativo: ativo({ tipo: 'inteligente', chave: i.chave }),
    aoClicar: () => escolher({ tipo: 'inteligente', chave: i.chave })
  })));

  const listas = estado.ctx?.listas || [];
  $('tarefasListas').replaceChildren(...(listas.length ? listas.map(l => {
    const menu = h('span', { class: 'tarefas-lado__menu', title: 'Opções da lista', attrs: { role: 'button', tabindex: '0', 'aria-label': `Opções de ${l.nome}` } }, icone('fa-ellipsis'));
    menu.addEventListener('click', e => { e.stopPropagation(); opcoesDaLista(l); });
    return botaoLateral({ rotulo: l.nome, cor: l.cor, contagem: conta({ tipo: 'lista', id: l.id }), ativo: ativo({ tipo: 'lista', id: l.id }), aoClicar: () => escolher({ tipo: 'lista', id: l.id, nome: l.nome }), extra: menu });
  }) : [h('p', { class: 'tarefas-lado__vazio', text: 'Crie listas para separar o trabalho (ex.: Clientes VIP, Pessoal).' })]));

  const marcadores = (estado.ctx?.marcadores || []).filter(m => estado.tarefas.some(t => (t.marcadores || []).includes(Number(m.id))));
  $('tarefasMarcadores').replaceChildren(...(marcadores.length ? marcadores.map(m => {
    const b = h('button', { type: 'button', class: `tarefas-lado__marcador${ativo({ tipo: 'marcador', id: m.id }) ? ' tarefas-lado__marcador--ativo' : ''}`, text: `#${m.nome}`, on: { click: () => escolher({ tipo: 'marcador', id: m.id, nome: m.nome }) } });
    b.style.setProperty('--marcador-cor', m.cor || '#d4c169');
    return b;
  }) : [h('p', { class: 'tarefas-lado__vazio', text: 'Use #marcador na criação rápida ou no editor.' })]));
}

function escolher(filtro) {
  estado.filtro = filtro;
  desenhar();
  $('tarefasConteudo')?.scrollTo?.({ top: 0 });
}

async function opcoesDaLista(l) {
  const d = T.dialogo({ classe: 'tui-dialogo--concluir', rotulo: 'Lista' });
  const nome = h('input', { class: 'tui-campo', type: 'text', maxLength: 60, value: l.nome });
  let cor = l.cor;
  const cores = h('div', { class: 'tarefas-cores' });
  const pintarCores = () => cores.replaceChildren(...T.CORES_LISTA.map(c => {
    const b = h('button', { type: 'button', class: 'tarefas-cor', title: c, attrs: { 'aria-pressed': String(c === cor), 'aria-label': `Cor ${c}` }, on: { click: () => { cor = c; pintarCores(); } } });
    b.style.background = c;
    return b;
  }));
  pintarCores();
  const salvar = h('button', { type: 'button', class: 'btn-primary tui-botao', on: { click: async () => {
    try { await T.api(`/listas/${l.id}`, { method: 'PUT', corpo: { nome: nome.value.trim(), cor } }); d.fechar(); T.limparContexto(); carregar({ silencioso: true }); } catch (err) { window.showToast?.(err.message, 'error'); }
  } } }, icone('fa-floppy-disk'), ' Salvar');
  const excluir = h('button', { type: 'button', class: 'btn-danger tui-botao', on: { click: async () => {
    const ok = await window.DialogPadrao?.confirm({ title: `Excluir a lista "${l.nome}"?`, tom: 'erro', message: 'As tarefas da lista não são apagadas: voltam para a Caixa de entrada.', confirmText: 'Excluir lista', confirmVariant: 'danger' });
    if (!ok) return;
    try { await T.api(`/listas/${l.id}`, { method: 'DELETE' }); d.fechar(); if (estado.filtro.tipo === 'lista' && Number(estado.filtro.id) === Number(l.id)) estado.filtro = { tipo: 'inteligente', chave: 'entrada' }; T.limparContexto(); carregar({ silencioso: true }); } catch (err) { window.showToast?.(err.message, 'error'); }
  } } }, icone('fa-trash-can'), ' Excluir');
  d.append(h('div', { class: 'tui-cartao tui-cartao--estreito' },
    h('header', { class: 'tui-concluir__topo' }, h('span', { class: 'tui-concluir__icone tarefas-icone-lista' }, icone('fa-list')), h('div', {}, h('h3', { class: 'tui-concluir__titulo', text: 'Lista' }), h('p', { class: 'tui-concluir__sub', text: l.nome }))),
    h('div', { class: 'tui-concluir__corpo' }, h('span', { class: 'tui-rotulo', text: 'Nome' }), nome, h('span', { class: 'tui-rotulo', text: 'Cor' }), cores),
    h('footer', { class: 'tui-rodape' }, h('div', { class: 'tui-rodape__lado' }, excluir), h('div', { class: 'tui-rodape__lado' }, h('button', { type: 'button', class: 'btn-neutral tui-botao', text: 'Cancelar', on: { click: () => d.fechar() } }), salvar))));
  d.addEventListener('cancel', e => { e.preventDefault(); d.fechar(); });
  d.showModal();
}

async function novaLista() {
  const d = T.dialogo({ classe: 'tui-dialogo--concluir', rotulo: 'Nova lista' });
  const campo = h('input', { class: 'tui-campo', type: 'text', maxLength: 60, placeholder: 'Ex.: Clientes VIP, Obras, Pessoal' });
  let cor = T.CORES_LISTA[(estado.ctx?.listas || []).length % T.CORES_LISTA.length];
  const cores = h('div', { class: 'tarefas-cores' });
  const pintarCores = () => cores.replaceChildren(...T.CORES_LISTA.map(c => {
    const b = h('button', { type: 'button', class: 'tarefas-cor', attrs: { 'aria-pressed': String(c === cor), 'aria-label': `Cor ${c}` }, on: { click: () => { cor = c; pintarCores(); } } });
    b.style.background = c;
    return b;
  }));
  pintarCores();
  const criar = async () => {
    if (!campo.value.trim()) { campo.focus(); return; }
    try {
      const l = await T.api('/listas', { method: 'POST', corpo: { nome: campo.value.trim(), cor } });
      d.fechar();
      T.limparContexto();
      estado.filtro = { tipo: 'lista', id: l.id, nome: l.nome };
      carregar({ silencioso: true });
    } catch (err) { window.showToast?.(err.message, 'error'); }
  };
  campo.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); criar(); } });
  d.append(h('div', { class: 'tui-cartao tui-cartao--estreito' },
    h('header', { class: 'tui-concluir__topo' }, h('span', { class: 'tui-concluir__icone tarefas-icone-lista' }, icone('fa-list')), h('div', {}, h('h3', { class: 'tui-concluir__titulo', text: 'Nova lista' }), h('p', { class: 'tui-concluir__sub', text: 'Só você vê as suas listas.' }))),
    h('div', { class: 'tui-concluir__corpo' }, h('span', { class: 'tui-rotulo', text: 'Nome' }), campo, h('span', { class: 'tui-rotulo', text: 'Cor' }), cores),
    h('footer', { class: 'tui-rodape' }, h('div', { class: 'tui-rodape__lado' }), h('div', { class: 'tui-rodape__lado' },
      h('button', { type: 'button', class: 'btn-neutral tui-botao', text: 'Cancelar', on: { click: () => d.fechar() } }),
      h('button', { type: 'button', class: 'btn-primary tui-botao', on: { click: criar } }, icone('fa-plus'), ' Criar lista')))));
  d.addEventListener('cancel', e => { e.preventDefault(); d.fechar(); });
  d.showModal();
  campo.focus();
}

// ------------------------------------------------------------ principal

function tituloDoFiltro() {
  if (estado.filtro.tipo === 'lista') return estado.filtro.nome || (estado.ctx?.listas || []).find(l => Number(l.id) === Number(estado.filtro.id))?.nome || 'Lista';
  if (estado.filtro.tipo === 'marcador') return `#${estado.filtro.nome || ''}`;
  return [...INTELIGENTES, ...COLABORACAO].find(i => i.chave === estado.filtro.chave)?.rotulo || 'Tarefas';
}

function vazio(texto, ic = 'fa-mug-hot') {
  return h('div', { class: 'tui-vazio' }, icone(ic), h('p', { text: texto }));
}

function desenharLista(alvo, tarefas) {
  if (estado.filtro.chave === 'convites') {
    if (!estado.convites.length) { alvo.append(vazio('Nenhum convite esperando resposta.', 'fa-envelope-open')); return; }
    const lista = h('div', { class: 'tarefas-grupo__itens' });
    for (const c of estado.convites) {
      lista.append(h('div', { class: 'tarefas-convite' },
        h('p', { class: 'tarefas-convite__de' }, icone('fa-user-plus'), ` ${c.convidado_por || 'Alguém'} convidou você${c.mensagem ? ` · “${c.mensagem}”` : ''}`),
        T.linhaDeTarefa(c.tarefa, { ctx: estado.ctx, convite: true })));
    }
    alvo.append(lista);
    return;
  }
  if (!tarefas.length) {
    alvo.append(vazio(estado.busca ? 'Nada encontrado com essa busca.' : estado.filtro.chave === 'hoje' ? 'Nada para hoje. Aproveite — ou crie uma tarefa aí em cima.' : 'Nenhuma tarefa aqui.', estado.busca ? 'fa-magnifying-glass' : 'fa-mug-hot'));
    return;
  }
  const agora = T.agoraEmBrasilia();
  const porGrupo = new Map(GRUPOS.map(([g]) => [g, []]));
  for (const t of tarefas) porGrupo.get(grupoDaTarefa(t, agora)).push(t);
  for (const [chave, rotulo, ic] of GRUPOS) {
    const itens = porGrupo.get(chave);
    if (!itens.length) continue;
    const recolhido = estado.recolhidos.has(chave) && estado.filtro.chave !== 'concluidas';
    const cabeca = h('button', { type: 'button', class: `tarefas-grupo__cabeca tarefas-grupo__cabeca--${chave}`, attrs: { 'aria-expanded': String(!recolhido) }, on: { click: () => {
      if (estado.recolhidos.has(chave)) estado.recolhidos.delete(chave); else estado.recolhidos.add(chave);
      desenhar();
    } } }, icone('fa-chevron-down', 'tarefas-grupo__seta'), icone(ic), h('span', { text: rotulo }), h('span', { class: 'tarefas-grupo__n', text: String(itens.length) }));
    const corpo = h('div', { class: 'tarefas-grupo__itens', hidden: recolhido });
    const ordenadas = chave === 'concluida' ? itens.slice().sort((a, b) => String(b.concluida_em).localeCompare(String(a.concluida_em))) : ordenar(itens);
    for (const t of ordenadas) corpo.append(T.linhaDeTarefa(t, { ctx: estado.ctx }));
    alvo.append(h('section', { class: 'tarefas-grupo' }, cabeca, corpo));
  }
}

// ------------------------------------------------------------ quadro

let arrastando = null;

function desenharQuadro(alvo, tarefas) {
  const quadro = h('div', { class: 'tarefas-quadro' });
  const hoje = hojeDia();
  const recentes = t => t.status !== 'concluida' || (t.concluida_em && T.diasEntre(String(t.concluida_em).slice(0, 10), hoje) <= 14);
  for (const [status, rotulo, ic] of COLUNAS_QUADRO) {
    const itens = tarefas.filter(t => (status === 'concluida' ? t.status === 'concluida' && recentes(t) : t.status === status))
      .sort((a, b) => ((Number(a.ordem) || 0) - (Number(b.ordem) || 0)) || (ordenar([a, b])[0] === a ? -1 : 1));
    const lista = h('div', { class: 'tarefas-coluna__itens', dataset: { status } });
    for (const t of itens) {
      const cartao = T.linhaDeTarefa(t, { ctx: estado.ctx, compacta: true });
      cartao.draggable = Boolean(t.pode?.concluir);
      cartao.addEventListener('dragstart', e => { arrastando = t; cartao.classList.add('tarefas-arrastando'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(t.id)); });
      cartao.addEventListener('dragend', () => { arrastando = null; cartao.classList.remove('tarefas-arrastando'); quadro.querySelectorAll('.tarefas-coluna--alvo').forEach(c => c.classList.remove('tarefas-coluna--alvo')); });
      lista.append(cartao);
    }
    if (!itens.length) lista.append(h('p', { class: 'tarefas-coluna__vazio', text: status === 'concluida' ? 'Solte aqui para concluir' : 'Arraste tarefas para cá' }));
    const coluna = h('section', { class: `tarefas-coluna tarefas-coluna--${status}` },
      h('header', { class: 'tarefas-coluna__cabeca' }, icone(ic), h('span', { text: rotulo }), h('span', { class: 'tarefas-grupo__n', text: String(itens.length) })), lista);
    coluna.addEventListener('dragover', e => { if (!arrastando) return; e.preventDefault(); coluna.classList.add('tarefas-coluna--alvo'); });
    coluna.addEventListener('dragleave', e => { if (!coluna.contains(e.relatedTarget)) coluna.classList.remove('tarefas-coluna--alvo'); });
    coluna.addEventListener('drop', async e => {
      e.preventDefault();
      coluna.classList.remove('tarefas-coluna--alvo');
      const t = arrastando;
      arrastando = null;
      if (!t) return;
      // Posição: entre os cartões onde soltou.
      const cartoes = [...lista.querySelectorAll('.tui-tarefa')].filter(c => Number(c.dataset.tarefaId) !== t.id);
      const depois = cartoes.find(c => e.clientY < c.getBoundingClientRect().top + c.getBoundingClientRect().height / 2);
      const ordemDe = c => Number(estado.tarefas.find(x => x.id === Number(c?.dataset.tarefaId))?.ordem) || 0;
      const ordem = depois ? (ordemDe(depois) + (cartoes.indexOf(depois) > 0 ? ordemDe(cartoes[cartoes.indexOf(depois) - 1]) : ordemDe(depois) - 2)) / 2 : (cartoes.length ? ordemDe(cartoes[cartoes.length - 1]) + 1 : 1);
      if (status === 'concluida') {
        if (t.status !== 'concluida') await T.concluir(t);
        return;
      }
      if (t.status === 'concluida') { window.showToast?.('Para voltar uma concluída, abra e use "Reabrir".', 'info'); return; }
      await T.mover(t, { status, ordem });
    });
    quadro.append(coluna);
  }
  alvo.append(quadro);
}

// ------------------------------------------------------------ desenhar

function desenhar() {
  $('tarefasAvisoSql').hidden = !estado.sqlPendente;
  document.querySelectorAll('[data-visao]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.visao === estado.visao)));
  desenharPessoas();
  desenharLateral();
  const alvo = $('tarefasConteudo');
  alvo.replaceChildren();
  alvo.classList.toggle('tarefas-conteudo--quadro', estado.visao === 'quadro');
  $('tarefasTituloVisao').textContent = tituloDoFiltro();
  if (estado.carregando) {
    alvo.append(h('div', { class: 'tarefas-esqueleto' }, ...Array.from({ length: 5 }, () => h('span'))));
    return;
  }
  if (estado.sqlPendente) { alvo.append(vazio('As tarefas aparecem aqui assim que o SQL for executado.', 'fa-database')); return; }
  const lista = visiveisNoFiltro();
  $('tarefasContagem').textContent = estado.filtro.chave === 'convites' ? `${estado.convites.length}` : `${lista.length} ${lista.length === 1 ? 'tarefa' : 'tarefas'}`;
  if (estado.visao === 'quadro' && estado.filtro.chave !== 'convites') {
    // O quadro mostra também as concluídas recentes do mesmo recorte.
    const base = estado.filtro.chave === 'concluidas' ? lista : estado.tarefas.filter(t => passaNaBusca(t) && (passaNoFiltro(t) || (t.status === 'concluida' && passaNoFiltroSemSituacao(t))));
    desenharQuadro(alvo, base);
  } else {
    desenharLista(alvo, lista);
  }
}

/** O recorte do filtro ignorando se está aberta (para a coluna Concluída do quadro). */
function passaNoFiltroSemSituacao(t) {
  const aberto = { ...t, status: 'a_fazer' };
  if (estado.filtro.tipo !== 'inteligente') return passaNoFiltro(aberto);
  if (['hoje', 'atrasadas', 'proximos7'].includes(estado.filtro.chave)) return Boolean(t.data) && T.diasEntre(t.data, hojeDia()) <= 7;
  return passaNoFiltro(aberto);
}

function desenharPessoas() {
  const seletor = $('tarefasPessoa');
  const ctx = estado.ctx;
  if (!ctx?.pode?.ver_outros) { seletor.hidden = true; return; }
  seletor.hidden = false;
  if (seletor.dataset.montado === String(ctx.visiveis?.length)) { seletor.value = estado.pessoa; return; }
  seletor.dataset.montado = String(ctx.visiveis?.length);
  const pessoas = (ctx.usuarios || []).filter(u => (ctx.visiveis || []).includes(Number(u.id)) && Number(u.id) !== Number(ctx.eu.id));
  seletor.replaceChildren(
    h('option', { value: 'eu', text: 'Minhas tarefas' }),
    h('option', { value: 'todos', text: ctx.eu.gestor ? 'Toda a equipe' : 'Todas que eu vejo' }),
    ...pessoas.map(u => h('option', { value: u.id, text: u.nome }))
  );
  seletor.value = estado.pessoa;
}

// ------------------------------------------------------------ criação rápida

function previaRapida() {
  const campo = $('tarefasRapida');
  const alvo = $('tarefasRapidaPrevia');
  const texto = campo.value.trim();
  alvo.replaceChildren();
  if (!texto || !estado.ctx) return null;
  const r = T.interpretarTexto(texto, { usuarios: estado.ctx.usuarios, listas: estado.ctx.listas, marcadores: estado.ctx.marcadores });
  const ICONES = { data: 'fa-calendar', hora: 'fa-clock', prioridade: 'fa-flag', marcador: 'fa-hashtag', lista: 'fa-list', pessoa: 'fa-user', duracao: 'fa-hourglass-half' };
  if (r.tipo) alvo.append(T.chip(r.tipo, { icone: T.TIPOS[r.tipo].icone, cor: T.TIPOS[r.tipo].cor }));
  for (const x of r.reconhecidos) {
    let rotulo = x.texto;
    if (x.tipo === 'pessoa') rotulo = estado.ctx.pode.atribuir ? `Para ${x.texto}` : `Convidar ${x.texto}`;
    alvo.append(T.chip(rotulo, { icone: ICONES[x.tipo], classe: x.tipo === 'prioridade' ? 'tui-chip--aviso' : 'tui-chip--ouro' }));
  }
  if (!r.data && ['hoje'].includes(estado.filtro.chave)) alvo.append(T.chip('Hoje', { icone: 'fa-calendar', classe: 'tui-chip--ouro' }));
  if (estado.filtro.tipo === 'lista' && !r.lista) alvo.append(T.chip(tituloDoFiltro(), { icone: 'fa-list' }));
  return r;
}

async function criarRapida({ completa = false } = {}) {
  const campo = $('tarefasRapida');
  const r = previaRapida();
  if (!r || !r.titulo) { campo.focus(); return; }
  const hoje = hojeDia();
  const listaDoFiltro = estado.filtro.tipo === 'lista' ? Number(estado.filtro.id) : null;
  // Marcadores novos são criados antes (ficam para todos).
  const marcadores = [];
  for (const m of r.marcadores) {
    if (m.id) { marcadores.push(Number(m.id)); continue; }
    try { const novo = await T.api('/marcadores', { method: 'POST', corpo: { nome: m.nome, cor: T.CORES_LISTA[(estado.ctx.marcadores || []).length % T.CORES_LISTA.length] } }); marcadores.push(Number(novo.id)); } catch (err) { window.showToast?.(err.message, 'error'); }
  }
  if (estado.filtro.tipo === 'marcador') marcadores.push(Number(estado.filtro.id));
  const preset = {
    titulo: r.titulo, tipo: r.tipo || 'Tarefa', prioridade: r.prioridade || 'media',
    data: r.data || (estado.filtro.chave === 'hoje' ? hoje : null), hora: r.hora, duracao_min: r.duracao_min || (r.hora ? 30 : null),
    lista_id: r.lista?.id || listaDoFiltro, marcadores: [...new Set(marcadores)]
  };
  if (r.pessoa && Number(r.pessoa.id) !== Number(estado.ctx.eu.id)) {
    if (estado.ctx.pode.atribuir) preset.responsavel_id = Number(r.pessoa.id);
    else preset.participantes = [Number(r.pessoa.id)];
  }
  if (completa) {
    campo.value = '';
    previaRapida();
    T.limparContexto();
    await T.abrirEditor({ preset: { ...preset, origemTexto: 'Da criação rápida' } });
    return;
  }
  try {
    await T.api('', { method: 'POST', corpo: preset });
    campo.value = '';
    previaRapida();
    window.showToast?.(preset.participantes ? `Tarefa criada e convite enviado para ${r.pessoa.nome}.` : 'Tarefa criada.', 'success');
    T.limparContexto();
    carregar({ silencioso: true });
  } catch (err) {
    window.showToast?.(err.message, 'error');
  }
}

// ------------------------------------------------------------ estatísticas

function horasLegiveis(h) {
  if (h === null || h === undefined) return '—';
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} dias`;
}

async function abrirEstatisticas() {
  const ctx = estado.ctx;
  let dias = 30;
  let pessoa = estado.pessoa;
  const d = T.dialogo({ classe: 'tarefas-dialogo-estatisticas', rotulo: 'Estatísticas' });
  const corpo = h('div', { class: 'tarefas-est__corpo' });
  const periodos = h('div', { class: 'tui-atalhos' });
  const seletor = ctx.pode.ver_outros ? h('select', { class: 'tui-campo tarefas-est__pessoa' },
    h('option', { value: 'eu', text: 'Só eu' }), h('option', { value: 'todos', text: ctx.eu.gestor ? 'Toda a equipe' : 'Todos que eu vejo' }),
    ...(ctx.usuarios || []).filter(u => (ctx.visiveis || []).includes(Number(u.id)) && Number(u.id) !== Number(ctx.eu.id)).map(u => h('option', { value: u.id, text: u.nome }))) : null;
  if (seletor) { seletor.value = pessoa; seletor.addEventListener('change', () => { pessoa = seletor.value; carregarEst(); }); }
  const pintarPeriodos = () => periodos.replaceChildren(...[[7, '7 dias'], [30, '30 dias'], [90, '90 dias'], [365, '12 meses']].map(([n, t]) => h('button', {
    type: 'button', class: `tui-atalho${n === dias ? ' tarefas-atalho--ativo' : ''}`, text: t, on: { click: () => { dias = n; pintarPeriodos(); carregarEst(); } }
  })));
  pintarPeriodos();
  async function carregarEst() {
    corpo.replaceChildren(h('div', { class: 'tarefas-esqueleto' }, h('span'), h('span'), h('span')));
    try {
      const hoje = hojeDia();
      const e = await T.api(`/estatisticas?de=${T.somarDias(hoje, -(dias - 1))}&ate=${hoje}&usuario=${encodeURIComponent(pessoa)}`);
      const kpi = (rotulo, valor, dica, tom) => h('div', { class: `tarefas-kpi tarefas-kpi--${tom}` }, h('span', { class: 'tarefas-kpi__rotulo', text: rotulo }), h('strong', { class: 'tarefas-kpi__valor', text: valor }), h('span', { class: 'tarefas-kpi__dica', text: dica }));
      const maior = Math.max(1, ...e.por_semana.map(s => s.concluidas));
      const barras = h('div', { class: 'tarefas-barras' }, e.por_semana.slice(-16).map(s => {
        const barra = h('div', { class: 'tarefas-barras__coluna', title: `Semana de ${T.dataCurta(s.semana)}: ${s.concluidas} concluída(s)` },
          h('span', { class: 'tarefas-barras__n', text: s.concluidas ? String(s.concluidas) : '' }),
          h('span', { class: 'tarefas-barras__barra' }),
          h('span', { class: 'tarefas-barras__rotulo', text: T.dataCurta(s.semana) }));
        barra.querySelector('.tarefas-barras__barra').style.height = `${Math.max(3, (s.concluidas / maior) * 100)}%`;
        return barra;
      }));
      const maiorTipo = Math.max(1, ...e.por_tipo.map(x => x.concluidas));
      const tipos = h('div', { class: 'tarefas-hbarras' }, e.por_tipo.length ? e.por_tipo.map(x => {
        const linha = h('div', { class: 'tarefas-hbarras__linha' }, h('span', { class: 'tarefas-hbarras__rotulo' }, icone(T.TIPOS[x.tipo]?.icone || 'fa-square-check'), ` ${x.tipo}`), h('span', { class: 'tarefas-hbarras__trilho' }, h('span')), h('strong', { text: String(x.concluidas) }));
        const b = linha.querySelector('.tarefas-hbarras__trilho > span');
        b.style.width = `${(x.concluidas / maiorTipo) * 100}%`;
        b.style.background = T.TIPOS[x.tipo]?.cor || 'var(--color-primary)';
        return linha;
      }) : [h('p', { class: 'tui-dica', text: 'Nenhuma concluída no período.' })]);
      const tabela = e.por_pessoa.length > 1 || pessoa === 'todos' ? h('table', { class: 'tarefas-tabela' },
        h('thead', {}, h('tr', {}, ...['Pessoa', 'Abertas', 'Atrasadas', 'Concluídas', 'No prazo'].map(t => h('th', { text: t })))),
        h('tbody', {}, ...e.por_pessoa.map(p => h('tr', {},
          h('td', {}, h('span', { class: 'tui-pessoa' }, T.avatar(p.usuario_id, p.nome, { tamanho: 'p' }), h('span', { text: p.nome }))),
          h('td', { text: String(p.abertas) }), h('td', { class: p.atrasadas ? 'tarefas-tabela--perigo' : '', text: String(p.atrasadas) }),
          h('td', { text: String(p.concluidas) }), h('td', { text: p.concluidas ? `${Math.round((p.no_prazo / p.concluidas) * 100)}%` : '—' }))))) : null;
      corpo.replaceChildren(
        h('div', { class: 'tarefas-kpis' },
          kpi('Concluídas', String(e.concluidas), `${e.criadas} criadas no período`, 'sucesso'),
          kpi('No prazo', e.taxa_no_prazo === null ? '—' : `${e.taxa_no_prazo}%`, `${e.no_prazo} de ${e.concluidas}`, e.taxa_no_prazo !== null && e.taxa_no_prazo < 70 ? 'aviso' : 'ouro'),
          kpi('Atrasadas agora', String(e.atrasadas), `${e.abertas} abertas`, e.atrasadas ? 'perigo' : 'neutro'),
          kpi('Tempo médio', horasLegiveis(e.horas_medias), 'da criação à conclusão', 'info')),
        h('section', { class: 'tarefas-est__bloco' }, h('h4', { class: 'tui-rotulo', text: 'Concluídas por semana' }), barras),
        h('section', { class: 'tarefas-est__bloco' }, h('h4', { class: 'tui-rotulo', text: 'Por tipo' }), tipos),
        // Sem a tabela, nada entra: `replaceChildren(null)` escreveria "null" na tela.
        ...(tabela ? [h('section', { class: 'tarefas-est__bloco' }, h('h4', { class: 'tui-rotulo', text: 'Por pessoa' }), h('div', { class: 'tarefas-tabela-moldura' }, tabela))] : [])
      );
    } catch (err) {
      corpo.replaceChildren(h('p', { class: 'tui-dica tui-dica--aviso', text: err.message }));
    }
  }
  d.append(h('div', { class: 'tui-cartao' },
    h('header', { class: 'tui-concluir__topo' }, h('span', { class: 'tui-concluir__icone tarefas-icone-est' }, icone('fa-chart-column')),
      h('div', { class: 'tarefas-est__titulo' }, h('h3', { class: 'tui-concluir__titulo', text: 'Estatísticas das tarefas' }), h('p', { class: 'tui-concluir__sub', text: 'Concluídas, prazo e atrasos no período' })),
      h('div', { class: 'tarefas-est__filtros' }, periodos, seletor)),
    corpo,
    h('footer', { class: 'tui-rodape' }, h('div', { class: 'tui-rodape__lado' }), h('div', { class: 'tui-rodape__lado' }, h('button', { type: 'button', class: 'btn-neutral tui-botao', text: 'Fechar', on: { click: () => d.fechar() } })))));
  d.addEventListener('cancel', e => { e.preventDefault(); d.fechar(); });
  d.showModal();
  carregarEst();
}

// ------------------------------------------------------------ automações

/**
 * Tarefas automáticas (decisão do dono, 24/09/2026). Abre para todos que veem
 * Tarefas, só com as regras das permissões da pessoa (o servidor filtra):
 *   - "Receber esta tarefa": liga/desliga SÓ para quem está usando (o mesmo
 *     interruptor de Configurações › Tarefas automáticas);
 *   - quem tem "Configurar tarefas automáticas" ajusta também a regra para
 *     todos: ligada, título, prazo, tipo e prioridade — como antes.
 */
async function abrirAutomacoes() {
  let resposta;
  try { resposta = await T.api('/automacoes'); } catch (err) { window.showToast?.(err.message, 'error'); return; }
  const regras = resposta.automacoes || [];
  const configura = Boolean(resposta.pode_configurar);
  const semPreferencias = Boolean(resposta.preferencias_sql_pendente);
  const d = T.dialogo({ classe: 'tarefas-dialogo-automacoes', rotulo: 'Tarefas automáticas' });
  const alteradas = new Map();
  const minhas = new Map();
  const linhas = regras.map(r => {
    const muda = (campo, valor) => { alteradas.set(r.chave, { ...(alteradas.get(r.chave) || {}), [campo]: valor }); };
    const pintar = () => cartao.classList.toggle('tarefas-regra--desligada', !(minha.checked && (configura ? geral.checked : r.ativa)));
    const minha = h('input', { type: 'checkbox', checked: Boolean(r.minha), disabled: semPreferencias, attrs: { role: 'switch', 'aria-label': `Receber a tarefa: ${r.nome}` } });
    minha.addEventListener('change', () => { minhas.set(r.chave, minha.checked); pintar(); });
    const geral = h('input', { type: 'checkbox', checked: Boolean(r.ativa), attrs: { role: 'switch', 'aria-label': `Ligar para todos: ${r.nome}` } });
    geral.addEventListener('change', () => { muda('ativa', geral.checked); pintar(); });
    const avisos = [];
    if (!r.ativa) avisos.push(h('p', { class: 'tui-dica tarefas-regra__aviso' }, icone('fa-power-off'), ' Desligada para todos: ninguém recebe esta tarefa agora.'));
    const topo = h('header', { class: 'tarefas-regra__topo' },
      h('label', { class: 'tarefas-interruptor', title: 'Receber esta tarefa' }, minha, h('span')),
      h('div', { class: 'tarefas-regra__textos' },
        h('strong', { text: r.nome }),
        h('p', { class: 'tui-dica', text: r.descricao || '' }),
        h('span', { class: 'tarefas-regra__modulo' }, icone(r.icone || 'fa-robot'), ` ${r.modulo || 'Tarefas'}${r.permissao_rotulo ? ` · para quem pode "${r.permissao_rotulo}"` : ''}`)),
      h('span', { class: 'tarefas-regra__minha', text: 'Receber esta tarefa' }));
    const partes = [topo, ...avisos];
    if (configura) {
      const antecedencia = r.prazo_tipo === 'antes_do_pagamento';
      const dias = h('input', { class: 'tui-campo tui-campo--curto', type: 'number', min: 0, max: 365, value: r.dias });
      dias.addEventListener('change', () => muda('dias', Math.max(0, Math.min(365, Number(dias.value) || 0))));
      const titulo = h('input', { class: 'tui-campo', type: 'text', maxLength: 200, value: r.titulo });
      titulo.addEventListener('change', () => muda('titulo', titulo.value));
      const tipo = h('select', { class: 'tui-campo' }, Object.keys(T.TIPOS).map(t => h('option', { value: t, text: t, selected: t === r.tipo })));
      tipo.addEventListener('change', () => muda('tipo', tipo.value));
      const prioridade = h('select', { class: 'tui-campo' }, Object.entries(T.PRIORIDADES).map(([v, p]) => h('option', { value: v, text: p.rotulo, selected: v === r.prioridade })));
      prioridade.addEventListener('change', () => muda('prioridade', prioridade.value));
      partes.push(
        h('div', { class: 'tarefas-regra__geral' },
          h('label', { class: 'tarefas-interruptor' }, geral, h('span')),
          h('span', { class: 'tui-rotulo', text: 'Ligada para todos' })),
        h('div', { class: 'tarefas-regra__campos' },
          h('label', { class: 'tarefas-regra__campo tarefas-regra__campo--largo' }, h('span', { class: 'tui-rotulo', text: 'Título da tarefa' }), titulo),
          h('label', { class: 'tarefas-regra__campo', title: antecedencia ? 'Quantos dias antes do dia marcado para pagar (0 = no próprio dia)' : 'Quantos dias depois do que aconteceu' },
            h('span', { class: 'tui-rotulo', text: antecedencia ? 'Antecedência (dias)' : 'Prazo (dias)' }), dias),
          h('label', { class: 'tarefas-regra__campo' }, h('span', { class: 'tui-rotulo', text: 'Tipo' }), tipo),
          h('label', { class: 'tarefas-regra__campo' }, h('span', { class: 'tui-rotulo', text: 'Prioridade' }), prioridade)));
    }
    const cartao = h('article', { class: 'tarefas-regra', attrs: { 'data-regra': r.chave } }, ...partes);
    pintar();
    return cartao;
  });
  const salvar = h('button', { type: 'button', class: 'btn-primary tui-botao', on: { click: async () => {
    try {
      for (const [chave, ativa] of minhas) await T.api(`/automacoes/${chave}/minha`, { method: 'PUT', corpo: { ativa } });
      for (const [chave, patch] of alteradas) await T.api(`/automacoes/${chave}`, { method: 'PUT', corpo: patch });
      const mudou = minhas.size + alteradas.size;
      window.showToast?.(mudou ? 'Tarefas automáticas salvas.' : 'Nada mudou.', 'success');
      d.fechar();
    } catch (err) { window.showToast?.(err.message, 'error'); }
  } } }, icone('fa-floppy-disk'), ' Salvar');
  const vazio = h('p', { class: 'tui-dica' }, icone('fa-circle-info'), ' Nenhuma tarefa automática ligada às suas permissões.');
  const rodapeDica = configura
    ? ' No título, {orcamento}, {cliente}, {pedido}, {prospeccao} e {competencia} viram os nomes. Cada registro gera a tarefa uma vez só.'
    : ' Cada registro gera a tarefa uma vez só. O ajuste das regras para todos é de quem pode configurar as tarefas automáticas.';
  d.append(h('div', { class: 'tui-cartao' },
    h('header', { class: 'tui-concluir__topo' }, h('span', { class: 'tui-concluir__icone tarefas-icone-est' }, icone('fa-robot')),
      h('div', {}, h('h3', { class: 'tui-concluir__titulo', text: 'Tarefas automáticas' }), h('p', { class: 'tui-concluir__sub', text: 'Quando algo acontece no CRM, a tarefa de acompanhamento nasce sozinha. Desligue as que não quer receber.' }))),
    h('div', { class: 'tui-concluir__corpo' },
      ...(semPreferencias ? [h('p', { class: 'tui-dica tarefas-regra__aviso' }, icone('fa-database'), ' Para ligar e desligar só para você, rode sql/tarefas_automaticas_por_usuario.sql e reinicie a API.')] : []),
      ...(linhas.length ? linhas : [vazio]),
      h('p', { class: 'tui-dica' }, icone('fa-circle-info'), rodapeDica)),
    h('footer', { class: 'tui-rodape' }, h('div', { class: 'tui-rodape__lado' }), h('div', { class: 'tui-rodape__lado' }, h('button', { type: 'button', class: 'btn-neutral tui-botao', text: 'Cancelar', on: { click: () => d.fechar() } }), salvar))));
  d.addEventListener('cancel', e => { e.preventDefault(); d.fechar(); });
  d.showModal();
}

// ------------------------------------------------------------ atalhos

function mostrarAtalhos() {
  window.DialogPadrao?.info({
    title: 'Atalhos de teclado', icone: 'fa-keyboard', tom: 'info',
    secoes: [{
      titulo: 'Tarefas', icone: 'fa-list-check',
      itens: [
        { rotulo: 'N', valor: 'Criação rápida' }, { rotulo: 'Shift + N', valor: 'Nova tarefa (completa)' },
        { rotulo: '/', valor: 'Buscar' }, { rotulo: '1 · 2', valor: 'Lista · Quadro' },
        { rotulo: 'Shift + clique no círculo', valor: 'Concluir sem perguntar' }, { rotulo: 'Ctrl + Enter', valor: 'Salvar no editor' }, { rotulo: '?', valor: 'Esta ajuda' }
      ]
    }, {
      titulo: 'Criação rápida', icone: 'fa-wand-magic-sparkles',
      itens: [
        { rotulo: 'amanhã, sexta, 25/10, dia 5, em 3 dias', valor: 'Data' }, { rotulo: '14h, às 9, 14:30', valor: 'Hora' },
        { rotulo: '!alta  !urgente  !!', valor: 'Prioridade' }, { rotulo: '#marcador', valor: 'Marcador (cria se não existir)' },
        { rotulo: '~Lista  ~"Nome com espaço"', valor: 'Lista' }, { rotulo: '@Ana', valor: 'Atribuir (ou convidar)' }, { rotulo: 'por 30min, por 1h30', valor: 'Duração' }
      ]
    }]
  });
}

function aoTeclar(e) {
  if (!document.body.contains($('tarefasConteudo'))) { document.removeEventListener('keydown', aoTeclar); return; }
  if (document.querySelector('dialog[open]')) return;
  const alvo = e.target;
  const digitando = alvo && (alvo.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(alvo.tagName));
  if (digitando) {
    if (e.key === 'Escape' && alvo.id === 'tarefasBusca') { alvo.value = ''; estado.busca = ''; desenhar(); alvo.blur(); }
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'n' || e.key === 'N') {
    e.preventDefault();
    if (e.shiftKey) T.abrirEditor({ preset: { data: estado.filtro.chave === 'hoje' ? hojeDia() : null } });
    else $('tarefasRapida')?.focus();
  } else if (e.key === '/') { e.preventDefault(); $('tarefasBusca')?.focus(); }
  else if (e.key === '1') { estado.visao = 'lista'; desenhar(); }
  else if (e.key === '2') { estado.visao = 'quadro'; desenhar(); }
  else if (e.key === '?') { mostrarAtalhos(); }
}

// ------------------------------------------------------------ início

function iniciar() {
  document.querySelectorAll('.animate-fade-in-up').forEach((el, i) => {
    setTimeout(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; }, i * 80);
  });
  try {
    const salvo = JSON.parse(localStorage.getItem('tarefas.preferencias') || '{}');
    if (salvo.visao) estado.visao = salvo.visao;
    if (salvo.ordem) estado.ordem = salvo.ordem;
  } catch (_) { /* padrão */ }
  $('tarefasOrdem').value = estado.ordem;
  const guardar = () => { try { localStorage.setItem('tarefas.preferencias', JSON.stringify({ visao: estado.visao, ordem: estado.ordem })); } catch (_) { /* sem problema */ } };

  // Vindo de outro lugar (sino, Dashboard) com um filtro/uma tarefa pedida.
  const pedido = window.tarefasPedido;
  window.tarefasPedido = null;
  if (pedido?.filtro) estado.filtro = { tipo: 'inteligente', chave: pedido.filtro };

  $('tarefasBtnNova').addEventListener('click', () => T.abrirEditor({ preset: { data: estado.filtro.chave === 'hoje' ? hojeDia() : estado.filtro.chave === 'semdata' ? null : undefined, lista_id: estado.filtro.tipo === 'lista' ? Number(estado.filtro.id) : null } }));
  $('tarefasBtnEstatisticas').addEventListener('click', abrirEstatisticas);
  $('tarefasBtnAutomacoes').addEventListener('click', abrirAutomacoes);
  $('tarefasNovaLista').addEventListener('click', novaLista);
  $('tarefasAjuda').addEventListener('click', mostrarAtalhos);
  $('tarefasBusca').addEventListener('input', e => { estado.busca = e.target.value; desenhar(); });
  $('tarefasOrdem').addEventListener('change', e => { estado.ordem = e.target.value; guardar(); desenhar(); });
  $('tarefasPessoa').addEventListener('change', e => { estado.pessoa = e.target.value; carregar(); });
  document.querySelectorAll('[data-visao]').forEach(b => b.addEventListener('click', () => { estado.visao = b.dataset.visao; guardar(); desenhar(); }));
  const rapida = $('tarefasRapida');
  rapida.addEventListener('input', previaRapida);
  rapida.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); criarRapida({ completa: e.shiftKey }); }
    if (e.key === 'Escape') { rapida.value = ''; previaRapida(); rapida.blur(); }
  });
  document.addEventListener('keydown', aoTeclar);

  let espera = null;
  const aoMudar = () => {
    if (!document.body.contains($('tarefasConteudo'))) { window.removeEventListener('tarefas:mudou', aoMudar); return; }
    clearTimeout(espera);
    espera = setTimeout(() => carregar({ silencioso: true }), 150);
  };
  window.addEventListener('tarefas:mudou', aoMudar);

  desenhar();
  return carregar().then(() => {
    // Todos que veem Tarefas abrem as automáticas (para ligar/desligar as suas).
    $('tarefasBtnAutomacoes').hidden = !estado.ctx?.pode?.ver;
    if (!estado.ctx?.pode?.criar) document.querySelector('.tarefas-rapida')?.setAttribute('hidden', '');
    if (pedido?.abrir) T.abrirEditor({ id: pedido.abrir, aba: pedido.aba || 'detalhes', foco: pedido.foco || null });
  });
}

// O menu espera esta promessa antes de tirar a máscara de carregamento.
const modulo = document.querySelector('.modulo-container.tarefas-modulo');
const pronto = iniciar();
if (modulo) modulo.moduleReadyPromise = pronto;
