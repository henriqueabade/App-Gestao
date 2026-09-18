/**
 * Regras das Tarefas e do Calendário — funções puras (sem API, sem Express).
 *
 * O controller (backend/tarefasController.js) lê o banco e chama estas
 * funções para decidir: o que é válido gravar, quem vê e quem mexe em cada
 * tarefa, quando ela está atrasada, quando nasce a próxima de uma série,
 * quais avisos o sino deve receber agora e os números das estatísticas.
 *
 * Datas: a tarefa guarda o DIA (`data`, 'AAAA-MM-DD') e a HORA ('HH:MM') de
 * Brasília, sem fuso. "Agora" também é lido em Brasília (America/Sao_Paulo),
 * qualquer que seja o fuso da máquina — o app roda em computadores diferentes
 * e todos precisam concordar sobre "atrasada".
 */

const STATUS = ['a_fazer', 'em_andamento', 'aguardando', 'concluida', 'cancelada'];
const ABERTOS = new Set(['a_fazer', 'em_andamento', 'aguardando']);
const PRIORIDADES = ['baixa', 'media', 'alta', 'urgente'];
const PESO_PRIORIDADE = { urgente: 4, alta: 3, media: 2, baixa: 1 };
const TIPOS = ['Tarefa', 'Ligação', 'E-mail', 'Reunião', 'WhatsApp', 'Visita', 'Proposta', 'Follow-up', 'Evento'];
const ROTULO_STATUS = {
  a_fazer: 'A fazer', em_andamento: 'Em andamento', aguardando: 'Aguardando',
  concluida: 'Concluída', cancelada: 'Cancelada'
};
const ROTULO_PRIORIDADE = { baixa: 'Baixa', media: 'Média', alta: 'Alta', urgente: 'Urgente' };

/** Tipo da tarefa → tipo da atividade registrada ao concluir (a lista da prospecção). */
const TIPO_DA_ATIVIDADE = {
  'Ligação': 'Ligação', 'E-mail': 'E-mail', 'Reunião': 'Reunião', 'WhatsApp': 'WhatsApp',
  'Visita': 'Visita', 'Proposta': 'Proposta'
};
const tipoDaAtividade = tipo => TIPO_DA_ATIVIDADE[tipo] || 'Atividade realizada';

/** Como terminou (o "resultado" pedido ao concluir). */
const RESULTADOS = {
  feito: 'Feito',
  atendeu: 'Falou com o cliente',
  nao_atendeu: 'Não atendeu',
  pediu_retorno: 'Pediu retorno',
  resposta_positiva: 'Resposta positiva',
  sem_interesse: 'Sem interesse',
  enviado: 'Enviado'
};

const LIMITE_TITULO = 200;
const HORA_PADRAO_LEMBRETE = '09:00';
const FUSO = 'America/Sao_Paulo';

function erro(status, mensagem) {
  const e = new Error(mensagem);
  e.status = status;
  return e;
}

const texto = v => (v === undefined || v === null ? '' : String(v).trim());
const mesmoId = (a, b) => a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b);
const idOuNulo = v => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : NaN;
};

// ------------------------------------------------------------ datas

const dois = n => String(n).padStart(2, '0');

/** Qualquer data que a API ou a tela mande → 'AAAA-MM-DD' (ou null). */
function diaISO(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    return `${valor.getFullYear()}-${dois(valor.getMonth() + 1)}-${dois(valor.getDate())}`;
  }
  const s = String(valor).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return validarDia(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return validarDia(Number(m[3]), Number(m[2]), Number(m[1]));
  return undefined;
}

function validarDia(a, m, d) {
  const data = new Date(Date.UTC(a, m - 1, d));
  if (data.getUTCFullYear() !== a || data.getUTCMonth() !== m - 1 || data.getUTCDate() !== d) return undefined;
  return `${a}-${dois(m)}-${dois(d)}`;
}

/** 'HH:MM' (aceita 'HH:MM:SS', '9h', '9:5'); vazio → null; inválido → undefined. */
function horaHHMM(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const m = /^(\d{1,2})(?:[:h](\d{1,2}))?(?::\d{2})?h?$/i.exec(String(valor).trim());
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (h > 23 || min > 59) return undefined;
  return `${dois(h)}:${dois(min)}`;
}

const minutosDaHora = hora => {
  const [h, m] = String(hora).split(':').map(Number);
  return h * 60 + m;
};

/** "Agora" em Brasília: { dia: 'AAAA-MM-DD', minutos: 0..1439 }. */
function agoraEmBrasilia(agora = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(agora);
  const p = Object.fromEntries(partes.map(x => [x.type, x.value]));
  return { dia: `${p.year}-${p.month}-${p.day}`, minutos: Number(p.hour) * 60 + Number(p.minute) };
}

