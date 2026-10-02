/**
 * Avisos de "algo seu" no sino (01/10/2026, pedido do dono).
 *
 * Toda vez que OUTRA pessoa
 *   - passa para você uma ficha (responsável, dono) ou tira de você;
 *   - exclui, cancela ou altera algo que é seu: que você criou, de que você é
 *     o responsável/dono ou de que você participa;
 *   - exclui ou altera um registro que você escreveu (uma interação, uma
 *     nota, um comentário tirado do histórico);
 * você recebe um aviso — e, quando a ação traz texto (nota, motivo,
 * observação, justificativa), o texto vem junto, como no histórico.
 *
 * O texto vai na própria `mensagem` (sem coluna nova e sem SQL), em linhas:
 *   1ª linha   o que aconteceu: "Ana passou a prospecção ACME para você."
 *   "• …"      o que mudou, uma linha por mudança (até 5, e "e mais N")
 *   "» …"      a nota, o motivo ou a observação, como foi escrita; uma nota
 *              com várias linhas tem "» " em cada uma, e um "»" sozinho
 *              separa uma nota da outra
 * O sino (notificacoesController.partesDaMensagem) separa as partes.
 *
 * Nunca avisa quem agiu, nem duas vezes a mesma pessoa pela mesma ação. Sem
 * quem agiu (o sistema sozinho), não avisa. Falha ao avisar vai só para o
 * log: nunca desfaz o que foi salvo.
 */

const MARCA_MUDANCA = '• ';
const MARCA_NOTA = '» ';
const MAX_MUDANCAS = 5;
const MAX_NOTAS = 3;
const MAX_NOTA = 600;
const MAX_VALOR = 80;

/**
 * Cada coisa que avisa: o nome, se é "a" ou "o" (para o título concordar),
 * a tabela da API e se o nome vai entre aspas (título de tarefa é frase).
 */
const ORIGENS = {
  prospeccao: { nome: 'prospecção', f: true, tabela: 'prospeccoes' },
  cliente: { nome: 'cliente', tabela: 'clientes' },
  contato: { nome: 'contato', tabela: 'contatos' },
  tarefa: { nome: 'tarefa', f: true, tabela: 'tarefas', aspas: true },
  orcamento: { nome: 'orçamento', tabela: 'orcamentos' },
  pedido: { nome: 'pedido', tabela: 'pedidos' },
  usuario: { nome: 'cadastro', tabela: 'usuarios' }
};

/** Os campos que dizem de quem é a ficha: trocar um deles é "passar para outra pessoa". */
const CAMPOS_DE_RESPONSAVEL = new Set(['responsavel_id', 'dono_cliente', 'dono']);

/** O próximo passo da prospecção: quem recebe a tarefa dele já foi avisado por ela. */
const CAMPOS_DO_PASSO = new Set(['proximo_passo', 'proximo_passo_data']);

/** Observações que o próprio sistema escreve e não explicam nada a quem recebe. */
const NOTAS_DO_SISTEMA = new Set(['cadastro inicial']);

const VERBOS = {
  criou: 'Criou', alterou: 'Alterou', excluiu: 'Excluiu', moveu: 'Moveu', converteu: 'Converteu',
  publicou: 'Publicou', concluiu: 'Concluiu', reabriu: 'Reabriu', cancelou: 'Cancelou',
  convidou: 'Convidou', respondeu: 'Respondeu'
};

