// Módulo Calendário (CRM): mês, semana, dia, agenda e equipe. Mostra as
// tarefas (com o próximo passo das prospecções), as atividades feitas nas
// fichas (ligações, visitas...) e os marcos do histórico (funil, orçamento,
// conversão), mais os feriados. Arrastar reagenda; esticar muda a duração.
// Editor e conclusão: src/js/utils/tarefas-ui.js.

const T = window.TarefasUI;
const { h, icone } = T;

// Zoom da grade de horas (Ctrl + rolagem, ou os botões − +): quantos px vale
// uma hora. Afastado, o rótulo é de hora em hora; chegando perto, de 30 em 30
// e depois de 15 em 15 minutos — e o arrastar fica mais fino (5 min).
const ZOOM = [48, 64, 96, 128, 192, 256];
const horaPx = () => ZOOM[estado.zoom] || ZOOM[0];
const rotuloMin = () => (horaPx() >= 160 ? 15 : horaPx() >= 80 ? 30 : 60);
const passoMin = () => (horaPx() >= 160 ? 5 : 15);
const rotuloDoZoom = () => (rotuloMin() === 60 ? '1 h' : `${rotuloMin()} min`);
const PASSO_MIN = 15;         // bloco mais curto que a grade desenha
const MAX_NO_DIA = 4;         // no máximo, por dia, na visão de mês (menos se a tela for baixa)

const estado = {
  ctx: null,
  visao: 'mes',
  foco: T.hoje(),
  miniMes: T.hoje().slice(0, 7),
  pessoa: 'eu',
  camadas: { tarefas: true, atividades: true, marcos: true, feriados: true },
  concluidas: true,
  listasOcultas: new Set(),
  dados: { tarefas: [], atividades: [], marcos: [] },
  periodo: null,
  sqlPendente: false,
  carregando: true,
  rolouGrade: false,
  zoom: 0,
  minutoNoTopo: null          // onde a grade de horas estava rolada (sobrevive ao redesenho)
};

const CAMADAS = [
  ['tarefas', 'Tarefas', 'fa-list-check', '#d4c169', 'Suas tarefas e os próximos passos das prospecções'],
  ['atividades', 'Atividades feitas', 'fa-circle-check', '#4ade80', 'Ligações, visitas, e-mails registrados nas fichas'],
  ['marcos', 'Marcos do histórico', 'fa-flag', '#c4a7ff', 'Mudança no funil, orçamento, conversão'],
  ['feriados', 'Feriados', 'fa-umbrella-beach', '#fca5a5', 'Nacionais, pontos facultativos e municipais']
];
const ICONE_ATIVIDADE = { 'Ligação': 'fa-phone', 'E-mail': 'fa-envelope', 'Reunião': 'fa-users', 'WhatsApp': 'fa-comment-dots', 'Visita': 'fa-location-dot', 'Nota': 'fa-note-sticky', 'Proposta': 'fa-file-signature', 'Atividade realizada': 'fa-circle-check' };
const ICONE_MARCO = { etapa: 'fa-filter', orcamento: 'fa-file-invoice-dollar', conversao: 'fa-handshake', arquivamento: 'fa-box-archive' };

const $ = id => document.getElementById(id);
const aberta = t => ['a_fazer', 'em_andamento', 'aguardando'].includes(t.status);
const minutos = hora => (hora ? T.minutosDaHora(hora) : 0);

// ------------------------------------------------------------ período

function periodoDaVisao() {
  const foco = estado.foco;
  if (estado.visao === 'mes') {
    const inicio = T.inicioDaSemana(`${foco.slice(0, 7)}-01`);
    return { de: inicio, ate: T.somarDias(inicio, 41) };
  }
  if (estado.visao === 'semana') {
    const inicio = T.inicioDaSemana(foco);
    return { de: inicio, ate: T.somarDias(inicio, 6) };
  }
  if (estado.visao === 'agenda') return { de: foco, ate: T.somarDias(foco, 30) };
  return { de: foco, ate: foco };
}

function tituloDaVisao() {
  const foco = estado.foco;
  const { de, ate } = periodoDaVisao();
  const mes = d => T.MESES[Number(d.slice(5, 7)) - 1];
  if (estado.visao === 'mes') return T.mesAno(Number(foco.slice(0, 4)), Number(foco.slice(5, 7)));
  if (estado.visao === 'semana') {
    if (de.slice(0, 7) === ate.slice(0, 7)) return `${Number(de.slice(8))} – ${Number(ate.slice(8))} de ${mes(de)} de ${ate.slice(0, 4)}`;
    return `${Number(de.slice(8))} de ${mes(de).slice(0, 3)} – ${Number(ate.slice(8))} de ${mes(ate).slice(0, 3)} de ${ate.slice(0, 4)}`;
  }
  if (estado.visao === 'agenda') return `Agenda · de ${T.dataCurta(de)} a ${T.dataCurta(ate)}`;
  return `${T.dataLonga(foco).replace(/^./, c => c.toUpperCase())} de ${foco.slice(0, 4)}`;
}

function andar(sentido) {
  const f = estado.foco;
  if (estado.visao === 'mes') estado.foco = T.somarMeses(`${f.slice(0, 7)}-01`, sentido);
  else if (estado.visao === 'semana') estado.foco = T.somarDias(f, 7 * sentido);
  else if (estado.visao === 'agenda') estado.foco = T.somarDias(f, 30 * sentido);
  else estado.foco = T.somarDias(f, sentido);
  estado.miniMes = estado.foco.slice(0, 7);
  carregar();
}

// ------------------------------------------------------------ dados

async function carregar() {
  const periodo = periodoDaVisao();
  estado.periodo = periodo;
  estado.carregando = true;
  desenhar();
  try {
    estado.ctx = await T.carregarContexto();
    if (estado.ctx.sql_pendente) {
      estado.sqlPendente = true;
    } else {
      const usuario = estado.visao === 'equipe' ? 'todos' : estado.pessoa;
      const r = await T.api(`/agenda?de=${periodo.de}&ate=${periodo.ate}&usuario=${encodeURIComponent(usuario)}`);
      if (estado.periodo !== periodo) return; // o usuário já navegou para outro período
      estado.sqlPendente = Boolean(r.sql_pendente);
      estado.dados = { tarefas: r.tarefas || [], atividades: r.atividades || [], marcos: r.marcos || [] };
    }
  } catch (err) {
    estado.sqlPendente = Boolean(err.sql_pendente);
    if (!err.sql_pendente) window.showToast?.(`Não foi possível carregar o calendário: ${err.message}`, 'error');
  } finally {
    estado.carregando = false;
  }
  await T.carregarFotos();
  desenhar();
}

// ------------------------------------------------------------ itens

function tituloDoMarco(m) {
  if (m.tipo === 'etapa') return `Funil: ${m.antes ? `${m.antes} → ` : ''}${m.depois || ''}`;
  if (m.tipo === 'conversao') return 'Virou cliente';
  if (m.tipo === 'arquivamento') return `Situação: ${m.depois || ''}`;
  return [m.titulo, m.depois && m.depois !== m.titulo ? m.depois : null].filter(Boolean).join(': ');
}

