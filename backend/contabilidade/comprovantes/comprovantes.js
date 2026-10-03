/**
 * Fase D (02/10/2026): os comprovantes de pagamento do BB — o ZIP que o site
 * do banco entrega (ou os PDFs soltos). Pedido do dono: "anexar no programa,
 * ele lê e já organiza, sem armazenar arquivos no servidor, só dados, de modo
 * que consigamos recriar de forma oficial os comprovantes para o pacote".
 *
 *   importar ........ abre o ZIP, lê cada PDF (leitor.js), guarda SÓ OS DADOS
 *                     (o texto e a posição de cada linha, os campos, o SHA-256
 *                     e o nome do arquivo), refaz o comprovante (pdf.js) e
 *                     confere com o original: idêntico, o arquivo não é
 *                     guardado; diferente (ou formato desconhecido), o
 *                     original fica em contabil_arquivos SÓ ATÉ o pacote do
 *                     mês ser gerado e salvo (descartarOriginais);
 *   casar ........... comprovante × lançamento (débito) do extrato (pura):
 *                     mesmo valor, até 5 dias, a mesma conta; liga sozinho com
 *                     o par único e uma chave (o DOCUMENTO do extrato, o ID do
 *                     Pix, o CPF/CNPJ) ou o mesmo dia, ou o nome a até 3 dias;
 *   ligar ........... grava a ligação, completa o CPF/CNPJ da contrapartida no
 *                     lançamento (a conciliação passa a casar pelo CNPJ) e
 *                     liga o boleto do DDA pela linha digitável;
 *   tela ............ listar, detalhe (os lançamentos candidatos), ligar à
 *                     mão, desligar, ignorar, restaurar, o PDF refeito.
 *
 * O pagamento tem comprovante quando o lançamento do banco que o paga
 * (conciliação) tem o comprovante ligado — o checklist usa
 * `pagamentosComComprovante`. A reprodução do pacote leva o pé "Reproduzido
 * pelo App-Gestão a partir do comprovante original do BB (…SHA-256…)".
 */
const c = require('../../financeiro/comum');
const b = require('../base');
const eventos = require('../eventos');
const arquivos = require('../arquivos');
const motor = require('../conciliacao/motor');
const leitor = require('./leitor');
const campos = require('./campos');
const pdf = require('./pdf');

const TABELA = 'contabil_comprovantes';
const SITUACOES = { novo: 'Sem lançamento', ligado: 'Ligado ao extrato', ignorado: 'Ignorado' };
const VISOES = { sem_par: 'Sem lançamento do extrato', ligados: 'Ligados ao extrato', ignorados: 'Ignorados', todos: 'Todos' };
const CRITERIOS = {
  documento: 'mesmo nº de documento', e2e: 'mesmo ID do Pix', cnpj: 'mesmo CPF/CNPJ', mesmo_dia: 'mesmo valor no mesmo dia', nome: 'nome na descrição do banco', manual: 'ligado à mão'
};
/** Até quantos dias entre a data do comprovante e a do lançamento. */
const JANELA_DIAS = 5;
const MAX_ARQUIVOS = 300;

const cent = v => Math.round(Math.abs(Number(v) || 0) * 100);
const chaveDoc = v => b.digitos(v).replace(/^0+(?=\d)/, '');
/** O CPF/CNPJ inteiro (sem asterisco) — só esse serve de chave. Pura. */
const docCheio = v => (/^\d{11}$|^\d{14}$/.test(String(v ?? '')) ? String(v) : null);

// ------------------------------------------------------------------ análise (pura)

/**
 * Um PDF → o que se guarda dele: SHA-256, formato, layout, linhas, campos e
 * se a reprodução confere com o original. Pura.
 */
function analisar(nome, dados) {
  const sha = arquivos.sha256(dados);
  let lido;
  try {
    lido = leitor.lerPdf(dados);
  } catch (e) {
    return { sha256: sha, nome, tamanho: dados.length, formato: 'ilegivel', layout: null, linhas: [], confere: false, diferenca: e.message, campos: campos.lerCampos([], { nomeArquivo: nome }) };
  }
  const f = leitor.formatoSimples(lido);
  let confere = false;
  let diferenca = f.ok ? null : `formato que o app não refaz: ${f.motivo}`;
  if (f.ok) {
    try {
      const deNovo = leitor.formatoSimples(leitor.lerPdf(pdf.gerarPdf({ layout: f.layout, linhas: f.linhas })));
      const iguais = deNovo.ok && JSON.stringify(deNovo.linhas) === JSON.stringify(f.linhas) && JSON.stringify(deNovo.layout) === JSON.stringify(f.layout);
      confere = iguais;
      if (!iguais) diferenca = 'a reprodução não ficou idêntica ao original';
    } catch (e) {
      diferenca = `não deu para refazer: ${e.message}`;
    }
  }
  return {
    sha256: sha, nome, tamanho: dados.length, formato: f.ok ? 'bb_texto' : 'desconhecido', layout: f.layout, linhas: f.linhas,
    confere, diferenca, campos: campos.lerCampos(f.linhas, { nomeArquivo: nome })
  };
}

