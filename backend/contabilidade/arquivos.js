/**
 * Arquivos da Contabilidade (etapa 2): XML, PDF, comprovante, guia, recibo…
 * guardados com o sha256, a origem e a competência que provam, e ligados ao
 * que provam (a competência, um documento recebido, uma conta a pagar, um
 * pagamento, o pagamento de um fechamento do Financeiro).
 *
 * - O conteúdo vai em partes de 512 KB (base64), como os anexos do histórico
 *   social: cada envio à API fica abaixo do limite dela. O arquivo só vira
 *   `completo` depois da última parte; o que falhou no meio é apagado.
 * - O mesmo arquivo (mesmo sha256) não é guardado duas vezes: o segundo envio
 *   só ganha o vínculo novo.
 * - Origem: `oficial` (veio da SEFAZ ou do banco — o XML autorizado),
 *   `interno` (gerado pelo app) e `fornecido` (anexado à mão). Arquivo
 *   original nunca é trocado por um gerado.
 * - Excluir é marcar (com motivo): o histórico do que foi entregue fica.
 */
const crypto = require('node:crypto');
const c = require('../financeiro/comum');
const b = require('./base');
const eventos = require('./eventos');

const LIMITE_BYTES = 20 * 1024 * 1024;
const TAMANHO_PARTE = 512 * 1024;

const CATEGORIAS = {
  xml_nfe: 'XML de NF-e',
  nfse: 'NFS-e',
  nota: 'Nota fiscal (PDF)',
  recibo: 'Recibo',
  guia: 'Guia de imposto',
  comprovante: 'Comprovante de pagamento',
  boleto: 'Boleto',
  contrato: 'Contrato',
  extrato: 'Extrato bancário',
  outro: 'Outro'
};

/** As categorias que servem de DOCUMENTO de um pagamento (nota, recibo, guia). */
const CATEGORIAS_DE_DOCUMENTO = new Set(['xml_nfe', 'nfse', 'nota', 'recibo', 'guia', 'contrato']);

const ORIGENS = { oficial: 'Oficial', interno: 'Interno', fornecido: 'Fornecido' };

const ALVOS = {
  competencia: 'Competência',
  documento_recebido: 'Documento recebido',
  titulo: 'Conta a pagar',
  pagamento: 'Pagamento de conta',
  financeiro_pagamento: 'Pagamento de fechamento',
  reembolso: 'Reembolso'
};

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** Arquivo → partes de até 512 KB, cada uma em base64 (decodificáveis separadas). */
function partesDoArquivo(buffer, tamanho = TAMANHO_PARTE) {
  const partes = [];
  for (let i = 0; i < buffer.length; i += tamanho) partes.push(buffer.subarray(i, i + tamanho).toString('base64'));
  return partes;
}

