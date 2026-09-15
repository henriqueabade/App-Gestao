// Adaptador interno: mantém o contrato dos clients HTTP para os controllers.
// O renderer continua usando IPC/rotas locais, nunca SQL ou credenciais.
const database = require('./localDatabase');
const { AsyncLocalStorage } = require('async_hooks');
const context = new AsyncLocalStorage();
const controls = new Set(['select', 'order', 'limit', 'offset']);

function invalid(message = 'Consulta inválida para o banco local.') {
  const err = new Error(message);
  err.status = 400;
  return err;
}
function identifier(value) {
  if (typeof value !== 'string' || !/^[a-z_][a-z0-9_]*$/i.test(value) || /^pg_/i.test(value)) throw invalid();
  return `"${value}"`;
}
function normalizeRow(row) {
  if (!row) return row;
  const result = { ...row };
  if (Buffer.isBuffer(result.foto_usuario)) {
    const b = result.foto_usuario;
    const mime = b[0] === 0xff ? 'image/jpeg' : b.toString('ascii', 0, 4) === 'RIFF' ? 'image/webp' : 'image/png';
    result.foto_usuario = `data:${mime};base64,${b.toString('base64')}`;
  }
  return JSON.parse(JSON.stringify(result));
}

function createLocalDataClient(queryable = database, options = {}) {
  const columnTypes = new Map();
  async function getColumnTypes(table) {
    if (!columnTypes.has(table)) {
      const { rows } = await queryable.query(
        'SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
        ['public', table]
      );
      columnTypes.set(table, new Map(rows.map(row => [row.column_name, row.data_type])));
    }
    return columnTypes.get(table);
  }
  async function send(method, path, { query = {}, body } = {}) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('#')) throw invalid();
    const [pathname, search = ''] = path.split('?');
    const params = {};
    for (const [key, value] of new URLSearchParams(search)) {
      if (Object.hasOwn(params, key)) params[key] = [].concat(params[key], value);
      else params[key] = value;
    }
    Object.assign(params, query);
    let parts;
    try { parts = pathname.replace(/^\/api(?=\/)/, '').split('/').filter(Boolean).map(decodeURIComponent); }
    catch (_) { throw invalid(); }
    let [table, id, action] = parts;
    if (parts.length > 3) throw invalid();
    if (table === 'perfil') {
      table = 'usuarios';
      action = id === 'imagem' ? 'avatar' : undefined;
      id = 'me';
    }
    if (table === 'usuarios' && id === 'me') {
      id = require('./localAuth').verifyToken(options.token || context.getStore()?.token || require('./tokenStore').getToken()).id;
    }
    if (action) {
      if (table !== 'usuarios' || action !== 'avatar' || !id) throw invalid();
      if (method === 'DELETE') { method = 'PUT'; body = { foto_usuario: null }; }
      else if (method === 'PUT' || method === 'POST') {
        let avatar = body?.foto_usuario ?? body?.avatar;
        if (typeof body?.get === 'function') {
          const file = body.get('imagem');
          if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) throw invalid('Imagem inválida.');
          avatar = `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString('base64')}`;
        }
        body = { foto_usuario: avatar };
        method = 'PUT';
      } else throw invalid();
    }
    const qualified = `"public".${identifier(table)}`;
    const key = table.startsWith('perm_') ? 'modelo_id' : table === 'tabela_fixa' ? 'id_prod' : 'id';
    const values = [];
    const bind = value => { values.push(value); return `$${values.length}`; };
    const where = [];
    if (id !== undefined) where.push(`${identifier(key)} = ${bind(id)}`);
    for (const [column, input] of Object.entries(params)) {
      if (controls.has(column) || input === undefined || input === '') continue;
      if (['or', 'and', 'not', 'filter', 'filtro'].includes(column)) throw invalid();
      const name = identifier(column);
      let value = input;
      let operator = '=';
      if (typeof value === 'string') {
        const match = value.match(/^(eq|neq|gt|gte|lt|lte|like|ilike|is)\.(.*)$/s);
        const list = value.match(/^in\.\((.*)\)$/s);
        if (list) value = list[1] ? list[1].split(',') : [];
        else if (match) {
          value = match[2];
          operator = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'LIKE', ilike: 'ILIKE', is: 'IS' }[match[1]];
          if (operator === 'IS') {
            if (!['null', 'true', 'false'].includes(value)) throw invalid();
            where.push(`${name} IS ${value.toUpperCase()}`);
            continue;
          }
        }
      }
      if (value === null) where.push(`${name} IS NULL`);
      else if (Array.isArray(value)) where.push(value.length ? `${name} IN (${value.map(bind).join(', ')})` : 'FALSE');
      else where.push(`${name} ${operator} ${bind(value)}`);
    }
    const condition = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    if (method === 'GET') {
      const selection = !params.select || params.select === '*' ? '*' : String(params.select).split(',').map(s => identifier(s.trim())).join(', ');
      let sql = `SELECT ${selection} FROM ${qualified}${condition}`;
      if (params.order) {
        sql += ' ORDER BY ' + String(params.order).split(',').map(item => {
          const match = item.trim().match(/^([a-z_][a-z0-9_]*)(?:\.(asc|desc))?(?:\.nulls(first|last))?$/i);
          if (!match) throw invalid();
          return `${identifier(match[1])} ${(match[2] || 'asc').toUpperCase()}${match[3] ? ` NULLS ${match[3].toUpperCase()}` : ''}`;
        }).join(', ');
      }
      for (const option of ['limit', 'offset']) {
        if (params[option] === undefined) continue;
        const number = Number(params[option]);
        if (!Number.isSafeInteger(number) || number < 0) throw invalid();
        sql += ` ${option.toUpperCase()} ${bind(number)}`;
      }
      const { rows } = await queryable.query(sql, values);
      return id !== undefined ? normalizeRow(rows[0]) || null : rows.map(normalizeRow);
    }
    if (method === 'DELETE') {
      if (id === undefined) throw invalid('Informe o registro a excluir.');
      const { rows } = await queryable.query(`DELETE FROM ${qualified}${condition} RETURNING *`, values);
      return normalizeRow(rows[0]) || null;
    }
    if (!['POST', 'PUT', 'PATCH'].includes(method) || !body || typeof body !== 'object' || Array.isArray(body)) throw invalid();
    const entries = Object.entries(body).filter(([, value]) => value !== undefined);
    if (!entries.length) throw invalid('Nenhum campo informado.');
    const columns = entries.map(([column]) => identifier(column));
    for (const entry of entries) {
      if (table === 'usuarios' && entry[0] === 'foto_usuario' && typeof entry[1] === 'string') {
        const match = entry[1].match(/^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
        if (!match) throw invalid('Imagem inválida.');
        const bytes = Buffer.from(match[1], 'base64');
        if (bytes.length > 5 * 1024 * 1024) throw invalid('Imagem muito grande.');
        if ((await getColumnTypes(table)).get('foto_usuario') === 'bytea') entry[1] = bytes;
      }
      if (Array.isArray(entry[1]) && ['json', 'jsonb'].includes((await getColumnTypes(table)).get(entry[0]))) {
        entry[1] = JSON.stringify(entry[1]);
      }
    }
    let sql;
    if (method === 'POST') {
      if (id !== undefined || where.length) throw invalid();
      sql = `INSERT INTO ${qualified} (${columns.join(', ')}) VALUES (${entries.map(([, v]) => bind(v)).join(', ')}) RETURNING *`;
    } else {
      if (id === undefined) throw invalid('Informe o registro a atualizar.');
      sql = `UPDATE ${qualified} SET ${entries.map(([, v], i) => `${columns[i]} = ${bind(v)}`).join(', ')}${condition} RETURNING *`;
    }
    const { rows } = await queryable.query(sql, values);
    return normalizeRow(rows[0]) || null;
  }
  return {
    get: (path, opts) => send('GET', path, opts),
    post: (path, body, opts) => send('POST', path, { ...opts, body }),
    put: (path, body, opts) => send('PUT', path, { ...opts, body }),
    patch: (path, body, opts) => send('PATCH', path, { ...opts, body }),
    delete: (path, opts) => send('DELETE', path, opts),
    query: (path, opts) => typeof path === 'string' && path.startsWith('/')
      ? send(opts?.method || 'GET', path, { ...opts, body: opts?.body || opts?.data })
      : queryable.query(path, opts)
  };
}
module.exports = {
  ...database, ...createLocalDataClient(), createLocalDataClient,
  runWithToken: (token, fn) => context.run({ token }, fn)
};