/** Soma dias a 'AAAA-MM-DD' (sem fuso: conta em UTC). */
function somarDias(dia, n) {
  const [a, m, d] = dia.split('-').map(Number);
  const data = new Date(Date.UTC(a, m - 1, d + n));
  return `${data.getUTCFullYear()}-${dois(data.getUTCMonth() + 1)}-${dois(data.getUTCDate())}`;
}

/** 0 = domingo ... 6 = sábado. */
const diaDaSemana = dia => {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
};

const diasEntre = (de, ate) => {
  const [a1, m1, d1] = de.split('-').map(Number);
  const [a2, m2, d2] = ate.split('-').map(Number);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86400000);
};

const ultimoDiaDoMes = (a, m) => new Date(Date.UTC(a, m, 0)).getUTCDate();

// ------------------------------------------------------------ perfil

/** Admin ou Sup Admin: veem tudo e atribuem a qualquer um, por natureza. */
function ehGestor(usuario) {
  const perfil = texto(usuario?.perfil ?? usuario?.tipo_usuario ?? usuario?.role)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s._-]+/g, '').toLowerCase();
  return ['supadmin', 'superadmin', 'admin', 'administrador', 'administrator'].includes(perfil);
}

// ------------------------------------------------------------ recorrência

const FREQUENCIAS = ['diaria', 'semanal', 'mensal', 'anual'];

/** Recorrência válida (ou null). Lança 400 com o motivo. */
function normalizarRecorrencia(bruta) {
  if (bruta === null || bruta === undefined || bruta === '' || bruta === false) return null;
  let r = bruta;
  if (typeof r === 'string') {
    try { r = JSON.parse(r); } catch (_) { throw erro(400, 'Recorrência inválida.'); }
  }
  if (!r || typeof r !== 'object') throw erro(400, 'Recorrência inválida.');
  if (!FREQUENCIAS.includes(r.freq)) throw erro(400, 'Frequência da recorrência inválida (diária, semanal, mensal ou anual).');
  const intervalo = Number(r.intervalo || 1);
  if (!Number.isInteger(intervalo) || intervalo < 1 || intervalo > 99) throw erro(400, 'O intervalo da recorrência vai de 1 a 99.');
  const saida = { freq: r.freq, intervalo };
  if (r.freq === 'diaria' && r.somente_uteis) saida.somente_uteis = true;
  if (r.freq === 'semanal') {
    const dias = [...new Set((Array.isArray(r.dias_semana) ? r.dias_semana : []).map(Number))]
      .filter(d => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b);
    if (dias.length) saida.dias_semana = dias;
  }
  if (r.freq === 'mensal' && r.modo === 'posicao') saida.modo = 'posicao';
  const fim = r.fim && typeof r.fim === 'object' ? r.fim : { tipo: 'nunca' };
  if (fim.tipo === 'data') {
    const data = diaISO(fim.data);
    if (!data) throw erro(400, 'Informe a data final da recorrência.');
    saida.fim = { tipo: 'data', data };
  } else if (fim.tipo === 'vezes') {
    const vezes = Number(fim.vezes);
    if (!Number.isInteger(vezes) || vezes < 2 || vezes > 999) throw erro(400, 'O número de repetições vai de 2 a 999.');
    saida.fim = { tipo: 'vezes', vezes };
  } else {
    saida.fim = { tipo: 'nunca' };
  }
  saida.ocorrencia = Number.isInteger(Number(r.ocorrencia)) && Number(r.ocorrencia) > 0 ? Number(r.ocorrencia) : 1;
  return saida;
}

/** Posição do dia no mês: 1..4, ou -1 para "a última" (ex.: última sexta). */
function posicaoNoMes(dia) {
  const d = Number(dia.slice(8, 10));
  const [a, m] = dia.split('-').map(Number);
  if (d + 7 > ultimoDiaDoMes(a, m)) return -1;
  return Math.ceil(d / 7);
}

function diaNaPosicao(a, m, diaSemana, posicao) {
  const ultimo = ultimoDiaDoMes(a, m);
  if (posicao === -1) {
    for (let d = ultimo; d > ultimo - 7; d--) {
      const dia = `${a}-${dois(m)}-${dois(d)}`;
      if (diaDaSemana(dia) === diaSemana) return dia;
    }
  }
  let conta = 0;
  for (let d = 1; d <= ultimo; d++) {
    const dia = `${a}-${dois(m)}-${dois(d)}`;
    if (diaDaSemana(dia) === diaSemana && ++conta === posicao) return dia;
  }
  return null;
}

