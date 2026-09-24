/**
 * Tarefas — o que outros módulos também chamam (sem Express).
 *
 *   - criarTarefa: grava a tarefa, o checklist inicial, os convites, a linha
 *     do tempo da tarefa, o histórico da ficha (cliente/prospecção) e o aviso
 *     de quem recebeu a tarefa;
 *   - concluirTarefa: fecha a tarefa (resultado, nota, a atividade gerada);
 *   - sincronizarPassoDaProspeccao: o próximo passo da prospecção é espelhado
 *     numa tarefa (origem 'proximo_passo'); trocar, concluir ou apagar o passo
 *     lá mexe na tarefa aqui;
 *   - criarTarefaAutomatica: as regras de tarefa automática (orçamento
 *     enviado, prospecção convertida, pedido entregue, comissões e produção
 *     fechadas) — só para quem pode recebê-las e não as desligou
 *     (backend/tarefasAutomaticas.js).
 *
 * Nada aqui derruba quem chamou por falha de histórico/aviso, e sem o SQL
 * (sql/tarefas_calendario.sql) as integrações simplesmente não fazem nada.
 */

const R = require('./tarefasRegras');
const A = require('./tarefasAutomaticas');
const social = require('./historicoSocial');
const permissoesRepo = require('./permissionsRepository');

const lista = r => (Array.isArray(r) ? r : []);
const texto = v => (v === undefined || v === null ? '' : String(v).trim());
const mesmoId = (a, b) => a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b);

/** "01/10/2026 às 14:30", "01/10/2026" ou "Sem data". */
function prazoLegivel(t) {
  const dia = R.diaISO(t?.data);
  if (!dia) return 'Sem data';
  const hora = R.horaHHMM(t.hora);
  return `${dia.split('-').reverse().join('/')}${hora ? ` às ${hora}` : ''}`;
}

/** O "retrato" que o histórico da ficha mostra da tarefa. */
function retratoDaTarefa(t, nomes = new Map()) {
  return [
    ['Tipo', t.tipo],
    ['Prazo', prazoLegivel(t)],
    ['Responsável', t.responsavel_id ? nomes.get(Number(t.responsavel_id)) || `#${t.responsavel_id}` : null],
    ['Prioridade', R.ROTULO_PRIORIDADE[t.prioridade]],
    ['Repetição', R.descreverRecorrencia(t.recorrencia) || null],
    ['Descrição', texto(t.descricao) || null]
  ].filter(([, v]) => v).map(([rotulo, valor]) => ({ rotulo, valor: String(valor) }));
}

/** Evento de histórico da ficha sobre a tarefa (criou, concluiu, reabriu, cancelou, excluiu). */
function eventoNaFicha(acao, t, { nomes, valor, observacao } = {}) {
  return {
    tipo: 'tarefa', acao,
    entidade: `Tarefa — ${t.titulo}`,
    valor_novo: valor ?? (acao === 'criou' ? prazoLegivel(t) : null),
    observacao: observacao || null,
    detalhe: { tarefa_id: Number(t.id), campos: retratoDaTarefa(t, nomes) }
  };
}

/** Grava o evento no histórico da prospecção e/ou do cliente da tarefa. */
async function registrarNaFicha(api, t, evento, usuarioId) {
  const alvos = [];
  if (t?.prospeccao_id) alvos.push(['prospeccao', t.prospeccao_id]);
  if (t?.cliente_id) alvos.push(['cliente', t.cliente_id]);
  for (const [origem, id] of alvos) await social.registrarEventos(api, origem, id, [evento], usuarioId);
}

/** Linha do tempo da própria tarefa. */
function registrarNaTarefa(api, tarefaId, eventos, usuarioId) {
  return social.registrarEventos(api, 'tarefa', tarefaId, eventos, usuarioId);
}

const avisar = (api, ids, aviso) => social.notificar(api, ids.filter(Boolean), aviso);