function itens({ todasAsCamadas = false } = {}) {
  const saida = [];
  const ligada = chave => todasAsCamadas || estado.camadas[chave];
  const listas = new Map((estado.ctx?.listas || []).map(l => [Number(l.id), l]));
  if (ligada('tarefas')) {
    for (const t of estado.dados.tarefas) {
      if (!estado.concluidas && t.status === 'concluida') continue;
      if (t.lista_id && estado.listasOcultas.has(Number(t.lista_id))) continue;
      const dia = t.data || (t.concluida_em ? T.agoraEmBrasilia(new Date(t.concluida_em)).dia : null);
      if (!dia) continue;
      const lista = listas.get(Number(t.lista_id));
      saida.push({
        chave: `t${t.id}`, tipo: 'tarefa', dia, hora: t.data ? t.hora : null, duracao: t.duracao_min || 30,
        titulo: t.titulo, sub: (t.vinculos || []).map(v => v.nome).join(' · '), cor: lista?.cor || T.TIPOS[t.tipo]?.cor || '#d4c169',
        icone: t.origem === 'proximo_passo' ? 'fa-forward-step' : T.TIPOS[t.tipo]?.icone || 'fa-square-check', concluida: t.status === 'concluida', atrasada: T.atrasada(t),
        arrastavel: aberta(t) && Boolean(t.pode?.concluir), prioridade: t.prioridade, pessoa: t.responsavel_id, dados: t
      });
    }
  }
  if (ligada('atividades') && estado.concluidas) {
    for (const a of estado.dados.atividades) {
      saida.push({
        chave: `a${a.id}`, tipo: 'atividade', dia: a.dia, hora: a.hora, duracao: a.duracao_min || 30,
        titulo: `${a.tipo}: ${a.resumo}`, sub: a.registro, cor: '#4ade80', icone: ICONE_ATIVIDADE[a.tipo] || 'fa-circle-check',
        concluida: true, pessoa: a.usuario_id, dados: a
      });
    }
  }
  if (ligada('marcos')) {
    for (const m of estado.dados.marcos) {
      saida.push({
        chave: `m${m.id}`, tipo: 'marco', dia: m.dia, hora: m.hora, duracao: 30, titulo: tituloDoMarco(m), sub: m.registro,
        cor: '#c4a7ff', icone: ICONE_MARCO[m.tipo] || 'fa-flag', pessoa: m.usuario_id, dados: m
      });
    }
  }
  return saida;
}

const ordemNoDia = (a, b) => (a.hora ? 1 : 0) - (b.hora ? 1 : 0) || minutos(a.hora) - minutos(b.hora) || ['tarefa', 'atividade', 'marco'].indexOf(a.tipo) - ['tarefa', 'atividade', 'marco'].indexOf(b.tipo);

function feriadosDoPeriodo() {
  if (!estado.camadas.feriados || !estado.periodo) return new Map();
  const anos = new Set([estado.periodo.de.slice(0, 4), estado.periodo.ate.slice(0, 4)]);
  const mapa = new Map();
  for (const ano of anos) {
    for (const f of T.feriadosDoAno(Number(ano), { municipio: estado.ctx?.municipio })) {
      if (f.tipo === 'data') continue;
      if (!mapa.has(f.dia)) mapa.set(f.dia, []);
      mapa.get(f.dia).push(f);
    }
  }
  return mapa;
}

// ------------------------------------------------------------ interação comum

function abrirItem(it) {
  if (it.tipo === 'tarefa') { T.abrirEditor({ id: it.dados.id }); return; }
  const x = it.dados;
  const d = T.dialogo({ classe: 'tui-dialogo--concluir', rotulo: it.tipo === 'atividade' ? 'Atividade' : 'Marco' });
  const vinculo = { tipo: x.origem, id: x.registro_id, nome: x.registro };
  const linha = (rotulo, valor) => (valor ? h('div', { class: 'cal-ficha__linha' }, h('span', { text: rotulo }), h('strong', { text: valor })) : null);
  d.append(h('div', { class: 'tui-cartao tui-cartao--estreito' },
    h('header', { class: 'tui-concluir__topo' },
      h('span', { class: `tui-concluir__icone cal-ficha__icone cal-ficha__icone--${it.tipo}` }, icone(it.icone)),
      h('div', {}, h('h3', { class: 'tui-concluir__titulo', text: it.tipo === 'atividade' ? x.tipo : 'Marco do histórico' }), h('p', { class: 'tui-concluir__sub', text: it.titulo }))),
    h('div', { class: 'tui-concluir__corpo' },
      linha(x.origem === 'cliente' ? 'Cliente' : 'Prospecção', x.registro),
      linha('Quando', `${T.dataBr(x.dia)}${x.hora ? ` às ${x.hora}` : ''}`),
      linha('Quem', x.usuario),
      it.tipo === 'atividade' ? linha('Resumo', x.resumo) : linha('O que mudou', [x.antes, x.depois].filter(Boolean).join(' → ')),
      it.tipo === 'atividade' && x.detalhe ? h('p', { class: 'cal-ficha__detalhe', text: x.detalhe }) : null),
    h('footer', { class: 'tui-rodape' }, h('div', { class: 'tui-rodape__lado' }),
      h('div', { class: 'tui-rodape__lado' },
        h('button', { type: 'button', class: 'btn-neutral tui-botao', text: 'Fechar', on: { click: () => d.fechar() } }),
        h('button', { type: 'button', class: 'btn-primary tui-botao', on: { click: () => { d.fechar(); T.abrirVinculo(vinculo); } } }, icone('fa-arrow-up-right-from-square'), ` Abrir ${x.origem === 'cliente' ? 'cliente' : 'prospecção'}`)))));
  d.addEventListener('cancel', e => { e.preventDefault(); d.fechar(); });
  d.showModal();
}

