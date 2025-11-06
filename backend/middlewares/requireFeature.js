const db = require('../db');
const {
  getRoleByCode,
  getFeaturesByRoleAndModule
} = require('../rbac/permissionsRepository');

function normalizeCode(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value).trim().toLowerCase();
}

function parsePositiveInteger(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric > 0) {
    return numeric;
  }
  return null;
}

function parseEmail(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== 'string') {
    return null;
  }
  const trimmed = candidate.trim().toLowerCase();
  if (!trimmed || !trimmed.includes('@') || /\s/.test(trimmed)) {
    return null;
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function extractUserId(req) {
  if (req && req.usuarioAutenticadoId) {
    const parsed = parsePositiveInteger(req.usuarioAutenticadoId);
    if (parsed) {
      return parsed;
    }
  }

  const headerCandidates = [
    req?.headers?.['x-usuario-id'],
    req?.headers?.['x-user-id'],
    req?.headers?.['x-usuario'],
    req?.headers?.['x-user']
  ];

  for (const candidate of headerCandidates) {
    const value = Array.isArray(candidate) ? candidate[0] : candidate;
    const parsed = parsePositiveInteger(value);
    if (parsed) {
      return parsed;
    }
  }

  const authorization = typeof req?.headers?.authorization === 'string'
    ? req.headers.authorization.trim()
    : '';
  if (authorization.toLowerCase().startsWith('bearer ')) {
    const token = authorization.slice(7).trim();
    const match = token.match(/(\d+)/);
    if (match) {
      const parsed = parsePositiveInteger(match[1]);
      if (parsed) {
        return parsed;
      }
    }
  }

  if (req?.body && typeof req.body === 'object') {
    const candidate = parsePositiveInteger(req.body.usuarioId ?? req.body.userId);
    if (candidate) {
      return candidate;
    }
  }

  if (req?.query && typeof req.query === 'object') {
    const candidate = parsePositiveInteger(req.query.usuarioId ?? req.query.userId);
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function extractUserEmail(req) {
  if (req?.usuarioAutenticadoEmail) {
    const parsed = parseEmail(req.usuarioAutenticadoEmail);
    if (parsed) {
      return parsed;
    }
  }

  const headerCandidates = [
    req?.headers?.['x-usuario-email'],
    req?.headers?.['x-user-email'],
    req?.headers?.['x-email'],
    req?.headers?.email
  ];

  for (const candidate of headerCandidates) {
    const parsed = parseEmail(candidate);
    if (parsed) {
      return parsed;
    }
  }

  if (req?.body && typeof req.body === 'object') {
    const parsed =
      parseEmail(req.body.usuarioEmail) ||
      parseEmail(req.body.userEmail) ||
      parseEmail(req.body.email);
    if (parsed) {
      return parsed;
    }
  }

  if (req?.query && typeof req.query === 'object') {
    const parsed =
      parseEmail(req.query.usuarioEmail) ||
      parseEmail(req.query.userEmail) ||
      parseEmail(req.query.email);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

async function loadUserById(id) {
  const { rows } = await db.query(
    'SELECT id, email, classificacao, perfil FROM usuarios WHERE id = $1 LIMIT 1',
    [id]
  );
  return rows[0] || null;
}

async function loadUserByEmail(email) {
  if (!email) {
    return null;
  }
  const { rows } = await db.query(
    'SELECT id, email, classificacao, perfil FROM usuarios WHERE lower(email) = $1 LIMIT 1',
    [email.trim().toLowerCase()]
  );
  return rows[0] || null;
}

async function resolveAuthenticatedUser(req) {
  if (!req) {
    return null;
  }

  if (req.usuarioAutenticadoCache) {
    return req.usuarioAutenticadoCache;
  }

  let userId = extractUserId(req);
  let user = null;

  if (userId) {
    user = await loadUserById(userId);
  }

  if (!user) {
    const email = extractUserEmail(req);
    if (!email) {
      return null;
    }
    user = await loadUserByEmail(email);
    if (user) {
      userId = parsePositiveInteger(user.id) || userId;
    }
  }

  if (user) {
    req.usuarioAutenticadoCache = user;
    if (userId) {
      req.usuarioAutenticadoId = userId;
    }
    if (user.email) {
      req.usuarioAutenticadoEmail = user.email;
    }
  }

  return user;
}

function buildFeatureKey(moduleCode, featureCode) {
  const modulePart = normalizeCode(moduleCode);
  const featurePart = normalizeCode(featureCode);
  if (!modulePart || !featurePart) {
    return null;
  }
  return `${modulePart}.${featurePart}`;
}

function requireFeature(moduleCode, featureCode) {
  const moduleKey = normalizeCode(moduleCode);
  const featureKey = normalizeCode(featureCode);

  if (!moduleKey) {
    throw new Error('moduleCode é obrigatório para requireFeature');
  }
  if (!featureKey) {
    throw new Error('featureCode é obrigatório para requireFeature');
  }

  const featureIdentifier = buildFeatureKey(moduleKey, featureKey);

  return async function requireFeatureMiddleware(req, res, next) {
    try {
      const user = await resolveAuthenticatedUser(req);
      if (!user) {
        return res.status(401).json({ error: 'unauthenticated' });
      }

      const roleCode = normalizeCode(user.classificacao || user.role || user.role_code || user.perfil);
      if (!roleCode) {
        return res.status(403).json({ error: 'forbidden', feature: featureIdentifier });
      }

      const role = await getRoleByCode(roleCode);
      if (!role) {
        return res.status(403).json({ error: 'forbidden', feature: featureIdentifier });
      }

      const features = await getFeaturesByRoleAndModule(role.id, moduleKey);
      const permitted = Array.isArray(features)
        ? features.some(feature => feature && normalizeCode(feature.code) === featureKey && feature.permitted)
        : false;

      if (!permitted) {
        return res.status(403).json({ error: 'forbidden', feature: featureIdentifier });
      }

      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = requireFeature;