/** O dia seguinte da série a partir de `dia` (sem olhar o fim). */
function passoDaSerie(dia, r) {
  const n = r.intervalo || 1;
  if (r.freq === 'diaria') {
    let prox = somarDias(dia, n);
    if (r.somente_uteis) while ([0, 6].includes(diaDaSemana(prox))) prox = somarDias(prox, 1);
    return prox;
  }
  if (r.freq === 'semanal') {
    const dias = r.dias_semana?.length ? r.dias_semana : [diaDaSemana(dia)];
    const inicioSemana = somarDias(dia, -diaDaSemana(dia));
    for (let i = 1; i <= 7 * n + 7; i++) {
      const candidato = somarDias(dia, i);
      const semanas = Math.floor(diasEntre(inicioSemana, candidato) / 7);
      if (semanas % n === 0 && dias.includes(diaDaSemana(candidato))) return candidato;
    }
    return somarDias(dia, 7 * n);
  }
  const [a, m, d] = dia.split('-').map(Number);
  if (r.freq === 'mensal') {
    const total = (m - 1) + n;
    const na = a + Math.floor(total / 12);
    const nm = (total % 12) + 1;
    if (r.modo === 'posicao') return diaNaPosicao(na, nm, diaDaSemana(dia), posicaoNoMes(dia));
    return `${na}-${dois(nm)}-${dois(Math.min(d, ultimoDiaDoMes(na, nm)))}`;
  }
  const na = a + n;
  return `${na}-${dois(m)}-${dois(Math.min(d, ultimoDiaDoMes(na, m)))}`;
}

/**
 * A próxima tarefa de uma série, ou null quando a série acabou. Ocorrências
 * que ficaram para trás (concluída com atraso) são puladas até hoje — ninguém
 * quer receber de uma vez as três segundas-feiras perdidas.
 * Devolve { data, ocorrencia }.
 */
function proximaOcorrencia(dia, recorrencia, hoje) {
  const r = normalizarRecorrencia(recorrencia);
  if (!r || !diaISO(dia)) return null;
  let prox = passoDaSerie(dia, r);
  let ocorrencia = (r.ocorrencia || 1) + 1;
  let voltas = 0;
  while (hoje && prox && prox < hoje && voltas++ < 1000) {
    prox = passoDaSerie(prox, r);
    ocorrencia++;
  }
  if (!prox) return null;
  if (r.fim.tipo === 'data' && prox > r.fim.data) return null;
  if (r.fim.tipo === 'vezes' && ocorrencia > r.fim.vezes) return null;
  return { data: prox, ocorrencia };
}

/** "Toda semana (seg, qua)", "A cada 2 meses", "Todo dia útil"... */
function descreverRecorrencia(recorrencia) {
  let r;
  try { r = normalizarRecorrencia(recorrencia); } catch (_) { return ''; }
  if (!r) return '';
  const n = r.intervalo;
  const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  let base;
  if (r.freq === 'diaria') base = r.somente_uteis ? 'Todo dia útil' : n === 1 ? 'Todo dia' : `A cada ${n} dias`;
  else if (r.freq === 'semanal') {
    base = n === 1 ? 'Toda semana' : `A cada ${n} semanas`;
    if (r.dias_semana?.length) base += ` (${r.dias_semana.map(d => DIAS[d]).join(', ')})`;
  } else if (r.freq === 'mensal') base = n === 1 ? 'Todo mês' : `A cada ${n} meses`;
  else base = n === 1 ? 'Todo ano' : `A cada ${n} anos`;
  if (r.fim.tipo === 'data') base += `, até ${r.fim.data.split('-').reverse().join('/')}`;
  if (r.fim.tipo === 'vezes') base += `, ${r.fim.vezes} vezes`;
  return base;
}

// ------------------------------------------------------------ validação

/**
 * Corpo da tela → colunas da tabela `tarefas`. `parcial`: só o que veio
 * (edição); sem `parcial`, título é obrigatório (criação). Lança 400.
 */
