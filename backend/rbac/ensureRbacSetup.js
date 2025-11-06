const { seedRbacPermissions } = require('../scripts/seed_rbac_permissions');

function getDb() {
  return require('../db');
}

let ensurePromise = null;

async function checkTables(db = getDb()) {
  try {
    await db.query('SELECT 1 FROM rbac.module LIMIT 1');
    return true;
  } catch (err) {
    const code = err && err.code ? String(err.code) : '';
    const message = String(err && err.message ? err.message : '');
    const missingRelation = code === '42P01' || message.toLowerCase().includes('relation "rbac.module" does not exist');
    if (missingRelation) {
      return false;
    }
    throw err;
  }
}

async function ensureRbacSetup() {
  if (ensurePromise) {
    return ensurePromise;
  }

  ensurePromise = (async () => {
    const db = getDb();
    const exists = await checkTables(db);
    if (!exists) {
      await seedRbacPermissions({ query: (text, params) => db.query(text, params) });
    }
  })();

  try {
    await ensurePromise;
  } catch (err) {
    ensurePromise = null;
    throw err;
  }

  return ensurePromise;
}

module.exports = { ensureRbacSetup };