/** Criação rápida num dia/hora (clique no espaço vazio). */
function criarRapido(dia, hora = null) {
  if (!estado.ctx?.pode?.criar) return;
  const d = T.dialogo({ classe: 'tui-dialogo--concluir', rotulo: 'Nova tarefa' });
  const titulo = h('input', { class: 'tui-campo cal-rapido__titulo', type: 'text', maxLength: 200, placeholder: 'O que precisa ser feito?' });
  const horaCampo = h('input', { class: 'tui-campo', type: 'time', value: hora || '' });
  const criar = async () => {
    const r = T.interpretarTexto(titulo.value, { usuarios: estado.ctx.usuarios, listas: estado.ctx.listas, marcadores: estado.ctx.marcadores });
    if (!r.titulo) { titulo.focus(); return; }
    const h2 = horaCampo.value || r.hora || null;
    try {
      await T.api('', { method: 'POST', corpo: { titulo: r.titulo, tipo: r.tipo || 'Tarefa', prioridade: r.prioridade || 'media', data: dia, hora: h2, duracao_min: h2 ? r.duracao_min || 30 : null, marcadores: r.marcadores.filter(m => m.id).map(m => m.id), lista_id: r.lista?.id || null } });
      d.fechar();
      window.showToast?.('Tarefa criada.', 'success');
      carregar();
    } catch (err) { window.showToast?.(err.message, 'error'); }
  };
  titulo.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); criar(); } });
  const feriado = feriadosDoPeriodo().get(dia)?.[0];
  d.append(h('div', { class: 'tui-cartao tui-cartao--estreito' },
    h('header', { class: 'tui-concluir__topo' }, h('span', { class: 'tui-concluir__icone cal-ficha__icone cal-ficha__icone--tarefa' }, icone('fa-plus')),
      h('div', {}, h('h3', { class: 'tui-concluir__titulo', text: 'Nova tarefa' }), h('p', { class: 'tui-concluir__sub', text: `${T.dataLonga(dia)}${hora ? ` · ${hora}` : ''}` }))),
    h('div', { class: 'tui-concluir__corpo' }, titulo, h('div', { class: 'tui-linha' }, h('span', { class: 'tui-rotulo-inline', text: 'Hora' }), horaCampo),
      feriado ? h('p', { class: 'tui-dica tui-dica--aviso', text: `Atenção: ${feriado.nome}${feriado.tipo === 'facultativo' ? ' (ponto facultativo)' : ''}` }) : null,
      h('p', { class: 'tui-dica', text: 'Dá para usar !alta, #marcador, ~lista e @pessoa no título.' })),
    h('footer', { class: 'tui-rodape' },
      h('div', { class: 'tui-rodape__lado' }, h('button', { type: 'button', class: 'btn-neutral tui-botao', on: { click: () => { d.fechar(); T.abrirEditor({ preset: { titulo: titulo.value, data: dia, hora: horaCampo.value || null } }); } } }, icone('fa-up-right-and-down-left-from-center'), ' Mais opções')),
      h('div', { class: 'tui-rodape__lado' }, h('button', { type: 'button', class: 'btn-neutral tui-botao', text: 'Cancelar', on: { click: () => d.fechar() } }), h('button', { type: 'button', class: 'btn-primary tui-botao', on: { click: criar } }, icone('fa-plus'), ' Criar')))));
  d.addEventListener('cancel', e => { e.preventDefault(); d.fechar(); });
  d.showModal();
  titulo.focus();
}

/** O "pílula" de um item (mês, faixa de dia inteiro, agenda). */
function pilula(it, { comHora = true } = {}) {
  const el = h('button', {
    type: 'button',
    class: `cal-pilula cal-pilula--${it.tipo}${it.concluida ? ' cal-pilula--feita' : ''}${it.atrasada ? ' cal-pilula--atrasada' : ''}`,
    title: [it.titulo, it.sub, it.hora ? `às ${it.hora}` : null, it.tipo === 'tarefa' && it.dados.responsavel ? `Responsável: ${it.dados.responsavel}` : null].filter(Boolean).join('\n'),
    dataset: { chave: it.chave }
  });
  el.style.setProperty('--cal-cor', it.cor);
  el.append(icone(it.concluida && it.tipo === 'tarefa' ? 'fa-circle-check' : it.icone));
  if (comHora && it.hora) el.append(h('span', { class: 'cal-pilula__hora', text: it.hora }));
  el.append(h('span', { class: 'cal-pilula__titulo', text: it.titulo }));
  el.addEventListener('click', e => { e.stopPropagation(); abrirItem(it); });
  if (it.arrastavel) {
    el.draggable = true;
    el.addEventListener('dragstart', e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', it.chave); el.classList.add('cal-arrastando'); arrastando = it; });
    el.addEventListener('dragend', () => { el.classList.remove('cal-arrastando'); arrastando = null; document.querySelectorAll('.cal-alvo').forEach(x => x.classList.remove('cal-alvo')); });
  }
  return el;
}

let arrastando = null;

/** Área que aceita soltar uma tarefa (dia do mês, faixa de dia inteiro). */
function aceitarSoltar(el, aoSoltar) {
  el.addEventListener('dragover', e => { if (!arrastando) return; e.preventDefault(); el.classList.add('cal-alvo'); });
  el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.classList.remove('cal-alvo'); });
  el.addEventListener('drop', async e => {
    e.preventDefault();
    el.classList.remove('cal-alvo');
    const it = arrastando;
    arrastando = null;
    if (it) await aoSoltar(it, e);
  });
}

// ------------------------------------------------------------ mês

function desenharMes(area) {
  const { de } = estado.periodo;
  const hoje = T.hoje();
  const mesAtual = estado.foco.slice(0, 7);
  const porDia = new Map();
  for (const it of itens()) { if (!porDia.has(it.dia)) porDia.set(it.dia, []); porDia.get(it.dia).push(it); }
  const feriados = feriadosDoPeriodo();
  // Quantos cabem por dia depende da altura da tela: o resto vira "+N mais".
  const alturaLinha = Math.max(56, ((area.clientHeight || 600) - 34) / 6);
  const cabem = Math.max(1, Math.floor((alturaLinha - 32) / 20));
  const grade = h('div', { class: 'cal-mes' });
  grade.append(h('div', { class: 'cal-mes__cabeca' }, T.DIAS_CURTOS.map(d => h('span', { text: d }))));
  const corpo = h('div', { class: 'cal-mes__corpo' });
  for (let i = 0; i < 42; i++) {
    const dia = T.somarDias(de, i);
    const lista = (porDia.get(dia) || []).sort(ordemNoDia);
    const doFeriado = feriados.get(dia) || [];
    const celula = h('div', {
      class: `cal-celula${dia.slice(0, 7) !== mesAtual ? ' cal-celula--fora' : ''}${dia === hoje ? ' cal-celula--hoje' : ''}${[0, 6].includes(T.diaDaSemana(dia)) ? ' cal-celula--fim' : ''}${doFeriado.some(f => f.tipo !== 'facultativo') ? ' cal-celula--feriado' : ''}`,
      dataset: { dia }
    });
    const topo = h('div', { class: 'cal-celula__topo' },
      h('button', { type: 'button', class: 'cal-celula__numero', text: String(Number(dia.slice(8))), title: 'Ver o dia', on: { click: e => { e.stopPropagation(); estado.foco = dia; estado.visao = 'dia'; carregar(); } } }),
      estado.ctx?.pode?.criar ? h('button', { type: 'button', class: 'cal-celula__mais', title: 'Nova tarefa neste dia', attrs: { 'aria-label': `Nova tarefa em ${T.dataBr(dia)}` }, on: { click: e => { e.stopPropagation(); criarRapido(dia); } } }, icone('fa-plus')) : null);
    celula.append(topo);
    for (const f of doFeriado) celula.append(h('span', { class: `cal-feriado cal-feriado--${f.tipo}`, text: f.nome, title: f.tipo === 'facultativo' ? 'Ponto facultativo' : f.tipo === 'municipal' ? 'Feriado municipal' : 'Feriado nacional' }));
    const eventos = h('div', { class: 'cal-celula__eventos' });
    const limite = Math.max(1, Math.min(MAX_NO_DIA, cabem - doFeriado.length));
    const mostrar = lista.length > limite ? Math.max(0, limite - 1) : lista.length;
    lista.slice(0, mostrar).forEach(it => eventos.append(pilula(it)));
    if (lista.length > mostrar) {
      eventos.append(h('button', { type: 'button', class: 'cal-celula__outros', text: `+${lista.length - mostrar} ${mostrar ? 'mais' : (lista.length - mostrar === 1 ? 'item' : 'itens')}`, on: { click: e => { e.stopPropagation(); estado.foco = dia; estado.visao = 'dia'; carregar(); } } }));
    }
    celula.append(eventos);
    celula.addEventListener('dblclick', () => criarRapido(dia));
    aceitarSoltar(celula, it => (it.dia !== dia ? T.mover(it.dados, { data: dia }) : null));
    corpo.append(celula);
  }
  grade.append(corpo);
  area.append(grade);
}