function normalizarTarefa(corpo = {}, { parcial = false } = {}) {
  const tem = chave => Object.prototype.hasOwnProperty.call(corpo, chave);
  const saida = {};

  if (!parcial || tem('titulo')) {
    const titulo = texto(corpo.titulo);
    if (!titulo) throw erro(400, 'Dê um título para a tarefa.');
    if (titulo.length > LIMITE_TITULO) throw erro(400, `O título passou de ${LIMITE_TITULO} caracteres.`);
    saida.titulo = titulo;
  }
  if (tem('descricao')) saida.descricao = texto(corpo.descricao) || null;
  if (tem('local')) saida.local = texto(corpo.local) || null;

  if (!parcial || tem('tipo')) {
    const tipo = texto(corpo.tipo) || 'Tarefa';
    if (!TIPOS.includes(tipo)) throw erro(400, `Tipo de tarefa inválido: ${tipo}.`);
    saida.tipo = tipo;
  }
  if (!parcial || tem('prioridade')) {
    const prioridade = texto(corpo.prioridade) || 'media';
    if (!PRIORIDADES.includes(prioridade)) throw erro(400, `Prioridade inválida: ${prioridade}.`);
    saida.prioridade = prioridade;
  }
  if (tem('status')) {
    const status = texto(corpo.status);
    if (!STATUS.includes(status)) throw erro(400, `Situação inválida: ${status}.`);
    saida.status = status;
  }

  if (tem('data')) {
    const data = diaISO(corpo.data);
    if (data === undefined) throw erro(400, 'Data inválida (use dd/mm/aaaa).');
    saida.data = data;
  }
  if (tem('hora')) {
    const hora = horaHHMM(corpo.hora);
    if (hora === undefined) throw erro(400, 'Hora inválida (use HH:MM).');
    saida.hora = hora;
  }
  if (tem('duracao_min')) {
    const d = corpo.duracao_min === null || corpo.duracao_min === '' ? null : Number(corpo.duracao_min);
    if (d !== null && (!Number.isInteger(d) || d < 5 || d > 1440)) throw erro(400, 'A duração vai de 5 minutos a 24 horas.');
    saida.duracao_min = d;
  }
  if (tem('lembrete_min')) {
    const l = corpo.lembrete_min === null || corpo.lembrete_min === '' ? null : Number(corpo.lembrete_min);
    if (l !== null && (!Number.isInteger(l) || l < 0 || l > 20160)) throw erro(400, 'Lembrete inválido.');
    saida.lembrete_min = l;
  }
  if (tem('recorrencia')) saida.recorrencia = normalizarRecorrencia(corpo.recorrencia);

  for (const chave of ['responsavel_id', 'lista_id', 'cliente_id', 'prospeccao_id', 'orcamento_id', 'pedido_id']) {
    if (!tem(chave)) continue;
    const id = idOuNulo(corpo[chave]);
    if (Number.isNaN(id)) throw erro(400, `Identificador inválido em ${chave}.`);
    saida[chave] = id;
  }
  if (tem('marcadores')) {
    const lista = Array.isArray(corpo.marcadores) ? corpo.marcadores : [];
    const ids = [...new Set(lista.map(Number))].filter(n => Number.isInteger(n) && n > 0);
    saida.marcadores = ids;
  }

  // Coerência: hora sem dia não existe; recorrência precisa de um dia de partida.
  const data = tem('data') ? saida.data : corpo.__data_atual;
  if (saida.hora && !data) throw erro(400, 'Escolha o dia antes da hora.');
  if (saida.recorrencia && !data) throw erro(400, 'A tarefa repetida precisa de uma data de início.');
  return saida;
}

// ------------------------------------------------------------ prazo

/** Início da tarefa em minutos desde o começo do dia (sem hora = fim do dia para "atrasada"). */
function atrasada(tarefa, agora = new Date()) {
  if (!ABERTOS.has(tarefa?.status || 'a_fazer')) return false;
  const dia = diaISO(tarefa?.data);
  if (!dia) return false;
  const { dia: hoje, minutos } = agoraEmBrasilia(agora);
  if (dia < hoje) return true;
  if (dia > hoje) return false;
  const hora = horaHHMM(tarefa.hora);
  return Boolean(hora) && minutosDaHora(hora) < minutos;
}

/** Em que grupo da lista a tarefa cai: atrasada, hoje, amanha, semana, depois, sem_data, concluida. */
function grupoDoPrazo(tarefa, agora = new Date()) {
  if (!ABERTOS.has(tarefa?.status || 'a_fazer')) return 'concluida';
  const dia = diaISO(tarefa?.data);
  if (!dia) return 'sem_data';
  if (atrasada(tarefa, agora)) return 'atrasada';
  const { dia: hoje } = agoraEmBrasilia(agora);
  const faltam = diasEntre(hoje, dia);
  if (faltam <= 0) return 'hoje';
  if (faltam === 1) return 'amanha';
  if (faltam <= 7) return 'semana';
  return 'depois';
}