/** Nome que dá para salvar em qualquer sistema (sem caminho, sem caracteres proibidos). */
function nomeDeArquivo(nome) {
  const limpo = String(nome ?? '').split(/[\\/]/).pop().replace(/[\u0000-\u001f<>:"|?*]/g, '').replace(/\s+/g, ' ').trim();
  return (limpo || 'arquivo').slice(0, 200);
}

/** O vínculo conferido: tipo conhecido e id coerente (competência 'AAAA-MM', o resto número). */
function vinculoValido(v) {
  const alvoTipo = String(v?.alvo_tipo || '');
  if (!ALVOS[alvoTipo]) throw c.erro('Diga a que o arquivo pertence.');
  const alvoId = String(v?.alvo_id ?? '').trim();
  if (alvoTipo === 'competencia' ? !c.competenciaValida(alvoId) : !/^\d{1,12}$/.test(alvoId)) throw c.erro('O vínculo do arquivo está incompleto.');
  return { alvo_tipo: alvoTipo, alvo_id: alvoId };
}

/** O que a tela vê de um arquivo (nunca o conteúdo). */
function publico(a, { vinculos = [], nomes = new Map() } = {}) {
  return {
    id: a.id,
    nome: a.nome_arquivo,
    tipo: a.tipo_mime || null,
    tamanho: Number(a.tamanho_bytes) || 0,
    sha256: a.sha256,
    categoria: a.categoria,
    categoria_rotulo: CATEGORIAS[a.categoria] || a.categoria,
    origem: a.origem,
    origem_rotulo: ORIGENS[a.origem] || a.origem,
    competencia: a.competencia || null,
    descricao: a.descricao || null,
    criado_em: b.instanteBR(a.criado_em),
    criado_por: nomes.get(String(a.criado_por)) || null,
    excluido: Boolean(a.excluido_em),
    motivo_exclusao: a.motivo_exclusao || null,
    vinculos: vinculos.filter(v => String(v.arquivo_id) === String(a.id)).map(v => ({ alvo_tipo: v.alvo_tipo, alvo_id: v.alvo_id, rotulo: ALVOS[v.alvo_tipo] || v.alvo_tipo }))
  };
}

const vivo = a => a && a.completo !== false && a.completo !== 'false' && !a.excluido_em;

async function inserirVinculos(api, arquivoId, vinculos, usuarioId, jaExistentes = []) {
  const novos = [];
  for (const v of vinculos) {
    if (jaExistentes.some(x => x.alvo_tipo === v.alvo_tipo && String(x.alvo_id) === String(v.alvo_id))) continue;
    try {
      novos.push(await b.inserir(api, 'contabil_arquivo_vinculos', { arquivo_id: Number(arquivoId), ...v, criado_por: usuarioId ?? null, criado_em: c.agora() }));
    } catch (e) {
      // Clique repetido (UNIQUE arquivo+alvo): o vínculo já está lá.
      if (!c.ehDuplicado(e)) throw e;
    }
  }
  return novos;
}

/**
 * Guarda um arquivo (ou reaproveita o igual já guardado) e liga ao que ele
 * prova. Devolve `{ arquivo, reaproveitado }`.
 */
async function salvar(api, { nome, tipo = null, base64, categoria = 'outro', origem = 'fornecido', competencia = null, descricao = null, vinculos = [], usuarioId = null, registrarEvento = true }) {
  const buffer = Buffer.from(String(base64 || ''), 'base64');
  if (!buffer.length) throw c.erro('O arquivo está vazio.');
  if (buffer.length > LIMITE_BYTES) throw c.erro(`O arquivo passa do limite de ${LIMITE_BYTES / 1024 / 1024} MB.`, 413);
  if (!CATEGORIAS[categoria]) throw c.erro('Escolha o tipo do arquivo (nota, recibo, comprovante…).');
  if (!ORIGENS[origem]) throw c.erro('Origem do arquivo inválida.');
  const comp = c.competenciaValida(competencia) ? String(competencia) : null;
  const ligacoes = (Array.isArray(vinculos) ? vinculos : []).map(vinculoValido);
  const hash = sha256(buffer);

  const iguais = (await b.ler(api, 'contabil_arquivos', { sha256: hash })).filter(vivo);
  if (iguais.length) {
    const existente = iguais[0];
    const ja = await b.ler(api, 'contabil_arquivo_vinculos', { arquivo_id: Number(existente.id) });
    await inserirVinculos(api, existente.id, ligacoes, usuarioId, ja);
    return { arquivo: existente, reaproveitado: true };
  }

  const partes = partesDoArquivo(buffer);
  const arquivo = await b.inserir(api, 'contabil_arquivos', {
    nome_arquivo: nomeDeArquivo(nome), tipo_mime: c.texto(tipo, 120) || null, tamanho_bytes: buffer.length, sha256: hash,
    partes: partes.length, completo: false, categoria, origem, competencia: comp, descricao: c.texto(descricao, 300) || null,
    criado_por: usuarioId ?? null, criado_em: c.agora()
  });
  try {
    for (let i = 0; i < partes.length; i++) {
      await b.inserir(api, 'contabil_arquivo_partes', { arquivo_id: Number(arquivo.id), ordem: i, dados: partes[i] });
    }
    await b.atualizar(api, 'contabil_arquivos', arquivo.id, { completo: true });
  } catch (e) {
    await api.delete(`/api/contabil_arquivos/${arquivo.id}`).catch(() => null);
    throw e;
  }
  await inserirVinculos(api, arquivo.id, ligacoes, usuarioId);
  if (registrarEvento) {
    await eventos.registrar(api, {
      tipo: 'arquivo_anexado', competencia: comp, usuarioId, referenciaTipo: 'arquivo', referenciaId: arquivo.id,
      descricao: `${CATEGORIAS[categoria]} anexado: ${nomeDeArquivo(nome)}${ligacoes.length ? ` (${ligacoes.map(v => ALVOS[v.alvo_tipo]).join(', ')})` : ''}`
    });
  }
  return { arquivo: { ...arquivo, completo: true }, reaproveitado: false };
}

/** O arquivo inteiro (metadados + conteúdo em base64). */
async function ler(api, id) {
  const arquivo = (await b.ler(api, 'contabil_arquivos', { id: Number(id) }))[0] || null;
  if (!arquivo || arquivo.completo === false || arquivo.completo === 'false') throw c.erro('Arquivo não encontrado.', 404);
  const partes = (await b.ler(api, 'contabil_arquivo_partes', { arquivo_id: Number(id) })).sort((x, y) => Number(x.ordem) - Number(y.ordem));
  if (partes.length !== Number(arquivo.partes)) throw c.erro('O arquivo está incompleto no banco.', 409);
  const buffer = Buffer.concat(partes.map(p => Buffer.from(String(p.dados || ''), 'base64')));
  return { arquivo, base64: buffer.toString('base64') };
}

/**
 * Os arquivos de uma competência (os da competência + os ligados a ela) ou os
 * de um alvo (tudo o que prova uma conta, um pagamento, um documento).
 */
async function listar(api, { competencia = null, alvoTipo = null, alvoId = null, incluirExcluidos = false } = {}) {
  const [todos, vinculos] = await Promise.all([b.ler(api, 'contabil_arquivos'), b.ler(api, 'contabil_arquivo_vinculos')]);
  let escolhidos;
  if (alvoTipo) {
    const ids = new Set(vinculos.filter(v => v.alvo_tipo === alvoTipo && String(v.alvo_id) === String(alvoId)).map(v => String(v.arquivo_id)));
    escolhidos = todos.filter(a => ids.has(String(a.id)));
  } else if (c.competenciaValida(competencia)) {
    const ligados = new Set(vinculos.filter(v => v.alvo_tipo === 'competencia' && v.alvo_id === competencia).map(v => String(v.arquivo_id)));
    escolhidos = todos.filter(a => a.competencia === competencia || ligados.has(String(a.id)));
  } else {
    escolhidos = todos;
  }
  escolhidos = escolhidos.filter(a => a.completo !== false && a.completo !== 'false' && (incluirExcluidos || !a.excluido_em));
  const nomes = await b.nomesDeUsuarios(api, escolhidos.map(a => a.criado_por));
  return escolhidos
    .sort((x, y) => String(y.criado_em).localeCompare(String(x.criado_em)) || Number(y.id) - Number(x.id))
    .map(a => publico(a, { vinculos, nomes }));
}

/**
 * Os arquivos vivos por alvo, para as contas do checklist: `Map('tipo:id' ->
 * [{ id, categoria, origem }])`. Pura sobre listas já lidas.
 */
function porAlvo(arquivosLista = [], vinculosLista = []) {
  const vivos = new Map(c.lista(arquivosLista).filter(vivo).map(a => [String(a.id), a]));
  const mapa = new Map();
  for (const v of c.lista(vinculosLista)) {
    const a = vivos.get(String(v.arquivo_id));
    if (!a) continue;
    const chave = `${v.alvo_tipo}:${v.alvo_id}`;
    if (!mapa.has(chave)) mapa.set(chave, []);
    mapa.get(chave).push({ id: a.id, categoria: a.categoria, origem: a.origem, nome: a.nome_arquivo });
  }
  return mapa;
}

async function vincular(api, arquivoId, vinculo, usuarioId = null) {
  const v = vinculoValido(vinculo);
  const arquivo = (await b.ler(api, 'contabil_arquivos', { id: Number(arquivoId) }))[0] || null;
  if (!vivo(arquivo)) throw c.erro('Arquivo não encontrado.', 404);
  const ja = await b.ler(api, 'contabil_arquivo_vinculos', { arquivo_id: Number(arquivoId) });
  await inserirVinculos(api, arquivoId, [v], usuarioId, ja);
  return { id: Number(arquivoId), ...v };
}

async function excluir(api, id, { motivo, usuarioId = null }) {
  const m = c.texto(motivo, 500);
  if (m.length < 5) throw c.erro('Diga por que o arquivo sai (ao menos 5 letras).');
  const arquivo = (await b.ler(api, 'contabil_arquivos', { id: Number(id) }))[0] || null;
  if (!arquivo || arquivo.excluido_em) throw c.erro('Arquivo não encontrado.', 404);
  await b.atualizar(api, 'contabil_arquivos', arquivo.id, { excluido_em: c.agora(), excluido_por: usuarioId, motivo_exclusao: m });
  await eventos.registrar(api, {
    tipo: 'arquivo_excluido', competencia: arquivo.competencia, usuarioId, referenciaTipo: 'arquivo', referenciaId: arquivo.id,
    descricao: `${CATEGORIAS[arquivo.categoria] || 'Arquivo'} excluído: ${arquivo.nome_arquivo} — ${m}`
  });
  return { id: arquivo.id, excluido: true };
}

module.exports = {
  LIMITE_BYTES, TAMANHO_PARTE, CATEGORIAS, CATEGORIAS_DE_DOCUMENTO, ORIGENS, ALVOS,
  sha256, partesDoArquivo, nomeDeArquivo, vinculoValido, publico, porAlvo,
  salvar, ler, listar, vincular, excluir
};