// ------------------------------------------------------------ semana / dia / equipe

/** Distribui os itens com hora que se sobrepõem em colunas lado a lado. */
function dispor(lista) {
  const ordenados = lista.slice().sort((a, b) => minutos(a.hora) - minutos(b.hora) || b.duracao - a.duracao);
  let grupo = [];
  let fimGrupo = -1;
  let colunas = [];
  const fechar = () => { const n = Math.max(1, ...grupo.map(x => x._col + 1)); grupo.forEach(x => { x._n = n; }); };
  for (const it of ordenados) {
    const ini = minutos(it.hora);
    const fim = ini + Math.max(PASSO_MIN, it.duracao);
    if (grupo.length && ini >= fimGrupo) { fechar(); grupo = []; colunas = []; }
    let col = colunas.findIndex(c => c <= ini);
    if (col === -1) { col = colunas.length; colunas.push(fim); } else colunas[col] = fim;
    it._col = col;
    grupo.push(it);
    fimGrupo = Math.max(fimGrupo, fim);
  }
  if (grupo.length) fechar();
  return ordenados;
}

function blocoNaGrade(it, { restritoAColuna = false } = {}) {
  const el = h('div', {
    class: `cal-evento cal-evento--${it.tipo}${it.concluida ? ' cal-evento--feito' : ''}${it.atrasada ? ' cal-evento--atrasado' : ''}${it.arrastavel ? ' cal-evento--arrastavel' : ''}`,
    attrs: { role: 'button', tabindex: '0', title: [it.titulo, it.sub, `${it.hora} · ${it.duracao} min`].filter(Boolean).join('\n') },
    dataset: { chave: it.chave }
  });
  el.style.setProperty('--cal-cor', it.cor);
  const ini = minutos(it.hora);
  el.style.top = `${(ini / 60) * horaPx()}px`;
  el.style.height = `${Math.max(20, (Math.max(PASSO_MIN, it.duracao) / 60) * horaPx() - 2)}px`;
  el.style.left = `calc(${(it._col / it._n) * 100}% + 2px)`;
  el.style.width = `calc(${100 / it._n}% - 4px)`;
  const hora = h('span', { class: 'cal-evento__hora', text: `${it.hora}${it.duracao >= 45 ? ` – ${T.horaDeMinutos(ini + it.duracao)}` : ''}` });
  el.append(h('span', { class: 'cal-evento__linha' }, icone(it.concluida && it.tipo === 'tarefa' ? 'fa-circle-check' : it.icone), h('span', { class: 'cal-evento__titulo', text: it.titulo })), hora);
  if (it.sub && it.duracao >= 45) el.append(h('span', { class: 'cal-evento__sub', text: it.sub }));
  if (it.arrastavel) el.append(h('span', { class: 'cal-evento__alca', title: 'Arraste para mudar a duração' }));
  el.addEventListener('keydown', e => { if (e.key === 'Enter') abrirItem(it); });

  // Arrastar com o ponteiro: mover (dia e hora) ou esticar (duração).
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const esticar = Boolean(e.target.closest('.cal-evento__alca'));
    const inicioX = e.clientX;
    const inicioY = e.clientY;
    const colunaOrigem = el.closest('.cal-dia-coluna');
    let novoDia = it.dia;
    let novoIni = ini;
    let novaDur = it.duracao;
    let moveu = false;
    const colunas = [...document.querySelectorAll('.cal-grade .cal-dia-coluna')];
    const aoMover = ev => {
      const dx = ev.clientX - inicioX;
      const dy = ev.clientY - inicioY;
      if (!moveu && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      if (!it.arrastavel) return;
      if (!moveu) { moveu = true; el.setPointerCapture(e.pointerId); el.classList.add('cal-evento--movendo'); }
      const passo = passoMin();
      const passos = Math.round(dy / (horaPx() / (60 / passo)));
      if (esticar) {
        novaDur = Math.max(passo, it.duracao + passos * passo);
        el.style.height = `${(novaDur / 60) * horaPx() - 2}px`;
        hora.textContent = `${it.hora} – ${T.horaDeMinutos(ini + novaDur)}`;
        return;
      }
      novoIni = Math.max(0, Math.min(1440 - passo, Math.round((ini + passos * passo) / passo) * passo));
      el.style.top = `${(novoIni / 60) * horaPx()}px`;
      hora.textContent = `${T.horaDeMinutos(novoIni)} – ${T.horaDeMinutos(novoIni + it.duracao)}`;
      if (!restritoAColuna) {
        const alvo = colunas.find(c => { const r = c.getBoundingClientRect(); return ev.clientX >= r.left && ev.clientX < r.right; });
        if (alvo && alvo.dataset.dia && alvo !== el.closest('.cal-dia-coluna')) {
          alvo.querySelector('.cal-dia-coluna__eventos').append(el);
          el.style.left = '2px';
          el.style.width = 'calc(100% - 4px)';
          novoDia = alvo.dataset.dia;
        }
      }
    };
    const aoSoltar = async () => {
      document.removeEventListener('pointermove', aoMover);
      document.removeEventListener('pointerup', aoSoltar);
      el.classList.remove('cal-evento--movendo');
      if (!moveu) { abrirItem(it); return; }
      const patch = esticar ? { duracao_min: novaDur } : { data: novoDia, hora: T.horaDeMinutos(novoIni) };
      const mudou = esticar ? novaDur !== it.duracao : (novoDia !== it.dia || novoIni !== ini);
      if (!mudou) return;
      const ok = await T.mover(it.dados, patch);
      if (!ok && colunaOrigem) desenhar();
    };
    document.addEventListener('pointermove', aoMover);
    document.addEventListener('pointerup', aoSoltar);
  });
  return el;
}

/**
 * A grade de horas. `colunas`: [{ chave, rotulo, sub, dia, filtro(item) }] —
 * os dias da semana, o dia, ou as pessoas da equipe.
 */
