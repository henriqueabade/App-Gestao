/**
 * NF-e e boletos emitidos FORA do sistema (fase 3, 21/09/2026): o modal
 * "NF-e e boletos de fora" (pedido-dados-externos.js), o botão e as tags no
 * Visualizar pedido, a linha do "Aguardando NF-e" do Financeiro e o "Gerar
 * boletos", que não oferece a parcela já cobrada por fora. As contas e a
 * gravação moram no backend (backend/fiscal/externas.js, com teste próprio).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..', '..');
const ler = (...partes) => fs.readFileSync(path.join(RAIZ, ...partes), 'utf8');
const FONTE = ler('js', 'modals', 'pedido-dados-externos.js');
const HTML = ler('html', 'modals', 'pedidos', 'dados-externos.html');
const VISUALIZAR = ler('js', 'modals', 'pedido-visualizar.js');
const VIS_HTML = ler('html', 'modals', 'pedidos', 'visualizar.html');
const FINANCEIRO = ler('js', 'modals', 'financeiro-modais.js');
const GERAR = ler('js', 'modals', 'pedido-gerar-boletos.js');
const plano = v => JSON.parse(JSON.stringify(v));
const semEspacoFixo = s => String(s).replace(/\s/g, ' ');

function puras() {
  const inicio = FONTE.indexOf('const TAMANHO_MAXIMO_DO_XML');
  const fim = FONTE.indexOf('// ------------------------------------------------- fim das funções puras');
  assert.ok(inicio !== -1 && fim > inicio, 'o bloco de funções puras não foi encontrado');
  return vm.runInContext(`${FONTE.slice(inicio, fim)}
({ chaveEmGrupos, documentoFormatado, linhasDaNota, etiquetaDaNota, estadoDaParcela, frasedaPrevia, mensagemDeErro })`, vm.createContext({}));
}

/** O texto de uma função pelo nome (o corpo começa no `{` depois de `) `: os parâmetros podem ter `{ }`). */
function textoDaFuncao(fonte, nome) {
  const inicio = fonte.indexOf(`function ${nome}(`);
  assert.ok(inicio !== -1, `sem a função ${nome}`);
  let nivel = 0;
  let i = fonte.indexOf(') {', inicio) + 2;
  for (; i < fonte.length; i += 1) {
    if (fonte[i] === '{') nivel += 1;
    if (fonte[i] === '}') { nivel -= 1; if (nivel === 0) break; }
  }
  return fonte.slice(inicio, i + 1);
}

/** Recorta uma função pelo nome e a executa isolada (com as dependências em `extras`). */
function recortar(fonte, nome, extras = '') {
  return vm.runInContext(`${extras}\n${textoDaFuncao(fonte, nome)}\n${nome}`, vm.createContext({}));
}

test('modal: a nota de fora aparece organizada (NF-e, valor, emissão, emitente, chave em grupos)', () => {
  const f = puras();
  const chave = '31260912345678000195550020000001231123456780';
  assert.strictEqual(f.chaveEmGrupos(chave), '3126 0912 3456 7800 0195 5500 2000 0001 2311 2345 6780');
  assert.strictEqual(f.documentoFormatado('12345678000195'), '12.345.678/0001-95');
  assert.strictEqual(f.documentoFormatado('12345678909'), '123.456.789-09');
  const linhas = plano(f.linhasDaNota({ serie: 2, numero: 123, valor_total: 1500, data_emissao: '2026-09-10', emitente_nome: 'Santíssimo', emitente_documento: '12345678000195', chave_acesso: chave, protocolo: '1312', origem: 'xml' }));
  assert.deepStrictEqual(linhas.map(([r]) => r), ['NF-e', 'Valor', 'Emissão', 'Emitente', 'Chave de acesso', 'Protocolo', 'Informada']);
  assert.strictEqual(linhas[0][1], 'série 2 · nº 123');
  assert.strictEqual(semEspacoFixo(linhas[1][1]), 'R$ 1.500,00');
  assert.strictEqual(linhas[2][1], '10/09/2026');
  assert.strictEqual(linhas[6][1], 'pelo XML');
  // Pela chave só se sabe o mês.
  const pelaChave = plano(f.linhasDaNota({ serie: 2, numero: 5, valor_total: 10, mes_emissao: '2026-09', chave_acesso: chave, origem: 'chave' }));
  assert.strictEqual(pelaChave.find(([r]) => r === 'Emissão')[1], '09/2026');
  assert.strictEqual(pelaChave.at(-1)[1], 'pela chave de acesso');
  assert.deepStrictEqual(plano(f.linhasDaNota(null)), []);
});

