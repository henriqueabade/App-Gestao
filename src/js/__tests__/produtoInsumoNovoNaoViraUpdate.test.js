/**
 * Linha de insumo ACRESCENTADA não pode virar "atualizada" (produto-editar.js).
 *
 * ---------------------------------------------------------------------------
 * O DEFEITO
 *
 * O salvamento manda três listas: `inseridos`, `atualizados` e `deletados`. A
 * separação é feita pelo campo `status` de cada linha da tabela.
 *
 * Numa linha ACRESCENTADA, `id` é o id do INSUMO — é assim que ela chega do
 * seletor de matéria-prima, e é por isso que o payload monta
 * `insumo_id: i.insumo_id ?? i.id`. Numa linha que já existe, `id` é o id da
 * linha de `produtos_insumos`. Dois números de tabelas diferentes no mesmo
 * campo.
 *
 * Ajustar a quantidade fazia `if(item.id) item.status = 'updated'`. Como a
 * linha nova TEM id (o do insumo), ela era promovida a "atualizada" e ia para
 * `atualizados` com aquele número. O backend então tentava
 * `PUT /produtos_insumos/<id do insumo>` e levava 404 — o insumo acrescentado
 * não entrava, e as exclusões do mesmo salvamento já tinham sido aplicadas
 * antes do erro (elas rodam primeiro em `salvarProdutoDetalhado`). O usuário
 * perdia a inclusão e ficava com a exclusão.
 *
 * Nove dos doze pontos que promovem para "updated" já tinham a guarda
 * `status !== 'new'`. Três não tinham — e é justamente por serem doze que o
 * teste abaixo confere a REGRA sobre o arquivo, e não cada caminho: um décimo
 * terceiro ponto sem guarda traz o mesmo 404 de volta.
 * ---------------------------------------------------------------------------
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ARQUIVO = path.join(__dirname, '..', 'modals', 'produto-editar.js');
const fonte = () => fs.readFileSync(ARQUIVO, 'utf8');

/** Cada promoção a "updated", com a condição que a protege. */
function promocoes(texto) {
  // `if(<condição>) <alvo>.status = 'updated';` — a forma usada no arquivo
  // inteiro. Pega também as variantes com espaço depois do `if`.
  const achados = [];
  const re = /if\s*\(([^)]*)\)\s*([A-Za-z_$][\w$]*)\.status\s*=\s*'updated'/g;
  let m;
  while ((m = re.exec(texto)) !== null) {
    achados.push({ condicao: m[1], alvo: m[2], indice: m.index });
  }
  return achados;
}

test('toda promoção a "updated" protege a linha recém-acrescentada', () => {
  const texto = fonte();
  const lista = promocoes(texto);

  assert.ok(lista.length >= 9, `esperava várias promoções, achei ${lista.length}`);

  const desprotegidas = lista.filter(p => !/status\s*!==\s*'new'/.test(p.condicao));

  // A mensagem precisa dizer QUAL linha, senão quem quebrar isto daqui a um
  // ano vai ter de caçar entre doze pontos iguais.
  const onde = desprotegidas.map(p => {
    const linha = texto.slice(0, p.indice).split('\n').length;
    return `linha ${linha}: if(${p.condicao.trim()})`;
  });

  assert.deepEqual(desprotegidas, [],
    'promoção a "updated" sem a guarda `status !== \'new\'`. Numa linha nova, `id` é o '
    + 'id do INSUMO, e ela iria para `atualizados` — o salvamento tenta '
    + `PUT /produtos_insumos/<id do insumo> e leva 404.\n  ${onde.join('\n  ')}`);
});

test('o payload separa as listas pelo status, e é por isso que ele importa', () => {
  const texto = fonte();

  // Se a montagem do payload deixar de se guiar pelo `status`, a regra acima
  // passa a proteger algo que não existe mais — e o teste viraria enfeite.
  assert.match(texto, /inseridos:\s*itens[\s\S]{0,80}?filter\(i => i\.status === 'new'\)/);
  assert.match(texto, /atualizados:\s*itens[\s\S]{0,80}?filter\(i => i\.status === 'updated'\)/);
});

test('a linha nova viaja como insumo_id, não como id de produtos_insumos', () => {
  const texto = fonte();

  // É esta linha que prova a ambiguidade do campo `id` — e que explica por que
  // promover uma linha nova a "updated" manda um número da tabela errada.
  assert.match(texto, /insumo_id:\s*i\.insumo_id \?\? i\.id/);
});
