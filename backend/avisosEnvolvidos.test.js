/**
 * Avisos de "algo seu" (01/10/2026): quem passou a responder, quem deixou de
 * responder, quem teve algo seu excluído/cancelado/alterado por outra pessoa
 * — e a nota que veio com a ação, como no histórico.
 */
const test = require('node:test');
const assert = require('node:assert');

const A = require('./avisosEnvolvidos');
const { partesDaMensagem, montarAvisos: avisosDoSino } = require('./notificacoesController');

const nomes = new Map([[1, 'Henrique'], [2, 'Ana'], [3, 'Bruno'], [4, 'Carla']]);
const nomeDe = id => nomes.get(Number(id)) || null;

test('linhaDoEvento: a mudança como a linha do tempo mostra', () => {
  assert.strictEqual(A.linhaDoEvento({ acao: 'alterou', entidade: 'Etapa do funil', valor_anterior: 'Proposta', valor_novo: 'Perdido' }), 'Etapa do funil: Proposta → Perdido');
  assert.strictEqual(A.linhaDoEvento({ acao: 'alterou', entidade: 'Site', valor_anterior: null, valor_novo: 'loja.com' }), 'Site: vazio → loja.com');
  assert.strictEqual(A.linhaDoEvento({ acao: 'alterou', entidade: 'Prazo', valor_anterior: '2026-09-14', valor_novo: '2026-10-02' }), 'Prazo: 14/09/2026 → 02/10/2026');
  assert.strictEqual(A.linhaDoEvento({ acao: 'excluiu', entidade: 'Interação', valor_anterior: 'Ligação' }), 'Excluiu Interação: Ligação');
  // O valor que já está no nome do evento não se repete.
  assert.strictEqual(A.linhaDoEvento({ acao: 'criou', entidade: 'Ligação — Falei com o João', valor_novo: 'Falei com o João' }), 'Criou Ligação — Falei com o João');
  assert.strictEqual(A.linhaDoEvento({ acao: 'concluiu', entidade: 'Tarefa', valor_novo: 'Feito — cliente aprovou' }), 'Concluiu Tarefa: Feito — cliente aprovou');
  assert.strictEqual(A.linhaDoEvento({ acao: 'alterou', entidade: 'Anotação', valor_novo: 'x'.repeat(200) }).length <= 'Anotação: vazio → '.length + 80, true);
});

test('notasDosEventos: observação, nota do detalhe e texto avulso — sem repetir e sem o "Cadastro inicial"', () => {
  const notas = A.notasDosEventos([
    { observacao: 'Cliente pediu para esperar' },
    { observacao: 'cliente pediu para esperar' },
    { observacao: 'Cadastro inicial' },
    { acao: 'criou', detalhe: JSON.stringify({ registro: { detalhe: 'Ligou às 10h\nvai mandar o projeto' } }) },
    { acao: 'excluiu', detalhe: { registro: { detalhe: 'o que saiu não é nota' } } },
    { detalhe: { nota: '@[Ana](u:2) confirma?' } }
  ], 'Motivo: preço');
  assert.deepStrictEqual(notas, ['Cliente pediu para esperar', 'Ligou às 10h\nvai mandar o projeto', '@Ana confirma?']);
  assert.strictEqual(A.notasDosEventos([], 'x'.repeat(900))[0].length, 600);
});

test('comporMensagem + partesDaMensagem: ida e volta (nota de várias linhas, duas notas, "e mais N")', () => {
  const msg = A.comporMensagem('Ana atualizou a prospecção ACME.', ['a', 'b', 'c', 'd', 'e', 'f', 'g'], ['Primeira\nsegunda linha', 'Outra nota']);
  assert.match(msg, /\n• e mais 2 mudanças\n/);
  const p = partesDaMensagem(msg);
  assert.strictEqual(p.mensagem, 'Ana atualizou a prospecção ACME.');
  assert.deepStrictEqual(p.mudancas, ['a', 'b', 'c', 'd', 'e', 'e mais 2 mudanças']);
  assert.deepStrictEqual(p.notas, ['Primeira\nsegunda linha', 'Outra nota']);
  // Aviso antigo, de uma linha só: volta igual.
  assert.deepStrictEqual(partesDaMensagem('Ana comentou em ACME: “oi”'), { mensagem: 'Ana comentou em ACME: “oi”', mudancas: [], notas: [] });
  // O sino entrega as partes separadas.
  const sino = avisosDoSino([{ id: 1, tipo: 'registro_alterado', titulo: 'x', mensagem: msg, criado_em: '2026-10-01T10:00:00Z' }]);
  assert.strictEqual(sino.itens[0].notas.length, 2);
  assert.strictEqual(sino.itens[0].mensagem, 'Ana atualizou a prospecção ACME.');
});