/** Ordem da lista: sem data por último; depois dia, hora (sem hora vem antes), prioridade. */
function compararTarefas(a, b) {
  const da = diaISO(a.data) || '9999-12-31';
  const db = diaISO(b.data) || '9999-12-31';
  if (da !== db) return da < db ? -1 : 1;
  const ha = horaHHMM(a.hora) || '';
  const hb = horaHHMM(b.hora) || '';
  if (ha !== hb) return ha < hb ? -1 : 1;
  const pa = PESO_PRIORIDADE[a.prioridade] || 0;
  const pb = PESO_PRIORIDADE[b.prioridade] || 0;
  if (pa !== pb) return pb - pa;
  return Number(a.id) - Number(b.id);
}

// ------------------------------------------------------------ acesso

/**
 * Escopo de visão de quem pede: { gestor, todos, alvos: Set<id> }.
 * `permissaoVerOutros`: a ação "Ver tarefas de outros usuários" do perfil;
 * `linhas`: tarefa_visibilidade do usuário (alvo_id null = todos).
 */
function escopoDeVisao({ usuario, permissaoVerOutros = false, linhas = [] } = {}) {
  if (ehGestor(usuario)) return { gestor: true, todos: true, alvos: new Set() };
  if (!permissaoVerOutros) return { gestor: false, todos: false, alvos: new Set() };
  const minhas = (Array.isArray(linhas) ? linhas : []).filter(l => mesmoId(l.usuario_id, usuario?.id));
  return {
    gestor: false,
    todos: minhas.some(l => l.alvo_id === null || l.alvo_id === undefined),
    alvos: new Set(minhas.filter(l => l.alvo_id !== null && l.alvo_id !== undefined).map(l => Number(l.alvo_id)))
  };
}

/** Os usuários cuja agenda o escopo alcança (além do próprio). */
function podeVerUsuario(escopo, usuarioId, alvoId) {
  if (mesmoId(usuarioId, alvoId)) return true;
  return Boolean(escopo?.todos || escopo?.alvos?.has(Number(alvoId)));
}

/** Participação de um usuário numa tarefa: 'pendente' | 'aceito' | null. */
function participacao(participantes = [], tarefaId, usuarioId) {
  const p = participantes.find(x => mesmoId(x.tarefa_id, tarefaId) && mesmoId(x.usuario_id, usuarioId));
  return p && ['pendente', 'aceito'].includes(p.status) ? p.status : null;
}

/** Vê a tarefa? Quem fez, quem responde, quem participa (ou foi convidado) e quem tem o escopo. */
function podeVerTarefa(tarefa, { usuarioId, escopo, participantes = [] }) {
  if (!tarefa) return false;
  if (tarefa.excluida_em && !escopo?.gestor) return false;
  if (escopo?.gestor) return true;
  if (mesmoId(tarefa.criado_por, usuarioId) || mesmoId(tarefa.responsavel_id, usuarioId)) return true;
  if (participacao(participantes, tarefa.id, usuarioId)) return true;
  return podeVerUsuario(escopo, usuarioId, tarefa.responsavel_id);
}

/** Mexe na tarefa (editar, concluir, checklist)? Quem fez, quem responde, participante que aceitou, gestor. */
function podeMexerNaTarefa(tarefa, { usuarioId, escopo, participantes = [] }) {
  if (!tarefa || tarefa.excluida_em) return false;
  if (escopo?.gestor) return true;
  if (mesmoId(tarefa.criado_por, usuarioId) || mesmoId(tarefa.responsavel_id, usuarioId)) return true;
  return participacao(participantes, tarefa.id, usuarioId) === 'aceito';
}

/** Excluir: quem criou (sendo também o responsável ou gestor) ou gestor. */
function podeExcluirTarefa(tarefa, { usuarioId, escopo }) {
  if (!tarefa || tarefa.excluida_em) return false;
  if (escopo?.gestor) return true;
  return mesmoId(tarefa.criado_por, usuarioId) && (mesmoId(tarefa.responsavel_id, usuarioId) || !tarefa.responsavel_id);
}

/**
 * Para quem a tarefa pode ir. Sem poder atribuir, só para si. A trava vale
 * também na edição (trocar o responsável é atribuir).
 */
function conferirResponsavel(responsavelId, { usuarioId, podeAtribuir }) {
  const alvo = responsavelId === null || responsavelId === undefined ? Number(usuarioId) : Number(responsavelId);
  if (!mesmoId(alvo, usuarioId) && !podeAtribuir) {
    throw erro(403, 'Só Admin, Sup Admin ou quem tem "Atribuir tarefa" cria tarefa para outra pessoa. Para trabalhar junto, convide.');
  }
  return alvo;
}

// ------------------------------------------------------------ histórico da tarefa