test('modal: etiqueta da nota e o estado de cada parcela (do BB, de fora ou livre)', () => {
  const f = puras();
  assert.deepStrictEqual(plano(f.etiquetaDaNota({ nota_externa: { serie: 2, numero: 9 } })), ['badge-info', 'NF-e 2/9 · de fora']);
  assert.deepStrictEqual(plano(f.etiquetaDaNota({ nota_propria: { serie: 1, numero: 4 } })), ['badge-success', 'NF-e 1/4 · emitida aqui']);
  assert.deepStrictEqual(plano(f.etiquetaDaNota({})), ['badge-neutral', 'Sem nota']);

  const deFora = plano(f.estadoDaParcela({ boleto_externo: { banco_nome: 'Itaú', vencimento: '2026-10-15', valor: 1500, linha_impressa: '34191.09008 ...' } }));
  assert.strictEqual(deFora.tipo, 'externo');
  assert.strictEqual(semEspacoFixo(deFora.texto), 'De fora · Itaú · vence 15/10/2026 · R$ 1.500,00');
  assert.deepStrictEqual(plano(f.estadoDaParcela({ tem_boleto_vivo: true, boleto: { status: 'registrado' } })), { tipo: 'bb', texto: 'Boleto do BB · registrado' });
  assert.strictEqual(f.estadoDaParcela({}).tipo, 'livre');

  const ok = plano(f.frasedaPrevia({ ok: true, boleto: { banco_nome: 'Itaú', vencimento: '2026-10-15', valor: 1500 }, avisos: [] }));
  assert.deepStrictEqual([ok.tom, semEspacoFixo(ok.texto)], ['ok', 'Itaú · vence 15/10/2026 · R$ 1.500,00']);
  assert.strictEqual(f.frasedaPrevia({ ok: true, boleto: {}, avisos: ['O boleto vence em outra data.'] }).tom, 'aviso');
  assert.deepStrictEqual(plano(f.frasedaPrevia({ ok: false, erro: 'A linha digitável não confere (campo 1).' })), { tom: 'erro', texto: 'A linha digitável não confere (campo 1).' });
  assert.match(f.mensagemDeErro(409, { sql_pendente: true }), /sql\/nfe_boletos_externos\.sql/);
});