test('trocaNosEventos: o responsável/dono pelo nome gravado (ou "#7")', () => {
  assert.deepStrictEqual(A.trocaNosEventos([{ acao: 'alterou', campo: 'responsavel_id', valor_anterior: 'Ana', valor_novo: 'Bruno' }], nomes), { de: 2, para: 3 });
  assert.deepStrictEqual(A.trocaNosEventos([{ acao: 'alterou', campo: 'dono_cliente', valor_anterior: null, valor_novo: '#4' }], nomes), { de: null, para: 4 });
  assert.strictEqual(A.trocaNosEventos([{ acao: 'alterou', campo: 'etapa', valor_anterior: 'A', valor_novo: 'B' }], nomes), null);
});

test('troca de responsável: o novo recebe "agora é sua", o antigo "passou para outra pessoa", o criador a atualização — nunca quem agiu', () => {
  const avisos = A.montarAvisos({
    origem: 'prospeccao', registroId: 7, nome: 'ACME', ator: 1, autor: 'Henrique',
    eventos: [
      { acao: 'alterou', campo: 'responsavel_id', entidade: 'Responsável', valor_anterior: 'Ana', valor_novo: 'Bruno', observacao: 'A Ana saiu de férias' }
    ],
    envolvidos: [3, 4, 1], troca: { de: 2, para: 3 }, nomeDe
  });
  const de = id => avisos.find(a => a.usuario_id === id);
  assert.strictEqual(avisos.length, 3);
  assert.strictEqual(de(3).tipo, 'responsavel_novo');
  assert.strictEqual(de(3).titulo, 'Prospecção agora é sua');
  assert.strictEqual(de(3).mensagem, 'Henrique passou a prospecção ACME para você.\n» A Ana saiu de férias');
  assert.strictEqual(de(2).tipo, 'responsavel_saiu');
  assert.strictEqual(de(2).mensagem, 'Henrique passou a prospecção ACME para Bruno.\n» A Ana saiu de férias');
  assert.strictEqual(de(4).tipo, 'registro_alterado', 'Carla (criou a ficha) também sabe');
  assert.strictEqual(de(4).mensagem, 'Henrique atualizou a prospecção ACME.\n• Responsável: Ana → Bruno\n» A Ana saiu de férias');
  assert.ok(!de(1), 'quem agiu não se avisa');
  assert.deepStrictEqual([de(3).origem, de(3).registro_id, de(3).autor_id], ['prospeccao', 7, 1]);
});

test('ficar sem responsável, criar já passando para outro e cliente (masculino)', () => {
  const sem = A.montarAvisos({ origem: 'cliente', registroId: 4, nome: 'Loja Boa', ator: 1, autor: 'Henrique', troca: { de: 2, para: null }, nomeDe });
  assert.strictEqual(sem[0].titulo, 'Cliente passou para outra pessoa');
  assert.strictEqual(sem[0].mensagem, 'Henrique tirou você do cliente Loja Boa: agora está sem responsável.');
  assert.strictEqual(A.oQue('prospeccao', 'ACME', 'em'), 'na prospecção ACME');
});