/**
 * Grava uma tarefa já normalizada (R.normalizarTarefa) e tudo o que vem com
 * ela. `extras`: { participantes: [ids] a convidar, checklist: [textos],
 * registrarFicha (padrão: sim), mensagem do convite, gatilho: o que criou a
 * tarefa automática ("Orçamento ORC-30 enviado") }.
 */
async function criarTarefa(api, dados, { usuarioId, nomes = new Map(), participantes = [], checklist = [], registrarFicha = true, mensagem = null, gatilho = null } = {}) {
  const payload = {
    ...dados,
    marcadores: dados.marcadores || [],
    criado_por: dados.criado_por ?? usuarioId ?? null,
    responsavel_id: dados.responsavel_id ?? usuarioId ?? null
  };
  if (payload.recorrencia && typeof payload.recorrencia === 'object') payload.recorrencia = { ...payload.recorrencia };
  const criada = await api.post('/api/tarefas', payload);
  const t = { ...payload, ...criada };

  let ordem = 1;
  for (const item of checklist.map(texto).filter(Boolean).slice(0, 100)) {
    await api.post('/api/tarefa_checklist', { tarefa_id: Number(t.id), texto: item.slice(0, 300), ordem: ordem++, criado_por: usuarioId ?? null })
      .catch(err => console.error('[tarefas] item do checklist não gravado:', err?.message || err));
  }

  await registrarNaTarefa(api, t.id, [{
    tipo: 'criacao', acao: 'criou', entidade: 'Tarefa', valor_novo: t.titulo,
    observacao: t.origem === 'automacao' ? 'Criada automaticamente' : t.origem === 'proximo_passo' ? 'Próximo passo da prospecção' : t.origem === 'recorrencia' ? 'Próxima da série' : null,
    detalhe: { campos: retratoDaTarefa(t, nomes) }
  }], usuarioId);
  if (registrarFicha) await registrarNaFicha(api, t, eventoNaFicha('criou', t, { nomes }), usuarioId);

  const autor = nomes.get(Number(usuarioId)) || 'Alguém';
  if (t.origem === 'automacao' && t.responsavel_id) {
    // Toda tarefa automática avisa quem a recebeu — mesmo quando foi a própria
    // pessoa que fez a ação —, dizendo o que aconteceu e onde desligar (a dica
    // é do tipo do aviso: o sino a mostra menor). Substitui o "Nova tarefa
    // para você", para não chegarem dois avisos.
    await avisar(api, [Number(t.responsavel_id)], {
      tipo: 'tarefa_automatica', titulo: 'Tarefa automática criada',
      mensagem: A.mensagemDoAviso({ gatilho, titulo: t.titulo, prazo: prazoLegivel(t) }),
      origem: 'tarefa', registro_id: Number(t.id), autor_id: null
    });
  } else if (t.responsavel_id && !mesmoId(t.responsavel_id, usuarioId)) {
    await avisar(api, [Number(t.responsavel_id)], {
      tipo: 'tarefa_atribuida', titulo: 'Nova tarefa para você',
      mensagem: `${autor} atribuiu: ${t.titulo} — ${prazoLegivel(t)}`,
      origem: 'tarefa', registro_id: Number(t.id), autor_id: usuarioId ?? null
    });
  }
  await convidar(api, t, participantes, { usuarioId, nomes, mensagem });
  return t;
}