/** A conta do banco do comprovante (agência e conta sem os dígitos). Pura. */
function contaDoComprovante(cp, contas) {
  if (!cp.agencia || !cp.conta) return null;
  const sem0 = v => b.digitos(v).replace(/^0+(?=\d)/, '');
  return c.lista(contas).find(x => x && sem0(x.agencia) === sem0(cp.agencia)
    && [sem0(x.conta), sem0(String(b.digitos(x.conta)).slice(0, -1))].includes(sem0(cp.conta))) || null;
}

/** Os PDFs de uma lista de arquivos (o ZIP aberto; o resto ignorado com o motivo). Pura. */
function expandir(entradas) {
  const pdfs = [];
  const ignorados = [];
  for (const e of entradas) {
    const nome = arquivos.nomeDeArquivo(e.nome);
    const dados = e.dados;
    if (/\.zip$/i.test(nome) || (dados.length > 4 && dados.readUInt32LE(0) === 0x04034b50)) {
      try {
        for (const x of leitor.lerZip(dados)) {
          if (/\.pdf$/i.test(x.nome)) pdfs.push({ nome: arquivos.nomeDeArquivo(x.nome), dados: x.dados });
          else ignorados.push({ nome: x.nome, motivo: 'não é PDF' });
        }
      } catch (err) {
        ignorados.push({ nome, motivo: err.message });
      }
    } else if (dados.subarray(0, 5).toString('latin1') === '%PDF-') {
      pdfs.push({ nome, dados });
    } else {
      ignorados.push({ nome, motivo: 'não é PDF nem ZIP' });
    }
  }
  return { pdfs, ignorados };
}

// ------------------------------------------------------------------ casamento (puro)

/**
 * Comprovante × lançamento do extrato. Devolve Map(id do comprovante ->
 * { automatico, candidatos }): só os sem lançamento; o lançamento já ligado
 * a outro comprovante não é candidato; automático só com o par único dos
 * dois lados. Pura.
 */
function casar({ comprovantes = [], movimentos = [] }) {
  const ocupados = new Set(c.lista(comprovantes).filter(x => x && x.movimento_id && x.situacao === 'ligado').map(x => String(x.movimento_id)));
  const debitos = c.lista(movimentos).filter(m => m && Number(m.valor) < 0 && !ocupados.has(String(m.id)));
  const saida = new Map();
  const autoDoMov = new Map();
  for (const cp of c.lista(comprovantes).filter(x => x && x.situacao === 'novo' && x.data && Number(x.valor) > 0)) {
    const cands = [];
    for (const m of debitos) {
      if (cp.conta_id && m.conta_id && String(m.conta_id) !== String(cp.conta_id)) continue;
      if (cent(m.valor) !== cent(cp.valor)) continue;
      const dias = Math.abs(motor.diasEntre(c.dia(cp.data), c.dia(m.data)));
      if (dias > JANELA_DIAS) continue;
      const docMov = chaveDoc(m.documento);
      let criterio = null;
      if (docMov && [chaveDoc(cp.documento), chaveDoc(cp.controle)].includes(docMov)) criterio = 'documento';
      else if (cp.e2e && String(m.identificador || '').toUpperCase().includes(String(cp.e2e).toUpperCase())) criterio = 'e2e';
      else if (docCheio(cp.favorecido_documento) && b.digitos(m.contrapartida_documento) === cp.favorecido_documento) criterio = 'cnpj';
      const nome = Boolean(cp.favorecido_nome) && motor.nomeNaDescricao(cp.favorecido_nome, m.descricao);
      const automatico = Boolean(criterio) || dias === 0 || (nome && dias <= 3);
      const pontos = (criterio ? 100 : 0) + (nome ? 20 : 0) + 30 - Math.min(dias, 10) * 3;
      cands.push({
        movimento_id: Number(m.id), pontos, dias, automatico,
        criterio: criterio || (dias === 0 ? 'mesmo_dia' : (nome ? 'nome' : null)),
        motivos: ['mesmo valor', dias === 0 ? 'mesmo dia' : `${dias} ${dias === 1 ? 'dia' : 'dias'} de diferença`, criterio ? CRITERIOS[criterio] : null, nome ? 'nome na descrição' : null].filter(Boolean)
      });
    }
    cands.sort((x, y) => y.pontos - x.pontos || x.dias - y.dias || x.movimento_id - y.movimento_id);
    const autos = cands.filter(x => x.automatico);
    // Com chave forte, ela decide entre dois do mesmo valor; sem chave, só o único.
    const fortes = autos.filter(x => ['documento', 'e2e', 'cnpj'].includes(x.criterio));
    const escolhido = fortes.length === 1 ? fortes[0] : (cands.length === 1 && autos.length === 1 ? autos[0] : null);
    if (escolhido) autoDoMov.set(String(escolhido.movimento_id), [...(autoDoMov.get(String(escolhido.movimento_id)) || []), cp.id]);
    saida.set(cp.id, { automatico: escolhido, candidatos: cands.slice(0, 8) });
  }
  for (const [, r] of saida) if (r.automatico && (autoDoMov.get(String(r.automatico.movimento_id)) || []).length > 1) r.automatico = null;
  return saida;
}

/**
 * Os pagamentos (de conta a pagar e de comissão/produção) que têm
 * comprovante: os conciliados com um lançamento do banco que tem o
 * comprovante ligado. `Set('titulo_pagamento:id' | 'financeiro_pagamento:id')`. Pura.
 */
