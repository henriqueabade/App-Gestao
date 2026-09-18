/**
 * Tarefas — peças de tela usadas em todo o app (Tarefas, Calendário, fichas
 * de cliente e prospecção, sino e Dashboard).
 *
 *   TarefasUI.abrirEditor({ id } | { preset })    a tarefa inteira num diálogo
 *   TarefasUI.concluir(tarefa)                     resultado, nota e "agendar a próxima"
 *   TarefasUI.responderConvite(id, 'aceitar'|'recusar')
 *   TarefasUI.montarMeuDia(alvo)                   o cartão "Meu dia"
 *   TarefasUI.interpretarTexto(texto, contexto)    "Ligar ACME amanhã 14h !alta #vip ~Lista @Ana"
 *   TarefasUI.feriadosDoAno(ano, { municipio })    nacionais, facultativos e de BH
 *   TarefasUI.gerarIcs(tarefas)                    arquivo para Google Agenda/Outlook
 *
 * Toda mudança dispara `tarefas:mudou` em window (as telas abertas recarregam).
 * Visual em src/styles/tarefas-ui.css. Nada de innerHTML: texto entra por
 * textContent.
 */
(() => {
  if (window.TarefasUI) return;

  // ------------------------------------------------------------ constantes

  const TIPOS = {
    'Tarefa': { icone: 'fa-square-check', cor: '#8aa7f3' },
    'Ligação': { icone: 'fa-phone', cor: '#7dd3fc' },
    'E-mail': { icone: 'fa-envelope', cor: '#c4a7ff' },
    'Reunião': { icone: 'fa-users', cor: '#fdba74' },
    'WhatsApp': { icone: 'fa-comment-dots', cor: '#86efac' },
    'Visita': { icone: 'fa-location-dot', cor: '#f9a8d4' },
    'Proposta': { icone: 'fa-file-signature', cor: '#d4c169' },
    'Follow-up': { icone: 'fa-rotate-right', cor: '#a5b4fc' },
    'Evento': { icone: 'fa-calendar-day', cor: '#fca5a5' }
  };
  const PRIORIDADES = {
    urgente: { rotulo: 'Urgente', cor: '#ff5858', peso: 4 },
    alta: { rotulo: 'Alta', cor: '#fbbf24', peso: 3 },
    media: { rotulo: 'Média', cor: '#8aa7f3', peso: 2 },
    baixa: { rotulo: 'Baixa', cor: '#9ca3af', peso: 1 }
  };
  const STATUS = {
    a_fazer: { rotulo: 'A fazer', icone: 'fa-circle' },
    em_andamento: { rotulo: 'Em andamento', icone: 'fa-circle-half-stroke' },
    aguardando: { rotulo: 'Aguardando', icone: 'fa-hourglass-half' },
    concluida: { rotulo: 'Concluída', icone: 'fa-circle-check' },
    cancelada: { rotulo: 'Cancelada', icone: 'fa-ban' }
  };
  const RESULTADOS = {
    feito: { rotulo: 'Feito', icone: 'fa-check' },
    atendeu: { rotulo: 'Falou com o cliente', icone: 'fa-headset' },
    nao_atendeu: { rotulo: 'Não atendeu', icone: 'fa-phone-slash' },
    pediu_retorno: { rotulo: 'Pediu retorno', icone: 'fa-reply' },
    resposta_positiva: { rotulo: 'Resposta positiva', icone: 'fa-thumbs-up' },
    sem_interesse: { rotulo: 'Sem interesse', icone: 'fa-thumbs-down' },
    enviado: { rotulo: 'Enviado', icone: 'fa-paper-plane' }
  };
  const LEMBRETES = [
    [null, 'Sem lembrete'], [0, 'Na hora'], [5, '5 min antes'], [15, '15 min antes'], [30, '30 min antes'],
    [60, '1 hora antes'], [120, '2 horas antes'], [1440, '1 dia antes'], [2880, '2 dias antes']
  ];
  const DURACOES = [[15, '15 min'], [30, '30 min'], [45, '45 min'], [60, '1 h'], [90, '1h30'], [120, '2 h'], [180, '3 h'], [240, '4 h'], [480, '8 h']];
  const CORES_LISTA = ['#8aa7f3', '#a2ffa6', '#d4c169', '#ff8a8a', '#c4a7ff', '#7dd3fc', '#fdba74', '#f9a8d4'];
  const VINCULO = {
    cliente: { rotulo: 'Cliente', icone: 'fa-building' },
    prospeccao: { rotulo: 'Prospecção', icone: 'fa-bullseye' },
    orcamento: { rotulo: 'Orçamento', icone: 'fa-file-invoice-dollar' },
    pedido: { rotulo: 'Pedido', icone: 'fa-box' }
  };
  const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const DIAS_LONGOS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  // ------------------------------------------------------------ datas (Brasília)

  const dois = n => String(n).padStart(2, '0');

  /** { dia: 'AAAA-MM-DD', minutos } agora em Brasília (o app todo concorda sobre "hoje"). */
  function agoraEmBrasilia(agora = new Date()) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(agora).map(x => [x.type, x.value]));
    return { dia: `${p.year}-${p.month}-${p.day}`, minutos: Number(p.hour) * 60 + Number(p.minute) };
  }
  const hoje = () => agoraEmBrasilia().dia;

  function somarDias(dia, n) {
    const [a, m, d] = dia.split('-').map(Number);
    const x = new Date(Date.UTC(a, m - 1, d + n));
    return `${x.getUTCFullYear()}-${dois(x.getUTCMonth() + 1)}-${dois(x.getUTCDate())}`;
  }
  function somarMeses(dia, n) {
    const [a, m, d] = dia.split('-').map(Number);
    const total = m - 1 + n;
    const na = a + Math.floor(total / 12);
    const nm = ((total % 12) + 12) % 12 + 1;
    const ultimo = new Date(Date.UTC(na, nm, 0)).getUTCDate();
    return `${na}-${dois(nm)}-${dois(Math.min(d, ultimo))}`;
  }
  const diaDaSemana = dia => { const [a, m, d] = dia.split('-').map(Number); return new Date(Date.UTC(a, m - 1, d)).getUTCDay(); };
  const diasEntre = (de, ate) => {
    const [a1, m1, d1] = de.split('-').map(Number);
    const [a2, m2, d2] = ate.split('-').map(Number);
    return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86400000);
  };
  const inicioDaSemana = dia => somarDias(dia, -diaDaSemana(dia));
  const dataCurta = dia => (dia ? `${dia.slice(8, 10)}/${dia.slice(5, 7)}` : '');
  const dataBr = dia => (dia ? dia.split('-').reverse().join('/') : '');
  const dataLonga = dia => `${DIAS_LONGOS[diaDaSemana(dia)]}, ${Number(dia.slice(8, 10))} de ${MESES[Number(dia.slice(5, 7)) - 1]}`;
  const mesAno = (ano, mes) => `${MESES[mes - 1].replace(/^./, c => c.toUpperCase())} de ${ano}`;
  const minutosDaHora = hora => { const [h, m] = String(hora).split(':').map(Number); return h * 60 + (m || 0); };
  const horaDeMinutos = min => `${dois(Math.floor(min / 60) % 24)}:${dois(min % 60)}`;

  /** "Hoje 14:00", "Amanhã", "Ontem", "sex 25/09", "Atrasada · 3 dias". */
  function rotuloDoPrazo(t, dia = hoje()) {
    if (!t?.data) return 'Sem data';
    const hora = t.hora ? ` ${t.hora}` : '';
    const faltam = diasEntre(dia, t.data);
    if (faltam === 0) return `Hoje${hora}`;
    if (faltam === 1) return `Amanhã${hora}`;
    if (faltam === -1) return `Ontem${hora}`;
    if (faltam > 1 && faltam < 7) return `${DIAS_CURTOS[diaDaSemana(t.data)]} ${dataCurta(t.data)}${hora}`;
    return `${dataCurta(t.data)}${t.data.slice(0, 4) !== dia.slice(0, 4) ? `/${t.data.slice(0, 4)}` : ''}${hora}`;
  }

  /** Mesma regra do servidor: atrasada = aberta e o dia (ou a hora de hoje) passou. */
  function atrasada(t, agora = agoraEmBrasilia()) {
    if (!t?.data || !['a_fazer', 'em_andamento', 'aguardando'].includes(t.status || 'a_fazer')) return false;
    if (t.data < agora.dia) return true;
    return t.data === agora.dia && Boolean(t.hora) && minutosDaHora(t.hora) < agora.minutos;
  }

  // ------------------------------------------------------------ texto → tarefa

  const semAcento = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const DIAS_POR_NOME = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };
  const TIPO_POR_PALAVRA = [
    [/^(ligar|telefonar|ligacao)$/, 'Ligação'], [/^(e-?mail|emails?)$/, 'E-mail'], [/^(reuniao|reunir)$/, 'Reunião'],
    [/^(whats(app)?|zap|wpp)$/, 'WhatsApp'], [/^(visita|visitar)$/, 'Visita'], [/^(proposta|orcamento)$/, 'Proposta'],
    [/^(follow-?up|retornar|cobrar)$/, 'Follow-up'], [/^(evento)$/, 'Evento']
  ];

  /**
   * Criação rápida: tira do texto o que é data, hora, duração, prioridade (!),
   * marcador (#), lista (~) e pessoa (@) — o resto é o título. Pura.
   * ctx: { agora: {dia, minutos}, usuarios, listas, marcadores }
   */
  function interpretarTexto(textoBruto, ctx = {}) {
    const agora = ctx.agora || agoraEmBrasilia();
    const dia = agora.dia;
    let texto = ` ${String(textoBruto || '').replace(/\s+/g, ' ').trim()} `;
    const r = { titulo: '', data: null, hora: null, duracao_min: null, prioridade: null, tipo: null, marcadores: [], lista: null, pessoa: null, reconhecidos: [] };
    const tirar = (regex, fn) => {
      texto = texto.replace(regex, (...m) => { const ok = fn(...m); return ok === false ? m[0] : ' '; });
    };

    // prioridade
    tirar(/\s!(urgente|alta|m[eé]dia|baixa|!{0,2})(?=\s)/i, (_, p) => {
      const chave = { '': 'alta', '!': 'urgente', '!!': 'urgente' }[p] ?? semAcento(p);
      r.prioridade = chave;
      r.reconhecidos.push({ tipo: 'prioridade', texto: PRIORIDADES[chave].rotulo });
    });
    // marcadores
    tirar(/\s#([\wÀ-ÿ-]{1,40})(?=\s)/g, (_, nome) => {
      const achado = (ctx.marcadores || []).find(m => semAcento(m.nome) === semAcento(nome));
      r.marcadores.push(achado ? { id: achado.id, nome: achado.nome } : { id: null, nome });
      r.reconhecidos.push({ tipo: 'marcador', texto: `#${achado?.nome || nome}` });
    });
    // lista (~Nome ou ~"Nome com espaço")
    tirar(/\s~(?:"([^"]+)"|([\wÀ-ÿ-]+))(?=\s)/, (_, entre, simples) => {
      const nome = entre || simples;
      const achado = (ctx.listas || []).find(l => semAcento(l.nome) === semAcento(nome)) || (ctx.listas || []).find(l => semAcento(l.nome).startsWith(semAcento(nome)));
      if (!achado) return false;
      r.lista = { id: achado.id, nome: achado.nome };
      r.reconhecidos.push({ tipo: 'lista', texto: achado.nome });
    });
    // pessoa
    tirar(/\s@([\wÀ-ÿ.-]{2,40})(?=\s)/, (_, nome) => {
      const alvo = semAcento(nome);
      const achado = (ctx.usuarios || []).find(u => semAcento(u.nome) === alvo) || (ctx.usuarios || []).find(u => semAcento(u.nome).split(' ')[0] === alvo) || (ctx.usuarios || []).find(u => semAcento(u.nome).startsWith(alvo));
      if (!achado) return false;
      r.pessoa = { id: achado.id, nome: achado.nome };
      r.reconhecidos.push({ tipo: 'pessoa', texto: achado.nome });
    });
    // duração: "por 30min", "por 1h30", "por 2 horas"
    tirar(/\spor\s+(\d{1,2})\s*(?:h(?:oras?)?\s*(\d{1,2})?|(min(?:utos?)?))(?=\s)/i, (_, n, extra, min) => {
      r.duracao_min = min ? Number(n) : Number(n) * 60 + Number(extra || 0);
      r.reconhecidos.push({ tipo: 'duracao', texto: `${r.duracao_min} min` });
    });
    // hora: "às 14", "às 14h30", "14h", "14:30"
    tirar(/\s(?:[àa]s\s+)(\d{1,2})(?:[:h](\d{2}))?h?(?=\s)/i, (_, h, m) => {
      if (Number(h) > 23 || Number(m || 0) > 59) return false;
      r.hora = `${dois(h)}:${dois(m || 0)}`;
    });
    if (!r.hora) {
      tirar(/\s(\d{1,2})(?:h(\d{2})?|:(\d{2}))(?=\s)/i, (_, h, m1, m2) => {
        const m = m1 || m2 || 0;
        if (Number(h) > 23 || Number(m) > 59) return false;
        r.hora = `${dois(h)}:${dois(m)}`;
      });
    }
    // datas
    const achouData = (d, rotulo) => { r.data = d; r.reconhecidos.push({ tipo: 'data', texto: rotulo }); };
    tirar(/\s(hoje)(?=\s)/i, () => achouData(dia, 'Hoje'));
    if (!r.data) tirar(/\s(depois\s+de\s+amanh[ãa])(?=\s)/i, () => achouData(somarDias(dia, 2), 'Depois de amanhã'));
    if (!r.data) tirar(/\s(amanh[ãa])(?=\s)/i, () => achouData(somarDias(dia, 1), 'Amanhã'));
    if (!r.data) {
      tirar(/\s(?:(?:na|no|pr[óo]xim[ao])\s+)?(domingo|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado)(?:-feira)?(?:\s+que\s+vem)?(?=\s)/i, (m, nome) => {
        const alvo = DIAS_POR_NOME[semAcento(nome)];
        let falta = (alvo - diaDaSemana(dia) + 7) % 7;
        if (falta === 0 || /pr[óo]xim|que\s+vem/i.test(m)) falta = falta === 0 ? 7 : falta;
        achouData(somarDias(dia, falta), `${DIAS_CURTOS[alvo]} ${dataCurta(somarDias(dia, falta))}`);
      });
    }
    if (!r.data) tirar(/\s(?:em|daqui\s+a)\s+(\d{1,3})\s+dias?(?=\s)/i, (_, n) => achouData(somarDias(dia, Number(n)), `Em ${n} dias`));
    if (!r.data) tirar(/\s(semana\s+que\s+vem|pr[óo]xima\s+semana)(?=\s)/i, () => { const d = somarDias(dia, ((8 - diaDaSemana(dia)) % 7) || 7); achouData(d, `seg ${dataCurta(d)}`); });
    if (!r.data) tirar(/\s(m[êe]s\s+que\s+vem|pr[óo]ximo\s+m[êe]s)(?=\s)/i, () => { const d = somarMeses(dia, 1); achouData(d, dataCurta(d)); });
    if (!r.data) {
      tirar(/\s(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=\s)/, (_, d, m, a) => {
        let ano = a ? Number(a.length === 2 ? `20${a}` : a) : Number(dia.slice(0, 4));
        let cand = `${ano}-${dois(m)}-${dois(d)}`;
        const valida = x => { const [aa, mm, dd] = x.split('-').map(Number); const t = new Date(Date.UTC(aa, mm - 1, dd)); return t.getUTCMonth() === mm - 1 && t.getUTCDate() === dd; };
        if (!valida(cand)) return false;
        if (!a && cand < dia) { ano += 1; cand = `${ano}-${dois(m)}-${dois(d)}`; }
        achouData(cand, dataCurta(cand));
      });
    }
    if (!r.data) {
      tirar(/\s(?:no\s+)?dia\s+(\d{1,2})(?=\s)/i, (_, d) => {
        if (Number(d) < 1 || Number(d) > 31) return false;
        let cand = `${dia.slice(0, 7)}-${dois(d)}`;
        if (cand < dia) cand = somarMeses(`${dia.slice(0, 7)}-01`, 1).slice(0, 8) + dois(d);
        achouData(cand, dataCurta(cand));
      });
    }
    if (r.hora && !r.data) achouData(agora.minutos < minutosDaHora(r.hora) ? dia : somarDias(dia, 1), agora.minutos < minutosDaHora(r.hora) ? 'Hoje' : 'Amanhã');
    if (r.hora) r.reconhecidos.push({ tipo: 'hora', texto: r.hora });

    const titulo = texto.replace(/\s+/g, ' ').replace(/\s+([,.;:])/g, '$1').trim().replace(/^[-–—,:]+\s*|\s*[-–—,:]+$/g, '');
    r.titulo = titulo ? titulo.charAt(0).toUpperCase() + titulo.slice(1) : '';
    const primeira = semAcento(r.titulo.split(' ')[0] || '');
    const tipo = TIPO_POR_PALAVRA.find(([re]) => re.test(primeira));
    if (tipo) r.tipo = tipo[1];
    return r;
  }

  // ------------------------------------------------------------ feriados

  /** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher). */
  function pascoa(ano) {
    const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
    return `${ano}-${dois(mes)}-${dois(dia)}`;
  }

  const MUNICIPAIS = {
    // Belo Horizonte
    3106200: { nome: 'Belo Horizonte', fixos: [['08-15', 'Assunção de Nossa Senhora'], ['12-08', 'Imaculada Conceição']], corpusChristi: true }
  };

  /**
   * Feriados do ano: nacionais, pontos facultativos (Carnaval, Cinzas,
   * Corpus Christi) e, se a empresa é de Belo Horizonte, os municipais.
   * municipio: { codigo, nome } (Configuração fiscal). Pura.
   */
  function feriadosDoAno(ano, { municipio = null } = {}) {
    const lista = [
      ['01-01', 'Confraternização Universal'], ['04-21', 'Tiradentes'], ['05-01', 'Dia do Trabalho'],
      ['09-07', 'Independência do Brasil'], ['10-12', 'Nossa Senhora Aparecida'], ['11-02', 'Finados'],
      ['11-15', 'Proclamação da República'], ['11-20', 'Dia da Consciência Negra'], ['12-25', 'Natal']
    ].map(([md, nome]) => ({ dia: `${ano}-${md}`, nome, tipo: 'nacional' }));
    const p = pascoa(ano);
    const local = municipio ? (MUNICIPAIS[Number(municipio.codigo)] || Object.values(MUNICIPAIS).find(x => semAcento(x.nome) === semAcento(municipio.nome))) : null;
    lista.push(
      { dia: somarDias(p, -48), nome: 'Carnaval', tipo: 'facultativo' },
      { dia: somarDias(p, -47), nome: 'Carnaval', tipo: 'facultativo' },
      { dia: somarDias(p, -46), nome: 'Quarta-feira de Cinzas (até 14h)', tipo: 'facultativo' },
      { dia: somarDias(p, -2), nome: 'Sexta-feira Santa', tipo: 'nacional' },
      { dia: p, nome: 'Páscoa', tipo: 'data' },
      { dia: somarDias(p, 60), nome: 'Corpus Christi', tipo: local?.corpusChristi ? 'municipal' : 'facultativo' }
    );
    if (local) for (const [md, nome] of local.fixos) lista.push({ dia: `${ano}-${md}`, nome, tipo: 'municipal' });
    return lista.sort((a, b) => a.dia.localeCompare(b.dia));
  }

  // ------------------------------------------------------------ .ics

  const icsTexto = v => String(v ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  /** Dobra linhas de mais de 75 bytes (UTF-8), como pede a RFC 5545. */
  function dobrar(linha) {
    const partes = [];
    let atual = '';
    let bytes = 0;
    for (const ch of linha) {
      const n = new TextEncoder().encode(ch).length;
      if (bytes + n > (partes.length ? 74 : 75)) { partes.push(atual); atual = ''; bytes = 0; }
      atual += ch;
      bytes += n;
    }
    partes.push(atual);
    return partes.join('\r\n ');
  }
  const DIA_ICS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

  function regraIcs(r, t) {
    if (!r) return null;
    const partes = [`FREQ=${{ diaria: 'DAILY', semanal: 'WEEKLY', mensal: 'MONTHLY', anual: 'YEARLY' }[r.freq]}`];
    if ((r.intervalo || 1) > 1) partes.push(`INTERVAL=${r.intervalo}`);
    if (r.freq === 'diaria' && r.somente_uteis) partes.push('BYDAY=MO,TU,WE,TH,FR');
    if (r.freq === 'semanal' && r.dias_semana?.length) partes.push(`BYDAY=${r.dias_semana.map(d => DIA_ICS[d]).join(',')}`);
    if (r.freq === 'mensal' && r.modo === 'posicao' && t.data) {
      const d = Number(t.data.slice(8, 10));
      const [a, m] = t.data.split('-').map(Number);
      const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
      partes.push(`BYDAY=${d + 7 > ultimo ? -1 : Math.ceil(d / 7)}${DIA_ICS[diaDaSemana(t.data)]}`);
    }
    if (r.fim?.tipo === 'data') partes.push(`UNTIL=${r.fim.data.replace(/-/g, '')}`);
    if (r.fim?.tipo === 'vezes') partes.push(`COUNT=${Math.max(1, r.fim.vezes - (r.ocorrencia || 1) + 1)}`);
    return partes.join(';');
  }

  /** As tarefas com data → texto .ics (fuso de Brasília; sem hora = dia inteiro). Pura. */
  function gerarIcs(tarefas = [], { nome = 'Tarefas — Santíssimo Decor', agora = new Date() } = {}) {
    const carimbo = agora.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const linhas = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Santissimo Decor//Tarefas//PT-BR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      `X-WR-CALNAME:${icsTexto(nome)}`, 'X-WR-TIMEZONE:America/Sao_Paulo',
      'BEGIN:VTIMEZONE', 'TZID:America/Sao_Paulo', 'BEGIN:STANDARD', 'DTSTART:19700101T000000',
      'TZOFFSETFROM:-0300', 'TZOFFSETTO:-0300', 'TZNAME:-03', 'END:STANDARD', 'END:VTIMEZONE'
    ];
    for (const t of tarefas) {
      if (!t?.data) continue;
      const d = t.data.replace(/-/g, '');
      linhas.push('BEGIN:VEVENT', `UID:tarefa-${t.id}@santissimodecor`, `DTSTAMP:${carimbo}`);
      if (t.hora) {
        const inicio = minutosDaHora(t.hora);
        const fimMin = inicio + (Number(t.duracao_min) || 30);
        const diaFim = fimMin >= 1440 ? somarDias(t.data, 1).replace(/-/g, '') : d;
        linhas.push(`DTSTART;TZID=America/Sao_Paulo:${d}T${t.hora.replace(':', '')}00`, `DTEND;TZID=America/Sao_Paulo:${diaFim}T${horaDeMinutos(fimMin % 1440).replace(':', '')}00`);
      } else {
        linhas.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${somarDias(t.data, 1).replace(/-/g, '')}`);
      }
      const concluida = t.status === 'concluida';
      linhas.push(`SUMMARY:${icsTexto(`${concluida ? '✓ ' : ''}${t.titulo}`)}`);
      const descricao = [
        `${t.tipo || 'Tarefa'} · prioridade ${PRIORIDADES[t.prioridade]?.rotulo || 'Média'}`,
        ...(t.vinculos || []).map(v => `${VINCULO[v.tipo]?.rotulo || v.tipo}: ${v.nome}`),
        t.responsavel ? `Responsável: ${t.responsavel}` : null,
        t.descricao || null
      ].filter(Boolean).join('\n');
      linhas.push(`DESCRIPTION:${icsTexto(descricao)}`);
      if (t.local) linhas.push(`LOCATION:${icsTexto(t.local)}`);
      linhas.push(`STATUS:${t.status === 'cancelada' ? 'CANCELLED' : 'CONFIRMED'}`);
      const regra = regraIcs(t.recorrencia, t);
      if (regra && !concluida) linhas.push(`RRULE:${regra}`);
      if (t.lembrete_min !== null && t.lembrete_min !== undefined && !concluida) {
        linhas.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsTexto(t.titulo)}`, `TRIGGER:-PT${Number(t.lembrete_min)}M`, 'END:VALARM');
      }
      linhas.push('END:VEVENT');
    }
    linhas.push('END:VCALENDAR');
    return `${linhas.map(dobrar).join('\r\n')}\r\n`;
  }

  // ------------------------------------------------------------ API e contexto

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
      e.sql_pendente = Boolean(json.sql_pendente);
      throw e;
    }
    return json;
  }
  const api = (caminho, opcoes) => chamar(`/api/tarefas${caminho}`, opcoes);

  let contexto = null;
  let contextoEm = 0;
  async function carregarContexto({ forcar = false } = {}) {
    if (!forcar && contexto && Date.now() - contextoEm < 60000) return contexto;
    contexto = await api('/contexto');
    contextoEm = Date.now();
    return contexto;
  }
  const avisar = (texto, tipo = 'info') => window.showToast?.(texto, tipo);
  const mudou = detalhe => window.dispatchEvent(new CustomEvent('tarefas:mudou', { detail: detalhe || {} }));

  let fotos = new Map();
  async function carregarFotos() {
    try {
      const base = (await window.apiConfig?.getApiBaseUrl?.()) || '';
      if (window.HistoricoSocial?.carregarFotos) fotos = await window.HistoricoSocial.carregarFotos(base);
    } catch (_) { /* iniciais */ }
    return fotos;
  }

  // ------------------------------------------------------------ DOM

  /** h('div', { class, text, title, on: {click}, attrs, dataset, style }, ...filhos) */
  function h(tag, props = {}, ...filhos) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === 'attrs') for (const [a, val] of Object.entries(v)) { if (val !== undefined && val !== null && val !== false) el.setAttribute(a, val === true ? '' : val); }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style') {
        // variáveis CSS (--x) só entram por setProperty
        for (const [p, val] of Object.entries(v)) { if (p.startsWith('--')) el.style.setProperty(p, val); else el.style[p] = val; }
      }
      else el[k] = v;
    }
    for (const f of filhos.flat()) {
      if (f === null || f === undefined || f === false) continue;
      el.append(f instanceof Node ? f : document.createTextNode(String(f)));
    }
    return el;
  }
  const icone = (nome, extra = '') => h('i', { class: `${nome.startsWith('fab ') ? '' : 'fas '}${nome}${extra ? ` ${extra}` : ''}`, attrs: { 'aria-hidden': 'true' } });
  const iniciais = nome => String(nome || '?').trim().split(/\s+/).filter(Boolean).map((p, i, t) => (i === 0 || i === t.length - 1 ? p[0] : '')).join('').toUpperCase().slice(0, 2) || '?';

  function avatar(usuarioId, nome, { tamanho = 'm', titulo = null } = {}) {
    const caixa = h('span', { class: `tui-avatar tui-avatar--${tamanho}`, title: titulo || nome || '' });
    const foto = usuarioId !== null && usuarioId !== undefined ? fotos.get(String(usuarioId)) : null;
    if (foto) caixa.append(h('img', { src: foto, alt: '' }));
    else caixa.textContent = iniciais(nome);
    return caixa;
  }

  /** Um chip pequeno: prazo, tipo, vínculo, marcador... */
  function chip(texto, { icone: ic, cor, classe = '', titulo } = {}) {
    const c = h('span', { class: `tui-chip ${classe}`.trim(), title: titulo || null });
    if (cor) c.style.setProperty('--tui-chip-cor', cor);
    if (ic) c.append(icone(ic));
    c.append(h('span', { text: texto }));
    return c;
  }

  function dialogo({ classe = '', rotulo = 'Tarefa', aoFechar } = {}) {
    const d = h('dialog', { class: `tui-dialogo ${classe}`.trim(), attrs: { 'aria-label': rotulo } });
    document.body.append(d);
    let fechado = false;
    const fechar = () => {
      if (fechado) return;
      fechado = true;
      try { d.close(); } catch (_) { /* já fechado */ }
      d.remove();
      aoFechar?.();
    };
    d.fechar = fechar;
    return d;
  }

  // ------------------------------------------------------------ vínculos

  /** Abre a ficha de um cliente/prospecção (ou o módulo do orçamento/pedido). */
  async function abrirVinculo(v) {
    if (!v) return;
    const pagina = { cliente: 'clientes', prospeccao: 'prospeccoes', orcamento: 'orcamentos', pedido: 'pedidos' }[v.tipo];
    await window.loadPage?.(pagina);
    if (v.tipo === 'cliente') window.ClientesModulo?.abrirDetalhes?.({ id: v.id });
    else if (v.tipo === 'prospeccao') window.ProspeccoesModulo?.abrirDetalhes?.({ id: v.id });
    else if (v.tipo === 'pedido') window.PedidosModulo?.abrirVisualizar?.(v.id);
    else if (v.tipo === 'orcamento') window.OrcamentosModulo?.abrirVisualizar?.(v.id);
  }

  // ------------------------------------------------------------ ação de outro módulo

  /** "2026-09" → "09/2026". */
  const competenciaLegivel = c => (/^\d{4}-\d{2}$/.test(String(c || '')) ? `${c.slice(5, 7)}/${c.slice(0, 4)}` : String(c || ''));

  /** "Fazer agora": abre o registro no módulo onde a ação acontece. */
  async function abrirAcao(acao) {
    if (!acao) return;
    if (acao.registroTipo === 'competencia') { await window.loadPage?.('financeiro'); return; }
    await abrirVinculo({ tipo: acao.registroTipo, id: Number(acao.registro) });
  }

  const cacheAcoes = new Map();
  /** O catálogo, marcando o que o responsável pode (60 s de cache por pessoa). */
  async function catalogoDeAcoes(responsavelId) {
    const chave = String(responsavelId || '');
    const guardado = cacheAcoes.get(chave);
    if (guardado && Date.now() - guardado.em < 60000) return guardado.valor;
    const valor = await api(`/acoes${responsavelId ? `?responsavel=${encodeURIComponent(responsavelId)}` : ''}`);
    cacheAcoes.set(chave, { valor, em: Date.now() });
    return valor;
  }

  /**
   * "Ação no sistema": módulo → registro (busca, ou o mês no Financeiro) →
   * ação. A lista só libera o que o RESPONSÁVEL pode fazer (o servidor confere
   * de novo). Quando a ação acontecer no módulo, a tarefa conclui sozinha.
   */
  function seletorDeAcao({ inicial = null, responsavelId, somenteLeitura = false, aoMudar }) {
    let atual = inicial ? { ...inicial } : null;    // { chave, registro, rotulo, registroTipo, modulo }
    let catalogo = null;
    let modulo = inicial?.modulo || '';
    const caixa = h('div', { class: 'tui-acao' });
    const resumo = h('div', { class: 'tui-acao__resumo' });
    const editor = h('div', { class: 'tui-acao__editor' });
    const selModulo = h('select', { class: 'tui-campo', attrs: { 'aria-label': 'Módulo' } });
    const selAcao = h('select', { class: 'tui-campo', attrs: { 'aria-label': 'Ação' } });
    const registroCaixa = h('div', { class: 'tui-acao__registro' });
    const aviso = h('p', { class: 'tui-dica tui-dica--aviso' });
    const emitir = () => aoMudar?.(atual && (atual.chave || atual.registro) ? atual : null);

    function pintarResumo() {
      resumo.replaceChildren();
      if (!atual?.chave) { resumo.hidden = true; return; }
      const acao = catalogo?.acoes.find(a => a.chave === atual.chave);
      const rotuloAcao = acao?.rotulo || atual.rotuloAcao || atual.chave;
      const registroTexto = atual.registroTipo === 'competencia' ? `Competência ${competenciaLegivel(atual.registro)}` : (atual.rotulo || `#${atual.registro}`);
      resumo.hidden = false;
      resumo.append(...[
        h('span', { class: 'tui-acao__icone' }, icone('fa-bolt')),
        h('div', { class: 'tui-acao__texto' }, h('strong', { text: rotuloAcao }), h('span', { text: atual.registro ? registroTexto : 'Escolha o registro' })),
        atual.registro && inicial?.chave === atual.chave && String(inicial?.registro) === String(atual.registro)
          ? h('button', { type: 'button', class: 'tui-link', on: { click: () => abrirAcao(atual) } }, icone('fa-arrow-up-right-from-square'), ' Fazer agora') : null,
        somenteLeitura ? null : h('button', { type: 'button', class: 'tui-icone-botao', title: 'Tirar a ação', attrs: { 'aria-label': 'Tirar a ação' }, on: { click: () => { atual = null; modulo = ''; montarEditor(); pintarResumo(); emitir(); } } }, icone('fa-xmark'))].filter(Boolean));
      if (acao && !acao.pode) aviso.textContent = 'O responsável não tem permissão para esta ação — troque a ação ou o responsável.';
      else aviso.textContent = '';
    }

    function montarRegistro() {
      registroCaixa.replaceChildren();
      const info = catalogo?.modulos.find(m => m.chave === modulo);
      if (!info) return;
      if (info.registro === 'competencia') {
        const hojeMes = hoje().slice(0, 7);
        const mes = h('input', { class: 'tui-campo', type: 'month', value: atual?.registroTipo === 'competencia' && atual.registro ? atual.registro : hojeMes, attrs: { 'aria-label': 'Competência' } });
        const aplicar = () => { atual = { ...(atual || {}), modulo, registroTipo: 'competencia', registro: mes.value || null, rotulo: mes.value ? `Competência ${competenciaLegivel(mes.value)}` : null }; pintarResumo(); emitir(); };
        mes.addEventListener('change', aplicar);
        registroCaixa.append(mes);
        if (!(atual?.registroTipo === 'competencia' && atual.registro)) aplicar();
        return;
      }
      const busca = h('input', { class: 'tui-campo', type: 'search', placeholder: `Buscar ${{ pedido: 'o pedido (número ou cliente)', orcamento: 'o orçamento (número ou cliente)', prospeccao: 'a prospecção', cliente: 'o cliente' }[info.registro]}…`, attrs: { 'aria-label': 'Registro da ação' } });
      const resultados = h('div', { class: 'tui-vinculos__resultados', attrs: { role: 'listbox' }, hidden: true });
      let espera = null;
      busca.addEventListener('input', () => {
        clearTimeout(espera);
        const q = busca.value.trim();
        if (q.length < 2) { resultados.hidden = true; return; }
        espera = setTimeout(async () => {
          try {
            const { resultados: achados } = await api(`/buscar-vinculos?q=${encodeURIComponent(q)}&tipo=${info.registro}`);
            resultados.replaceChildren();
            if (!achados.length) resultados.append(h('div', { class: 'tui-vinculos__vazio', text: 'Nada encontrado.' }));
            for (const r of achados) {
              resultados.append(h('button', {
                type: 'button', class: 'tui-vinculos__opcao', attrs: { role: 'option' },
                on: { click: () => {
                  atual = { ...(atual || {}), modulo, registroTipo: info.registro, registro: String(r.id), rotulo: [r.nome, r.detalhe].filter(Boolean).join(' — ').slice(0, 200) };
                  busca.value = '';
                  resultados.hidden = true;
                  pintarResumo();
                  emitir();
                } }
              }, icone(VINCULO[r.tipo]?.icone || info.icone), h('span', { class: 'tui-vinculos__nome', text: r.nome }), h('span', { class: 'tui-vinculos__tipo', text: r.detalhe || '' })));
            }
            resultados.hidden = false;
          } catch (err) { avisar(err.message, 'error'); }
        }, 250);
      });
      busca.addEventListener('keydown', e => { if (e.key === 'Escape' && !resultados.hidden) { e.stopPropagation(); e.preventDefault(); resultados.hidden = true; } });
      registroCaixa.append(h('div', { class: 'tui-vinculos' }, busca, resultados));
    }

    function montarEditor() {
      editor.replaceChildren();
      if (somenteLeitura || !catalogo) { editor.hidden = true; return; }
      editor.hidden = false;
      const comAlguma = new Set(catalogo.acoes.filter(a => a.pode).map(a => a.modulo));
      selModulo.replaceChildren(h('option', { value: '', text: 'Módulo…' }), ...catalogo.modulos.map(m => h('option', {
        value: m.chave, text: comAlguma.has(m.chave) ? m.rotulo : `${m.rotulo} (sem permissão)`, disabled: !comAlguma.has(m.chave), selected: m.chave === modulo
      })));
      const doModulo = catalogo.acoes.filter(a => a.modulo === modulo);
      selAcao.replaceChildren(h('option', { value: '', text: modulo ? 'Qual ação?' : 'Escolha o módulo' }), ...doModulo.map(a => h('option', {
        value: a.chave, text: a.pode ? a.rotulo : `${a.rotulo} — sem permissão`, disabled: !a.pode, selected: a.chave === atual?.chave
      })));
      selAcao.disabled = !modulo;
      montarRegistro();
      editor.append(h('div', { class: 'tui-acao__linha' }, selModulo, selAcao), registroCaixa);
    }

    selModulo.addEventListener('change', () => {
      modulo = selModulo.value;
      const tipo = catalogo.modulos.find(m => m.chave === modulo)?.registro;
      // Trocar de módulo zera a ação e o registro (a menos que o tipo seja o mesmo).
      atual = modulo ? { modulo, registroTipo: tipo, chave: null, registro: atual?.registroTipo === tipo ? atual.registro : null, rotulo: atual?.registroTipo === tipo ? atual.rotulo : null } : null;
      montarEditor();
      pintarResumo();
      emitir();
    });
    selAcao.addEventListener('change', () => {
      atual = { ...(atual || {}), modulo, chave: selAcao.value || null };
      pintarResumo();
      emitir();
    });

    caixa.append(resumo, editor, aviso);
    caixa.trocarResponsavel = async id => {
      try {
        catalogo = await catalogoDeAcoes(id);
        montarEditor();
        pintarResumo();
      } catch (err) {
        editor.replaceChildren(h('p', { class: 'tui-dica tui-dica--aviso', text: err.sql_pendente ? 'Rode sql/tarefas_acoes.sql e reinicie a API para ligar ações do sistema.' : `Não foi possível carregar as ações: ${err.message}` }));
      }
    };
    pintarResumo();
    caixa.trocarResponsavel(responsavelId);
    return caixa;
  }

  function seletorDeVinculo({ inicial = [], aoMudar }) {
    let vinculos = [...inicial];
    const caixa = h('div', { class: 'tui-vinculos' });
    const escolhidos = h('div', { class: 'tui-vinculos__escolhidos' });
    const busca = h('input', { class: 'tui-campo', type: 'search', placeholder: 'Buscar cliente, prospecção, orçamento ou pedido…', attrs: { 'aria-label': 'Ligar a um cliente, prospecção, orçamento ou pedido' } });
    const resultados = h('div', { class: 'tui-vinculos__resultados', attrs: { role: 'listbox' }, hidden: true });
    const pintar = () => {
      escolhidos.replaceChildren(...vinculos.map(v => {
        const c = chip(v.nome, { icone: VINCULO[v.tipo]?.icone, classe: 'tui-chip--vinculo', titulo: VINCULO[v.tipo]?.rotulo });
        c.append(h('button', { type: 'button', class: 'tui-chip__x', title: 'Tirar', attrs: { 'aria-label': `Tirar ${v.nome}` }, on: { click: () => { vinculos = vinculos.filter(x => x !== v); pintar(); aoMudar?.(vinculos); } } }, icone('fa-xmark')));
        return c;
      }));
      busca.hidden = vinculos.some(v => v.tipo === 'cliente' || v.tipo === 'prospeccao') && vinculos.length >= 2;
    };
    let espera = null;
    busca.addEventListener('input', () => {
      clearTimeout(espera);
      const q = busca.value.trim();
      if (q.length < 2) { resultados.hidden = true; return; }
      espera = setTimeout(async () => {
        try {
          const { resultados: achados } = await api(`/buscar-vinculos?q=${encodeURIComponent(q)}`);
          resultados.replaceChildren();
          if (!achados.length) resultados.append(h('div', { class: 'tui-vinculos__vazio', text: 'Nada encontrado.' }));
          for (const r of achados) {
            resultados.append(h('button', {
              type: 'button', class: 'tui-vinculos__opcao', attrs: { role: 'option' },
              on: {
                click: () => {
                  vinculos = vinculos.filter(v => v.tipo !== r.tipo);
                  vinculos.push({ tipo: r.tipo, id: r.id, nome: r.nome });
                  if (r.tipo === 'orcamento' || r.tipo === 'pedido') {
                    if (r.cliente_id && !vinculos.some(v => v.tipo === 'cliente')) vinculos.push({ tipo: 'cliente', id: r.cliente_id, nome: r.detalhe || `Cliente #${r.cliente_id}` });
                    if (r.prospeccao_id && !r.cliente_id && !vinculos.some(v => v.tipo === 'prospeccao')) vinculos.push({ tipo: 'prospeccao', id: r.prospeccao_id, nome: r.detalhe || `Prospecção #${r.prospeccao_id}` });
                  }
                  busca.value = '';
                  resultados.hidden = true;
                  pintar();
                  aoMudar?.(vinculos);
                }
              }
            }, icone(VINCULO[r.tipo].icone), h('span', { class: 'tui-vinculos__nome', text: r.nome }), h('span', { class: 'tui-vinculos__tipo', text: [VINCULO[r.tipo].rotulo, r.detalhe].filter(Boolean).join(' · ') })));
          }
          resultados.hidden = false;
        } catch (err) {
          avisar(err.message, 'error');
        }
      }, 250);
    });
    busca.addEventListener('keydown', e => { if (e.key === 'Escape' && !resultados.hidden) { e.stopPropagation(); e.preventDefault(); resultados.hidden = true; } });
    caixa.append(escolhidos, busca, resultados);
    pintar();
    caixa.valor = () => vinculos;
    return caixa;
  }

  // ------------------------------------------------------------ repetição

  const DIAS_LETRA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

  function editorDeRepeticao({ inicial = null, diaBase, aoMudar }) {
    let r = inicial ? JSON.parse(JSON.stringify(inicial)) : null;
    const caixa = h('div', { class: 'tui-repeticao' });
    const PRONTAS = [
      ['', 'Não repete'], ['diaria', 'Todo dia'], ['uteis', 'Todo dia útil'], ['semanal', 'Toda semana'],
      ['mensal', 'Todo mês'], ['anual', 'Todo ano'], ['personalizar', 'Personalizar…']
    ];
    const escolha = h('select', { class: 'tui-campo', attrs: { 'aria-label': 'Repetir' } }, PRONTAS.map(([v, t]) => h('option', { value: v, text: t })));
    const detalhe = h('div', { class: 'tui-repeticao__detalhe' });
    const qualPronta = () => {
      if (!r) return '';
      const simples = (r.intervalo || 1) === 1 && (!r.fim || r.fim.tipo === 'nunca') && !r.modo;
      if (simples && r.freq === 'diaria') return r.somente_uteis ? 'uteis' : 'diaria';
      if (simples && r.freq === 'semanal' && (!r.dias_semana || (r.dias_semana.length === 1 && r.dias_semana[0] === diaDaSemana(diaBase() || hoje())))) return 'semanal';
      if (simples && ['mensal', 'anual'].includes(r.freq)) return r.freq;
      return 'personalizar';
    };
    const avisarMudanca = () => aoMudar?.(r);
    const pintarDetalhe = () => {
      detalhe.replaceChildren();
      detalhe.hidden = escolha.value !== 'personalizar';
      if (detalhe.hidden || !r) return;
      const intervalo = h('input', { class: 'tui-campo tui-campo--curto', type: 'number', min: 1, max: 99, value: r.intervalo || 1, attrs: { 'aria-label': 'A cada' } });
      const freq = h('select', { class: 'tui-campo', attrs: { 'aria-label': 'Frequência' } },
        [['diaria', 'dia(s)'], ['semanal', 'semana(s)'], ['mensal', 'mês(es)'], ['anual', 'ano(s)']].map(([v, t]) => h('option', { value: v, text: t, selected: r.freq === v })));
      intervalo.addEventListener('change', () => { r.intervalo = Math.max(1, Math.min(99, Number(intervalo.value) || 1)); avisarMudanca(); });
      freq.addEventListener('change', () => { r.freq = freq.value; if (r.freq !== 'semanal') delete r.dias_semana; if (r.freq !== 'mensal') delete r.modo; pintarDetalhe(); avisarMudanca(); });
      detalhe.append(h('div', { class: 'tui-linha' }, h('span', { class: 'tui-rotulo-inline', text: 'A cada' }), intervalo, freq));
      if (r.freq === 'semanal') {
        const dias = new Set(r.dias_semana?.length ? r.dias_semana : [diaDaSemana(diaBase() || hoje())]);
        detalhe.append(h('div', { class: 'tui-dias' }, DIAS_LETRA.map((l, i) => h('button', {
          type: 'button', class: 'tui-dia', text: l, title: DIAS_LONGOS[i], attrs: { 'aria-pressed': String(dias.has(i)) },
          on: { click: e => { if (dias.has(i) && dias.size > 1) dias.delete(i); else dias.add(i); e.currentTarget.setAttribute('aria-pressed', String(dias.has(i))); r.dias_semana = [...dias].sort(); avisarMudanca(); } }
        }))));
      }
      if (r.freq === 'diaria') {
        const uteis = h('input', { type: 'checkbox', checked: Boolean(r.somente_uteis) });
        uteis.addEventListener('change', () => { r.somente_uteis = uteis.checked; avisarMudanca(); });
        detalhe.append(h('label', { class: 'tui-check' }, uteis, ' Só dias úteis'));
      }
      if (r.freq === 'mensal') {
        const base = diaBase() || hoje();
        const modo = h('select', { class: 'tui-campo', attrs: { 'aria-label': 'Como repetir no mês' } },
          h('option', { value: 'dia', text: `Todo dia ${Number(base.slice(8, 10))}`, selected: r.modo !== 'posicao' }),
          h('option', { value: 'posicao', text: `Na mesma posição (${Math.ceil(Number(base.slice(8, 10)) / 7)}ª ${DIAS_CURTOS[diaDaSemana(base)]})`, selected: r.modo === 'posicao' }));
        modo.addEventListener('change', () => { if (modo.value === 'posicao') r.modo = 'posicao'; else delete r.modo; avisarMudanca(); });
        detalhe.append(modo);
      }
      const fim = r.fim || { tipo: 'nunca' };
      const tipoFim = h('select', { class: 'tui-campo', attrs: { 'aria-label': 'Termina' } },
        [['nunca', 'Nunca termina'], ['data', 'Termina em'], ['vezes', 'Termina após']].map(([v, t]) => h('option', { value: v, text: t, selected: fim.tipo === v })));
      const valorFim = fim.tipo === 'data'
        ? h('input', { class: 'tui-campo', type: 'date', value: fim.data || somarMeses(diaBase() || hoje(), 3) })
        : fim.tipo === 'vezes' ? h('input', { class: 'tui-campo tui-campo--curto', type: 'number', min: 2, max: 999, value: fim.vezes || 10 }) : null;
      const gravarFim = () => {
        if (tipoFim.value === 'nunca') r.fim = { tipo: 'nunca' };
        else if (tipoFim.value === 'data') r.fim = { tipo: 'data', data: valorFim?.type === 'date' ? valorFim.value : somarMeses(diaBase() || hoje(), 3) };
        else r.fim = { tipo: 'vezes', vezes: valorFim?.type === 'number' ? Math.max(2, Number(valorFim.value) || 10) : 10 };
        avisarMudanca();
      };
      tipoFim.addEventListener('change', () => { gravarFim(); pintarDetalhe(); });
      valorFim?.addEventListener('change', gravarFim);
      detalhe.append(h('div', { class: 'tui-linha' }, tipoFim, valorFim, fim.tipo === 'vezes' ? h('span', { class: 'tui-rotulo-inline', text: 'vezes' }) : null));
    };
    escolha.addEventListener('change', () => {
      const v = escolha.value;
      if (!v) r = null;
      else if (v === 'uteis') r = { freq: 'diaria', intervalo: 1, somente_uteis: true, fim: { tipo: 'nunca' } };
      else if (v === 'personalizar') r = r || { freq: 'semanal', intervalo: 1, dias_semana: [diaDaSemana(diaBase() || hoje())], fim: { tipo: 'nunca' } };
      else r = { freq: v, intervalo: 1, fim: { tipo: 'nunca' } };
      pintarDetalhe();
      avisarMudanca();
    });
    escolha.value = qualPronta();
    caixa.append(escolha, detalhe);
    pintarDetalhe();
    caixa.valor = () => r;
    return caixa;
  }

  /** "Toda semana (seg, qua)" (o mesmo texto do servidor, para o chip). */
  function descreverRepeticao(r) {
    if (!r) return '';
    const n = r.intervalo || 1;
    let base;
    if (r.freq === 'diaria') base = r.somente_uteis ? 'Todo dia útil' : n === 1 ? 'Todo dia' : `A cada ${n} dias`;
    else if (r.freq === 'semanal') base = `${n === 1 ? 'Toda semana' : `A cada ${n} semanas`}${r.dias_semana?.length ? ` (${r.dias_semana.map(d => DIAS_CURTOS[d]).join(', ')})` : ''}`;
    else if (r.freq === 'mensal') base = n === 1 ? 'Todo mês' : `A cada ${n} meses`;
    else base = n === 1 ? 'Todo ano' : `A cada ${n} anos`;
    if (r.fim?.tipo === 'data') base += `, até ${dataBr(r.fim.data)}`;
    if (r.fim?.tipo === 'vezes') base += `, ${r.fim.vezes} vezes`;
    return base;
  }

  // ------------------------------------------------------------ editor

  const EVENTO_DA_TAREFA = {
    criacao: 'Criação', campo: 'Edição', situacao: 'Situação', responsavel: 'Responsável', participantes: 'Participantes', observacao: 'Comentário'
  };
  const ACAO_DA_TAREFA = { criou: 'Criou', alterou: 'Alterou', excluiu: 'Excluiu', moveu: 'Moveu', publicou: 'Comentou', concluiu: 'Concluiu', reabriu: 'Reabriu', convidou: 'Convidou', respondeu: 'Respondeu', atribuiu: 'Atribuiu', cancelou: 'Cancelou' };
  const TOM_DA_ACAO = { concluiu: 'sucesso', reabriu: 'aviso', cancelou: 'perigo', excluiu: 'perigo', convidou: 'info', respondeu: 'info', atribuiu: 'info', publicou: 'observacao' };
  const lerDetalhe = b => { if (!b) return null; if (typeof b === 'object') return b; try { return JSON.parse(b); } catch (_) { return null; } };
  const cru = v => (v === null || v === undefined || String(v).trim() === '' ? null : String(v));

  /** Como a linha do tempo da tarefa descreve cada evento (o componente é o do histórico social). */
  function descreverEventoDaTarefa(ev) {
    const detalhe = lerDetalhe(ev.detalhe);
    return {
      etiqueta: EVENTO_DA_TAREFA[ev.tipo] || 'Tarefa', tom: TOM_DA_ACAO[ev.acao] || 'neutro',
      acao: ACAO_DA_TAREFA[ev.acao] || ev.acao, titulo: ev.tipo === 'observacao' ? null : cru(ev.entidade),
      campo: null, antes: cru(ev.valor_anterior), depois: cru(ev.valor_novo), riscado: ev.acao === 'excluiu',
      retrato: Array.isArray(detalhe?.campos) ? detalhe.campos : [], pendencias: [], nota: cru(ev.observacao)
    };
  }

  /**
   * O editor: tarefa nova (preset: { titulo, data, hora, tipo, cliente/prospecção... })
   * ou existente ({ id }). `aba`: 'detalhes' | 'conversa'. Devolve uma promessa
   * que resolve quando o diálogo fecha (true se algo foi gravado).
   */
  async function abrirEditor({ id = null, preset = {}, aba = 'detalhes', foco = null } = {}) {
    let ctx;
    try {
      ctx = await carregarContexto();
    } catch (err) {
      avisar(err.sql_pendente ? 'Tarefas ainda não ativadas: rode o SQL de tarefas e reinicie a API.' : err.message, 'error');
      return false;
    }
    if (ctx.sql_pendente) { avisar('Tarefas ainda não ativadas: rode o SQL de tarefas e reinicie a API.', 'error'); return false; }
    await carregarFotos();
    let original = null;
    if (id) {
      try { original = await api(`/${id}`); } catch (err) { avisar(err.message, 'error'); return false; }
    }
    const nova = !original;
    const pode = original ? original.pode : { editar: true, concluir: true, excluir: false, convidar: ctx.pode.convidar, atribuir: ctx.pode.atribuir };
    const somenteLeitura = !nova && !pode.editar;
    const eu = ctx.eu;
    const hojeDia = hoje();

    // Estado editável
    const estado = {
      titulo: original?.titulo ?? preset.titulo ?? '',
      descricao: original?.descricao ?? preset.descricao ?? '',
      tipo: original?.tipo ?? preset.tipo ?? 'Tarefa',
      prioridade: original?.prioridade ?? preset.prioridade ?? 'media',
      status: original?.status ?? 'a_fazer',
      data: original ? original.data : (preset.data === undefined ? hojeDia : preset.data),
      hora: original?.hora ?? preset.hora ?? null,
      duracao_min: original?.duracao_min ?? preset.duracao_min ?? null,
      lembrete_min: original ? original.lembrete_min : (preset.lembrete_min ?? null),
      local: original?.local ?? preset.local ?? '',
      responsavel_id: original?.responsavel_id ?? preset.responsavel_id ?? eu.id,
      lista_id: original?.lista_id ?? preset.lista_id ?? null,
      marcadores: [...(original?.marcadores ?? preset.marcadores ?? [])],
      recorrencia: original?.recorrencia ?? preset.recorrencia ?? null,
      vinculos: original?.vinculos ?? preset.vinculos ?? [],
      acao: original?.acao ? { ...original.acao, rotulo: original.acao.registroRotulo, rotuloAcao: original.acao.rotulo } : null
    };
    const checklistNovo = [...(preset.checklist || [])];
    let participantesNovos = [...(preset.participantes || [])];
    let alterado = false;
    let gravou = false;
    const marcar = () => { alterado = true; };

    return new Promise(resolver => {
      const d = dialogo({ classe: 'tui-dialogo--editor', rotulo: nova ? 'Nova tarefa' : 'Tarefa', aoFechar: () => { linha?.destruir?.(); resolver(gravou); } });
      let linha = null;
      const cartao = h('div', { class: 'tui-cartao' });
      d.append(cartao);

      // ---- topo
      const tipoBotao = h('button', { type: 'button', class: 'tui-tipo', title: 'Tipo da tarefa', disabled: somenteLeitura });
      const pintarTipo = () => {
        tipoBotao.replaceChildren(icone(TIPOS[estado.tipo].icone), h('span', { text: estado.tipo }), icone('fa-chevron-down', 'tui-tipo__seta'));
        tipoBotao.style.setProperty('--tui-tipo-cor', TIPOS[estado.tipo].cor);
      };
      const menuTipo = h('div', { class: 'tui-menu', hidden: true, attrs: { role: 'menu' } }, Object.keys(TIPOS).map(t => h('button', {
        type: 'button', class: 'tui-menu__item', attrs: { role: 'menuitem' },
        on: { click: () => { estado.tipo = t; menuTipo.hidden = true; pintarTipo(); marcar(); pintarLocal(); } }
      }, icone(TIPOS[t].icone), h('span', { text: t }))));
      tipoBotao.addEventListener('click', () => { menuTipo.hidden = !menuTipo.hidden; });
      pintarTipo();
      const titulo = h('input', { class: 'tui-titulo', type: 'text', maxLength: 200, value: estado.titulo, placeholder: 'O que precisa ser feito?', readOnly: somenteLeitura, attrs: { 'aria-label': 'Título da tarefa' } });
      titulo.addEventListener('input', () => { estado.titulo = titulo.value; marcar(); });
      const fechar = h('button', { type: 'button', class: 'tui-fechar', title: 'Fechar (Esc)', attrs: { 'aria-label': 'Fechar' } }, icone('fa-xmark'));
      const topo = h('header', { class: 'tui-topo' },
        h('div', { class: 'tui-topo__linha' }, h('div', { class: 'tui-tipo-caixa' }, tipoBotao, menuTipo), titulo, fechar));

      // selos: origem, situação, quem criou
      const selos = h('div', { class: 'tui-selos' });
      if (original) {
        const st = STATUS[original.status];
        selos.append(chip(st.rotulo, { icone: st.icone, classe: `tui-chip--status tui-chip--${original.status}` }));
        if (original.atrasada) selos.append(chip('Atrasada', { icone: 'fa-triangle-exclamation', classe: 'tui-chip--perigo' }));
        if (original.origem === 'proximo_passo') selos.append(chip('Próximo passo da prospecção', { icone: 'fa-forward-step', classe: 'tui-chip--passo', titulo: 'Mudar o título ou a data muda o próximo passo lá; concluir abre o "Concluir passo planejado"' }));
        if (original.origem === 'automacao') selos.append(chip('Criada automaticamente', { icone: 'fa-robot', classe: 'tui-chip--info' }));
        if (original.recorrencia_texto) selos.append(chip(original.recorrencia_texto, { icone: 'fa-repeat' }));
        selos.append(h('span', { class: 'tui-selos__quem', text: `Criada por ${original.criado_por_nome || '—'}` }));
        if (original.status === 'concluida') {
          selos.append(chip(`Concluída${original.concluida_por_nome ? ` por ${original.concluida_por_nome}` : ''}${original.resultado_texto && original.resultado !== 'feito' ? ` — ${original.resultado_texto}` : ''}`, { icone: 'fa-circle-check', classe: 'tui-chip--sucesso' }));
        }
      } else if (preset.origemTexto) {
        selos.append(chip(preset.origemTexto, { icone: 'fa-wand-magic-sparkles', classe: 'tui-chip--info' }));
      }
      if (somenteLeitura) selos.append(chip('Somente leitura', { icone: 'fa-lock' }));
      topo.append(selos);

      // abas (só tarefa existente)
      const abas = h('div', { class: 'tui-abas', attrs: { role: 'tablist' } });
      const painelDetalhes = h('div', { class: 'tui-painel', attrs: { role: 'tabpanel' } });
      const painelConversa = h('div', { class: 'tui-painel tui-painel--conversa', attrs: { role: 'tabpanel' }, hidden: true });
      const trocarAba = qual => {
        painelDetalhes.hidden = qual !== 'detalhes';
        painelConversa.hidden = qual !== 'conversa';
        abas.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.aba === qual)));
        if (qual === 'conversa' && !linha && original && window.HistoricoSocial) {
          const alvo = h('div');
          painelConversa.append(alvo);
          linha = window.HistoricoSocial.montar(alvo, {
            origem: 'tarefa', registroId: original.id, descrever: descreverEventoDaTarefa, foco,
            textos: { placeholder: 'Escreva um comentário ou anexe arquivos… (Ctrl+Enter envia)', publicar: 'Enviar', publicado: 'Enviado.', vazio: 'Nada por aqui ainda.' }
          });
        }
      };
      if (original) {
        abas.append(
          h('button', { type: 'button', text: 'Detalhes', dataset: { aba: 'detalhes' }, attrs: { role: 'tab' }, on: { click: () => trocarAba('detalhes') } }),
          h('button', { type: 'button', dataset: { aba: 'conversa' }, attrs: { role: 'tab' }, on: { click: () => trocarAba('conversa') } },
            icone('fa-comments'), ` Conversa e anexos${original.comentarios || original.anexos ? ` (${original.comentarios + original.anexos})` : ''}`)
        );
        topo.append(abas);
      }

      // ---- corpo: coluna principal
      const principal = h('div', { class: 'tui-principal' });
      const descricao = h('textarea', { class: 'tui-campo tui-descricao', rows: 3, maxLength: 5000, value: estado.descricao || '', placeholder: 'Detalhes, combinados, links…', readOnly: somenteLeitura });
      descricao.addEventListener('input', () => { estado.descricao = descricao.value; marcar(); });
      principal.append(h('label', { class: 'tui-rotulo' }, icone('fa-align-left'), ' Descrição'), descricao);

      // checklist
      const itensOriginais = original?.itens_checklist || [];
      const listaChecklist = h('div', { class: 'tui-checklist' });
      const barra = h('div', { class: 'tui-progresso' }, h('span'));
      const contagem = h('span', { class: 'tui-rotulo__extra' });
      const pintarProgresso = () => {
        const itens = nova ? checklistNovo.map(t => ({ texto: t, feito: false })) : itensAtuais;
        const feitos = itens.filter(i => i.feito).length;
        contagem.textContent = itens.length ? `${feitos}/${itens.length}` : '';
        barra.hidden = !itens.length;
        barra.firstChild.style.width = `${itens.length ? Math.round((feitos / itens.length) * 100) : 0}%`;
      };
      let itensAtuais = itensOriginais.map(i => ({ ...i }));
      const linhaDoItem = (item, indice) => {
        const marca = h('input', { type: 'checkbox', checked: Boolean(item.feito), disabled: somenteLeitura && !pode.concluir, attrs: { 'aria-label': 'Feito' } });
        const texto = h('input', { class: 'tui-checklist__texto', type: 'text', value: item.texto, maxLength: 300, readOnly: somenteLeitura });
        const tirar = h('button', { type: 'button', class: 'tui-icone-botao', title: 'Tirar item', hidden: somenteLeitura }, icone('fa-trash-can'));
        const el = h('div', { class: `tui-checklist__item${item.feito ? ' tui-checklist__item--feito' : ''}` }, marca, texto, tirar);
        marca.addEventListener('change', async () => {
          if (nova) return;
          try {
            await api(`/${original.id}/checklist/${item.id}`, { method: 'PUT', corpo: { feito: marca.checked } });
            item.feito = marca.checked;
            el.classList.toggle('tui-checklist__item--feito', marca.checked);
            pintarProgresso();
            gravou = true;
          } catch (err) { marca.checked = !marca.checked; avisar(err.message, 'error'); }
        });
        texto.addEventListener('change', async () => {
          const novoTexto = texto.value.trim();
          if (!novoTexto) { texto.value = item.texto; return; }
          if (nova) { checklistNovo[indice] = novoTexto; return; }
          try { await api(`/${original.id}/checklist/${item.id}`, { method: 'PUT', corpo: { texto: novoTexto } }); item.texto = novoTexto; gravou = true; } catch (err) { avisar(err.message, 'error'); }
        });
        tirar.addEventListener('click', async () => {
          if (nova) { checklistNovo.splice(indice, 1); pintarChecklist(); return; }
          try { await api(`/${original.id}/checklist/${item.id}`, { method: 'DELETE' }); itensAtuais = itensAtuais.filter(i => i !== item); gravou = true; pintarChecklist(); } catch (err) { avisar(err.message, 'error'); }
        });
        return el;
      };
      const pintarChecklist = () => {
        const itens = nova ? checklistNovo.map(t => ({ texto: t, feito: false })) : itensAtuais;
        listaChecklist.replaceChildren(...itens.map(linhaDoItem));
        pintarProgresso();
      };
      const novoItem = h('input', { class: 'tui-campo', type: 'text', maxLength: 300, placeholder: '+ Adicionar item (Enter)', hidden: somenteLeitura && !nova });
      novoItem.addEventListener('keydown', async e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const texto = novoItem.value.trim();
        if (!texto) return;
        if (nova) { checklistNovo.push(texto); novoItem.value = ''; pintarChecklist(); return; }
        try {
          const r = await api(`/${original.id}/checklist`, { method: 'POST', corpo: { texto } });
          itensAtuais.push({ id: r.id, texto, feito: false });
          novoItem.value = '';
          gravou = true;
          pintarChecklist();
        } catch (err) { avisar(err.message, 'error'); }
      });
      principal.append(h('div', { class: 'tui-rotulo' }, icone('fa-list-check'), ' Checklist ', contagem), barra, listaChecklist, novoItem);
      pintarChecklist();

      // vínculo
      const vinculos = seletorDeVinculo({ inicial: estado.vinculos, aoMudar: v => { estado.vinculos = v; marcar(); } });
      if (somenteLeitura) vinculos.querySelector('input').hidden = true;
      const abrirLigados = h('div', { class: 'tui-vinculos__abrir' }, (original?.vinculos || []).filter(v => ['cliente', 'prospeccao'].includes(v.tipo)).map(v => h('button', {
        type: 'button', class: 'tui-link', on: { click: () => { d.fechar(); abrirVinculo(v); } }
      }, icone('fa-arrow-up-right-from-square'), ` Abrir ${VINCULO[v.tipo].rotulo.toLowerCase()}`)));
      principal.append(h('div', { class: 'tui-rotulo' }, icone('fa-link'), ' Ligada a'), vinculos, abrirLigados);
      if (original?.origem === 'proximo_passo') vinculos.querySelector('input').hidden = true;

      // ação de outro módulo (o próximo passo da prospecção não cobra ação)
      let seletorAcao = null;
      if (original?.origem !== 'proximo_passo' && (!somenteLeitura || estado.acao)) {
        seletorAcao = seletorDeAcao({ inicial: estado.acao, responsavelId: estado.responsavel_id, somenteLeitura, aoMudar: a => { estado.acao = a; marcar(); } });
        principal.append(
          h('div', { class: 'tui-rotulo' }, icone('fa-bolt'), ' Ação no sistema', h('span', { class: 'tui-rotulo__extra', text: 'opcional' })),
          h('p', { class: 'tui-dica' }, 'Ligue a tarefa a algo que se faz em outro módulo — despachar um pedido, fechar uma competência. Quando isso for feito lá, por qualquer pessoa, a tarefa conclui sozinha.'),
          seletorAcao);
      }

      // ---- corpo: coluna de propriedades
      const lado = h('aside', { class: 'tui-lado' });
      const campo = (rotulo, ic, ...conteudo) => h('div', { class: 'tui-prop' }, h('span', { class: 'tui-prop__rotulo' }, icone(ic), ` ${rotulo}`), ...conteudo);

      // quando
      const data = h('input', { class: 'tui-campo', type: 'date', value: estado.data || '', disabled: somenteLeitura, attrs: { 'aria-label': 'Data' } });
      const hora = h('input', { class: 'tui-campo', type: 'time', value: estado.hora || '', disabled: somenteLeitura || !estado.data, attrs: { 'aria-label': 'Hora' } });
      const duracao = h('select', { class: 'tui-campo', disabled: somenteLeitura || !estado.hora, attrs: { 'aria-label': 'Duração' } },
        h('option', { value: '', text: 'Duração' }), DURACOES.map(([v, t]) => h('option', { value: v, text: t, selected: Number(estado.duracao_min) === v })));
      const atalhos = h('div', { class: 'tui-atalhos' }, [['Hoje', 0], ['Amanhã', 1], ['Próx. seg', 'seg'], ['Sem data', null]].map(([t, n]) => h('button', {
        type: 'button', class: 'tui-atalho', text: t, disabled: somenteLeitura,
        on: { click: () => { estado.data = n === null ? null : somarDias(hojeDia, n === 'seg' ? (((8 - diaDaSemana(hojeDia)) % 7) || 7) : n); data.value = estado.data || ''; sincronizarQuando(); marcar(); } }
      })));
      const sincronizarQuando = () => {
        if (!estado.data) { estado.hora = null; hora.value = ''; }
        hora.disabled = somenteLeitura || !estado.data;
        if (!estado.hora) { duracao.value = ''; estado.duracao_min = null; }
        duracao.disabled = somenteLeitura || !estado.hora;
        feriadoDoDia.textContent = '';
        if (estado.data) {
          const f = feriadosDoAno(Number(estado.data.slice(0, 4)), { municipio: ctx.municipio }).find(x => x.dia === estado.data && x.tipo !== 'data');
          if (f) feriadoDoDia.textContent = `Atenção: ${f.nome}${f.tipo === 'facultativo' ? ' (ponto facultativo)' : ''}`;
          if ([0, 6].includes(diaDaSemana(estado.data)) && !f) feriadoDoDia.textContent = `Cai num ${DIAS_LONGOS[diaDaSemana(estado.data)]}.`;
        }
      };
      data.addEventListener('change', () => { estado.data = data.value || null; sincronizarQuando(); marcar(); });
      hora.addEventListener('change', () => { estado.hora = hora.value || null; if (estado.hora && !estado.duracao_min) { estado.duracao_min = 30; duracao.value = '30'; } sincronizarQuando(); marcar(); });
      duracao.addEventListener('change', () => { estado.duracao_min = duracao.value ? Number(duracao.value) : null; marcar(); });
      const feriadoDoDia = h('p', { class: 'tui-dica tui-dica--aviso' });
      lado.append(campo('Quando', 'fa-calendar-days', atalhos, h('div', { class: 'tui-linha' }, data, hora), duracao, feriadoDoDia));
      sincronizarQuando();

      // lembrete
      const lembrete = h('select', { class: 'tui-campo', disabled: somenteLeitura }, LEMBRETES.map(([v, t]) => h('option', { value: v === null ? '' : v, text: t, selected: (estado.lembrete_min ?? null) === v })));
      lembrete.addEventListener('change', () => { estado.lembrete_min = lembrete.value === '' ? null : Number(lembrete.value); marcar(); });
      lado.append(campo('Lembrete', 'fa-bell', lembrete, h('p', { class: 'tui-dica', text: 'No sino e como notificação do Windows. Sem hora, conta a partir das 9h.' })));

      // repetição
      const repeticao = editorDeRepeticao({ inicial: estado.recorrencia, diaBase: () => estado.data, aoMudar: r => { estado.recorrencia = r; marcar(); } });
      if (somenteLeitura) repeticao.querySelectorAll('select,input').forEach(x => { x.disabled = true; });
      lado.append(campo('Repetir', 'fa-repeat', repeticao));

      // prioridade
      const prioridades = h('div', { class: 'tui-prioridades', attrs: { role: 'radiogroup', 'aria-label': 'Prioridade' } });
      const pintarPrioridade = () => prioridades.replaceChildren(...Object.entries(PRIORIDADES).reverse().map(([chave, p]) => {
        const b = h('button', { type: 'button', class: 'tui-prioridade', title: p.rotulo, disabled: somenteLeitura, attrs: { role: 'radio', 'aria-checked': String(estado.prioridade === chave) }, on: { click: () => { estado.prioridade = chave; pintarPrioridade(); marcar(); } } }, icone('fa-flag'), h('span', { text: p.rotulo }));
        b.style.setProperty('--tui-prioridade-cor', p.cor);
        return b;
      }));
      pintarPrioridade();
      lado.append(campo('Prioridade', 'fa-flag', prioridades));

      // responsável
      const usuarios = ctx.usuarios || [];
      const nomeDe = uid => usuarios.find(u => Number(u.id) === Number(uid))?.nome || (Number(uid) === Number(eu.id) ? eu.nome : `#${uid}`);
      if (pode.atribuir && !somenteLeitura) {
        const resp = h('select', { class: 'tui-campo' }, usuarios.map(u => h('option', { value: u.id, text: Number(u.id) === Number(eu.id) ? `${u.nome} (você)` : u.nome, selected: Number(u.id) === Number(estado.responsavel_id) })));
        resp.addEventListener('change', () => { estado.responsavel_id = Number(resp.value); marcar(); seletorAcao?.trocarResponsavel?.(estado.responsavel_id); });
        lado.append(campo('Responsável', 'fa-user-check', resp));
      } else {
        lado.append(campo('Responsável', 'fa-user-check', h('div', { class: 'tui-pessoa' }, avatar(estado.responsavel_id, nomeDe(estado.responsavel_id), { tamanho: 'p' }), h('span', { text: Number(estado.responsavel_id) === Number(eu.id) ? `${nomeDe(estado.responsavel_id)} (você)` : nomeDe(estado.responsavel_id) }))));
      }

      // participantes
      const participantesAtuais = (original?.todos_participantes || []).filter(p => ['pendente', 'aceito'].includes(p.status));
      const listaParticipantes = h('div', { class: 'tui-participantes' });
      const pintarParticipantes = () => {
        listaParticipantes.replaceChildren(
          ...participantesAtuais.map(p => h('span', { class: `tui-participante tui-participante--${p.status}`, title: p.status === 'pendente' ? 'Convite enviado, esperando resposta' : 'Aceitou' },
            avatar(p.usuario_id, p.nome, { tamanho: 'p' }), h('span', { text: p.nome }), p.status === 'pendente' ? icone('fa-hourglass-half') : icone('fa-check'),
            (pode.editar || Number(p.usuario_id) === Number(eu.id)) ? h('button', { type: 'button', class: 'tui-chip__x', title: Number(p.usuario_id) === Number(eu.id) ? 'Sair da tarefa' : 'Tirar da tarefa', on: { click: async () => {
              try { await api(`/${original.id}/participantes/${p.usuario_id}`, { method: 'DELETE' }); participantesAtuais.splice(participantesAtuais.indexOf(p), 1); gravou = true; pintarParticipantes(); } catch (err) { avisar(err.message, 'error'); }
            } } }, icone('fa-xmark')) : null)),
          ...participantesNovos.map(uid => h('span', { class: 'tui-participante tui-participante--novo', title: 'Será convidado ao salvar' }, avatar(uid, nomeDe(uid), { tamanho: 'p' }), h('span', { text: nomeDe(uid) }),
            h('button', { type: 'button', class: 'tui-chip__x', title: 'Não convidar', on: { click: () => { participantesNovos = participantesNovos.filter(x => x !== uid); pintarParticipantes(); } } }, icone('fa-xmark'))))
        );
      };
      const convidar = h('select', { class: 'tui-campo', attrs: { 'aria-label': 'Convidar alguém' } });
      const pintarConvidar = () => {
        const ja = new Set([Number(estado.responsavel_id), Number(eu.id), ...participantesAtuais.map(p => Number(p.usuario_id)), ...participantesNovos.map(Number)]);
        convidar.replaceChildren(h('option', { value: '', text: '+ Convidar alguém…' }), ...usuarios.filter(u => !ja.has(Number(u.id))).map(u => h('option', { value: u.id, text: u.nome })));
      };
      convidar.addEventListener('change', () => { if (convidar.value) { participantesNovos.push(Number(convidar.value)); marcar(); pintarParticipantes(); pintarConvidar(); } });
      pintarParticipantes();
      pintarConvidar();
      lado.append(campo('Em conjunto com', 'fa-user-group', listaParticipantes, pode.convidar && !somenteLeitura ? convidar : null,
        pode.convidar && !somenteLeitura ? h('p', { class: 'tui-dica', text: 'O convidado aceita ou recusa pelo sino ou em Tarefas › Convites.' }) : null));

      // lista
      const listas = ctx.listas || [];
      const lista = h('select', { class: 'tui-campo', disabled: somenteLeitura }, h('option', { value: '', text: 'Caixa de entrada' }), listas.map(l => h('option', { value: l.id, text: l.nome, selected: Number(l.id) === Number(estado.lista_id) })));
      lista.addEventListener('change', () => { estado.lista_id = lista.value ? Number(lista.value) : null; marcar(); });
      if (estado.lista_id && !listas.some(l => Number(l.id) === Number(estado.lista_id))) lista.append(h('option', { value: estado.lista_id, text: 'Lista de outra pessoa', selected: true }));
      lado.append(campo('Lista', 'fa-list', lista));

      // marcadores
      const marcadoresCaixa = h('div', { class: 'tui-marcadores' });
      let todosMarcadores = [...(ctx.marcadores || [])];
      const pintarMarcadores = () => {
        marcadoresCaixa.replaceChildren(...todosMarcadores.map(m => {
          const ativo = estado.marcadores.includes(Number(m.id));
          const b = h('button', { type: 'button', class: 'tui-marcador', text: `#${m.nome}`, disabled: somenteLeitura, attrs: { 'aria-pressed': String(ativo) }, on: { click: () => {
            estado.marcadores = ativo ? estado.marcadores.filter(x => x !== Number(m.id)) : [...estado.marcadores, Number(m.id)];
            marcar();
            pintarMarcadores();
          } } });
          b.style.setProperty('--tui-marcador-cor', m.cor || '#d4c169');
          return b;
        }));
      };
      const novoMarcador = h('input', { class: 'tui-campo', type: 'text', maxLength: 40, placeholder: '+ Novo marcador (Enter)', hidden: somenteLeitura });
      novoMarcador.addEventListener('keydown', async e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const nome = novoMarcador.value.trim().replace(/^#/, '');
        if (!nome) return;
        try {
          const m = await api('/marcadores', { method: 'POST', corpo: { nome, cor: CORES_LISTA[todosMarcadores.length % CORES_LISTA.length] } });
          if (!todosMarcadores.some(x => Number(x.id) === Number(m.id))) todosMarcadores.push(m);
          if (!estado.marcadores.includes(Number(m.id))) estado.marcadores.push(Number(m.id));
          contexto = null;
          novoMarcador.value = '';
          marcar();
          pintarMarcadores();
        } catch (err) { avisar(err.message, 'error'); }
      });
      pintarMarcadores();
      lado.append(campo('Marcadores', 'fa-hashtag', marcadoresCaixa, novoMarcador));

      // local
      const local = h('input', { class: 'tui-campo', type: 'text', maxLength: 200, value: estado.local || '', placeholder: 'Endereço, sala, link da reunião…', readOnly: somenteLeitura });
      local.addEventListener('input', () => { estado.local = local.value; marcar(); });
      const campoLocal = campo('Local', 'fa-location-dot', local);
      const pintarLocal = () => { campoLocal.hidden = !['Reunião', 'Visita', 'Evento'].includes(estado.tipo) && !estado.local; };
      pintarLocal();
      lado.append(campoLocal);

      painelDetalhes.append(h('div', { class: 'tui-corpo' }, principal, lado));
      cartao.append(topo, painelDetalhes, painelConversa);

      // ---- rodapé
      const rodape = h('footer', { class: 'tui-rodape' });
      const esquerda = h('div', { class: 'tui-rodape__lado' });
      const direita = h('div', { class: 'tui-rodape__lado' });
      if (original && pode.excluir) {
        esquerda.append(h('button', { type: 'button', class: 'btn-danger tui-botao', on: { click: async () => {
          const ok = await window.DialogPadrao?.confirm({ title: 'Excluir esta tarefa?', tom: 'erro', icone: 'fa-trash-can', message: `"${original.titulo}" sai das listas e do calendário.`, nota: 'O registro continua guardado (com quem excluiu e quando) e o histórico da ficha ligada conta a exclusão.', confirmText: 'Excluir', confirmVariant: 'danger' });
          if (!ok) return;
          try { await api(`/${original.id}`, { method: 'DELETE' }); avisar('Tarefa excluída.', 'success'); gravou = true; mudou({ id: original.id }); d.fechar(); } catch (err) { avisar(err.message, 'error'); }
        } } }, icone('fa-trash-can'), ' Excluir'));
      }
      if (original && ['concluida', 'cancelada'].includes(original.status) && pode.concluir) {
        esquerda.append(h('button', { type: 'button', class: 'btn-warning tui-botao', on: { click: async () => {
          try { await api(`/${original.id}/reabrir`, { method: 'POST', corpo: {} }); avisar('Tarefa reaberta.', 'success'); gravou = true; mudou({ id: original.id }); d.fechar(); abrirEditor({ id: original.id }); } catch (err) { avisar(err.message, 'error'); }
        } } }, icone('fa-rotate-left'), ' Reabrir'));
      }
      const cancelar = h('button', { type: 'button', class: 'btn-neutral tui-botao', text: somenteLeitura ? 'Fechar' : 'Cancelar' });
      direita.append(cancelar);
      if (!somenteLeitura) {
        const salvar = h('button', { type: 'button', class: 'btn-primary tui-botao' }, icone('fa-floppy-disk'), nova ? ' Criar tarefa' : ' Salvar');
        salvar.addEventListener('click', () => gravar());
        direita.append(salvar);
      }
      if (original && !['concluida', 'cancelada'].includes(original.status) && pode.concluir) {
        direita.append(h('button', { type: 'button', class: 'btn-success tui-botao', on: { click: async () => {
          if (alterado && !somenteLeitura) { const ok = await gravar({ fecharDepois: false }); if (!ok) return; }
          d.fechar();
          concluir(original);
        } } }, icone('fa-circle-check'), ' Concluir'));
      }
      rodape.append(esquerda, direita);
      cartao.append(rodape);

      const tentarFechar = async () => {
        if (alterado && !somenteLeitura) {
          const ok = await window.DialogPadrao?.confirm({ title: 'Descartar as alterações?', tom: 'aviso', message: 'O que você mudou nesta tarefa ainda não foi salvo.', confirmText: 'Descartar', cancelText: 'Continuar editando', confirmVariant: 'danger' });
          if (!ok) return;
        }
        d.fechar();
      };
      fechar.addEventListener('click', tentarFechar);
      cancelar.addEventListener('click', tentarFechar);
      d.addEventListener('cancel', e => { e.preventDefault(); tentarFechar(); });
      d.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !somenteLeitura && painelConversa.hidden) { e.preventDefault(); gravar(); }
      });

      async function gravar({ fecharDepois = true } = {}) {
        if (!estado.titulo.trim()) { titulo.focus(); avisar('Dê um título para a tarefa.', 'error'); return false; }
        const vinc = estado.vinculos;
        const idDe = tipo => vinc.find(v => v.tipo === tipo)?.id ?? null;
        const corpo = {
          titulo: estado.titulo.trim(), descricao: estado.descricao || null, tipo: estado.tipo, prioridade: estado.prioridade,
          data: estado.data || null, hora: estado.data ? estado.hora || null : null, duracao_min: estado.hora ? estado.duracao_min || 30 : null,
          lembrete_min: estado.lembrete_min, local: estado.local || null, lista_id: estado.lista_id, marcadores: estado.marcadores,
          recorrencia: estado.data ? estado.recorrencia : null,
          cliente_id: idDe('cliente'), prospeccao_id: idDe('prospeccao'), orcamento_id: idDe('orcamento'), pedido_id: idDe('pedido')
        };
        if (pode.atribuir) corpo.responsavel_id = estado.responsavel_id;
        if (estado.acao?.chave && !estado.acao.registro) { avisar('Escolha o registro da ação (ou tire a ação).', 'error'); return false; }
        if (estado.acao && !estado.acao.chave && estado.acao.registro) { avisar('Escolha qual ação a tarefa cobra (ou tire a ação).', 'error'); return false; }
        if (estado.acao?.chave) Object.assign(corpo, { acao_chave: estado.acao.chave, acao_registro: estado.acao.registro, acao_rotulo: estado.acao.rotulo || null });
        else if (original?.acao) Object.assign(corpo, { acao_chave: null, acao_registro: null, acao_rotulo: null });
        try {
          let tarefaId = original?.id;
          if (nova) {
            const r = await api('', { method: 'POST', corpo: { ...corpo, checklist: checklistNovo, participantes: participantesNovos } });
            tarefaId = r.id;
            avisar(participantesNovos.length ? 'Tarefa criada e convites enviados.' : 'Tarefa criada.', 'success');
          } else {
            if (original.origem === 'proximo_passo') { delete corpo.cliente_id; delete corpo.prospeccao_id; }
            await api(`/${original.id}`, { method: 'PUT', corpo });
            if (participantesNovos.length) await api(`/${original.id}/participantes`, { method: 'POST', corpo: { usuarios: participantesNovos } });
            avisar('Tarefa salva.', 'success');
          }
          gravou = true;
          alterado = false;
          participantesNovos = [];
          mudou({ id: tarefaId });
          if (fecharDepois) d.fechar();
          return true;
        } catch (err) {
          avisar(err.message, 'error');
          return false;
        }
      }

      d.showModal();
      if (original && aba === 'conversa') trocarAba('conversa');
      else if (original) trocarAba('detalhes');
      if (nova) setTimeout(() => titulo.focus(), 30);
    });
  }

  // ------------------------------------------------------------ concluir

  const ehPassoDaProspeccao = t => t?.origem === 'proximo_passo' && Boolean(idDaProspeccao(t));
  const idDaProspeccao = t => t?.prospeccao_id || (t?.vinculos || []).find(v => v.tipo === 'prospeccao')?.id || null;
  const OVERLAYS_DO_PASSO = ['concluirPassoOverlay', 'converterProspeccaoOverlay'];

  /**
   * Tarefa de próximo passo: concluir É o "Concluir passo planejado" da
   * prospecção — o que aconteceu, com quem, o rumo no funil e o próximo passo,
   * tudo obrigatório lá. O backend conclui esta tarefa junto (passoNaTarefa,
   * em backend/prospeccoesController.js), então aqui só se abre o modal dela,
   * por cima da tela onde a pessoa está.
   */
  async function concluirPassoNaProspeccao(t) {
    const prospeccaoId = idDaProspeccao(t);
    try {
      const r = await chamar(`/api/prospeccoes/${prospeccaoId}`);
      const ficha = r?.prospeccao || r;
      if (!ficha?.id) throw new Error('Prospecção não encontrada.');
      if (!String(ficha.proximo_passo || '').trim()) throw new Error('Esta prospecção já não tem passo em aberto — atualize a lista.');
      window.prospeccaoAcaoAlvo = ficha;
      window.prospeccaoAcaoContatos = Array.isArray(r?.contatos) ? r.contatos : [];
      // O modal usa a folha do módulo Prospecções (botões, selos). Fora dele,
      // a folha entra só enquanto o modal (ou a conversão que ele abre) existir.
      const naPagina = document.querySelector('link#page-style[data-page="prospeccoes"]');
      let folha = null;
      if (!naPagina) {
        folha = document.createElement('link');
        folha.rel = 'stylesheet';
        folha.href = '../css/prospeccoes.css';
        folha.dataset.tuiFolha = 'prospeccoes';
        document.head.appendChild(folha);
      }
      await window.Modal.open('modals/prospeccoes/concluir-passo.html', '../js/modals/prospeccao-concluir-passo.js', 'concluirPasso', true);
      // Quando o modal (e a conversão, se escolhida) fechar: tira a folha e
      // atualiza as listas — concluído ou não, o passo pode ter mudado.
      const vigiar = setInterval(() => {
        if (OVERLAYS_DO_PASSO.some(id => document.getElementById(id))) return;
        clearInterval(vigiar);
        folha?.remove();
        mudou({ id: t.id, prospeccao_id: prospeccaoId });
      }, 500);
      return true;
    } catch (err) {
      avisar(`Não foi possível abrir o passo da prospecção: ${err.message}`, 'error');
      return false;
    }
  }

  /** Concluir com resultado e nota; opcionalmente já agenda a próxima. */
  function concluir(t, { rapido = false } = {}) {
    // Próximo passo da prospecção: sempre pelo modal dela (nem o Shift+clique
    // pula — o passo exige dizer o que aconteceu e o que vem depois).
    if (ehPassoDaProspeccao(t) && ['a_fazer', 'em_andamento', 'aguardando'].includes(t.status)) return concluirPassoNaProspeccao(t);
    if (rapido) {
      return api(`/${t.id}/concluir`, { method: 'POST', corpo: { resultado: 'feito' } })
        .then(r => { avisar(r.serie_data ? `Concluída. A próxima da série ficou para ${dataBr(r.serie_data)}.` : 'Tarefa concluída.', 'success'); mudou({ id: t.id }); return true; })
        .catch(err => { avisar(err.message, 'error'); return false; });
    }
    return new Promise(resolver => {
      let feito = false;
      const d = dialogo({ classe: 'tui-dialogo--concluir', rotulo: 'Concluir tarefa', aoFechar: () => resolver(feito) });
      const ligada = (t.vinculos || []).find(v => v.tipo === 'cliente' || v.tipo === 'prospeccao');
      let resultado = 'feito';
      const opcoes = h('div', { class: 'tui-resultados', attrs: { role: 'radiogroup', 'aria-label': 'Como foi' } });
      const pintarOpcoes = () => opcoes.replaceChildren(...Object.entries(RESULTADOS).map(([chave, r]) => h('button', {
        type: 'button', class: 'tui-resultado', attrs: { role: 'radio', 'aria-checked': String(resultado === chave) },
        on: { click: () => { resultado = chave; pintarOpcoes(); } }
      }, icone(r.icone), h('span', { text: r.rotulo }))));
      pintarOpcoes();
      const nota = h('textarea', { class: 'tui-campo', rows: 3, maxLength: 2000, placeholder: ligada ? `Como foi? Vai para as atividades de ${ligada.nome}.` : 'Como foi? (opcional)' });
      const agendar = h('input', { type: 'checkbox' });
      const proximoTitulo = h('input', { class: 'tui-campo', type: 'text', maxLength: 200, value: t.origem === 'proximo_passo' ? '' : `Follow-up: ${t.titulo}`.slice(0, 200), placeholder: 'O que fazer em seguida' });
      let proximaData = somarDias(hoje(), 3);
      const dataProx = h('input', { class: 'tui-campo', type: 'date', value: proximaData });
      const horaProx = h('input', { class: 'tui-campo', type: 'time' });
      const atalhos = h('div', { class: 'tui-atalhos' }, [['Amanhã', 1], ['Em 3 dias', 3], ['Próx. semana', 7], ['Em 15 dias', 15]].map(([txt, n]) => h('button', {
        type: 'button', class: 'tui-atalho', text: txt, on: { click: () => { proximaData = somarDias(hoje(), n); dataProx.value = proximaData; } }
      })));
      dataProx.addEventListener('change', () => { proximaData = dataProx.value; });
      const proxima = h('div', { class: 'tui-proxima', hidden: true }, proximoTitulo, atalhos, h('div', { class: 'tui-linha' }, dataProx, horaProx));
      agendar.addEventListener('change', () => { proxima.hidden = !agendar.checked; if (agendar.checked) proximoTitulo.focus(); });
      const botaoConcluir = h('button', { type: 'button', class: 'btn-success tui-botao' }, icone('fa-circle-check'), ' Concluir');
      const cancelar = h('button', { type: 'button', class: 'btn-neutral tui-botao', text: 'Cancelar', on: { click: () => d.fechar() } });
      botaoConcluir.addEventListener('click', async () => {
        const corpo = { resultado, nota: nota.value.trim() || null };
        if (agendar.checked) {
          if (!proximoTitulo.value.trim()) { proximoTitulo.focus(); avisar('Diga o que fazer em seguida.', 'error'); return; }
          corpo.proxima = { titulo: proximoTitulo.value.trim(), data: dataProx.value || null, hora: horaProx.value || null };
        }
        try {
          const r = await api(`/${t.id}/concluir`, { method: 'POST', corpo });
          feito = true;
          const partes = ['Tarefa concluída.'];
          if (r.interacao) partes.push('A atividade foi registrada na ficha.');
          if (r.serie_data) partes.push(`A próxima da série ficou para ${dataBr(r.serie_data)}.`);
          if (corpo.proxima) partes.push('A próxima já está agendada.');
          avisar(partes.join(' '), 'success');
          mudou({ id: t.id });
          d.fechar();
        } catch (err) { avisar(err.message, 'error'); }
      });
      d.append(h('div', { class: 'tui-cartao tui-cartao--estreito' },
        h('header', { class: 'tui-concluir__topo' }, h('span', { class: 'tui-concluir__icone' }, icone('fa-check')), h('div', {}, h('h3', { class: 'tui-concluir__titulo', text: 'Concluir tarefa' }), h('p', { class: 'tui-concluir__sub', text: t.titulo }))),
        h('div', { class: 'tui-concluir__corpo' },
          h('span', { class: 'tui-rotulo', text: 'Como foi?' }), opcoes, nota,
          ligada ? h('p', { class: 'tui-dica' }, icone('fa-circle-info'), ` Vira uma atividade em ${VINCULO[ligada.tipo].rotulo.toLowerCase()} · ${ligada.nome} e aparece no histórico.`) : null,
          t.recorrencia_texto ? h('p', { class: 'tui-dica' }, icone('fa-repeat'), ` ${t.recorrencia_texto}: a próxima da série nasce sozinha.`) : null,
          t.acao ? h('p', { class: 'tui-dica tui-dica--aviso' }, icone('fa-bolt'), ` Esta tarefa conclui sozinha quando "${t.acao.rotulo}" for feito no módulo ${t.acao.moduloRotulo}. Concluir aqui não faz a ação por você.`) : null,
          h('label', { class: 'tui-check tui-check--destaque' }, agendar, t.origem === 'proximo_passo' ? ' Definir o próximo passo da prospecção' : ' Agendar a próxima'), proxima),
        h('footer', { class: 'tui-rodape' }, h('div', { class: 'tui-rodape__lado' }), h('div', { class: 'tui-rodape__lado' }, cancelar, botaoConcluir))
      ));
      d.addEventListener('cancel', e => { e.preventDefault(); d.fechar(); });
      d.showModal();
      nota.focus();
    });
  }

  async function responderConvite(id, resposta) {
    try {
      await api(`/${id}/convite`, { method: 'POST', corpo: { resposta } });
      avisar(resposta === 'aceitar' ? 'Convite aceito: a tarefa já está na sua lista.' : 'Convite recusado.', 'success');
      contexto = null;
      mudou({ id });
      return true;
    } catch (err) {
      avisar(err.message, 'error');
      return false;
    }
  }

  // ------------------------------------------------------------ Meu dia

  /** O cartão "Meu dia" (Dashboard e topo de Tarefas). */
  async function montarMeuDia(alvo, { aoClicar } = {}) {
    if (!alvo) return;
    const pintar = async () => {
      let r;
      try { r = await api('/resumo'); } catch (err) { alvo.hidden = true; return; }
      if (r.sql_pendente) { alvo.hidden = true; return; }
      alvo.hidden = false;
      const agora = agoraEmBrasilia();
      const saudacao = agora.minutos < 720 ? 'Bom dia' : agora.minutos < 1080 ? 'Boa tarde' : 'Boa noite';
      const numero = (valor, rotulo, ic, tom, filtro) => h('button', { type: 'button', class: `tui-dia__numero tui-dia__numero--${tom}`, on: { click: () => aoClicar?.(filtro) } },
        icone(ic), h('strong', { text: String(valor) }), h('span', { text: rotulo }));
      alvo.replaceChildren(h('div', { class: 'tui-meudia' },
        h('div', { class: 'tui-meudia__cabeca' },
          h('span', { class: 'tui-meudia__ola', text: `${saudacao}! Seu dia` }),
          h('span', { class: 'tui-meudia__data', text: dataLonga(agora.dia) })),
        h('div', { class: 'tui-meudia__numeros' },
          numero(r.hoje, 'para hoje', 'fa-sun', 'ouro', 'hoje'),
          numero(r.atrasadas, r.atrasadas === 1 ? 'atrasada' : 'atrasadas', 'fa-triangle-exclamation', r.atrasadas ? 'perigo' : 'neutro', 'atrasadas'),
          numero(r.concluidas_hoje, 'feitas hoje', 'fa-circle-check', 'sucesso', 'concluidas'),
          numero(r.convites, r.convites === 1 ? 'convite' : 'convites', 'fa-user-plus', r.convites ? 'info' : 'neutro', 'convites')),
        r.proxima ? h('button', { type: 'button', class: 'tui-meudia__proxima', on: { click: () => abrirEditor({ id: r.proxima.id }) } }, icone('fa-clock'), ` Próxima: ${r.proxima.hora} · ${r.proxima.titulo}`) : null
      ));
    };
    await pintar();
    const aoMudar = () => { if (alvo.isConnected) pintar(); else window.removeEventListener('tarefas:mudou', aoMudar); };
    window.addEventListener('tarefas:mudou', aoMudar);
  }

  // ------------------------------------------------------------ exportar

  async function exportarIcs(tarefas, { nome } = {}) {
    const texto = gerarIcs(tarefas, { nome: nome || 'Tarefas — Santíssimo Decor' });
    const arquivo = `tarefas-${hoje()}`;
    if (window.electronAPI?.salvarTextoComoArquivo) {
      const r = await window.electronAPI.salvarTextoComoArquivo({ conteudo: texto, nomeSugerido: arquivo, extensao: 'ics', titulo: 'Exportar para Google Agenda / Outlook', descricao: 'Calendário (.ics)' });
      if (r?.canceled) return false;
      if (!r?.success) throw new Error(r?.message || 'Não foi possível salvar o arquivo.');
    } else {
      const url = URL.createObjectURL(new Blob([texto], { type: 'text/calendar;charset=utf-8' }));
      const a = h('a', { href: url, download: `${arquivo}.ics` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return true;
  }

  // ------------------------------------------------------------ linha de tarefa

  /** Reagenda sem abrir nada (arrastar, "Hoje", "Amanhã"...). */
  async function mover(t, patch) {
    try {
      await api(`/${t.id}/mover`, { method: 'PATCH', corpo: patch });
      mudou({ id: t.id });
      return true;
    } catch (err) {
      avisar(err.message, 'error');
      return false;
    }
  }

  /**
   * A linha de uma tarefa (Tarefas, fichas, dia do calendário): o círculo de
   * concluir na cor da prioridade, o título e os chips — prazo, tipo, vínculo,
   * lista, marcadores, checklist, conversa, repetição, pessoas.
   * opcoes: { ctx, compacta, semVinculo, convite }
   */
  function linhaDeTarefa(t, { ctx = contexto, compacta = false, semVinculo = false, convite = null } = {}) {
    const agora = agoraEmBrasilia();
    const aberta = ['a_fazer', 'em_andamento', 'aguardando'].includes(t.status);
    const atrasadaAgora = aberta && atrasada(t, agora);
    const el = h('article', {
      class: `tui-tarefa${atrasadaAgora ? ' tui-tarefa--atrasada' : ''}${!aberta ? ' tui-tarefa--concluida' : ''}${convite ? ' tui-tarefa--convite' : ''}${t.origem === 'proximo_passo' ? ' tui-tarefa--passo' : ''}`,
      attrs: { tabindex: '0', 'aria-label': t.titulo }, dataset: { tarefaId: t.id }
    });
    el.style.setProperty('--tui-prioridade-cor', PRIORIDADES[t.prioridade]?.cor || '#8aa7f3');

    const check = h('button', {
      type: 'button', class: 'tui-tarefa__check',
      title: !aberta ? 'Concluída — clique para abrir' : t.origem === 'proximo_passo' ? 'Concluir o passo (abre o "Concluir passo planejado")' : 'Concluir (Shift+clique conclui direto)',
      attrs: { 'aria-label': aberta ? 'Concluir' : 'Concluída' }
    }, icone('fa-check'));
    check.addEventListener('click', e => {
      e.stopPropagation();
      if (convite) return;
      if (!aberta) { abrirEditor({ id: t.id }); return; }
      if (!t.pode?.concluir) { avisar('Só quem responde ou participa conclui esta tarefa.', 'error'); return; }
      concluir(t, { rapido: e.shiftKey });
    });

    const meta = h('div', { class: 'tui-tarefa__meta' });
    // O próximo passo combinado na prospecção tem selo próprio: é o compromisso
    // do funil, e concluí-lo abre o "Concluir passo planejado".
    if (t.origem === 'proximo_passo') meta.append(chip('Próximo passo', { icone: 'fa-forward-step', classe: 'tui-chip--passo', titulo: 'Próximo passo combinado na prospecção — concluir abre o "Concluir passo planejado"' }));
    if (t.data || !compacta) {
      const hojeDia = agora.dia;
      const classe = atrasadaAgora ? 'tui-chip--perigo' : t.data === hojeDia ? 'tui-chip--ouro' : '';
      meta.append(chip(atrasadaAgora ? `${rotuloDoPrazo(t, hojeDia)} · atrasada` : rotuloDoPrazo(t, hojeDia), { icone: atrasadaAgora ? 'fa-triangle-exclamation' : 'fa-calendar', classe }));
    }
    if (t.tipo && t.tipo !== 'Tarefa') meta.append(chip(t.tipo, { icone: TIPOS[t.tipo]?.icone, cor: TIPOS[t.tipo]?.cor }));
    if (!semVinculo) for (const v of t.vinculos || []) meta.append(chip(v.nome, { icone: VINCULO[v.tipo]?.icone, classe: 'tui-chip--vinculo', titulo: VINCULO[v.tipo]?.rotulo }));
    const lista = (ctx?.listas || []).find(l => Number(l.id) === Number(t.lista_id));
    if (lista && !compacta) meta.append(chip(lista.nome, { icone: 'fa-circle', cor: lista.cor }));
    for (const mid of t.marcadores || []) {
      const m = (ctx?.marcadores || []).find(x => Number(x.id) === Number(mid));
      if (m) meta.append(chip(`#${m.nome}`, { cor: m.cor }));
    }
    if (t.recorrencia) meta.append(chip(t.recorrencia_texto || 'Repete', { icone: 'fa-repeat' }));
    if (t.acao) meta.append(chip(t.acao.registroTipo === 'competencia' ? `${t.acao.rotulo} · ${competenciaLegivel(t.acao.registro)}` : t.acao.rotulo, {
      icone: 'fa-bolt', classe: 'tui-chip--acao', titulo: `Ação no sistema (${t.acao.moduloRotulo}): conclui sozinha quando isso for feito lá${t.acao.registroRotulo ? ` — ${t.acao.registroRotulo}` : ''}`
    }));
    if (t.checklist?.total) meta.append(h('span', { class: 'tui-tarefa__contador', title: 'Checklist' }, icone('fa-list-check'), ` ${t.checklist.feitos}/${t.checklist.total}`));
    if (t.comentarios) meta.append(h('span', { class: 'tui-tarefa__contador', title: 'Comentários' }, icone('fa-comment'), ` ${t.comentarios}`));
    if (t.anexos) meta.append(h('span', { class: 'tui-tarefa__contador', title: 'Anexos' }, icone('fa-paperclip'), ` ${t.anexos}`));
    if (t.origem === 'automacao' && !compacta) meta.append(h('span', { class: 'tui-tarefa__contador', title: 'Criada automaticamente' }, icone('fa-robot')));

    const corpo = h('div', { class: 'tui-tarefa__corpo' }, h('span', { class: 'tui-tarefa__titulo', text: t.titulo }));
    if (t.descricao && !compacta) corpo.append(h('span', { class: 'tui-tarefa__descricao', text: t.descricao }));
    if (!aberta && t.resultado_texto && t.resultado !== 'feito') corpo.append(h('span', { class: 'tui-tarefa__descricao', text: `Resultado: ${t.resultado_texto}${t.resultado_nota ? ` — ${t.resultado_nota}` : ''}` }));
    corpo.append(meta);

    const lado = h('div', { class: 'tui-tarefa__lado' });
    if (convite) {
      lado.append(
        h('button', { type: 'button', class: 'tui-mini-botao tui-mini-botao--sim', on: { click: e => { e.stopPropagation(); responderConvite(t.id, 'aceitar'); } } }, icone('fa-check'), ' Aceitar'),
        h('button', { type: 'button', class: 'tui-mini-botao tui-mini-botao--nao', on: { click: e => { e.stopPropagation(); responderConvite(t.id, 'recusar'); } } }, icone('fa-xmark'), ' Recusar'));
    } else {
      if (aberta && t.pode?.concluir && !compacta) {
        const hojeDia = agora.dia;
        const acoes = h('div', { class: 'tui-tarefa__acoes' },
          [['Hoje', 0], ['Amanhã', 1], ['+1 sem', 7]].filter(([, n]) => somarDias(hojeDia, n) !== t.data).map(([rotulo, n]) => h('button', {
            type: 'button', class: 'tui-mini-botao', text: rotulo, title: `Passar para ${rotulo.toLowerCase()}`,
            on: { click: e => { e.stopPropagation(); mover(t, { data: somarDias(hojeDia, n) }); } }
          })));
        lado.append(acoes);
      }
      for (const p of (t.participantes || []).slice(0, 3)) lado.append(avatar(p.usuario_id, p.nome, { tamanho: 'p', titulo: `${p.nome}${p.status === 'pendente' ? ' (convite pendente)' : ' (em conjunto)'}` }));
      if (t.responsavel_id && ctx?.eu && Number(t.responsavel_id) !== Number(ctx.eu.id)) lado.append(avatar(t.responsavel_id, t.responsavel, { tamanho: 'm', titulo: `Responsável: ${t.responsavel}` }));
    }
    el.append(check, corpo, lado);
    el.addEventListener('click', () => abrirEditor({ id: t.id }));
    el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === el) abrirEditor({ id: t.id }); });
    return el;
  }

  // ------------------------------------------------------------ tarefas da ficha

  /**
   * O bloco "Tarefas" dentro da ficha do cliente/prospecção: as abertas
   * ligadas a ela (as que eu vejo), as concluídas recolhidas e o botão
   * "Agendar tarefa" (já ligada à ficha). tipo: 'cliente' | 'prospeccao'.
   */
  function montarTarefasDaFicha(alvo, { tipo, id, nome }) {
    if (!alvo) return () => {};
    let mostrarConcluidas = false;
    const pintar = async () => {
      if (!alvo.isConnected) { window.removeEventListener('tarefas:mudou', pintar); return; }
      let ctx;
      let r;
      try {
        [ctx, r] = await Promise.all([carregarContexto(), api(`?${tipo === 'cliente' ? 'cliente_id' : 'prospeccao_id'}=${encodeURIComponent(id)}&dias_concluidas=365`)]);
      } catch (err) {
        alvo.replaceChildren(h('p', { class: 'tui-dica tui-dica--aviso', text: err.sql_pendente ? 'As tarefas aparecem aqui depois que o SQL de tarefas for executado.' : `Não foi possível carregar as tarefas: ${err.message}` }));
        return;
      }
      if (ctx.sql_pendente || r.sql_pendente) {
        alvo.replaceChildren(h('div', { class: 'tui-aviso-sql' }, icone('fa-database'), h('span', { text: 'As tarefas aparecem aqui depois que o SQL de tarefas (sql/tarefas_calendario.sql) for executado.' })));
        return;
      }
      await carregarFotos();
      const tarefas = r.tarefas || [];
      const abertas = tarefas.filter(t => ['a_fazer', 'em_andamento', 'aguardando'].includes(t.status));
      const feitas = tarefas.filter(t => t.status === 'concluida');
      const agora = agoraEmBrasilia();
      const atrasadasN = abertas.filter(t => atrasada(t, agora)).length;
      const topo = h('div', { class: 'tui-ficha__topo' },
        h('div', { class: 'tui-ficha__titulo' }, icone('fa-list-check'), h('strong', { text: 'Tarefas' }),
          abertas.length ? chip(`${abertas.length} aberta${abertas.length > 1 ? 's' : ''}`, { classe: 'tui-chip--ouro' }) : null,
          atrasadasN ? chip(`${atrasadasN} atrasada${atrasadasN > 1 ? 's' : ''}`, { icone: 'fa-triangle-exclamation', classe: 'tui-chip--perigo' }) : null),
        ctx.pode.criar ? h('button', { type: 'button', class: 'btn-primary tui-botao', on: { click: () => abrirEditor({ preset: { vinculos: [{ tipo, id: Number(id), nome }], data: hoje() } }) } }, icone('fa-plus'), ' Agendar tarefa') : null);
      const lista = h('div', { class: 'tui-ficha__lista' });
      if (!abertas.length) lista.append(h('p', { class: 'tui-dica', text: 'Nenhuma tarefa aberta. Agende a próxima ligação, visita ou retorno — ela aparece aqui, em Tarefas e no Calendário.' }));
      abertas.sort((a, b) => (a.data || '9999').localeCompare(b.data || '9999') || (a.hora || '').localeCompare(b.hora || '')).forEach(t => lista.append(linhaDeTarefa(t, { ctx, semVinculo: true })));
      const partes = [topo, lista];
      if (feitas.length) {
        const botao = h('button', { type: 'button', class: 'tui-link tui-ficha__ver', on: { click: () => { mostrarConcluidas = !mostrarConcluidas; pintar(); } } },
          icone(mostrarConcluidas ? 'fa-chevron-up' : 'fa-chevron-down'), ` ${mostrarConcluidas ? 'Esconder' : 'Ver'} concluídas (${feitas.length})`);
        partes.push(botao);
        if (mostrarConcluidas) {
          const concluidas = h('div', { class: 'tui-ficha__lista' });
          feitas.sort((a, b) => String(b.concluida_em).localeCompare(String(a.concluida_em))).forEach(t => concluidas.append(linhaDeTarefa(t, { ctx, semVinculo: true, compacta: true })));
          partes.push(concluidas);
        }
      }
      alvo.replaceChildren(h('div', { class: 'tui-ficha tui-escopo' }, ...partes));
    };
    pintar();
    window.addEventListener('tarefas:mudou', pintar);
    return pintar;
  }

  window.TarefasUI = {
    // telas
    abrirEditor, concluir, responderConvite, montarMeuDia, exportarIcs, abrirVinculo, abrirAcao, linhaDeTarefa, mover, montarTarefasDaFicha,
    carregarContexto, carregarFotos, api, h, icone, avatar, chip, dialogo,
    limparContexto: () => { contexto = null; },
    // puras
    interpretarTexto, feriadosDoAno, pascoa, gerarIcs, descreverRepeticao, rotuloDoPrazo, atrasada,
    agoraEmBrasilia, hoje, somarDias, somarMeses, diaDaSemana, diasEntre, inicioDaSemana,
    dataCurta, dataBr, dataLonga, mesAno, minutosDaHora, horaDeMinutos, iniciais, semAcento,
    TIPOS, PRIORIDADES, STATUS, RESULTADOS, VINCULO, DIAS_CURTOS, DIAS_LONGOS, MESES, CORES_LISTA
  };
})();