/** Convites (tarefa em conjunto): cada convidado aceita ou recusa pelo sino ou em Tarefas. */
async function convidar(api, t, ids = [], { usuarioId, nomes = new Map(), mensagem = null } = {}) {
  const alvos = [...new Set(lista(ids).map(Number))]
    .filter(id => Number.isInteger(id) && id > 0 && !mesmoId(id, t.responsavel_id) && !mesmoId(id, usuarioId));
  if (!alvos.length) return [];
  const existentes = lista(await api.get('/api/tarefa_participantes', { query: { tarefa_id: t.id } }).catch(() => []));
  const convidados = [];
  for (const id of alvos) {
    const ja = existentes.find(p => mesmoId(p.usuario_id, id));
    if (ja && ['pendente', 'aceito'].includes(ja.status)) continue;
    if (ja) {
      await api.put(`/api/tarefa_participantes/${ja.id}`, { status: 'pendente', convidado_por: usuarioId ?? null, mensagem: texto(mensagem) || null, convidado_em: new Date().toISOString(), respondido_em: null });
    } else {
      await api.post('/api/tarefa_participantes', { tarefa_id: Number(t.id), usuario_id: id, status: 'pendente', convidado_por: usuarioId ?? null, mensagem: texto(mensagem) || null });
    }
    convidados.push(id);
  }
  if (!convidados.length) return [];
  const autor = nomes.get(Number(usuarioId)) || 'Alguém';
  await registrarNaTarefa(api, t.id, [{
    tipo: 'participantes', acao: 'convidou', entidade: 'Convite',
    valor_novo: convidados.map(id => nomes.get(id) || `#${id}`).join(', '),
    observacao: texto(mensagem) || null
  }], usuarioId);
  await avisar(api, convidados, {
    tipo: 'convite_tarefa', titulo: 'Convite para tarefa em conjunto',
    mensagem: `${autor} convidou você: ${t.titulo} — ${prazoLegivel(t)}${texto(mensagem) ? ` · “${texto(mensagem)}”` : ''}`,
    origem: 'tarefa', registro_id: Number(t.id), autor_id: usuarioId ?? null
  });
  return convidados;
}

/**
 * Fecha a tarefa. `interacao`: { origem: 'prospeccao'|'cliente', id } da
 * atividade que a conclusão gerou (fica o elo para abrir de um lado e do outro).
 */
async function concluirTarefa(api, t, { usuarioId, resultado = null, nota = null, interacao = null, nomes = new Map(), registrarFicha = true } = {}) {
  const patch = {
    status: 'concluida',
    concluida_em: new Date().toISOString(),
    concluida_por: usuarioId ?? null,
    resultado: resultado && R.RESULTADOS[resultado] ? resultado : null,
    resultado_nota: texto(nota) || null,
    interacao_origem: interacao?.origem || null,
    interacao_id: interacao?.id ?? null,
    atualizado_em: new Date().toISOString()
  };
  await api.put(`/api/tarefas/${t.id}`, patch);
  const legivel = [R.RESULTADOS[patch.resultado], patch.resultado_nota].filter(Boolean).join(' — ') || 'Concluída';
  await registrarNaTarefa(api, t.id, [{ tipo: 'situacao', acao: 'concluiu', entidade: 'Tarefa', valor_anterior: R.ROTULO_STATUS[t.status] || null, valor_novo: legivel }], usuarioId);
  if (registrarFicha) await registrarNaFicha(api, { ...t, ...patch }, eventoNaFicha('concluiu', t, { nomes, valor: legivel }), usuarioId);
  return { ...t, ...patch };
}

// ------------------------------------------------------------ próximo passo

/**
 * Espelha o próximo passo da prospecção numa tarefa. Chamar DEPOIS de gravar
 * a prospecção. `concluiuAnterior`: o passo que estava aberto foi cumprido
 * (concluir passo, ou trocar o passo contando o que aconteceu) — a tarefa
 * dele é concluída em vez de reaproveitada.
 */