function pagamentosComComprovante({ comprovantes = [], vinculos = [] }) {
  const comMov = new Set(c.lista(comprovantes).filter(x => x && x.situacao === 'ligado' && x.movimento_id).map(x => String(x.movimento_id)));
  const saida = new Set();
  for (const v of c.lista(vinculos)) {
    if (!v || v.desfeito_em || !comMov.has(String(v.movimento_id))) continue;
    saida.add(`${v.alvo_tipo}:${v.alvo_id}`);
  }
  return saida;
}

// ------------------------------------------------------------------ leitura

const lerTodos = api => b.lerOpcional(api, TABELA);

async function lerComprovante(api, id) {
  const linha = (await b.ler(api, TABELA, { id: Number(id) }))[0] || null;
  if (!linha) throw c.erro('Comprovante não encontrado.', 404);
  return normalizar(linha);
}

/** A linha com datas, valores e o JSON já no formato das contas. Pura. */
function normalizar(l) {
  return {
    ...l, id: Number(l.id), data: c.dia(l.data), valor: l.valor === null || l.valor === undefined ? null : c.centavos(l.valor),
    tarifa: l.tarifa === null || l.tarifa === undefined ? null : c.centavos(l.tarifa),
    linhas: c.jsonDe(l.linhas, []) || [], layout: c.jsonDe(l.layout, null),
    confere: l.confere === true || l.confere === 'true', segunda_via: l.segunda_via === true || l.segunda_via === 'true',
    situacao: SITUACOES[l.situacao] ? l.situacao : 'novo'
  };
}

// ------------------------------------------------------------------ gravação

/** Grava a ligação do comprovante com o lançamento (e o que ela completa). */
async function gravarLigacao(api, cp, m, { criterio, usuarioId = null }) {
  await b.atualizar(api, TABELA, cp.id, {
    movimento_id: Number(m.id), situacao: 'ligado', ligacao_criterio: criterio, ligado_em: c.agora(), ligado_por: usuarioId,
    motivo: null, decidido_em: null, decidido_por: null, conta_id: cp.conta_id ?? m.conta_id ?? null, atualizado_em: c.agora()
  });
  // O CPF/CNPJ do favorecido completa o lançamento que não tinha (a conciliação casa pelo CNPJ).
  let completou = false;
  const doc = docCheio(cp.favorecido_documento);
  if (doc && !b.digitos(m.contrapartida_documento)) {
    const fechada = ((await b.lerOpcional(api, 'competencia_contabil', { competencia: String(m.competencia) })) || [])[0]?.status === 'fechada';
    if (!fechada) {
      await b.atualizar(api, 'movimentos_bancarios', m.id, { contrapartida_documento: doc, contrapartida_tipo: doc.length === 14 ? 'J' : 'F' }).then(() => { completou = true; }).catch(() => null);
    }
  }
  await eventos.registrar(api, {
    tipo: 'comprovante_ligado', usuarioId, competencia: m.competencia || cp.competencia,
    descricao: `Comprovante ${campos.TIPOS[cp.tipo] || ''} de ${cp.favorecido_nome || 'favorecido'} (${c.reais(cp.valor)}, ${c.impressa(cp.data)}) ligado ao lançamento de ${c.impressa(c.dia(m.data))}`
      + ` — ${CRITERIOS[criterio] || criterio}${completou ? '; o CPF/CNPJ da contrapartida foi completado' : ''}`,
    dados: { comprovante_id: cp.id, movimento_id: m.id, criterio }
  });
  return { completou };
}

/** O boleto do DDA do comprovante de título (pela linha digitável). */
async function boletoDoDda(api, cp) {
  if (cp.tipo !== 'boleto' || !/^\d{47}$|^\d{44}$/.test(String(cp.codigo || ''))) return null;
  const boletos = (await b.lerOpcional(api, 'contabil_dda_boletos').catch(() => null)) || [];
  return boletos.find(x => x && (b.digitos(x.linha_digitavel) === cp.codigo || b.digitos(x.codigo_barras) === cp.codigo)) || null;
}

/**
 * As ligações automáticas com o extrato. Devolve `{ ligados, completados,
 * meses, falhas }` (os meses, para a conciliação rodar sozinha).
 */
async function ligarSozinhos(api, { usuarioId = null } = {}) {
  const lidos = await lerTodos(api);
  if (!lidos) return { ligados: 0, completados: 0, meses: [], falhas: [] };
  const comprovantes = lidos.filter(Boolean).map(normalizar);
  const datas = comprovantes.filter(x => x.situacao === 'novo' && x.data).map(x => x.data).sort();
  if (!datas.length) return { ligados: 0, completados: 0, meses: [], falhas: [] };
  const movimentos = (await b.lerOpcional(api, 'movimentos_bancarios')) || [];
  const perto = movimentos.filter(m => m && c.dia(m.data) >= motor.somarDias(datas[0], -JANELA_DIAS) && c.dia(m.data) <= motor.somarDias(datas[datas.length - 1], JANELA_DIAS));
  const casados = casar({ comprovantes, movimentos: perto });
  const porId = new Map(perto.map(m => [Number(m.id), m]));
  const saida = { ligados: 0, completados: 0, meses: new Set(), falhas: [] };
  for (const cp of comprovantes.filter(x => x.situacao === 'novo')) {
    const auto = casados.get(cp.id)?.automatico;
    if (!auto) continue;
    const m = porId.get(auto.movimento_id);
    try {
      const r = await gravarLigacao(api, cp, m, { criterio: auto.criterio, usuarioId });
      saida.ligados++;
      if (r.completou) saida.completados++;
      saida.meses.add(String(m.competencia || c.dia(m.data).slice(0, 7)));
    } catch (e) {
      saida.falhas.push(`${cp.favorecido_nome || cp.nome_arquivo}: ${c.ehDuplicado(e) ? 'o lançamento acabou de ser ligado a outro comprovante' : e.message}`);
    }
  }
  return { ...saida, meses: [...saida.meses].sort() };
}