test('exclusão e cancelamento: todos os envolvidos e quem escreveu, com o motivo', () => {
  const exc = A.montarAvisos({
    origem: 'tarefa', registroId: 9, nome: 'Ligar para o João', ator: 2, autor: 'Ana',
    situacao: 'excluiu', nota: 'Motivo: cliente desistiu', envolvidos: [3, 2, 4]
  });
  assert.deepStrictEqual(exc.map(a => a.usuario_id), [3, 4]);
  assert.strictEqual(exc[0].tipo, 'registro_excluido');
  assert.strictEqual(exc[0].titulo, 'Tarefa excluída');
  assert.strictEqual(exc[0].mensagem, 'Ana excluiu a tarefa “Ligar para o João”.\n» Motivo: cliente desistiu');
  const canc = A.montarAvisos({ origem: 'pedido', registroId: 5, nome: '123', ator: 2, autor: 'Ana', situacao: 'cancelou', envolvidos: [3] });
  assert.strictEqual(canc[0].titulo, 'Pedido cancelado');
  assert.strictEqual(canc[0].mensagem, 'Ana cancelou o pedido 123.');
});

test('criação já com outro responsável: só ele recebe, sem a lista do cadastro', () => {
  const avisos = A.montarAvisos({
    origem: 'prospeccao', registroId: 7, nome: 'ACME', ator: 1, autor: 'Henrique', situacao: 'criou',
    eventos: [{ acao: 'criou', entidade: 'Prospecção', valor_novo: 'ACME', observacao: 'Cadastro inicial' }, { acao: 'criou', entidade: 'Etapa do funil', valor_novo: 'Novo' }],
    envolvidos: [3, 1], troca: { de: null, para: 3 }, nomeDe
  });
  assert.strictEqual(avisos.length, 1);
  assert.strictEqual(avisos[0].mensagem, 'Henrique criou a prospecção ACME e deixou com você.');
});

test('registro de outra pessoa excluído: ela recebe "Um registro seu foi excluído"; nada mudou, ninguém recebe', () => {
  const avisos = A.montarAvisos({
    origem: 'prospeccao', registroId: 7, nome: 'ACME', ator: 1, autor: 'Henrique',
    eventos: [{ acao: 'excluiu', entidade: 'Interação', valor_anterior: 'Ligação — falei com ele' }],
    envolvidos: [3], autores: [2]
  });
  assert.strictEqual(avisos.find(a => a.usuario_id === 2).titulo, 'Um registro seu foi excluído');
  assert.strictEqual(avisos.find(a => a.usuario_id === 2).mensagem, 'Henrique excluiu um registro seu na prospecção ACME.\n• Excluiu Interação: Ligação — falei com ele');
  assert.strictEqual(avisos.find(a => a.usuario_id === 3).tipo, 'registro_alterado');
  assert.deepStrictEqual(A.montarAvisos({ origem: 'cliente', ator: 1, eventos: [], envolvidos: [3] }), []);
});

/** Uma API de mentira: lê de `tabelas`, guarda o que é postado. */
function apiFalsa(tabelas) {
  const postados = [];
  return {
    postados,
    async get(caminho) {
      const [, , tabela, id] = caminho.split('/');
      const linhas = tabelas[tabela];
      if (!linhas) { const e = new Error('Tabela não encontrada'); e.status = 404; throw e; }
      return id ? linhas.find(l => String(l.id) === id) || null : linhas;
    },
    async post(caminho, corpo) {
      if (caminho !== '/api/notificacoes') throw new Error(`POST inesperado: ${caminho}`);
      postados.push(corpo);
      return { id: postados.length, ...corpo };
    }
  };
}