async function sincronizarPassoDaProspeccao(api, prospeccaoId, { usuarioId = null, concluiuAnterior = false, nota = null, interacaoId = null } = {}) {
  try {
    const p = await api.get(`/api/prospeccoes/${prospeccaoId}`).catch(() => null);
    if (!p || p.error) return null;
    const abertas = lista(await api.get('/api/tarefas', { query: { prospeccao_id: prospeccaoId } }))
      .filter(t => t.origem === 'proximo_passo' && R.ABERTOS.has(t.status) && !t.excluida_em)
      .sort((a, b) => Number(a.id) - Number(b.id));
    const passo = texto(p.proximo_passo).slice(0, 200);
    const data = R.diaISO(p.proximo_passo_data) || null;
    const ativa = (p.status || 'ativa') === 'ativa';

    let restantes = abertas;
    if (concluiuAnterior && abertas.length) {
      for (const t of abertas) {
        await concluirTarefa(api, t, {
          usuarioId, resultado: 'feito', nota,
          interacao: interacaoId ? { origem: 'prospeccao', id: interacaoId } : null,
          registrarFicha: false
        });
      }
      restantes = [];
    }

    if (passo && ativa) {
      const [atual, ...sobras] = restantes;
      for (const t of sobras) await cancelar(api, t, usuarioId, 'Passo substituído');
      if (atual) {
        const depois = { titulo: passo, data };
        const dono = p.responsavel_id || p.criado_por;
        if (dono && !mesmoId(dono, atual.responsavel_id)) depois.responsavel_id = Number(dono);
        const eventos = R.diferencasDaTarefa(atual, depois);
        if (eventos.length) {
          await api.put(`/api/tarefas/${atual.id}`, { ...depois, atualizado_em: new Date().toISOString() });
          await registrarNaTarefa(api, atual.id, eventos, usuarioId);
        }
        return atual.id;
      }
      const criada = await criarTarefa(api, {
        titulo: passo, tipo: 'Follow-up', prioridade: 'media', status: 'a_fazer', data,
        responsavel_id: p.responsavel_id || p.criado_por || usuarioId,
        prospeccao_id: Number(prospeccaoId), origem: 'proximo_passo'
      }, { usuarioId, nomes: await social.nomesDosUsuarios(api), registrarFicha: false });
      return criada.id;
    }
    for (const t of restantes) await cancelar(api, t, usuarioId, ativa ? 'Próximo passo removido' : 'Prospecção encerrada');
    return null;
  } catch (err) {
    if (!social.semTabela(err)) console.error('[tarefas] próximo passo não sincronizado:', err?.message || err);
    return null;
  }
}

async function cancelar(api, t, usuarioId, motivo) {
  await api.put(`/api/tarefas/${t.id}`, { status: 'cancelada', atualizado_em: new Date().toISOString() });
  await registrarNaTarefa(api, t.id, [{ tipo: 'situacao', acao: 'cancelou', entidade: 'Tarefa', valor_anterior: R.ROTULO_STATUS[t.status] || null, valor_novo: 'Cancelada', observacao: motivo }], usuarioId);
}

// ------------------------------------------------------------ automações

/**
 * As regras que a pessoa desligou para si (Map chave → ligada). Sem a tabela
 * (sql/tarefas_automaticas_por_usuario.sql ainda não rodou), nada desligado:
 * o padrão é receber.
 */
async function preferenciasDoUsuario(api, usuarioId) {
  try {
    const linhas = await api.get('/api/tarefa_automacao_usuarios', { query: { usuario_id: usuarioId } });
    return { mapa: A.mapaDePreferencias(lista(linhas), usuarioId), sqlPendente: false };
  } catch (err) {
    if (social.semTabela(err)) return { mapa: new Map(), sqlPendente: true };
    throw err;
  }
}

/**
 * Esta pessoa recebe a tarefa da regra? Precisa ver Tarefas, ter a permissão
 * da regra (Admin e Sup Admin têm tudo, como no controller) e não a ter
 * desligado para si.
 */