function desenharGrade(area, colunas, { equipe = false } = {}) {
  const hoje = T.hoje();
  const agora = T.agoraEmBrasilia();
  const todos = itens();
  const feriados = feriadosDoPeriodo();
  const px = horaPx();
  const moldura = h('div', {
    class: `cal-grade${equipe ? ' cal-grade--equipe' : ''}`,
    style: { '--cal-colunas': String(colunas.length), '--cal-hora': `${px}px`, '--cal-sub': `${(px * Math.min(30, rotuloMin())) / 60}px` }
  });

  // cabeçalho das colunas + faixa de dia inteiro
  const cabeca = h('div', { class: 'cal-grade__cabeca' }, h('div', { class: 'cal-grade__canto' }));
  const faixa = h('div', { class: 'cal-grade__faixa' }, h('div', { class: 'cal-grade__canto cal-grade__canto--faixa', text: 'dia todo' }));
  for (const c of colunas) {
    cabeca.append(h('div', { class: `cal-grade__coluna-cabeca${c.dia === hoje && !equipe ? ' cal-grade__coluna-cabeca--hoje' : ''}` },
      c.pessoa ? T.avatar(c.pessoa.id, c.pessoa.nome, { tamanho: 'p' }) : null,
      h('span', { class: 'cal-grade__dia-semana', text: c.rotulo }),
      c.sub ? h('button', { type: 'button', class: 'cal-grade__dia-numero', text: c.sub, title: equipe ? null : 'Ver o dia', on: { click: () => { if (!equipe) { estado.foco = c.dia; estado.visao = 'dia'; carregar(); } } } }) : null));
    const doDia = todos.filter(it => c.filtro(it) && !it.hora).sort(ordemNoDia);
    const celula = h('div', { class: 'cal-grade__faixa-celula', dataset: { dia: c.dia } });
    for (const f of (!equipe ? feriados.get(c.dia) || [] : [])) celula.append(h('span', { class: `cal-feriado cal-feriado--${f.tipo}`, text: f.nome }));
    doDia.forEach(it => celula.append(pilula(it, { comHora: false })));
    if (!equipe) aceitarSoltar(celula, it => T.mover(it.dados, { data: c.dia, hora: null }));
    faixa.append(celula);
  }

  // corpo com as horas
  const rolagem = h('div', { class: 'cal-grade__rolagem' });
  const corpo = h('div', { class: 'cal-grade__corpo', style: { height: `${24 * px}px` } });
  const passoRotulo = rotuloMin();
  const horas = h('div', { class: 'cal-grade__horas' }, Array.from({ length: 1440 / passoRotulo }, (_, i) => {
    const min = i * passoRotulo;
    const cheia = min % 60 === 0;
    return h('span', { class: cheia ? '' : 'cal-grade__hora--sub', style: { height: `${(px * passoRotulo) / 60}px` }, text: min ? T.horaDeMinutos(min) : '' });
  }));
  corpo.append(horas);
  for (const c of colunas) {
    const coluna = h('div', { class: `cal-dia-coluna${c.dia === hoje && !equipe ? ' cal-dia-coluna--hoje' : ''}${!equipe && [0, 6].includes(T.diaDaSemana(c.dia)) ? ' cal-dia-coluna--fim' : ''}`, dataset: { dia: c.dia } });
    const eventos = h('div', { class: 'cal-dia-coluna__eventos' });
    const doDia = dispor(todos.filter(it => c.filtro(it) && it.hora));
    doDia.forEach(it => eventos.append(blocoNaGrade(it, { restritoAColuna: equipe })));
    coluna.append(eventos);
    if (c.dia === hoje) {
      const linha = h('div', { class: 'cal-agora', style: { top: `${(agora.minutos / 60) * px}px` } });
      coluna.append(linha);
    }
    coluna.addEventListener('click', e => {
      if (e.target !== coluna && e.target !== eventos) return;
      const r = coluna.getBoundingClientRect();
      // Cria no degrau que está desenhado: 30 min afastado, 15 chegando perto.
      const degrau = passoRotulo === 60 ? 30 : passoRotulo;
      const min = Math.floor(((e.clientY - r.top) / px) * (60 / degrau)) * degrau;
      criarRapido(c.dia, T.horaDeMinutos(Math.max(0, Math.min(1440 - degrau, min))));
    });
    if (!equipe) {
      // Soltar uma tarefa de dia inteiro na grade dá a ela uma hora.
      aceitarSoltar(coluna, (it, e) => {
        const r = coluna.getBoundingClientRect();
        const passo = passoMin();
        const min = Math.round(((e.clientY - r.top) / px) * (60 / passo)) * passo;
        return T.mover(it.dados, { data: c.dia, hora: T.horaDeMinutos(Math.max(0, Math.min(1440 - passo, min))), duracao_min: it.duracao || 30 });
      });
    }
    corpo.append(coluna);
  }
  rolagem.append(corpo);
  moldura.append(cabeca, faixa, rolagem);
  area.append(moldura);
  // Abre perto do horário de trabalho (ou de agora, se hoje estiver na tela);
  // depois, fica onde a pessoa deixou — mover uma tarefa redesenha a grade, e
  // voltar para as 7h a cada gesto seria perder o lugar.
  // (Na hora, sem esperar o próximo quadro: a grade já está na tela.)
  const alvoHora = estado.minutoNoTopo !== null
    ? estado.minutoNoTopo / 60
    : (colunas.some(c => c.dia === hoje) ? Math.max(0, agora.minutos / 60 - 2) : 7);
  rolagem.scrollTop = alvoHora * px;
  // Com o px DESTA grade: ao trocar o zoom, a grade velha ainda solta um
  // último "scroll" ao sair da tela, e medir com o px novo deslocava a hora.
  rolagem.addEventListener('scroll', () => {
    if (rolagem.isConnected) estado.minutoNoTopo = (rolagem.scrollTop / px) * 60;
  }, { passive: true });
  // Ctrl + rolagem aproxima/afasta, mantendo parado o horário sob o mouse.
  rolagem.addEventListener('wheel', e => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const y = e.clientY - rolagem.getBoundingClientRect().top;
    const minutoSobOMouse = ((rolagem.scrollTop + y) / horaPx()) * 60;
    if (!mudarZoom(e.deltaY < 0 ? 1 : -1)) return;
    estado.minutoNoTopo = Math.max(0, minutoSobOMouse - (y / horaPx()) * 60);
    desenhar();
  }, { passive: false });
}

/** Um degrau de zoom para mais (1) ou para menos (-1). Devolve se mudou. */
function mudarZoom(sentido) {
  const novo = Math.max(0, Math.min(ZOOM.length - 1, estado.zoom + sentido));
  if (novo === estado.zoom) return false;
  estado.zoom = novo;
  guardar();
  return true;
}

function desenharSemana(area) {
  const { de } = estado.periodo;
  desenharGrade(area, Array.from({ length: 7 }, (_, i) => {
    const dia = T.somarDias(de, i);
    return { chave: dia, dia, rotulo: T.DIAS_CURTOS[T.diaDaSemana(dia)], sub: String(Number(dia.slice(8))), filtro: it => it.dia === dia };
  }));
}

function desenharDia(area) {
  const dia = estado.foco;
  desenharGrade(area, [{ chave: dia, dia, rotulo: T.DIAS_LONGOS[T.diaDaSemana(dia)], sub: String(Number(dia.slice(8))), filtro: it => it.dia === dia }]);
}