test('avisarDaFicha: cliente com dono por NOME — troca de dono, criação e exclusão; sem quem agiu, nada', async () => {
  const tabelas = {
    usuarios: [{ id: 1, nome: 'Henrique' }, { id: 2, nome: 'Ana' }, { id: 3, nome: 'Bruno' }, { id: 4, nome: 'Carla' }],
    clientes: [{ id: 4, nome_fantasia: 'Loja Boa', dono_cliente: 'Bruno', criado_por: 4 }]
  };
  const api = apiFalsa(tabelas);
  const avisados = await A.avisarDaFicha(api, {
    origem: 'cliente', registroId: 4, usuarioId: 1,
    eventos: [{ acao: 'alterou', campo: 'dono_cliente', entidade: 'Dono', valor_anterior: 'Ana', valor_novo: 'Bruno' }]
  });
  assert.deepStrictEqual(avisados, [3, 2, 4]);
  assert.strictEqual(api.postados[0].titulo, 'Cliente agora é seu');
  assert.strictEqual(api.postados[1].mensagem, 'Henrique passou o cliente Loja Boa para Bruno.');
  assert.strictEqual(api.postados[2].mensagem, 'Henrique atualizou o cliente Loja Boa.\n• Dono: Ana → Bruno');

  // Criado já com o Bruno como dono: só ele, "criou e deixou com você".
  const criacao = apiFalsa(tabelas);
  await A.avisarDaFicha(criacao, { origem: 'cliente', registroId: 4, usuarioId: 4, situacao: 'criou', eventos: [{ acao: 'criou', entidade: 'Cliente' }] });
  assert.deepStrictEqual(criacao.postados.map(p => [p.usuario_id, p.mensagem]), [[3, 'Carla criou o cliente Loja Boa e deixou com você.']]);

  // Excluído (a ficha já não existe: vem pronta), com o motivo.
  const exclusao = apiFalsa({ usuarios: tabelas.usuarios });
  await A.avisarDaFicha(exclusao, { origem: 'cliente', registroId: 4, registro: tabelas.clientes[0], usuarioId: 1, situacao: 'excluiu', nota: 'Motivo: duplicado' });
  assert.deepStrictEqual(exclusao.postados.map(p => p.usuario_id), [3, 4]);
  assert.strictEqual(exclusao.postados[0].mensagem, 'Henrique excluiu o cliente Loja Boa.\n» Motivo: duplicado');

  // O sistema sozinho (sem usuário) não avisa; ficha que não existe também não.
  assert.deepStrictEqual(await A.avisarDaFicha(apiFalsa(tabelas), { origem: 'cliente', registroId: 4, usuarioId: null, situacao: 'excluiu' }), []);
  assert.deepStrictEqual(await A.avisarDaFicha(apiFalsa(tabelas), { origem: 'cliente', registroId: 99, usuarioId: 1, eventos: [{ acao: 'alterou', entidade: 'x', valor_novo: 'y' }] }), []);
});

test('avisosDaPlanilha: um aviso por pessoa, com as fichas listadas; quem importou não recebe', () => {
  const avisos = A.avisosDaPlanilha({
    ator: 1, autor: 'Henrique', arquivo: 'leads.csv',
    fichas: [
      { id: 10, nome: 'ACME', para: [2] },
      { id: 11, nome: 'Beta', para: [2, 1] },
      { id: 7, nome: 'Antiga', para: [3, 3], interacao: true }
    ]
  });
  assert.strictEqual(avisos.length, 2);
  const ana = avisos.find(a => a.usuario_id === 2);
  assert.strictEqual(ana.titulo, 'Prospecções importadas para você');
  assert.strictEqual(ana.mensagem, 'Henrique importou a planilha leads.csv: 2 prospecções novas para você.\n• Nova: ACME\n• Nova: Beta');
  assert.strictEqual(ana.registro_id, null, 'várias fichas: o sino abre só o módulo');
  const joao = avisos.find(a => a.usuario_id === 3);
  assert.strictEqual(joao.mensagem, 'Henrique importou a planilha leads.csv: 1 interação nas suas prospecções.\n• Interação em Antiga');
  assert.strictEqual(joao.registro_id, 7);
  const cli = A.avisosDaPlanilha({ origem: 'cliente', ator: 1, autor: 'Henrique', fichas: [{ id: 5, nome: 'Loja', para: [2] }] });
  assert.strictEqual(cli[0].titulo, 'Clientes importados para você');
  assert.strictEqual(cli[0].origem, 'cliente');
});

test('envolvidosDe: dono gravado por nome vira id; tarefa soma quem participa (aceito)', () => {
  assert.deepStrictEqual(A.envolvidosDe('cliente', { dono_cliente: 'ana', criado_por: 4 }, { nomes }), [2, 4]);
  assert.deepStrictEqual(A.envolvidosDe('pedido', { dono: 'Bruno' }, { nomes }), [3, undefined]);
  assert.deepStrictEqual(
    A.envolvidosDe('tarefa', { responsavel_id: 2, criado_por: 1 }, { participantes: [{ usuario_id: 3, status: 'aceito' }, { usuario_id: 4, status: 'pendente' }] }),
    [2, 1, 3]
  );
});