/**
 * Anexar o ZIP do BB (ou PDFs): `arquivos` = [{ nome, base64 }]. Guarda os
 * dados de cada comprovante novo (o repetido pelo SHA-256 fica de fora),
 * guarda o original só quando a reprodução não confere, liga ao extrato e
 * roda a conciliação automática nos meses tocados.
 */
async function importar(api, { arquivos: entradas = [], usuarioId = null, hoje }) {
  if (!Array.isArray(entradas) || !entradas.length) throw c.erro('Escolha o ZIP do BB ou os PDFs dos comprovantes.');
  if ((await lerTodos(api)) === null) throw c.erro(b.SQL_FALTANDO_FASE_D, 409, { sql_pendente: true, sql_arquivo: b.SQL_ARQUIVO_FASE_D });
  const brutos = entradas.map(e => ({ nome: e?.nome, dados: Buffer.from(String(e?.base64 || ''), 'base64') })).filter(e => e.dados.length);
  const { pdfs, ignorados } = expandir(brutos);
  if (pdfs.length > MAX_ARQUIVOS) throw c.erro(`São ${pdfs.length} PDFs: anexe no máximo ${MAX_ARQUIVOS} por vez.`, 413);
  const existentes = new Set(((await lerTodos(api)) || []).map(x => x.sha256));
  const contas = (await b.lerOpcional(api, 'contas_financeiras').catch(() => null)) || [];
  const saida = { lidos: pdfs.length, novos: 0, repetidos: 0, refeitos: 0, guardados: 0, ignorados, falhas: [], ids: [] };
  for (const p of pdfs) {
    const a = analisar(p.nome, p.dados);
    if (existentes.has(a.sha256)) { saida.repetidos++; continue; }
    existentes.add(a.sha256);
    const cps = a.campos;
    if (a.formato === 'ilegivel') { saida.ignorados.push({ nome: p.nome, motivo: a.diferenca }); continue; }
    let arquivoId = null;
    if (!a.confere) {
      // O original fica só até o pacote do mês ser gerado e salvo (regra do dono).
      const r = await arquivos.salvar(api, {
        nome: p.nome, tipo: 'application/pdf', base64: p.dados.toString('base64'), categoria: 'comprovante', origem: 'oficial',
        competencia: null, descricao: 'Original do comprovante do BB (fica até o pacote)', usuarioId, registrarEvento: false
      });
      arquivoId = r.arquivo.id;
      saida.guardados++;
    } else {
      saida.refeitos++;
    }
    const conta = contaDoComprovante(cps, contas);
    try {
      const linha = await b.inserir(api, TABELA, {
        sha256: a.sha256, nome_arquivo: p.nome, tamanho_bytes: a.tamanho, formato: a.formato,
        layout: a.layout ? JSON.stringify(a.layout) : null, linhas: JSON.stringify(a.linhas), confere: a.confere, diferenca: a.diferenca,
        arquivo_id: arquivoId, tipo: cps.tipo, data: cps.data, valor: cps.valor, tarifa: cps.tarifa, autenticacao: cps.autenticacao,
        documento: cps.documento ? String(cps.documento).slice(0, 30) : null, controle: cps.controle ? String(cps.controle).slice(0, 30) : null,
        favorecido_nome: cps.favorecido_nome, favorecido_documento: cps.favorecido_documento, pagador_nome: cps.pagador_nome, pagador_documento: cps.pagador_documento,
        codigo: cps.codigo, e2e: cps.e2e, agencia: cps.agencia, conta: cps.conta, segunda_via: cps.segunda_via,
        competencia: cps.data ? cps.data.slice(0, 7) : null, conta_id: conta?.id ?? null, situacao: 'novo',
        importado_em: c.agora(), importado_por: usuarioId, atualizado_em: c.agora()
      });
      saida.novos++;
      saida.ids.push(linha.id);
      const dda = await boletoDoDda(api, cps).catch(() => null);
      if (dda) await b.atualizar(api, TABELA, linha.id, { dda_boleto_id: Number(dda.id) }).catch(() => null);
    } catch (e) {
      if (c.ehDuplicado(e) && !e.extra?.sql_pendente) { saida.repetidos++; continue; }
      saida.falhas.push(`${p.nome}: ${e.message}`);
    }
  }
  const ligados = await ligarSozinhos(api, { usuarioId });
  let conciliacao = null;
  if (ligados.meses.length) {
    const conciliacaoMod = require('../conciliacao/conciliacao');
    conciliacao = await conciliacaoMod.automaticaDosMeses(api, { competencias: ligados.meses, usuarioId, hoje });
  }
  const partes = [`${c.plural(saida.lidos, 'comprovante lido', 'comprovantes lidos')}`];
  if (saida.novos) partes.push(c.plural(saida.novos, 'novo', 'novos'));
  if (saida.repetidos) partes.push(`${c.plural(saida.repetidos, 'já estava', 'já estavam')} no app`);
  if (saida.refeitos) partes.push(`${c.plural(saida.refeitos, 'refeito idêntico', 'refeitos idênticos')} (o arquivo não foi guardado)`);
  if (saida.guardados) partes.push(`${c.plural(saida.guardados, 'original guardado', 'originais guardados')} até o pacote`);
  if (ligados.ligados) partes.push(`${c.plural(ligados.ligados, 'ligado ao extrato', 'ligados ao extrato')}${ligados.completados ? ` (${c.plural(ligados.completados, 'CPF/CNPJ completado', 'CPF/CNPJ completados')} no lançamento)` : ''}`);
  const frase = conciliacao ? require('../conciliacao/conciliacao').resumoDaAutomatica(conciliacao) : null;
  if (frase) partes.push(frase);
  if (saida.ignorados.length) partes.push(`${c.plural(saida.ignorados.length, 'arquivo ignorado', 'arquivos ignorados')}`);
  if (saida.novos) {
    await eventos.registrar(api, {
      tipo: 'comprovantes_importados', usuarioId,
      descricao: `Comprovantes do BB anexados: ${partes.join(' · ')}`,
      dados: { novos: saida.novos, refeitos: saida.refeitos, guardados: saida.guardados, ligados: ligados.ligados }
    });
  }
  return { ...saida, ligados: ligados.ligados, completados: ligados.completados, falhas: [...saida.falhas, ...ligados.falhas], conciliacao, resumo: partes.join(' · ') };
}

