// Remove campos sensiveis de qualquer payload que va para o renderer.
//
// Motivo: GET /api/usuarios devolvia os registros crus do upstream, incluindo o
// hash bcrypt da senha e os tokens de confirmacao/aprovacao. Nada disso e usado
// pela interface e nao deve sair do backend.
const CAMPOS_PROIBIDOS = [
  'senha', 'password', 'password_hash', 'senha_hash',
  'confirmacao_token', 'aprovacao_token', 'reset_token', 'token'
];

function limparRegistro(registro) {
  if (!registro || typeof registro !== 'object') return registro;
  const copia = Array.isArray(registro) ? [] : {};
  for (const [chave, valor] of Object.entries(registro)) {
    if (CAMPOS_PROIBIDOS.includes(chave)) continue;
    copia[chave] = valor && typeof valor === 'object' ? limparRegistro(valor) : valor;
  }
  return copia;
}

/** Aceita objeto, array ou {data:[...]} e devolve o mesmo formato sem os campos sensiveis. */
function sanitizarSaida(dados) {
  if (Array.isArray(dados)) return dados.map(limparRegistro);
  if (dados && typeof dados === 'object') return limparRegistro(dados);
  return dados;
}

module.exports = { sanitizarSaida, CAMPOS_PROIBIDOS };