test('modal: confere antes de gravar, XML descartado, remover pede confirmação, avisa quem está aberto', () => {
  assert.ok(FONTE.includes("fetchApi(`/api/fiscal/pedidos/${id}/nfe-externa/previa`, comoJson(entrada))"), 'confere a nota antes');
  assert.ok(FONTE.includes("fetchApi(`/api/fiscal/pedidos/${id}/nfe-externa`, comoJson(entradaNota))"), 'grava o que foi conferido');
  assert.ok(FONTE.includes("fetchApi(`/api/cobranca/pedidos/${id}/boletos-externos/previa`"), 'confere a linha digitável ao colar');
  assert.ok(FONTE.includes("fetchApi(`/api/cobranca/pedidos/${id}/boletos-externos`, comoJson({ linhas }))"));
  assert.ok(FONTE.includes("{ method: 'DELETE' }"));
  assert.ok((FONTE.match(/window\.DialogPadrao\?\.confirm\?\.\(/g) || []).length === 2, 'remover nota e remover boleto pedem confirmação');
  assert.ok(FONTE.includes("avisarQuemEstaAberto('nfe:externa')") && FONTE.includes("avisarQuemEstaAberto('boletos:alterados')"));
  assert.ok(FONTE.includes('if (arquivo.size > TAMANHO_MAXIMO_DO_XML)'));
  assert.ok(!/innerHTML|window\.confirm\(/.test(FONTE), 'montado por createElement, sem confirm() do sistema');
  assert.ok(FONTE.includes("window.Modal?.signalReady?.(overlayId)"));
  // Anatomia do HTML.
  assert.match(HTML, /id="dadosExternosOverlay" class="hidden fixed inset-0[^"]*ctl-padrao"/);
  assert.ok(HTML.includes('id="notaExternaXml" type="file" accept=".xml'), 'escolhe o XML');
  assert.ok(HTML.includes('id="notaExternaChave"') && HTML.includes('id="notaExternaValor"'), 'ou a chave + o valor');
  assert.match(HTML, /id="gravarNotaExterna"[^>]*data-perm="financeiro\.nfe\.emit"/);
  assert.match(HTML, /id="gravarBoletosExternos"[^>]*data-perm="financeiro\.boleto\.emit"/);
});

test('Visualizar: o botão só em pedido que saiu e com algo a informar (ou a ver); tags e "Gerar boletos" sabem do boleto de fora', () => {
  const dependencias = ['pagaComBoleto', 'pedidoJaSaiu'].map(n => textoDaFuncao(VISUALIZAR, n)).join('\n');
  const precisa = recortar(VISUALIZAR, 'precisaDeDadosDeFora', dependencias);
  const enviado = { situacao: 'Enviado', forma_pagamento: 'boleto' };
  const livre = { parcelas: [{ tem_boleto_vivo: false }] };
  assert.strictEqual(precisa({ pedido: { situacao: 'Produção' }, notas: [], boletos: livre }), false, 'não saiu: nada de nota de fora');
  assert.strictEqual(precisa({ pedido: enviado, notas: [], boletos: livre }), true, 'sem nota nenhuma');
  assert.strictEqual(precisa({ pedido: enviado, notas: [{ status_fiscal: 'autorizada' }], boletos: { parcelas: [{ tem_boleto_vivo: true }] } }), false, 'nota daqui e boletos do BB: nada a informar');
  assert.strictEqual(precisa({ pedido: enviado, notas: [{ status_fiscal: 'autorizada' }], boletos: livre }), true, 'falta boleto numa parcela');
  assert.strictEqual(precisa({ pedido: { situacao: 'Entregue', forma_pagamento: 'pix' }, notas: [{ status_fiscal: 'autorizada' }], boletos: livre }), false, 'em Pix, parcela sem boleto não é falta');
  assert.strictEqual(precisa({ pedido: enviado, notas: [{ status_fiscal: 'autorizada' }], boletos: { parcelas: [{ tem_boleto_vivo: false, boleto_externo: { id: 1 } }] } }), true, 'tem dado de fora para ver ou tirar');
  assert.strictEqual(precisa({ pedido: { ...enviado, devolucao: 'total' }, notas: [], boletos: livre }), false, 'devolvido por inteiro: não saiu mais');

  assert.match(VIS_HTML, /id="visualizarPedidoDadosExternos" type="button" class="hidden btn-neutral ctl-botao ctl-botao--pequeno/);
  assert.ok(VISUALIZAR.includes("abrirPorCima('modals/pedidos/dados-externos.html', '../js/modals/pedido-dados-externos.js', 'dadosExternos');"));
  assert.ok(VISUALIZAR.includes("'dadosExternos'") && VISUALIZAR.includes("'nfe:externa'"), 'ao informar, o Visualizar volta atualizado');
  assert.ok(VISUALIZAR.includes('const falta = estado.parcelas.some(l => !l?.tem_boleto_vivo && !l?.boleto_externo);'), 'parcela cobrada por fora não conta como faltando');

  const tags = recortar(VISUALIZAR, 'tagsDoEmbarque');
  const comFora = plano(tags({ nfe_dispensada: true }, [], 0, { parcelas: 2, registrados: 0, externos: 2 }, [], { serie: 2, numero: 700, valor_total: 1500 }));
  assert.deepStrictEqual(comFora.map(t => [t.classe, semEspacoFixo(t.texto)]), [['badge-info', 'NF-e 2/700 · de fora · R$ 1.500,00'], ['badge-info', 'Boletos de fora 2/2']], 'a de fora vence o "Sem nota fiscal"');
  const rotulo = recortar(VISUALIZAR, 'rotuloDoBoletoExterno');
  assert.deepStrictEqual(plano(rotulo({ banco_nome: 'Itaú', vencimento: '2026-10-15', linha_digitavel: '341' })), { classe: 'badge-info', texto: 'de fora · Itaú · vence 15/10/2026', linha: '341' });
});

test('Financeiro e "Gerar boletos": a linha do Aguardando NF-e abre o modal; parcela cobrada por fora não se marca', () => {
  assert.ok(FINANCEIRO.includes("criar('button', 'btn-neutral px-3 py-1 rounded-md text-xs font-medium text-white', 'NF-e de fora')"));
  assert.ok(FINANCEIRO.includes("abrirModalDePedido('modals/pedidos/dados-externos.html', '../js/modals/pedido-dados-externos.js', 'dadosExternos', { esperar: true, aoFechar: carregarLista });"), 'ao fechar, a lista relê (o pedido sai dela)');
  const linha = recortar(GERAR, 'linhaDaParcela', "const ROTULO_STATUS = {}; const MOTIVOS_BAIXA = {}; const diaCurto = iso => { const m = /^(\\d{4})-(\\d{2})-(\\d{2})/.exec(String(iso || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };");
  const l = plano(linha({ parcela: { id: 2, numero_parcela: 2, valor: 1000, data_vencimento: '2027-02-17' }, tem_boleto_vivo: false, boleto_externo: { banco_nome: 'Itaú', vencimento: '2027-02-17', linha_impressa: '34191...' } }));
  assert.deepStrictEqual([l.podeGerar, l.classe, l.rotulo], [false, 'badge-info', 'Boleto de fora · Itaú']);
  assert.match(l.detalhe, /vence 17\/02\/2027/);
});