/** O lançamento do extrato para ligar à mão: existe, é débito, não é de outro comprovante. */
async function conferirMovimento(api, movimentoId, cp) {
  const m = (await b.ler(api, 'movimentos_bancarios', { id: Number(movimentoId) }))[0] || null;
  if (!m) throw c.erro('Lançamento do extrato não encontrado.', 404);
  if (!(Number(m.valor) < 0)) throw c.erro('O comprovante é de pagamento: escolha um débito do extrato.', 422);
  const outro = (await b.ler(api, TABELA, { movimento_id: Number(m.id) })).find(x => String(x.id) !== String(cp.id) && x.situacao === 'ligado');
  if (outro) throw c.erro('Este lançamento já tem outro comprovante: desligue-o antes.', 409);
  return m;
}

async function ligar(api, id, { movimentoId, usuarioId = null }) {
  if (!/^\d+$/.test(String(movimentoId ?? ''))) throw c.erro('Escolha o lançamento do extrato.');
  const cp = await lerComprovante(api, id);
  if (cp.situacao !== 'novo') throw c.erro(cp.situacao === 'ligado' ? 'Este comprovante já está ligado: desligue antes.' : 'Este comprovante está ignorado: restaure antes.', 409);
  const m = await conferirMovimento(api, movimentoId, cp);
  let r;
  try {
    r = await gravarLigacao(api, cp, m, { criterio: 'manual', usuarioId });
  } catch (e) {
    if (c.ehDuplicado(e) && !e.extra?.sql_pendente) throw c.erro('Este lançamento acabou de ser ligado a outro comprovante.', 409);
    throw e;
  }
  const aviso = cent(m.valor) !== cent(cp.valor) ? `O lançamento é de ${c.reais(Math.abs(Number(m.valor)))} e o comprovante de ${c.reais(cp.valor)}.` : null;
  return { id: cp.id, situacao: 'ligado', movimento_id: Number(m.id), competencia: String(m.competencia || c.dia(m.data).slice(0, 7)), completou: r.completou, aviso };
}

/**
 * O "Ligar sozinho" da tela: os comprovantes sem lançamento que agora têm o
 * par certo (o extrato chegou depois do ZIP) se ligam, e a conciliação
 * automática roda nos meses tocados.
 */
async function conferir(api, { usuarioId = null, hoje } = {}) {
  if ((await lerTodos(api)) === null) throw c.erro(b.SQL_FALTANDO_FASE_D, 409, { sql_pendente: true, sql_arquivo: b.SQL_ARQUIVO_FASE_D });
  const r = await ligarSozinhos(api, { usuarioId });
  const conciliacaoMod = require('../conciliacao/conciliacao');
  const conciliacao = r.meses.length ? await conciliacaoMod.automaticaDosMeses(api, { competencias: r.meses, usuarioId, hoje }) : null;
  const partes = [r.ligados ? c.plural(r.ligados, 'comprovante ligado ao extrato', 'comprovantes ligados ao extrato') : 'Nenhum comprovante novo para ligar sozinho'];
  if (r.completados) partes.push(`${c.plural(r.completados, 'CPF/CNPJ completado', 'CPF/CNPJ completados')} no lançamento`);
  const frase = conciliacaoMod.resumoDaAutomatica(conciliacao);
  if (frase) partes.push(frase);
  return { ligados: r.ligados, completados: r.completados, falhas: [...r.falhas, ...(conciliacao?.falhas || [])], conciliacao, resumo: partes.join(' · ') };
}