const CAMPOS_DA_TAREFA = {
  titulo: 'Título', descricao: 'Descrição', tipo: 'Tipo', prioridade: 'Prioridade', status: 'Situação',
  data: 'Data', hora: 'Hora', duracao_min: 'Duração', lembrete_min: 'Lembrete', local: 'Local',
  responsavel_id: 'Responsável', lista_id: 'Lista', marcadores: 'Marcadores', recorrencia: 'Repetição',
  cliente_id: 'Cliente', prospeccao_id: 'Prospecção', orcamento_id: 'Orçamento', pedido_id: 'Pedido',
  acao_chave: 'Ação no sistema', acao_rotulo: 'Registro da ação'
};

/** Valor legível de um campo (nomes: { usuarios, listas, marcadores, vinculos } em Map). */
function legivelDaTarefa(campo, valor, nomes = {}) {
  if (valor === null || valor === undefined || valor === '' || (Array.isArray(valor) && !valor.length)) return null;
  switch (campo) {
    case 'data': return diaISO(valor)?.split('-').reverse().join('/') || String(valor);
    case 'hora': return horaHHMM(valor) || String(valor);
    case 'status': return ROTULO_STATUS[valor] || String(valor);
    case 'prioridade': return ROTULO_PRIORIDADE[valor] || String(valor);
    case 'duracao_min': return `${valor} min`;
    case 'lembrete_min': return Number(valor) === 0 ? 'Na hora' : `${valor} min antes`;
    case 'responsavel_id': return nomes.usuarios?.get(Number(valor)) || `#${valor}`;
    case 'lista_id': return nomes.listas?.get(Number(valor)) || `#${valor}`;
    case 'marcadores': return valor.map(v => nomes.marcadores?.get(Number(v)) || `#${v}`).join(', ');
    case 'recorrencia': return descreverRecorrencia(valor) || null;
    case 'acao_chave': return require('./tarefasAcoes').descreverAcao(valor)?.rotulo || String(valor);
    case 'cliente_id': case 'prospeccao_id': case 'orcamento_id': case 'pedido_id':
      return nomes.vinculos?.get(`${campo}:${valor}`) || `#${valor}`;
    default: return String(valor);
  }
}

/** Um evento por campo que mudou (só o que veio em `depois`). */
function diferencasDaTarefa(antes = {}, depois = {}, nomes = {}) {
  const eventos = [];
  const comparavel = (campo, v) => {
    if (campo === 'data') return diaISO(v) || null;
    if (campo === 'hora') return horaHHMM(v) || null;
    if (campo === 'marcadores') return JSON.stringify([...(v || [])].map(Number).sort((a, b) => a - b));
    if (campo === 'recorrencia') return v ? JSON.stringify(normalizarRecorrencia(v)) : null;
    return v === undefined || v === null || v === '' ? null : String(v);
  };
  for (const [campo, rotulo] of Object.entries(CAMPOS_DA_TAREFA)) {
    if (!(campo in depois) || depois[campo] === undefined) continue;
    if (comparavel(campo, antes[campo]) === comparavel(campo, depois[campo])) continue;
    eventos.push({
      tipo: campo === 'responsavel_id' ? 'responsavel' : campo === 'status' ? 'situacao' : 'campo',
      acao: campo === 'responsavel_id' ? 'atribuiu' : 'alterou',
      entidade: rotulo, campo,
      valor_anterior: legivelDaTarefa(campo, antes[campo], nomes),
      valor_novo: legivelDaTarefa(campo, depois[campo], nomes)
    });
  }
  return eventos;
}

// ------------------------------------------------------------ avisos

/** O instante do lembrete: { dia, minutos } (sem hora: a partir das 9h). */
function momentoDoLembrete(tarefa) {
  const dia = diaISO(tarefa?.data);
  if (!dia || tarefa.lembrete_min === null || tarefa.lembrete_min === undefined) return null;
  const inicio = minutosDaHora(horaHHMM(tarefa.hora) || HORA_PADRAO_LEMBRETE) - Number(tarefa.lembrete_min);
  const voltaDias = inicio < 0 ? Math.ceil(-inicio / 1440) : 0;
  return { dia: somarDias(dia, -voltaDias), minutos: inicio + voltaDias * 1440 };
}

const jaChegou = (momento, agora) => momento.dia < agora.dia || (momento.dia === agora.dia && momento.minutos <= agora.minutos);

/**
 * Os avisos que o sino deve ganhar agora para um usuário, sem repetir (a
 * `chave` casa com o índice único do banco):
 *   - lembrete: uma vez, quando chega a hora escolhida;
 *   - atraso: uma vez por dia enquanto a tarefa estiver aberta e atrasada.
 * `tarefas`: as que ele responde ou das quais participa (aceito).
 */
