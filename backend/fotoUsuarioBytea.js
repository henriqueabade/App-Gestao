const SUPPORTED_TABLES = new Map([
  ['usuarios', '"public"."usuarios"'],
  ['usuarios_login_cache', '"public"."usuarios_login_cache"']
]);

function getQualifiedTable(table) {
  const qualified = SUPPORTED_TABLES.get(table);
  if (!qualified) {
    throw new Error(`Tabela não suportada para conversão de foto_usuario: ${table}`);
  }
  return qualified;
}

function buildFotoUsuarioConversionExpression(table) {
  const qualified = getQualifiedTable(table);
  return `ALTER TABLE ${qualified}
    ALTER COLUMN foto_usuario TYPE bytea USING (
      CASE
        WHEN foto_usuario IS NULL THEN NULL
        ELSE (
          CASE
            WHEN TRIM(COALESCE(foto_usuario::text, '')) = '' THEN NULL
            WHEN foto_usuario::text ~ '^[A-Za-z0-9+/=\\s]+$' THEN decode(regexp_replace(foto_usuario::text, '\\s', '', 'g'), 'base64')
            ELSE NULL
          END
        )
      END
    )`;
}

async function ensureFotoUsuarioColumn(queryable, table, options = {}) {
  if (!queryable || typeof queryable.query !== 'function') {
    throw new Error('Objeto com método query é obrigatório.');
  }

  const { createIfMissing = false } = options;

  const { rows } = await queryable.query(
    `SELECT column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = 'foto_usuario'`,
    [table]
  );

  if (!rows.length) {
    if (!createIfMissing) {
      return { exists: false, created: false, converted: false };
    }

    const qualified = getQualifiedTable(table);
    await queryable.query(`ALTER TABLE ${qualified} ADD COLUMN foto_usuario BYTEA`);
    return { exists: true, created: true, converted: false };
  }

  const dataType = typeof rows[0].data_type === 'string' ? rows[0].data_type.toLowerCase() : '';
  if (dataType === 'bytea') {
    return { exists: true, created: false, converted: false };
  }

  const alterSql = buildFotoUsuarioConversionExpression(table);
  await queryable.query(alterSql);
  return { exists: true, created: false, converted: true };
}

module.exports = {
  ensureFotoUsuarioColumn,
  buildFotoUsuarioConversionExpression
};
