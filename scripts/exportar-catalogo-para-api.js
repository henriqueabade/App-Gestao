#!/usr/bin/env node
/**
 * Exporta o catálogo de permissões (backend/permissionsCatalog.js) para a API
 * (Santissimo-db-API/acesso/catalogo-permissoes.json) — Segurança, 09/10/2026.
 *
 * A API confere permissão por tabela com as MESMAS chaves da tela; para isso
 * ela precisa saber, de cada chave, a tabela perm_<módulo> e a coluna. O
 * catálogo continua mantido à mão aqui; mudou uma ação, rode:
 *
 *   node scripts/exportar-catalogo-para-api.js            (grava na API ao lado)
 *   node scripts/exportar-catalogo-para-api.js --conferir (só diz se está igual)
 *
 * O teste backend/catalogoDaApi.test.js confere que a cópia da API bate com
 * este catálogo (quando o repositório da API está ao lado).
 */
const fs = require('fs');
const path = require('path');
const { PERMISSIONS_CATALOG, MODULE_CODES } = require('../backend/permissionsCatalog');

const DESTINO = path.join(__dirname, '..', '..', 'Santissimo-db-API', 'acesso', 'catalogo-permissoes.json');

function catalogoParaApi() {
  return {
    descricao: 'Gerado de App-Gestao/backend/permissionsCatalog.js por scripts/exportar-catalogo-para-api.js. Não edite à mão.',
    modulos: MODULE_CODES.map(code => {
      const m = PERMISSIONS_CATALOG[code];
      return {
        code: m.code,
        table: m.table,
        actions: m.actions.map(a => ({ key: a.key, column: a.column })),
        columns: m.columns.map(c => ({ key: c.key, column: c.column }))
      };
    })
  };
}

function texto() {
  return `${JSON.stringify(catalogoParaApi(), null, 2)}\n`;
}

if (require.main === module) {
  const conferir = process.argv.includes('--conferir');
  const atual = fs.existsSync(DESTINO) ? fs.readFileSync(DESTINO, 'utf8').replace(/\r\n/g, '\n') : null;
  if (conferir) {
    if (atual === texto()) { console.log('Catálogo da API em dia.'); process.exit(0); }
    console.error(atual === null ? `Sem o arquivo ${DESTINO}.` : 'O catálogo da API está DIFERENTE: rode sem --conferir.');
    process.exit(1);
  }
  if (!fs.existsSync(path.dirname(DESTINO))) {
    console.error(`Não achei a pasta da API em ${path.dirname(DESTINO)}.`);
    process.exit(1);
  }
  fs.writeFileSync(DESTINO, texto());
  console.log(`Gravado: ${DESTINO}`);
}

module.exports = { catalogoParaApi, texto, DESTINO };