function desenharEquipe(area) {
  const dia = estado.foco;
  const ctx = estado.ctx;
  const pessoas = (ctx.usuarios || []).filter(u => (ctx.visiveis || []).includes(Number(u.id)));
  if (!pessoas.length) { area.append(h('div', { class: 'tui-vazio' }, icone('fa-users'), h('p', { text: 'Ninguém para mostrar.' }))); return; }
  desenharGrade(area, pessoas.map(p => ({
    chave: String(p.id), dia, rotulo: p.nome.split(' ')[0], pessoa: p, filtro: it => it.dia === dia && Number(it.pessoa) === Number(p.id)
  })), { equipe: true });
}

// ------------------------------------------------------------ agenda

function desenharAgenda(area) {
  const { de, ate } = estado.periodo;
  const todos = itens();
  const feriados = feriadosDoPeriodo();
  const hoje = T.hoje();
  const lista = h('div', { class: 'cal-agenda' });
  let algum = false;
  for (let dia = de; dia <= ate; dia = T.somarDias(dia, 1)) {
    const doDia = todos.filter(it => it.dia === dia).sort(ordemNoDia);
    const doFeriado = feriados.get(dia) || [];
    if (!doDia.length && !doFeriado.length) continue;
    algum = true;
    const bloco = h('section', { class: `cal-agenda__dia${dia === hoje ? ' cal-agenda__dia--hoje' : ''}` },
      h('header', { class: 'cal-agenda__data' },
        h('strong', { text: String(Number(dia.slice(8))) }),
        h('span', { text: `${T.DIAS_LONGOS[T.diaDaSemana(dia)]}${dia === hoje ? ' · hoje' : ''}` }),
        h('span', { class: 'cal-agenda__mes', text: T.MESES[Number(dia.slice(5, 7)) - 1] })));
    const itensEl = h('div', { class: 'cal-agenda__itens' });
    for (const f of doFeriado) itensEl.append(h('div', { class: `cal-agenda__feriado cal-feriado--${f.tipo}` }, icone('fa-umbrella-beach'), ` ${f.nome}${f.tipo === 'facultativo' ? ' (ponto facultativo)' : ''}`));
    for (const it of doDia) {
      if (it.tipo === 'tarefa') {
        const linha = T.linhaDeTarefa(it.dados, { ctx: estado.ctx });
        itensEl.append(h('div', { class: 'cal-agenda__linha' }, h('span', { class: 'cal-agenda__hora', text: it.hora || 'dia todo' }), linha));
      } else {
        const b = h('button', { type: 'button', class: `cal-agenda__evento cal-agenda__evento--${it.tipo}`, on: { click: () => abrirItem(it) } },
          icone(it.icone), h('span', { class: 'cal-agenda__evento-titulo', text: it.titulo }), it.sub ? h('span', { class: 'cal-agenda__evento-sub', text: it.sub }) : null,
          it.dados.usuario ? h('span', { class: 'cal-agenda__evento-sub', text: it.dados.usuario }) : null);
        b.style.setProperty('--cal-cor', it.cor);
        itensEl.append(h('div', { class: 'cal-agenda__linha' }, h('span', { class: 'cal-agenda__hora', text: it.hora || '' }), b));
      }
    }
    bloco.append(itensEl);
    lista.append(bloco);
  }
  if (!algum) lista.append(h('div', { class: 'tui-vazio' }, icone('fa-calendar-check'), h('p', { text: 'Nada nos próximos 30 dias.' })));
  area.append(lista);
}

// ------------------------------------------------------------ lateral

function desenharMini() {
  const alvo = $('calMini');
  const [ano, mes] = estado.miniMes.split('-').map(Number);
  const inicio = T.inicioDaSemana(`${estado.miniMes}-01`);
  const hoje = T.hoje();
  const comItens = new Set(itens().map(it => it.dia));
  const feriados = new Set(estado.camadas.feriados ? T.feriadosDoAno(ano, { municipio: estado.ctx?.municipio }).filter(f => f.tipo !== 'data').map(f => f.dia) : []);
  const { de, ate } = estado.periodo || periodoDaVisao();
  const grade = h('div', { class: 'cal-mini__grade' }, T.DIAS_CURTOS.map(d => h('span', { class: 'cal-mini__semana', text: d[0].toUpperCase() })));
  for (let i = 0; i < 42; i++) {
    const dia = T.somarDias(inicio, i);
    const b = h('button', {
      type: 'button', text: String(Number(dia.slice(8))), title: T.dataBr(dia),
      class: `cal-mini__dia${dia.slice(0, 7) !== estado.miniMes ? ' cal-mini__dia--fora' : ''}${dia === hoje ? ' cal-mini__dia--hoje' : ''}${dia >= de && dia <= ate && estado.visao !== 'mes' ? ' cal-mini__dia--periodo' : ''}${dia === estado.foco ? ' cal-mini__dia--foco' : ''}${feriados.has(dia) ? ' cal-mini__dia--feriado' : ''}`,
      on: { click: () => { estado.foco = dia; if (estado.visao === 'agenda') estado.visao = 'dia'; carregar(); } }
    });
    if (comItens.has(dia)) b.append(h('i', { class: 'cal-mini__ponto' }));
    grade.append(b);
  }
  const trocar = n => { estado.miniMes = T.somarMeses(`${estado.miniMes}-01`, n).slice(0, 7); desenharMini(); };
  alvo.replaceChildren(
    h('div', { class: 'cal-mini__topo' },
      h('button', { type: 'button', class: 'cal-icone-botao cal-icone-botao--p', attrs: { 'aria-label': 'Mês anterior' }, on: { click: () => trocar(-1) } }, icone('fa-chevron-left')),
      h('strong', { text: T.mesAno(ano, mes) }),
      h('button', { type: 'button', class: 'cal-icone-botao cal-icone-botao--p', attrs: { 'aria-label': 'Próximo mês' }, on: { click: () => trocar(1) } }, icone('fa-chevron-right'))),
    grade);
}

/**
 * O período que os números da lateral contam: na visão de mês, o mês inteiro
 * (sem os dias de outros meses que completam a grade); nas outras, o que está
 * na tela — a semana, o dia, os 30 dias da agenda.
 */
function periodoDeContagem() {
  const foco = estado.foco;
  const hoje = T.hoje();
  if (estado.visao === 'mes') {
    const de = `${foco.slice(0, 7)}-01`;
    return { de, ate: T.somarDias(T.somarMeses(de, 1), -1), rotulo: `em ${T.MESES[Number(foco.slice(5, 7)) - 1].toLowerCase()}` };
  }
  const { de, ate } = estado.periodo || periodoDaVisao();
  if (estado.visao === 'semana') return { de, ate, rotulo: hoje >= de && hoje <= ate ? 'nesta semana' : 'na semana' };
  if (estado.visao === 'agenda') return { de, ate, rotulo: 'em 30 dias' };
  return { de, ate, rotulo: de === hoje ? 'hoje' : 'no dia' };
}