function avisosDevidos(tarefas = [], { usuarioId, agora = new Date(), jaEnviadas = new Set() } = {}) {
  const momento = agoraEmBrasilia(agora);
  const saida = [];
  for (const t of tarefas) {
    if (!t || t.excluida_em || !ABERTOS.has(t.status || 'a_fazer')) continue;
    const quando = [diaISO(t.data), horaHHMM(t.hora)].filter(Boolean).join(' ');
    const lembrete = momentoDoLembrete(t);
    if (lembrete && jaChegou(lembrete, momento) && !atrasada(t, agora)) {
      const chave = `lembrete:${t.id}:${quando}`;
      if (!jaEnviadas.has(chave)) {
        saida.push({
          chave, tipo: 'tarefa_lembrete', titulo: 'Lembrete de tarefa',
          mensagem: `${t.titulo}${horaHHMM(t.hora) ? ` — às ${horaHHMM(t.hora)}` : ' — hoje'}`,
          origem: 'tarefa', registro_id: t.id, usuario_id: usuarioId
        });
      }
    }
    if (atrasada(t, agora)) {
      const chave = `atraso:${t.id}:${momento.dia}`;
      if (!jaEnviadas.has(chave)) {
        const dias = diasEntre(diaISO(t.data), momento.dia);
        saida.push({
          chave, tipo: 'tarefa_atrasada', titulo: 'Tarefa atrasada',
          mensagem: `${t.titulo} — ${dias <= 0 ? 'venceu hoje' : dias === 1 ? 'venceu ontem' : `venceu há ${dias} dias`}`,
          origem: 'tarefa', registro_id: t.id, usuario_id: usuarioId
        });
      }
    }
  }
  return saida;
}

// ------------------------------------------------------------ resumo e estatísticas

/** "Meu dia": o que vence hoje, o que está atrasado, o que já foi feito hoje e os convites. */
function resumoDoDia(tarefas = [], { usuarioId, convites = 0, agora = new Date() } = {}) {
  const { dia: hoje, minutos } = agoraEmBrasilia(agora);
  const minhas = tarefas.filter(t => !t.excluida_em && mesmoId(t.responsavel_id, usuarioId));
  const abertas = minhas.filter(t => ABERTOS.has(t.status));
  const deHoje = abertas.filter(t => diaISO(t.data) === hoje);
  const atrasadas = abertas.filter(t => atrasada(t, agora));
  const concluidasHoje = minhas.filter(t => t.status === 'concluida' && t.concluida_em && agoraEmBrasilia(new Date(t.concluida_em)).dia === hoje);
  const proxima = deHoje
    .filter(t => horaHHMM(t.hora) && minutosDaHora(horaHHMM(t.hora)) >= minutos)
    .sort(compararTarefas)[0] || null;
  return {
    hoje: deHoje.length,
    atrasadas: atrasadas.length,
    concluidas_hoje: concluidasHoje.length,
    convites: Number(convites) || 0,
    proxima: proxima ? { id: proxima.id, titulo: proxima.titulo, hora: horaHHMM(proxima.hora) } : null
  };
}

/** Segunda-feira da semana de um dia. */
const inicioDaSemana = dia => somarDias(dia, -((diaDaSemana(dia) + 6) % 7));

/**
 * Números do painel de estatísticas no período [de, ate]: concluídas, no
 * prazo, atrasadas agora, tempo médio, por semana, por tipo e por pessoa.
 */