async function desligar(api, id, { motivo, usuarioId = null }) {
  const texto = c.texto(motivo, 500);
  if (texto.length < 5) throw c.erro('Diga por que o comprovante sai deste lançamento (ao menos 5 letras).');
  const cp = await lerComprovante(api, id);
  if (cp.situacao !== 'ligado') throw c.erro('Este comprovante não está ligado a um lançamento.', 409);
  await b.atualizar(api, TABELA, cp.id, { movimento_id: null, situacao: 'novo', ligacao_criterio: null, ligado_em: null, ligado_por: null, atualizado_em: c.agora() });
  await eventos.registrar(api, {
    tipo: 'comprovante_desligado', usuarioId, competencia: cp.competencia,
    descricao: `Comprovante de ${cp.favorecido_nome || 'favorecido'} (${c.reais(cp.valor)}, ${c.impressa(cp.data)}) desligado do lançamento do extrato: ${texto}`,
    dados: { comprovante_id: cp.id, movimento_id: cp.movimento_id }
  });
  return { id: cp.id, situacao: 'novo' };
}

async function ignorar(api, id, { motivo, usuarioId = null }) {
  const texto = c.texto(motivo, 500);
  if (texto.length < 5) throw c.erro('Diga por que o comprovante é ignorado (ao menos 5 letras): repetido, de outra conta…');
  const cp = await lerComprovante(api, id);
  if (cp.situacao !== 'novo') throw c.erro(cp.situacao === 'ligado' ? 'Este comprovante está ligado: desligue antes.' : 'Este comprovante já está ignorado.', 409);
  await b.atualizar(api, TABELA, cp.id, { situacao: 'ignorado', motivo: texto, decidido_em: c.agora(), decidido_por: usuarioId, atualizado_em: c.agora() });
  await eventos.registrar(api, {
    tipo: 'comprovante_ignorado', usuarioId, competencia: cp.competencia,
    descricao: `Comprovante de ${cp.favorecido_nome || 'favorecido'} (${c.reais(cp.valor)}, ${c.impressa(cp.data)}) ignorado: ${texto}`,
    dados: { comprovante_id: cp.id }
  });
  return { id: cp.id, situacao: 'ignorado' };
}

async function restaurar(api, id, { usuarioId = null } = {}) {
  const cp = await lerComprovante(api, id);
  if (cp.situacao !== 'ignorado') throw c.erro('Este comprovante não está ignorado.', 409);
  await b.atualizar(api, TABELA, cp.id, { situacao: 'novo', motivo: null, decidido_em: null, decidido_por: null, atualizado_em: c.agora() });
  await eventos.registrar(api, {
    tipo: 'comprovante_restaurado', usuarioId, competencia: cp.competencia,
    descricao: `Comprovante de ${cp.favorecido_nome || 'favorecido'} (${c.reais(cp.valor)}) voltou a ficar sem lançamento (antes ignorado: ${cp.motivo || 'sem motivo'})`,
    dados: { comprovante_id: cp.id }
  });
  return { id: cp.id, situacao: 'novo' };
}

// ------------------------------------------------------------------ PDF (a reprodução) e o descarte do original

/** O nome do arquivo da reprodução (o do BB, para casar com o que o dono baixou). Pura. */
function nomeDaReproducao(cp) {
  const base = String(cp.nome_arquivo || `Comprovante ${cp.id}.pdf`).replace(/\.pdf$/i, '');
  return `${base}.pdf`;
}

/**
 * O PDF do comprovante: refeito dos dados (com o pé "Reproduzido…" quando
 * `comRodape`) ou, quando a reprodução não confere, o original guardado.
 * `{ nome, tipo, base64, origem }`.
 */
async function pdfDoComprovante(api, id, { comRodape = true } = {}) {
  const cp = await lerComprovante(api, id);
  if (cp.confere && cp.layout) {
    const rodape = comRodape ? pdf.rodapeDaReproducao({ nomeArquivo: cp.nome_arquivo, sha256: cp.sha256, autenticacao: cp.autenticacao }) : [];
    const bytes = pdf.gerarPdf({ layout: cp.layout, linhas: cp.linhas, rodape, titulo: `Comprovante ${campos.TIPOS[cp.tipo] || ''} - ${cp.favorecido_nome || ''}`.trim() });
    return { nome: nomeDaReproducao(cp), tipo: 'application/pdf', base64: bytes.toString('base64'), origem: 'reproduzido' };
  }
  if (cp.arquivo_id && !cp.original_descartado_em) {
    const { arquivo, base64 } = await arquivos.ler(api, cp.arquivo_id);
    return { nome: arquivo.nome_arquivo, tipo: 'application/pdf', base64, origem: 'oficial' };
  }
  throw c.erro('O original deste comprovante já foi enviado no pacote e saiu do servidor: anexe o PDF de novo para gerar outro pacote.', 409);
}

/**
 * Depois do pacote gerado E salvo (regra do dono): os originais guardados dos
 * comprovantes da competência saem do servidor (as partes do arquivo são
 * apagadas); ficam os dados e o SHA-256. Devolve quantos saíram.
 */