const texto = v => (v === undefined || v === null ? '' : String(v).trim());
const lista = r => (Array.isArray(r) ? r : []);
const idValido = v => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const mesmoId = (a, b) => idValido(a) !== null && idValido(a) === idValido(b);
const maiuscula = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function cortar(valor, max) {
  const s = texto(valor).replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** As marcas da linha do tempo (@menção, citação) viram texto de ler. */
function semMarcas(t) {
  return require('./historicoSocial').textoSimples(t);
}

/** "2026-09-14" vira "14/09/2026"; o resto fica como veio (cortado). Pura. */
function valorLegivel(valor) {
  if (valor === undefined || valor === null) return null;
  if (typeof valor === 'boolean') return valor ? 'Sim' : 'Não';
  const s = texto(typeof valor === 'object' ? JSON.stringify(valor) : valor);
  if (!s) return null;
  const dia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (dia) return `${dia[3]}/${dia[2]}/${dia[1]}`;
  return cortar(semMarcas(s), MAX_VALOR);
}

/**
 * "a prospecção ACME", "a tarefa “Ligar para o João”", "o pedido 123" — e,
 * com a preposição, "do cliente X" / "na prospecção Y". Pura.
 */
function oQue(origem, nome, prep = '') {
  const o = ORIGENS[origem] || { nome: 'registro' };
  const artigo = { '': o.f ? 'a' : 'o', de: o.f ? 'da' : 'do', em: o.f ? 'na' : 'no' }[prep] || (o.f ? 'a' : 'o');
  const n = cortar(nome, 70);
  if (!n) return `${artigo} ${o.nome}`;
  return `${artigo} ${o.nome} ${o.aspas ? `“${n}”` : n}`;
}

/** "Prospecção", "Cliente"… e a terminação do adjetivo ("excluída"/"excluído"). */
const nomeDaOrigem = origem => maiuscula((ORIGENS[origem] || { nome: 'registro' }).nome);
const fim = origem => (ORIGENS[origem]?.f ? 'a' : 'o');

/**
 * Um evento do histórico em uma linha, do jeito que a linha do tempo mostra:
 * "Etapa do funil: Proposta → Perdido", "Excluiu Interação: Ligação". Pura.
 */
function linhaDoEvento(e) {
  if (!e) return null;
  const entidade = cortar(semMarcas(e.entidade), MAX_VALOR) || maiuscula(texto(e.tipo)) || 'Registro';
  const antes = valorLegivel(e.valor_anterior);
  const depois = valorLegivel(e.valor_novo);
  const repete = v => !v || entidade.toLowerCase().includes(v.toLowerCase());
  switch (e.acao) {
    case 'alterou':
    case 'moveu':
    case 'atribuiu':
      if (antes || depois) return `${entidade}: ${antes || 'vazio'} → ${depois || 'vazio'}`;
      return `Alterou ${entidade}`;
    case 'criou':
      return repete(depois) ? `Criou ${entidade}` : `Criou ${entidade}: ${depois}`;
    case 'excluiu':
      return repete(antes) ? `Excluiu ${entidade}` : `Excluiu ${entidade}: ${antes}`;
    default: {
      const verbo = VERBOS[e.acao] || maiuscula(texto(e.acao)) || 'Alterou';
      return repete(depois) ? `${verbo} ${entidade}` : `${verbo} ${entidade}: ${depois}`;
    }
  }
}

/** O `detalhe` é JSONB: às vezes chega objeto, às vezes texto. */
function lerDetalhe(bruto) {
  if (!bruto) return null;
  if (typeof bruto === 'object') return bruto;
  try { return JSON.parse(bruto); } catch (_) { return null; }
}

/**
 * Os textos escritos por gente que vieram com a ação: a observação de cada
 * evento, a nota/descrição gravada no detalhe (a "nota" de concluir, o
 * "detalhe" da interação) e a `nota` avulsa de quem chamou. Sem repetir e sem
 * as observações automáticas ("Cadastro inicial"). Pura.
 */
function notasDosEventos(eventos = [], extra = null) {
  const vistos = new Set();
  const saida = [];
  const somar = bruto => {
    const t = semMarcas(bruto).replace(/\r\n?/g, '\n').trim();
    if (!t) return;
    const chave = t.toLowerCase();
    if (NOTAS_DO_SISTEMA.has(chave) || vistos.has(chave)) return;
    vistos.add(chave);
    saida.push(t.length > MAX_NOTA ? `${t.slice(0, MAX_NOTA - 1).trimEnd()}…` : t);
  };
  for (const e of lista(eventos)) {
    if (!e) continue;
    somar(e.observacao);
    const d = lerDetalhe(e.detalhe);
    if (d && typeof d.nota === 'string') somar(d.nota);
    // A descrição escrita ao registrar (a interação); na exclusão ela é só o
    // retrato do que saiu, e já está na linha da mudança.
    if (e.acao === 'criou' && d?.registro && typeof d.registro.detalhe === 'string') somar(d.registro.detalhe);
  }
  for (const n of Array.isArray(extra) ? extra : [extra]) if (typeof n === 'string') somar(n);
  return saida.slice(0, MAX_NOTAS);
}

/** O evento que troca quem responde pela ficha? */
const ehTroca = e => e && ['alterou', 'moveu', 'atribuiu'].includes(e.acao) && CAMPOS_DE_RESPONSAVEL.has(texto(e.campo));

/**
 * O id de um usuário pelo nome que o histórico guardou ("Ana Souza", ou
 * "#7" quando o nome não foi achado). Pura.
 */
function idPeloNome(nome, nomes = new Map()) {
  const t = texto(nome);
  if (!t) return null;
  const marca = /^#(\d+)$/.exec(t);
  if (marca) return idValido(marca[1]);
  const alvo = t.toLowerCase();
  for (const [id, n] of nomes) if (texto(n).toLowerCase() === alvo) return idValido(id);
  return null;
}

/** A troca de responsável/dono que veio nos eventos: { de, para } em ids, ou null. Pura. */
function trocaNosEventos(eventos = [], nomes = new Map()) {
  const e = lista(eventos).find(ehTroca);
  if (!e) return null;
  const de = idPeloNome(e.valor_anterior, nomes);
  const para = idPeloNome(e.valor_novo, nomes);
  return de || para ? { de, para } : null;
}

/** Junta as linhas da mensagem (ver o topo). Pura. */
function comporMensagem(primeira, mudancas = [], notas = []) {
  const linhas = [texto(primeira)];
  const ms = lista(mudancas).filter(Boolean);
  ms.slice(0, MAX_MUDANCAS).forEach(m => linhas.push(MARCA_MUDANCA + m));
  if (ms.length > MAX_MUDANCAS) {
    const resto = ms.length - MAX_MUDANCAS;
    linhas.push(`${MARCA_MUDANCA}e mais ${resto} mudança${resto > 1 ? 's' : ''}`);
  }
  lista(notas).filter(Boolean).forEach((nota, i) => {
    if (i > 0) linhas.push(MARCA_NOTA.trim());
    texto(nota).split('\n').forEach(l => linhas.push(MARCA_NOTA + l.trimEnd()));
  });
  return linhas.join('\n');
}

/**
 * A mensagem gravada em linhas → o que o sino mostra: o texto principal, o
 * que mudou ("• …") e as notas ("» …", uma nota de várias linhas; "»" sozinho
 * separa uma nota da outra). Mensagem antiga, de uma linha só, volta igual e
 * sem listas. Pura (o sino e os avisos do Windows usam).
 */
function partesDaMensagem(bruta) {
  const principal = [];
  const mudancas = [];
  const notas = [];
  let nota = null;
  const fecharNota = () => {
    if (nota !== null && nota.join('\n').trim()) notas.push(nota.join('\n').trim());
    nota = null;
  };
  for (const linha of String(bruta || '').split('\n')) {
    if (linha.startsWith(MARCA_NOTA) || linha === MARCA_NOTA.trim()) {
      if (linha === MARCA_NOTA.trim()) { fecharNota(); continue; }
      if (nota === null) nota = [];
      nota.push(linha.slice(MARCA_NOTA.length));
      continue;
    }
    fecharNota();
    if (linha.startsWith(MARCA_MUDANCA)) mudancas.push(linha.slice(MARCA_MUDANCA.length).trim());
    else if (linha.trim()) principal.push(linha.trim());
  }
  fecharNota();
  return { mensagem: principal.join(' '), mudancas, notas };
}

/**
 * Os avisos de UMA ação numa ficha, prontos para gravar. Pura.
 *
 *   origem, registroId, nome   a ficha ("prospeccao", 7, "ACME")
 *   ator, autor                quem fez (id e nome)
 *   eventos                    o que o histórico gravou desta ação
 *   envolvidos                 ids de quem RESPONDE pela ficha (responsável/dono,
 *                              quem participa): recebem toda alteração
 *   criadores                  ids de quem só CRIOU a ficha: recebem só o
 *                              importante (decisão do dono, 02/10/2026) —
 *                              troca de responsável, ganho, perdido, conversão,
 *                              exclusão (`importanteParaQuemCriou`)
 *   autores                    ids de quem escreveu o registro mexido/excluído
 *   troca                      { de, para }: o responsável/dono mudou
 *   situacao                   'criou' | 'excluiu' | 'cancelou' | null
 *   nota                       texto avulso (motivo) além das observações
 *   excluir                    ids que já foram avisados por outro caminho
 *   nomeDe                     id → nome (para "passou para Bruno")
 *   resumo                     a 1ª linha pronta, quando o padrão não serve
 *
 * Cada pessoa recebe UM aviso, na ordem: quem passou a responder, quem
 * deixou de responder, quem escreveu o registro mexido, os demais.
 */
function montarAvisos({
  origem, registroId = null, nome = '', ator = null, autor = 'Alguém', eventos = [], envolvidos = [], criadores = [],
  autores = [], troca = null, situacao = null, nota = null, excluir = [], nomeDe = () => null, resumo = null,
  semPassoPara = null
} = {}) {
  const avisados = new Set([ator, ...lista(excluir)].map(idValido).filter(Boolean));
  const saida = [];
  const base = { origem: origem || null, registro_id: idValido(registroId), autor_id: idValido(ator) };
  const dar = (id, aviso) => {
    const n = idValido(id);
    if (!n || avisados.has(n)) return;
    avisados.add(n);
    saida.push({ usuario_id: n, ...aviso, ...base });
  };
  const evs = lista(eventos).filter(Boolean).filter(e => !(situacao === 'criou' && e.acao === 'criou'));
  // Quem entra ou sai já lê a troca na 1ª linha; os demais a veem na lista.
  const mudancas = evs.map(linhaDoEvento).filter(Boolean);
  const semTroca = evs.filter(e => !ehTroca(e)).map(linhaDoEvento).filter(Boolean);
  // Quem acabou de receber a tarefa do próximo passo ("Nova tarefa para você",
  // decisão do dono de 02/10/2026) não lê o passo de novo aqui. Pura.
  const semPasso = idValido(semPassoPara);
  const linhasSemPasso = doisLados => doisLados.filter(e => !CAMPOS_DO_PASSO.has(e.campo)).map(linhaDoEvento).filter(Boolean);
  const mudancasSemPasso = linhasSemPasso(evs);
  const semTrocaSemPasso = linhasSemPasso(evs.filter(e => !ehTroca(e)));
  const paraQuem = (id, comPasso, sem) => (semPasso && mesmoId(id, semPasso) ? sem : comPasso);
  const notas = notasDosEventos(lista(eventos), nota);
  const alvo = oQue(origem, nome);
  const Nome = nomeDaOrigem(origem);
  const a = fim(origem);

  if (troca?.para) {
    const primeira = situacao === 'criou'
      ? `${autor} criou ${alvo} e deixou com você.`
      : `${autor} passou ${alvo} para você.`;
    dar(troca.para, {
      tipo: 'responsavel_novo', titulo: `${Nome} agora é ${a === 'a' ? 'sua' : 'seu'}`,
      mensagem: comporMensagem(primeira, situacao ? [] : paraQuem(troca.para, semTroca, semTrocaSemPasso), notas)
    });
  }
  if (troca?.de && !mesmoId(troca.de, troca.para)) {
    const novo = troca.para ? nomeDe(troca.para) : null;
    const primeira = troca.para
      ? `${autor} passou ${alvo} para ${novo || 'outra pessoa'}.`
      : `${autor} tirou você ${oQue(origem, nome, 'de')}: agora está sem responsável.`;
    dar(troca.de, { tipo: 'responsavel_saiu', titulo: `${Nome} passou para outra pessoa`, mensagem: comporMensagem(primeira, [], notas) });
  }
  if (situacao === 'criou') return saida;

  if (situacao === 'excluiu' || situacao === 'cancelou') {
    const verbo = situacao === 'excluiu' ? 'excluiu' : 'cancelou';
    const aviso = {
      tipo: situacao === 'excluiu' ? 'registro_excluido' : 'registro_cancelado',
      titulo: `${Nome} ${situacao === 'excluiu' ? 'excluíd' : 'cancelad'}${a}`,
      mensagem: comporMensagem(resumo || `${autor} ${verbo} ${alvo}.`, [], notas)
    };
    // Excluir e cancelar são "o importante": quem criou recebe também.
    [...lista(autores), ...lista(envolvidos), ...lista(criadores)].forEach(id => dar(id, aviso));
    return saida;
  }

  if (!mudancas.length && !notas.length && !resumo) return saida;
  // Quem recebeu a tarefa do passo e não tem mais nada a ler: a tarefa já avisou.
  if (semPasso && !mudancasSemPasso.length && !notas.length && !resumo) avisados.add(semPasso);
  if (lista(autores).length) {
    const excluiu = evs.some(e => e.acao === 'excluiu');
    const primeira = `${autor} ${excluiu ? 'excluiu' : 'alterou'} um registro seu ${oQue(origem, nome, 'em')}.`;
    lista(autores).forEach(id => dar(id, {
      tipo: excluiu ? 'item_excluido' : 'item_alterado',
      titulo: excluiu ? 'Um registro seu foi excluído' : 'Um registro seu foi alterado',
      mensagem: comporMensagem(primeira, paraQuem(id, mudancas, mudancasSemPasso), notas)
    }));
  }
  const primeira = resumo || `${autor} atualizou ${alvo}.`;
  // Quem responde recebe toda alteração; quem só criou, só o importante.
  const para = [...lista(envolvidos), ...(importanteParaQuemCriou(evs, troca) ? lista(criadores) : [])];
  para.forEach(id => dar(id, {
    tipo: 'registro_alterado', titulo: `${Nome} atualizad${a}`,
    mensagem: comporMensagem(primeira, paraQuem(id, mudancas, mudancasSemPasso), notas)
  }));
  return saida;
}

/** As situações da tarefa que contam como "o importante" para quem a criou. */
const SITUACOES_IMPORTANTES = new Set(['concluiu', 'reabriu', 'cancelou']);
const sem = v => String(v ?? '').normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();

/**
 * O que quem só CRIOU a ficha recebe (decisão do dono, 02/10/2026, item 1/2
 * "b"): a troca de responsável, ganho, perdido, conversão e exclusão — e, nas
 * tarefas, concluir, reabrir e cancelar; nos orçamentos, aprovado/rejeitado.
 * Alteração comum (telefone, endereço, título, prazo) fica só com quem
 * responde e no histórico. Pura.
 */
function importanteParaQuemCriou(eventos = [], troca = null) {
  if (troca && (troca.para || troca.de)) return true;
  return lista(eventos).some(e => e && (
    e.tipo === 'conversao' || e.acao === 'converteu'
    || (e.campo === 'etapa' && ['ganho', 'perdido'].includes(sem(e.valor_novo)))
    || (e.campo === 'situacao' && ['aprovado', 'rejeitado'].includes(sem(e.valor_novo)))
    || (e.tipo === 'situacao' && SITUACOES_IMPORTANTES.has(e.acao))
  ));
}

/** Os textos do aviso da planilha, por módulo. */
const DA_PLANILHA = {
  prospeccao: { um: 'prospecção nova', varios: 'prospecções novas', titulo: 'Prospecções importadas para você', nas: 'nas suas prospecções' },
  cliente: { um: 'cliente novo', varios: 'clientes novos', titulo: 'Clientes importados para você', nas: 'nos seus clientes' }
};

/**
 * A planilha importada: UM aviso por pessoa no lugar de um por ficha.
 * `fichas`: [{ id, nome, para: [ids], interacao: bool }] — a ficha nova (o
 * responsável/dono dela) ou a interação acrescentada numa ficha que já
 * existia (o responsável e quem a criou). Pura.
 */
function avisosDaPlanilha({ origem = 'prospeccao', ator, autor = 'Alguém', arquivo = 'planilha.csv', fichas = [] } = {}) {
  const r = DA_PLANILHA[origem] || DA_PLANILHA.prospeccao;
  const porPessoa = new Map();
  for (const f of lista(fichas)) {
    for (const id of new Set(lista(f.para).map(idValido).filter(Boolean))) {
      if (mesmoId(id, ator)) continue;
      if (!porPessoa.has(id)) porPessoa.set(id, []);
      porPessoa.get(id).push(f);
    }
  }
  const plural = (n, um, varios) => `${n} ${n > 1 ? varios : um}`;
  return [...porPessoa.entries()].map(([id, fs]) => {
    const novas = fs.filter(f => !f.interacao);
    const inter = fs.filter(f => f.interacao);
    const partes = [];
    if (novas.length) partes.push(`${plural(novas.length, r.um, r.varios)} para você`);
    if (inter.length) partes.push(`${plural(inter.length, 'interação', 'interações')} ${r.nas}`);
    const linhas = fs.map(f => `${f.interacao ? 'Interação em' : 'Nova:'} ${cortar(f.nome, 60) || `#${f.id}`}`);
    const unica = new Set(fs.map(f => String(f.id))).size === 1 ? idValido(fs[0].id) : null;
    return {
      usuario_id: id, tipo: novas.length ? 'responsavel_novo' : 'registro_alterado',
      titulo: novas.length ? r.titulo : 'Interações importadas',
      mensagem: comporMensagem(`${autor} importou a planilha ${cortar(arquivo, 60)}: ${partes.join(' e ')}.`, linhas, []),
      origem: DA_PLANILHA[origem] ? origem : 'prospeccao', registro_id: unica, autor_id: idValido(ator)
    };
  });
}

// ------------------------------------------------------------ com a API

/** Grava os avisos (cada falha só vai para o log). Devolve os ids avisados. */
async function gravar(api, avisos = []) {
  const avisados = [];
  for (const aviso of lista(avisos)) {
    try {
      await api.post('/api/notificacoes', aviso);
      avisados.push(aviso.usuario_id);
    } catch (err) {
      console.warn('[avisos] aviso não gravado:', err?.message || err);
    }
  }
  return avisados;
}

/** O nome que o aviso mostra da ficha. Pura. */
function nomeDoRegistro(origem, r = {}) {
  if (origem === 'orcamento' || origem === 'pedido') return texto(r.numero) || `#${r.id}`;
  return texto(r.nome_fantasia) || texto(r.titulo) || texto(r.nome) || texto(r.numero) || (r.id ? `#${r.id}` : '');
}

/**
 * Quem tem a ficha, em ids: quem criou e quem responde/é o dono (e, na
 * tarefa, quem participa). Dono guardado por NOME (cliente, orçamento,
 * pedido) vira id pelo nome. Pura.
 */
function envolvidosDe(origem, r = {}, opcoes = {}) {
  const { responsaveis, criadores } = papeisDe(origem, r, opcoes);
  return [...responsaveis, ...criadores];
}

/**
 * Quem RESPONDE pela ficha (responsável/dono; na tarefa, também quem
 * participa) e quem só a CRIOU (decisão do dono, 02/10/2026): os primeiros
 * recebem toda alteração, os outros só o importante. Ficha sem responsável:
 * quem criou responde por ela. Pura.
 */
function papeisDe(origem, r = {}, { nomes = new Map(), participantes = [] } = {}) {
  let responsaveis;
  switch (origem) {
    case 'prospeccao':
    case 'contato': responsaveis = [r.responsavel_id]; break;
    case 'cliente': responsaveis = [idPeloNome(r.dono_cliente, nomes)]; break;
    case 'tarefa': responsaveis = [r.responsavel_id, ...lista(participantes).filter(p => p.status === 'aceito').map(p => p.usuario_id)]; break;
    case 'orcamento':
    case 'pedido': responsaveis = [idPeloNome(r.dono, nomes)]; break;
    default: return { responsaveis: [], criadores: [] };
  }
  responsaveis = [...new Set(responsaveis.map(idValido).filter(Boolean))];
  const criador = idValido(r.criado_por);
  if (!criador || responsaveis.includes(criador)) return { responsaveis, criadores: [] };
  // Sem ninguém respondendo pela ficha (só os participantes não contam), quem criou responde.
  const semResponsavel = !idValido(origem === 'tarefa' ? r.responsavel_id : responsaveis[0]);
  return semResponsavel ? { responsaveis: [...responsaveis, criador], criadores: [] } : { responsaveis, criadores: [criador] };
}

/** Quem responde pela ficha (o responsável ou o dono), em id. Pura. */
function responsavelDe(origem, r = {}, nomes = new Map()) {
  if (origem === 'cliente') return idPeloNome(r.dono_cliente, nomes);
  if (origem === 'orcamento' || origem === 'pedido') return idPeloNome(r.dono, nomes);
  return idValido(r.responsavel_id);
}

/**
 * Avisa quem tem a ficha sobre o que acabou de ser gravado no histórico dela.
 * Lê a ficha (se não veio) e os nomes; a troca de responsável/dono é achada
 * nos eventos quando não vem pronta. `extras`: mais gente que deve saber
 * (o dono do orçamento ligado, por exemplo). Devolve os ids avisados.
 */
async function avisarDaFicha(api, {
  origem, registroId, eventos = [], usuarioId = null, registro = null, nomes = null,
  troca, situacao = null, nota = null, autores = [], extras = [], excluir = [], resumo = null, semPassoPara = null
} = {}) {
  try {
    if (!idValido(usuarioId) || !ORIGENS[origem]) return [];
    const evs = lista(Array.isArray(eventos) ? eventos : [eventos]).filter(Boolean);
    if (!evs.length && !troca && !situacao && !texto(nota) && !resumo) return [];
    const social = require('./historicoSocial');
    const mapa = nomes || await social.nomesDosUsuarios(api);
    const r = registro || await api.get(`/api/${ORIGENS[origem].tabela}/${registroId}`).catch(() => null);
    if (!r || r.error) return [];
    let participantes = [];
    if (origem === 'tarefa') participantes = lista(await api.get('/api/tarefa_participantes', { query: { tarefa_id: r.id ?? registroId } }).catch(() => []));
    const papeis = papeisDe(origem, r, { nomes: mapa, participantes });
    const avisos = montarAvisos({
      origem, registroId: r.id ?? registroId, nome: nomeDoRegistro(origem, r),
      ator: usuarioId, autor: mapa.get(Number(usuarioId)) || 'Alguém', eventos: evs,
      // Quem responde (e os `extras`, como o dono do cliente de um orçamento)
      // recebe toda alteração; quem só criou, o importante (02/10/2026).
      envolvidos: [...papeis.responsaveis, ...lista(extras)],
      criadores: papeis.criadores,
      // Na criação, quem ficou com a ficha "recebeu" dela; depois, a troca vem nos eventos.
      autores,
      troca: troca !== undefined ? troca
        : situacao === 'criou' ? { de: null, para: responsavelDe(origem, r, mapa) } : trocaNosEventos(evs, mapa),
      situacao, nota, excluir, resumo, semPassoPara, nomeDe: id => mapa.get(Number(id)) || null
    });
    return gravar(api, avisos);
  } catch (err) {
    console.warn(`[avisos] ${origem} ${registroId}: aviso não montado:`, err?.message || err);
    return [];
  }
}

/**
 * Orçamento e pedido: avisa o dono (o vendedor, gravado pelo nome) e, além
 * dele, quem responde pelo cliente e pela prospecção ligados — o orçamento
 * do meu cliente mudou de situação, o pedido do meu cliente foi cancelado.
 * `registro`: o orçamento/pedido (lido antes de excluir, quando for o caso).
 */
async function avisarDaVenda(api, { origem, registro, eventos = [], usuarioId = null, situacao = null, nota = null, troca, excluir = [] } = {}) {
  try {
    if (!registro || !idValido(usuarioId)) return [];
    const social = require('./historicoSocial');
    const nomes = await social.nomesDosUsuarios(api);
    const [cliente, prospeccao] = await Promise.all([
      registro.cliente_id ? api.get(`/api/clientes/${registro.cliente_id}`).catch(() => null) : null,
      registro.prospeccao_id ? api.get(`/api/prospeccoes/${registro.prospeccao_id}`).catch(() => null) : null
    ]);
    const extras = [
      cliente && !cliente.error ? responsavelDe('cliente', cliente, nomes) : null,
      prospeccao && !prospeccao.error ? responsavelDe('prospeccao', prospeccao, nomes) : null
    ];
    return avisarDaFicha(api, {
      origem, registroId: registro.id, registro, eventos, usuarioId, nomes, situacao, nota, troca, extras, excluir
    });
  } catch (err) {
    console.warn(`[avisos] ${origem}: aviso não montado:`, err?.message || err);
    return [];
  }
}

/**
 * Aviso para quem lançou/fechou algo que OUTRA pessoa cancelou, estornou,
 * excluiu ou reabriu (Financeiro, Cobrança, Contabilidade): a frase recebe
 * o nome de quem fez; a nota (o motivo, a justificativa) vai junto. Nunca
 * avisa quem fez. Falha só vai para o log. Devolve os ids avisados.
 */
async function avisarPessoa(api, { para, usuarioId = null, origem, registroId = null, tipo = 'registro_alterado', titulo, frase, mudancas = [], nota = null } = {}) {
  try {
    if (!idValido(usuarioId)) return [];
    const alvos = [...new Set((Array.isArray(para) ? para : [para]).map(idValido).filter(Boolean))].filter(id => !mesmoId(id, usuarioId));
    if (!alvos.length) return [];
    const nomes = await require('./historicoSocial').nomesDosUsuarios(api);
    const autor = nomes.get(Number(usuarioId)) || 'Alguém';
    const mensagem = comporMensagem(typeof frase === 'function' ? frase(autor) : frase, mudancas, notasDosEventos([], nota));
    return gravar(api, alvos.map(id => ({
      usuario_id: id, tipo, titulo, mensagem, origem: origem || null, registro_id: idValido(registroId), autor_id: idValido(usuarioId)
    })));
  } catch (err) {
    console.warn('[avisos] aviso não montado:', err?.message || err);
    return [];
  }
}

/**
 * Excluir prospecção, cliente, orçamento e pedido pede o motivo (decisão do
 * dono, 02/10/2026): a ficha some com o histórico, e o motivo vai no aviso de
 * quem a tinha. A rota recusa ANTES de apagar qualquer coisa. Devolve o
 * motivo (até 600 letras) ou null. Pura.
 */
const SEM_MOTIVO = 'Escreva o motivo da exclusão.';
function motivoDaExclusao(corpo) {
  const m = texto(corpo?.motivo).replace(/\s+/g, ' ');
  return m ? m.slice(0, MAX_NOTA) : null;
}

module.exports = {
  avisarDaVenda, avisarPessoa, SEM_MOTIVO, motivoDaExclusao,
  MARCA_MUDANCA, MARCA_NOTA, ORIGENS, CAMPOS_DE_RESPONSAVEL, CAMPOS_DO_PASSO,
  valorLegivel, oQue, linhaDoEvento, notasDosEventos, idPeloNome, trocaNosEventos, comporMensagem, partesDaMensagem,
  montarAvisos, avisosDaPlanilha, nomeDoRegistro, envolvidosDe, papeisDe, importanteParaQuemCriou, responsavelDe, gravar, avisarDaFicha
};
