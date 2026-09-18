/**
 * As partes puras da tela do histórico social (src/js/utils/historico-social.js)
 * e do relatório da importação CSV (src/js/utils/acoes-csv.js).
 *
 * Os dois arquivos rodam como <script> no menu.html e publicam o que expõem
 * em `window`; aqui rodam num contexto com um `window` vazio.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

function carregar(relativo) {
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'utils', relativo), 'utf8');
  const contexto = { window: {}, TextDecoder, Date, Map, Set, console };
  vm.runInNewContext(codigo, contexto, { filename: relativo });
  return contexto.window;
}

const { HistoricoSocial: hs } = carregar('historico-social.js');
// O que volta do contexto isolado tem outro Array.prototype: o deepStrictEqual
// compara protótipos, então os resultados passam por aqui antes.
const daqui = valor => JSON.parse(JSON.stringify(valor));
const { AcoesCsv: acoes } = carregar('acoes-csv.js');

test('montarArvore: respostas dentro de respostas, sem limite de níveis', () => {
  const arvore = hs.montarArvore([
    { id: 1, texto: 'a' },
    { id: 2, resposta_de: 1, texto: 'b' },
    { id: 3, resposta_de: 2, texto: 'c' },
    { id: 4, resposta_de: 3, texto: 'd' },
    { id: 5, resposta_de: 4, texto: 'e' },
    { id: 6, texto: 'f' },
    { id: 7, resposta_de: 99, texto: 'pai sumiu' }
  ]);
  assert.deepStrictEqual(daqui(arvore.map(n => n.id)), [1, 6, 7], 'resposta órfã sobe para a raiz');
  assert.strictEqual(arvore[0].respostas[0].respostas[0].respostas[0].respostas[0].id, 5);
  assert.strictEqual(hs.contarNaArvore(arvore[0]), 5);
});

test('datas e horas no fuso de quem vê', () => {
  const hoje = '2026-09-18';
  assert.strictEqual(hs.rotuloDoDia(new Date(2026, 8, 18, 9, 0), hoje), 'Hoje · 18/09/2026');
  assert.strictEqual(hs.rotuloDoDia(new Date(2026, 8, 17, 23, 59), hoje), 'Ontem · 17/09/2026');
  assert.strictEqual(hs.rotuloDoDia(new Date(2026, 8, 1, 10, 0), hoje), '01/09/2026');
  assert.strictEqual(hs.horaDe(new Date(2026, 8, 18, 7, 5)), '07:05');
  assert.strictEqual(hs.diaLocal(new Date(2026, 0, 2, 23, 30)), '2026-01-02');
});

test('quem curtiu, iniciais, tamanho e ícone do arquivo', () => {
  assert.strictEqual(hs.quemCurtiu([]), '');
  assert.strictEqual(hs.quemCurtiu(['Ana']), 'Curtido por Ana');
  assert.strictEqual(hs.quemCurtiu(['Ana', 'Bruno']), 'Curtido por Ana e Bruno');
  assert.strictEqual(hs.quemCurtiu(['Ana', 'Bruno', 'Caio', 'Dora']), 'Curtido por Ana, Bruno e mais 2');
  assert.strictEqual(hs.iniciais('Ana Maria Souza'), 'AS');
  assert.strictEqual(hs.iniciais(''), '?');
  assert.strictEqual(hs.tamanhoLegivel(512), '512 B');
  assert.strictEqual(hs.tamanhoLegivel(1536), '1,5 KB');
  assert.strictEqual(hs.tamanhoLegivel(20 * 1024 * 1024), '20,0 MB');
  assert.strictEqual(hs.iconeDoArquivo('foto.JPG'), 'fa-file-image');
  assert.strictEqual(hs.iconeDoArquivo('x', 'application/pdf'), 'fa-file-pdf');
  assert.strictEqual(hs.iconeDoArquivo('planilha.xlsx'), 'fa-file-excel');
  assert.strictEqual(hs.iconeDoArquivo('desenho.dwg'), 'fa-file');
});

test('conferirArquivos: até 5 por vez, nada vazio, nada acima do limite', () => {
  const MB = 1024 * 1024;
  const arquivos = [
    { name: 'a.pdf', size: MB }, { name: 'vazio.txt', size: 0 }, { name: 'enorme.mov', size: 25 * MB },
    { name: 'b.png', size: 10 }, { name: 'c.png', size: 10 }, { name: 'd.png', size: 10 }, { name: 'e.png', size: 10 },
    { name: 'f.png', size: 10 }
  ];
  const { aceitos, recusados } = hs.conferirArquivos(arquivos, 20 * MB);
  assert.deepStrictEqual(daqui(aceitos.map(a => a.name)), ['a.pdf', 'b.png', 'c.png', 'd.png', 'e.png']);
  assert.deepStrictEqual(daqui(recusados), ['vazio.txt: arquivo vazio', 'enorme.mov: passa de 20,0 MB', 'f.png: no máximo 5 arquivos por vez']);
});

test('importação: filtro das linhas e tom do relatório', () => {
  const linhas = [
    { linha: 2, situacao: 'registrado' },
    { linha: 3, situacao: 'registrado_com_pendencias' },
    { linha: 4, situacao: 'nao_registrado' },
    { linha: 5, situacao: 'ignorado' }
  ];
  assert.deepStrictEqual(acoes.filtrarLinhas(linhas, 'problemas').map(l => l.linha), [3, 4]);
  assert.deepStrictEqual(acoes.filtrarLinhas(linhas, 'todas').map(l => l.linha), [2, 3, 4, 5]);
  assert.deepStrictEqual(acoes.filtrarLinhas(linhas, 'ignorado').map(l => l.linha), [5]);

  assert.strictEqual(acoes.tomDoResultado({ registrados: 3 }), 'sucesso');
  assert.strictEqual(acoes.tomDoResultado({ registrados: 3, com_pendencias: 1 }), 'aviso');
  assert.strictEqual(acoes.tomDoResultado({ registrados: 1, nao_registrados: 1 }), 'aviso');
  assert.strictEqual(acoes.tomDoResultado({ nao_registrados: 2 }), 'erro');
  assert.strictEqual(acoes.tomDoResultado({ ignorados: 1 }), 'info');
  assert.strictEqual(acoes.SITUACAO.nao_registrado.rotulo, 'Pendente de registro');
  assert.strictEqual(acoes.SITUACAO.registrado_com_pendencias.rotulo, 'Registrado com dados faltantes');
});

test('relatório em CSV: BOM, ponto e vírgula, motivos juntos numa célula', () => {
  const texto = acoes.relatorioCsv({
    linhas: [
      { linha: 4, identificacao: 'Loja; Centro', situacao: 'nao_registrado', bloqueios: ['Razão social é obrigatória.', 'CNPJ inválido'], pendencias: [], avisos: [] },
      { linha: 5, identificacao: 'Casa "Azul"', situacao: 'registrado_com_pendencias', bloqueios: [], pendencias: ['Dono não informado.'], avisos: [] }
    ]
  });
  assert.ok(texto.startsWith('\uFEFFLinha;Identificação;Situação;'));
  const linhas = texto.split('\r\n');
  assert.strictEqual(linhas[1], '4;"Loja; Centro";Pendente de registro;Razão social é obrigatória. | CNPJ inválido;;');
  assert.strictEqual(linhas[2], '5;"Casa ""Azul""";Registrado com dados faltantes;;Dono não informado.;');
});

test('decodificar: UTF-8, e o CSV do Excel em Windows-1252', () => {
  const utf8 = new TextEncoder().encode('Razão;São João');
  assert.strictEqual(acoes.decodificar(utf8), 'Razão;São João');
  const ansi = Uint8Array.from([0x52, 0x61, 0x7a, 0xe3, 0x6f]); // "Razão" em Windows-1252
  assert.strictEqual(acoes.decodificar(ansi), 'Razão');
});