async function descartarOriginais(api, { competencia, usuarioId = null, pacoteId = null }) {
  const lidos = await lerTodos(api);
  if (!lidos || !c.competenciaValida(competencia)) return { descartados: 0 };
  const alvo = lidos.filter(x => x && x.competencia === competencia && x.arquivo_id && !x.original_descartado_em);
  let descartados = 0;
  for (const cp of alvo) {
    try {
      const partes = await b.ler(api, 'contabil_arquivo_partes', { arquivo_id: Number(cp.arquivo_id) });
      for (const p of partes) await b.excluir(api, 'contabil_arquivo_partes', p.id);
      await b.atualizar(api, 'contabil_arquivos', cp.arquivo_id, {
        excluido_em: c.agora(), excluido_por: usuarioId, motivo_exclusao: `Original descartado depois do pacote${pacoteId ? ` ${pacoteId}` : ''} (ficam os dados e o SHA-256)`
      });
      await b.atualizar(api, TABELA, cp.id, { original_descartado_em: c.agora(), atualizado_em: c.agora() });
      descartados++;
    } catch (e) {
      console.warn('[contabilidade/comprovantes] original não descartado:', e?.message || e);
    }
  }
  if (descartados) {
    await eventos.registrar(api, {
      tipo: 'comprovantes_descartados', usuarioId, competencia,
      descricao: `${c.plural(descartados, 'original de comprovante saiu', 'originais de comprovante saíram')} do servidor depois do pacote de ${c.rotuloCompetencia(competencia)} (ficam os dados e o SHA-256)`,
      dados: { pacote_id: pacoteId, descartados }
    });
  }
  return { descartados };
}

// ------------------------------------------------------------------ tela

/** Um comprovante como a tela vê. Pura. */
function linhaPublica(cp, { movimentosPorId = new Map(), casado = null, contas = new Map(), empresa = null } = {}) {
  const m = cp.movimento_id ? movimentosPorId.get(String(cp.movimento_id)) || null : null;
  const avisos = [];
  const empresaDoc = b.digitos(empresa);
  if (cp.pagador_documento && docCheio(cp.pagador_documento) && empresaDoc && cp.pagador_documento !== empresaDoc) {
    avisos.push(`O pagador do ${cp.tipo === 'boleto' ? 'boleto' : 'pagamento'} é ${cp.pagador_nome || b.documentoFormatado(cp.pagador_documento)}, não a empresa: confira (reembolso a receber?).`);
  }
  // O motivo técnico (diferenca) fica no banco; a tela só diz o que acontece com o arquivo.
  if (!cp.confere) avisos.push(cp.original_descartado_em ? 'O original já foi enviado no pacote e saiu do servidor.' : 'O app não refaz este idêntico ao do banco: o original fica guardado até o pacote.');
  if (m && cent(m.valor) !== cent(cp.valor)) avisos.push(`O lançamento é de ${c.reais(Math.abs(Number(m.valor)))} e o comprovante de ${c.reais(cp.valor)}.`);
  return {
    id: cp.id, nome_arquivo: cp.nome_arquivo, sha_curto: String(cp.sha256 || '').slice(0, 12), tipo: cp.tipo, tipo_rotulo: campos.TIPOS[cp.tipo] || cp.tipo,
    data: cp.data, valor: cp.valor, tarifa: cp.tarifa, autenticacao: cp.autenticacao, documento: cp.documento, controle: cp.controle,
    favorecido_nome: cp.favorecido_nome, favorecido_documento: docCheio(cp.favorecido_documento) ? b.documentoFormatado(cp.favorecido_documento) : cp.favorecido_documento,
    pagador_nome: cp.pagador_nome, codigo: cp.codigo, e2e: cp.e2e, segunda_via: cp.segunda_via,
    conta: cp.conta_id ? contas.get(String(cp.conta_id))?.nome || null : null,
    confere: cp.confere, original_guardado: Boolean(cp.arquivo_id) && !cp.original_descartado_em,
    situacao: cp.situacao, situacao_rotulo: SITUACOES[cp.situacao], motivo: cp.motivo || null,
    movimento: m ? { id: Number(m.id), data: c.dia(m.data), valor: c.centavos(m.valor), descricao: m.descricao || null, estado: m.estado_conciliacao || 'pendente', competencia: m.competencia } : null,
    criterio_rotulo: cp.ligacao_criterio ? CRITERIOS[cp.ligacao_criterio] || cp.ligacao_criterio : null,
    sugestoes: (casado?.candidatos || []).slice(0, 3).map(x => {
      const mm = movimentosPorId.get(String(x.movimento_id));
      return mm ? { movimento_id: x.movimento_id, data: c.dia(mm.data), valor: c.centavos(mm.valor), descricao: mm.descricao || null, motivos: x.motivos } : null;
    }).filter(Boolean),
    dda_boleto_id: cp.dda_boleto_id ?? null,
    avisos,
    pode: { ligar: cp.situacao === 'novo', ignorar: cp.situacao === 'novo', desligar: cp.situacao === 'ligado', restaurar: cp.situacao === 'ignorado', baixar: cp.confere || (Boolean(cp.arquivo_id) && !cp.original_descartado_em) }
  };
}

const naVisao = (cp, visao) => (visao === 'sem_par' ? cp.situacao === 'novo' : visao === 'ligados' ? cp.situacao === 'ligado' : visao === 'ignorados' ? cp.situacao === 'ignorado' : true);