function desenharLateral() {
  desenharMini();
  const periodo = periodoDeContagem();
  $('calContagemRotulo').textContent = `· ${periodo.rotulo}`;
  const noPeriodo = itens({ todasAsCamadas: true }).filter(it => it.dia >= periodo.de && it.dia <= periodo.ate);
  const conta = tipo => noPeriodo.filter(it => it.tipo === tipo).length;
  const anos = [...new Set([periodo.de.slice(0, 4), periodo.ate.slice(0, 4)])].map(Number);
  const feriados = anos.flatMap(a => T.feriadosDoAno(a, { municipio: estado.ctx?.municipio }))
    .filter(f => f.tipo !== 'data' && f.dia >= periodo.de && f.dia <= periodo.ate);
  // Um feriado de dois dias (Carnaval) conta por dia, como aparece na grade.
  const numeros = { tarefas: conta('tarefa'), atividades: conta('atividade'), marcos: conta('marco'), feriados: feriados.length };
  $('calCamadas').replaceChildren(...CAMADAS.map(([chave, rotulo, ic, cor, dica]) => {
    const marca = h('input', { type: 'checkbox', checked: estado.camadas[chave] });
    marca.addEventListener('change', () => { estado.camadas[chave] = marca.checked; desenhar(); });
    const n = numeros[chave];
    const rotuloEl = h('label', { class: 'cal-camada', title: `${dica} — ${n} ${periodo.rotulo}` }, marca, h('span', { class: 'cal-camada__cor', style: { background: cor } }, icone(ic)), h('span', { class: 'cal-camada__rotulo', text: rotulo }),
      estado.carregando && chave !== 'feriados' ? null : h('span', { class: `cal-camada__n${n ? '' : ' cal-camada__n--zero'}`, text: String(n) }));
    return rotuloEl;
  }));
  const listas = estado.ctx?.listas || [];
  $('calListasGrupo').hidden = !listas.length;
  $('calListas').replaceChildren(...listas.map(l => {
    const marca = h('input', { type: 'checkbox', checked: !estado.listasOcultas.has(Number(l.id)) });
    marca.addEventListener('change', () => { if (marca.checked) estado.listasOcultas.delete(Number(l.id)); else estado.listasOcultas.add(Number(l.id)); desenhar(); });
    return h('label', { class: 'cal-camada' }, marca, h('span', { class: 'cal-camada__ponto', style: { background: l.cor } }), h('span', { class: 'cal-camada__rotulo', text: l.nome }));
  }));
  $('calLegenda').replaceChildren(...Object.entries(T.TIPOS).map(([nome, t]) => h('span', { class: 'cal-legenda__item' }, h('i', { class: `fas ${t.icone}`, style: { color: t.cor } }), ` ${nome}`)));
}

function desenharPessoas() {
  const seletor = $('calPessoa');
  const ctx = estado.ctx;
  const botaoEquipe = document.querySelector('[data-visao="equipe"]');
  const podeVer = Boolean(ctx?.pode?.ver_outros);
  if (botaoEquipe) botaoEquipe.hidden = !podeVer;
  if (!podeVer) { seletor.hidden = true; return; }
  seletor.hidden = estado.visao === 'equipe';
  if (seletor.dataset.montado !== String(ctx.visiveis?.length)) {
    seletor.dataset.montado = String(ctx.visiveis?.length);
    const pessoas = (ctx.usuarios || []).filter(u => (ctx.visiveis || []).includes(Number(u.id)) && Number(u.id) !== Number(ctx.eu.id));
    seletor.replaceChildren(h('option', { value: 'eu', text: 'Minha agenda' }), h('option', { value: 'todos', text: ctx.eu.gestor ? 'Toda a equipe' : 'Todos que eu vejo' }), ...pessoas.map(u => h('option', { value: u.id, text: u.nome })));
  }
  seletor.value = estado.pessoa;
}

// ------------------------------------------------------------ desenhar

