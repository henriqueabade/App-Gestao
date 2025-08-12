const db = require('../db');

async function run() {
  try {
    const result = await db.query(
      `UPDATE produtos_insumos pi
          SET produto_codigo = p.codigo
         FROM produtos p
        WHERE pi.produto_codigo IS NULL
          AND pi.produto_id = p.id`
    );
    console.log(`Atualizados ${result.rowCount} registros de produtos_insumos.`);
  } catch (err) {
    console.error('Erro ao atualizar produtos_insumos:', err);
  } finally {
    process.exit();
  }
}

run();