async function listar(api, { competencia = null, visao = 'todos' } = {}) {
  const v = VISOES[visao] ? visao : 'todos';
  const lidos = await lerTodos(api);
  if (lidos === null) return { sql_pendente: true, sql_arquivo: b.SQL_ARQUIVO_FASE_D, visao: v, visoes: VISOES, linhas: [], contagem: null };
  const todos = lidos.filter(Boolean).map(normalizar);
  const comp = c.competenciaValida(competencia) ? String(competencia) : null;
  const doMes = comp ? todos.filter(x => x.competencia === comp) : todos;
  const [movimentos, contasLidas, fiscal] = await Promise.all([
    b.lerOpcional(api, 'movimentos_bancarios').then(x => x || []).catch(() => []),
    b.lerOpcional(api, 'contas_financeiras').then(x => x || []).catch(() => []),
    require('../../fiscal/configuracaoFiscal').carregar(api).catch(() => null)
  ]);
  const movimentosPorId = new Map(movimentos.map(m => [String(m.id), m]));
  const casados = casar({ comprovantes: todos, movimentos });
  const contas = new Map(contasLidas.map(x => [String(x.id), x]));
  const linhas = doMes.filter(x => naVisao(x, v))
    .sort((x, y) => String(x.data || '').localeCompare(String(y.data || '')) || x.id - y.id)
    .map(cp => linhaPublica(cp, { movimentosPorId, casado: casados.get(cp.id), contas, empresa: fiscal?.cnpj }));
  return {
    sql_pendente: false, competencia: comp, visao: v, visoes: VISOES, tipos: campos.TIPOS, linhas,
    contagem: {
      total: doMes.length, sem_par: doMes.filter(x => x.situacao === 'novo').length, ligados: doMes.filter(x => x.situacao === 'ligado').length,
      ignorados: doMes.filter(x => x.situacao === 'ignorado').length, refeitos: doMes.filter(x => x.confere).length,
      originais_guardados: doMes.filter(x => x.arquivo_id && !x.original_descartado_em).length,
      valor_sem_par: c.centavos(doMes.filter(x => x.situacao === 'novo').reduce((s, x) => s + (x.valor || 0), 0))
    }
  };
}

/** Um comprovante, o texto dele e os lançamentos para ligar à mão (débitos a até 10 dias, os de mesmo valor primeiro). */
async function detalhe(api, id) {
  const cp = await lerComprovante(api, id);
  const movimentos = (await b.lerOpcional(api, 'movimentos_bancarios')) || [];
  const ocupados = new Set(((await lerTodos(api)) || []).filter(x => x && x.situacao === 'ligado' && x.movimento_id && String(x.id) !== String(cp.id)).map(x => String(x.movimento_id)));
  const candidatos = cp.data ? movimentos
    .filter(m => m && Number(m.valor) < 0 && !ocupados.has(String(m.id)) && Math.abs(motor.diasEntre(cp.data, c.dia(m.data))) <= 10)
    .map(m => ({
      movimento_id: Number(m.id), data: c.dia(m.data), valor: c.centavos(m.valor), descricao: m.descricao || null, estado: m.estado_conciliacao || 'pendente',
      mesmo_valor: cent(m.valor) === cent(cp.valor), dias: Math.abs(motor.diasEntre(cp.data, c.dia(m.data)))
    }))
    .sort((x, y) => Number(y.mesmo_valor) - Number(x.mesmo_valor) || x.dias - y.dias || x.movimento_id - y.movimento_id)
    .slice(0, 30) : [];
  const movimentosPorId = new Map(movimentos.map(m => [String(m.id), m]));
  return { comprovante: { ...linhaPublica(cp, { movimentosPorId }), linhas: cp.linhas }, candidatos };
}

/**
 * Os itens dos Documentos da competência (o pacote usa a mesma lista): o
 * comprovante refeito (origem "reproduzido") ou o original guardado. Pura.
 */
function itensDeEvidencia(comprovantes, competencia) {
  return c.lista(comprovantes).filter(x => x && x.competencia === competencia && x.situacao !== 'ignorado').map(cp => {
    const titulo = `Comprovante ${campos.TIPOS[cp.tipo] || ''} — ${cp.favorecido_nome || 'favorecido'}`.replace(/\s+/g, ' ');
    const detalhe = [cp.autenticacao ? `autenticação ${cp.autenticacao}` : null, cp.situacao === 'ligado' ? 'ligado ao extrato' : 'sem lançamento do extrato', cp.nome_arquivo].filter(Boolean).join(' · ');
    const base = { chave: `comprovante:${cp.id}`, grupo: 'pagamentos', data: cp.data, titulo, detalhe, valor: cp.valor, categoria: 'Comprovante de pagamento' };
    if (cp.confere) return { ...base, origem: 'reproduzido', baixar: { tipo: 'comprovante', id: cp.id }, falta: false };
    if (cp.arquivo_id && !cp.original_descartado_em) return { ...base, origem: 'oficial', baixar: { tipo: 'arquivo', id: cp.arquivo_id }, falta: false };
    return { ...base, origem: null, baixar: null, falta: true, falta_rotulo: 'O original já saiu no pacote: anexe de novo' };
  });
}

module.exports = {
  TABELA, SITUACOES, VISOES, CRITERIOS, JANELA_DIAS, MAX_ARQUIVOS,
  analisar, contaDoComprovante, expandir, casar, pagamentosComComprovante, normalizar, nomeDaReproducao, linhaPublica, itensDeEvidencia,
  lerTodos, lerComprovante, ligarSozinhos, importar, ligar, conferir, desligar, ignorar, restaurar, pdfDoComprovante, descartarOriginais, listar, detalhe
};