function montarEstatisticas(tarefas = [], { de, ate, agora = new Date(), nomes = new Map() } = {}) {
  const validas = tarefas.filter(t => !t.excluida_em);
  const diaDaConclusao = t => (t.concluida_em ? agoraEmBrasilia(new Date(t.concluida_em)).dia : null);
  const noPeriodo = dia => dia && (!de || dia >= de) && (!ate || dia <= ate);
  const concluidas = validas.filter(t => t.status === 'concluida' && noPeriodo(diaDaConclusao(t)));
  const noPrazo = concluidas.filter(t => !diaISO(t.data) || diaDaConclusao(t) <= diaISO(t.data));
  const abertas = validas.filter(t => ABERTOS.has(t.status));
  const atrasadasAgora = abertas.filter(t => atrasada(t, agora));
  const criadas = validas.filter(t => noPeriodo(t.criado_em ? agoraEmBrasilia(new Date(t.criado_em)).dia : null));
  const horas = concluidas
    .filter(t => t.criado_em && t.concluida_em)
    .map(t => (new Date(t.concluida_em) - new Date(t.criado_em)) / 3600000)
    .filter(h => h >= 0);

  const semanas = new Map();
  for (const t of concluidas) {
    const s = inicioDaSemana(diaDaConclusao(t));
    semanas.set(s, (semanas.get(s) || 0) + 1);
  }
  const porSemana = [];
  if (de && ate) {
    for (let s = inicioDaSemana(de); s <= ate; s = somarDias(s, 7)) porSemana.push({ semana: s, concluidas: semanas.get(s) || 0 });
  } else {
    for (const [semana, n] of [...semanas].sort()) porSemana.push({ semana, concluidas: n });
  }

  const porTipo = {};
  for (const t of concluidas) porTipo[t.tipo || 'Tarefa'] = (porTipo[t.tipo || 'Tarefa'] || 0) + 1;

  const pessoas = new Map();
  const pessoa = id => {
    const chave = id === null || id === undefined ? 0 : Number(id);
    if (!pessoas.has(chave)) pessoas.set(chave, { usuario_id: chave || null, nome: nomes.get(chave) || (chave ? `#${chave}` : 'Sem responsável'), abertas: 0, atrasadas: 0, concluidas: 0, no_prazo: 0 });
    return pessoas.get(chave);
  };
  for (const t of abertas) {
    const p = pessoa(t.responsavel_id);
    p.abertas++;
    if (atrasada(t, agora)) p.atrasadas++;
  }
  for (const t of concluidas) {
    const p = pessoa(t.responsavel_id);
    p.concluidas++;
    if (noPrazo.includes(t)) p.no_prazo++;
  }

  return {
    periodo: { de: de || null, ate: ate || null },
    criadas: criadas.length,
    concluidas: concluidas.length,
    no_prazo: noPrazo.length,
    taxa_no_prazo: concluidas.length ? Math.round((noPrazo.length / concluidas.length) * 100) : null,
    abertas: abertas.length,
    atrasadas: atrasadasAgora.length,
    horas_medias: horas.length ? Math.round((horas.reduce((s, h) => s + h, 0) / horas.length) * 10) / 10 : null,
    por_semana: porSemana,
    por_tipo: Object.entries(porTipo).map(([tipo, n]) => ({ tipo, concluidas: n })).sort((a, b) => b.concluidas - a.concluidas),
    por_pessoa: [...pessoas.values()].sort((a, b) => b.concluidas - a.concluidas || b.abertas - a.abertas)
  };
}

// ------------------------------------------------------------ automações

/** "Follow-up do orçamento {orcamento} — {cliente}" → com os nomes (o que faltar some com o traço). */
function tituloDaAutomacao(modelo, valores = {}) {
  const preenchido = String(modelo || '').replace(/\{(\w+)\}/g, (_, chave) => texto(valores[chave]));
  return preenchido
    .replace(/\s+—\s*$/g, '')
    .replace(/^\s*—\s+/g, '')
    .replace(/\s+—\s+—\s+/g, ' — ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, LIMITE_TITULO);
}

// ------------------------------------------------------------ atividade

/** Folga para o relógio da máquina de quem registra. */
const FOLGA_DO_RELOGIO_MS = 5 * 60 * 1000;

/**
 * Atividade (cliente ou prospecção) é o que JÁ aconteceu — e por isso é
 * sempre concluída. A data não pode estar no futuro: algo que ainda vai
 * acontecer é tarefa (ou o próximo passo). Devolve o instante em ISO (agora,
 * se não veio) ou lança 400.
 */
function quandoAconteceu(valor, agora = new Date()) {
  if (valor === undefined || valor === null || valor === '') return agora.toISOString();
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) throw erro(400, 'Data da atividade inválida.');
  if (d.getTime() > agora.getTime() + FOLGA_DO_RELOGIO_MS) {
    throw erro(400, 'A atividade registra o que já aconteceu: a data e a hora não podem estar no futuro. Para algo que ainda vai acontecer, agende uma tarefa ou o próximo passo.');
  }
  return d.toISOString();
}

module.exports = {
  quandoAconteceu,
  STATUS, ABERTOS, PRIORIDADES, TIPOS, RESULTADOS, ROTULO_STATUS, ROTULO_PRIORIDADE, FREQUENCIAS, CAMPOS_DA_TAREFA,
  erro, diaISO, horaHHMM, agoraEmBrasilia, somarDias, diaDaSemana, diasEntre,
  ehGestor, tipoDaAtividade,
  normalizarRecorrencia, proximaOcorrencia, descreverRecorrencia,
  normalizarTarefa, atrasada, grupoDoPrazo, compararTarefas,
  escopoDeVisao, podeVerUsuario, participacao, podeVerTarefa, podeMexerNaTarefa, podeExcluirTarefa, conferirResponsavel,
  legivelDaTarefa, diferencasDaTarefa,
  momentoDoLembrete, avisosDevidos, resumoDoDia, montarEstatisticas, tituloDaAutomacao
};