async function recebeAutomatica(api, usuarioId, chave) {
  const [prefs, usuario] = await Promise.all([
    preferenciasDoUsuario(api, usuarioId),
    api.get(`/api/usuarios/${Number(usuarioId)}`).catch(() => null)
  ]);
  if (prefs.mapa.get(String(chave)) === false) return false;
  if (!usuario || usuario.error) return false;
  if (R.ehGestor(usuario)) return true;
  const permissoes = await permissoesRepo.loadPermissionsForUsuario(api, usuario);
  return A.podeReceber(chave, c => permissoesRepo.can(permissoes, c));
}

/**
 * Cria a tarefa de uma regra automática, se a regra estiver ligada, a tarefa
 * ainda não existir (`chave_origem` = regra:id do registro) e quem recebe
 * puder recebê-la (`recebeAutomatica`).
 * contexto: { refId, responsavelId, usuarioId, vinculos: {...}, valores: {...},
 *   base: o dia marcado (regras "antes do pagamento"), descricao, acao:
 *   { acao_chave, acao_registro, acao_rotulo } — a tarefa conclui sozinha
 *   quando a ação acontece (backend/tarefasAcoes.js) }
 */
async function criarTarefaAutomatica(api, chave, { refId, responsavelId = null, usuarioId = null, vinculos = {}, valores = {}, base = null, descricao = null, acao = null } = {}) {
  try {
    const regra = lista(await api.get('/api/tarefa_automacoes', { query: { chave } }))[0];
    if (!regra || !regra.ativa) return null;
    const responsavel = Number(responsavelId || usuarioId) || null;
    if (!responsavel) return null;
    const chaveOrigem = `${chave}:${refId}`;
    const existe = lista(await api.get('/api/tarefas', { query: { chave_origem: chaveOrigem } })).length > 0;
    if (existe) return null;
    if (!(await recebeAutomatica(api, responsavel, chave))) return null;
    const catalogo = A.regraDoCatalogo(chave);
    const hoje = R.agoraEmBrasilia().dia;
    const tipo = R.TIPOS.includes(regra.tipo) ? regra.tipo : 'Follow-up';
    const prioridade = R.PRIORIDADES.includes(regra.prioridade) ? regra.prioridade : 'media';
    const limpos = Object.fromEntries(Object.entries(vinculos).filter(([, v]) => v !== null && v !== undefined));
    const daAcao = acao?.acao_chave ? { acao_chave: acao.acao_chave, acao_registro: acao.acao_registro ?? null, acao_rotulo: acao.acao_rotulo ?? null } : {};
    return await criarTarefa(api, {
      titulo: R.tituloDaAutomacao(regra.titulo, valores) || regra.nome,
      descricao: texto(descricao) || texto(regra.descricao) || null,
      tipo, prioridade, status: 'a_fazer',
      data: A.dataDaTarefa({ prazo: catalogo.prazo, dias: Number(regra.dias) || 0, hoje, base }),
      responsavel_id: responsavel,
      ...limpos,
      ...daAcao,
      origem: 'automacao', chave_origem: chaveOrigem
    }, { usuarioId, nomes: await social.nomesDosUsuarios(api), gatilho: catalogo.gatilho(valores) });
  } catch (err) {
    if (!social.semTabela(err)) console.error(`[tarefas] automação ${chave} não criou a tarefa:`, err?.message || err);
    return null;
  }
}

/** O usuário cujo nome é o dono do cliente (o "dono" é texto em clientes.dono_cliente). */
async function usuarioPeloNome(api, nome) {
  const alvo = texto(nome).toLowerCase();
  if (!alvo) return null;
  const nomes = await social.nomesDosUsuarios(api);
  for (const [id, n] of nomes) if (texto(n).toLowerCase() === alvo) return id;
  return null;
}

module.exports = {
  prazoLegivel, retratoDaTarefa, eventoNaFicha, registrarNaFicha, registrarNaTarefa,
  criarTarefa, convidar, concluirTarefa, cancelar,
  sincronizarPassoDaProspeccao, criarTarefaAutomatica, usuarioPeloNome,
  preferenciasDoUsuario, recebeAutomatica
};