function desenhar() {
  if (!document.body.contains($('calArea'))) return;
  $('calAvisoSql').hidden = !estado.sqlPendente;
  $('calTitulo').textContent = tituloDaVisao();
  document.querySelectorAll('.cal-visoes [data-visao]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.visao === estado.visao)));
  desenharPessoas();
  const comGrade = ['semana', 'dia', 'equipe'].includes(estado.visao);
  $('calZoom').hidden = !comGrade;
  $('calZoomRotulo').textContent = rotuloDoZoom();
  $('calZoomMenos').disabled = estado.zoom === 0;
  $('calZoomMais').disabled = estado.zoom === ZOOM.length - 1;
  if (!estado.periodo) estado.periodo = periodoDaVisao();
  desenharLateral();
  const area = $('calArea');
  area.replaceChildren();
  area.dataset.visao = estado.visao;
  area.classList.toggle('cal-area--carregando', estado.carregando);
  if (estado.sqlPendente) { area.append(h('div', { class: 'tui-vazio' }, icone('fa-database'), h('p', { text: 'O calendário aparece aqui assim que o SQL for executado.' }))); return; }
  ({ mes: desenharMes, semana: desenharSemana, dia: desenharDia, agenda: desenharAgenda, equipe: desenharEquipe })[estado.visao](area);
}

// ------------------------------------------------------------ exportar

async function exportar() {
  const d = T.dialogo({ classe: 'tui-dialogo--concluir', rotulo: 'Exportar calendário' });
  const hoje = T.hoje();
  const opcao = (valor, titulo, dica, marcado) => h('label', { class: 'cal-exportar__opcao' }, h('input', { type: 'radio', name: 'calExportar', value: valor, checked: marcado }), h('span', {}, h('strong', { text: titulo }), h('small', { text: dica })));
  const grupo = h('div', { class: 'cal-exportar' },
    opcao('periodo', 'O que está na tela', `${T.dataBr(estado.periodo.de)} a ${T.dataBr(estado.periodo.ate)}`, true),
    opcao('90', 'Próximos 90 dias', `${T.dataBr(hoje)} a ${T.dataBr(T.somarDias(hoje, 90))}`, false),
    opcao('abertas', 'Todas as tarefas abertas', 'Com data, de qualquer dia', false));
  const baixar = async () => {
    const escolha = grupo.querySelector('input:checked')?.value;
    try {
      let tarefas;
      if (escolha === 'periodo') tarefas = estado.dados.tarefas;
      else if (escolha === '90') tarefas = (await T.api(`/agenda?de=${hoje}&ate=${T.somarDias(hoje, 90)}&camadas=tarefas&usuario=${encodeURIComponent(estado.pessoa)}`)).tarefas;
      else tarefas = (await T.api(`?usuario=${encodeURIComponent(estado.pessoa)}&concluidas=0`)).tarefas;
      const comData = (tarefas || []).filter(t => t.data && t.status !== 'cancelada');
      if (!comData.length) { window.showToast?.('Nenhuma tarefa com data para exportar.', 'info'); return; }
      if (await T.exportarIcs(comData)) {
        window.showToast?.(`${comData.length} tarefa(s) exportada(s). Abra o arquivo no Google Agenda ou no Outlook.`, 'success');
        d.fechar();
      }
    } catch (err) { window.showToast?.(err.message, 'error'); }
  };
  d.append(h('div', { class: 'tui-cartao tui-cartao--estreito' },
    h('header', { class: 'tui-concluir__topo' }, h('span', { class: 'tui-concluir__icone cal-ficha__icone cal-ficha__icone--marco' }, icone('fa-file-export')),
      h('div', {}, h('h3', { class: 'tui-concluir__titulo', text: 'Levar para o Google Agenda / Outlook' }), h('p', { class: 'tui-concluir__sub', text: 'Gera um arquivo .ics com as tarefas (lembretes e repetições vão junto)' }))),
    h('div', { class: 'tui-concluir__corpo' }, grupo,
      h('p', { class: 'tui-dica' }, icone('fa-circle-info'), ' Google Agenda: Configurações › Importar e exportar › Importar. Outlook: Arquivo › Abrir e exportar › Importar. No celular, abra o arquivo recebido por e-mail.')),
    h('footer', { class: 'tui-rodape' }, h('div', { class: 'tui-rodape__lado' }), h('div', { class: 'tui-rodape__lado' },
      h('button', { type: 'button', class: 'btn-neutral tui-botao', text: 'Cancelar', on: { click: () => d.fechar() } }),
      h('button', { type: 'button', class: 'btn-primary tui-botao', on: { click: baixar } }, icone('fa-download'), ' Baixar arquivo')))));
  d.addEventListener('cancel', e => { e.preventDefault(); d.fechar(); });
  d.showModal();
}

// ------------------------------------------------------------ atalhos

function mostrarAtalhos() {
  window.DialogPadrao?.info({
    title: 'Atalhos do calendário', icone: 'fa-keyboard', tom: 'info',
    secoes: [{
      titulo: 'Navegar', icone: 'fa-calendar',
      itens: [{ rotulo: '← →', valor: 'Período anterior / próximo' }, { rotulo: 'T', valor: 'Hoje' }, { rotulo: 'M · S · D · A · E', valor: 'Mês, semana, dia, agenda, equipe' }, { rotulo: 'N', valor: 'Nova tarefa' }]
    }, {
      titulo: 'Com o mouse', icone: 'fa-arrow-pointer',
      itens: [{ rotulo: 'Arrastar', valor: 'Muda o dia (e a hora, na semana e no dia)' }, { rotulo: 'Puxar a borda de baixo', valor: 'Muda a duração' }, { rotulo: 'Clique no espaço vazio', valor: 'Cria a tarefa naquele horário' }, { rotulo: 'Duplo clique no dia (mês)', valor: 'Cria a tarefa naquele dia' }, { rotulo: 'Ctrl + rolar', valor: 'Aproxima a grade de horas: de 1 h até 15 min' }]
    }]
  });
}

function aoTeclar(e) {
  if (!document.body.contains($('calArea'))) { document.removeEventListener('keydown', aoTeclar); return; }
  if (document.querySelector('dialog[open]')) return;
  const alvo = e.target;
  if (alvo && (alvo.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(alvo.tagName))) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tecla = e.key.toLowerCase();
  const visoes = { m: 'mes', s: 'semana', d: 'dia', a: 'agenda', e: 'equipe' };
  if (e.key === 'ArrowLeft') { e.preventDefault(); andar(-1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); andar(1); }
  else if (tecla === 't') { estado.foco = T.hoje(); estado.miniMes = estado.foco.slice(0, 7); carregar(); }
  else if (visoes[tecla] && (tecla !== 'e' || estado.ctx?.pode?.ver_outros)) { estado.visao = visoes[tecla]; guardar(); carregar(); }
  else if (tecla === 'n') { e.preventDefault(); T.abrirEditor({ preset: { data: estado.foco } }); }
  else if (e.key === '?') mostrarAtalhos();
}

function guardar() {
  try { localStorage.setItem('calendario.preferencias', JSON.stringify({ visao: estado.visao, camadas: estado.camadas, concluidas: estado.concluidas, zoom: estado.zoom })); } catch (_) { /* sem problema */ }
}

// ------------------------------------------------------------ início

function iniciar() {
  document.querySelectorAll('.animate-fade-in-up').forEach((el, i) => {
    setTimeout(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; }, i * 80);
  });
  try {
    const salvo = JSON.parse(localStorage.getItem('calendario.preferencias') || '{}');
    if (salvo.visao && salvo.visao !== 'equipe') estado.visao = salvo.visao;
    if (salvo.camadas) Object.assign(estado.camadas, salvo.camadas);
    if (typeof salvo.concluidas === 'boolean') estado.concluidas = salvo.concluidas;
    if (Number.isInteger(salvo.zoom) && salvo.zoom >= 0 && salvo.zoom < ZOOM.length) estado.zoom = salvo.zoom;
  } catch (_) { /* padrão */ }
  $('calConcluidas').checked = estado.concluidas;
  document.querySelectorAll('.cal-visoes [data-visao]').forEach(b => b.addEventListener('click', () => { estado.visao = b.dataset.visao; guardar(); carregar(); }));
  $('calAnterior').addEventListener('click', () => andar(-1));
  $('calProximo').addEventListener('click', () => andar(1));
  $('calHoje').addEventListener('click', () => { estado.foco = T.hoje(); estado.miniMes = estado.foco.slice(0, 7); carregar(); });
  $('calPessoa').addEventListener('change', e => { estado.pessoa = e.target.value; carregar(); });
  $('calConcluidas').addEventListener('change', e => { estado.concluidas = e.target.checked; guardar(); desenhar(); });
  $('calBtnNova').addEventListener('click', () => T.abrirEditor({ preset: { data: estado.visao === 'mes' ? T.hoje() : estado.foco } }));
  $('calBtnExportar').addEventListener('click', exportar);
  $('calAjuda').addEventListener('click', mostrarAtalhos);
  $('calZoomMenos').addEventListener('click', () => { if (mudarZoom(-1)) desenhar(); });
  $('calZoomMais').addEventListener('click', () => { if (mudarZoom(1)) desenhar(); });
  document.addEventListener('keydown', aoTeclar);
  const aoMudar = () => { if (!document.body.contains($('calArea'))) { window.removeEventListener('tarefas:mudou', aoMudar); return; } carregar(); };
  window.addEventListener('tarefas:mudou', aoMudar);
  // A linha de "agora" anda sozinha.
  const relogio = setInterval(() => {
    if (!document.body.contains($('calArea'))) { clearInterval(relogio); return; }
    const linha = document.querySelector('.cal-agora');
    if (linha) linha.style.top = `${(T.agoraEmBrasilia().minutos / 60) * horaPx()}px`;
  }, 60000);
  return carregar().then(() => {
    $('calBtnExportar').hidden = !estado.ctx?.pode?.exportar;
    $('calBtnNova').hidden = !estado.ctx?.pode?.criar;
  });
}

const modulo = document.querySelector('.modulo-container.calendario-modulo');
const pronto = iniciar();
if (modulo) modulo.moduleReadyPromise = pronto;
