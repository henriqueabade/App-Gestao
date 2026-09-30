/**
 * ZIP sem biblioteca de fora (etapa 9): o pacote da contabilidade é pequeno
 * (XMLs, OFX, PDFs de até 20 MB cada), e o formato é simples — cabeçalho
 * local + dados de cada arquivo, o diretório central e o registro de fim.
 * A compressão é o `deflateRawSync` do próprio Node (quando ele ganha do
 * arquivo cru; PDF e imagem costumam já vir comprimidos e vão sem mexer).
 *
 * - Nomes em UTF-8 (bit 11 ligado): acento e cedilha abrem certos no Windows,
 *   no macOS e nos programas de ZIP.
 * - Sem ZIP64: até 65.535 arquivos e 4 GB (o pacote fica muito longe disso).
 * - `ler` abre um ZIP destes (os testes e a conferência usam) e confere o CRC.
 *
 * Puro (só Buffer e zlib).
 */
const zlib = require('zlib');

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let x = n;
    for (let k = 0; k < 8; k++) x = x & 1 ? 0xEDB88320 ^ (x >>> 1) : x >>> 1;
    t[n] = x >>> 0;
  }
  return t;
})();

/** CRC-32 do ZIP (o mesmo do gzip). */
function crc32(buffer) {
  let x = 0xFFFFFFFF;
  for (let i = 0; i < buffer.length; i++) x = TABELA_CRC[(x ^ buffer[i]) & 0xFF] ^ (x >>> 8);
  return (x ^ 0xFFFFFFFF) >>> 0;
}

/** 'AAAA-MM-DDTHH:MM:SS' (hora de Brasília, como o app grava) -> data e hora do MS-DOS. */
function dataDos(instante) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(instante || ''));
  const [ano, mes, dia, hora, minuto, segundo] = m ? m.slice(1).map(v => Number(v) || 0) : [1980, 1, 1, 0, 0, 0];
  return {
    data: ((Math.max(ano, 1980) - 1980) << 9) | (mes << 5) | dia,
    hora: (hora << 11) | (minuto << 5) | Math.floor(segundo / 2)
  };
}

const BIT_UTF8 = 0x0800;

/**
 * O ZIP de uma lista `[{ nome: 'pasta/arquivo.xml', dados: Buffer | texto }]`,
 * todos com a data `quando`. Nome repetido é erro (quem monta já desempata).
 */
function zipar(entradas, { quando = null } = {}) {
  const { data, hora } = dataDos(quando);
  const vistos = new Set();
  const locais = [];
  const centrais = [];
  let deslocamento = 0;
  for (const e of entradas) {
    const nome = Buffer.from(String(e.nome), 'utf8');
    if (!nome.length || nome.length > 0xFFFF) throw new Error(`Nome de arquivo inválido no pacote: ${e.nome}`);
    if (vistos.has(String(e.nome))) throw new Error(`Arquivo repetido no pacote: ${e.nome}`);
    vistos.add(String(e.nome));
    const dados = Buffer.isBuffer(e.dados) ? e.dados : Buffer.from(String(e.dados ?? ''), 'utf8');
    const crc = crc32(dados);
    let metodo = 0;
    let gravado = dados;
    if (dados.length > 64) {
      const comprimido = zlib.deflateRawSync(dados, { level: 9 });
      if (comprimido.length < dados.length) { metodo = 8; gravado = comprimido; }
    }
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(BIT_UTF8, 6);
    local.writeUInt16LE(metodo, 8);
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(data, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(gravado.length, 18);
    local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(BIT_UTF8, 8);
    central.writeUInt16LE(metodo, 10);
    central.writeUInt16LE(hora, 12);
    central.writeUInt16LE(data, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(gravado.length, 20);
    central.writeUInt32LE(dados.length, 24);
    central.writeUInt16LE(nome.length, 28);
    central.writeUInt32LE(deslocamento, 42);
    locais.push(local, nome, gravado);
    centrais.push(central, nome);
    deslocamento += local.length + nome.length + gravado.length;
    if (deslocamento > 0xFFFFFFFF) throw new Error('O pacote passou de 4 GB.');
  }
  if (vistos.size > 0xFFFF) throw new Error('Arquivos demais no pacote.');
  const diretorio = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(vistos.size, 8);
  fim.writeUInt16LE(vistos.size, 10);
  fim.writeUInt32LE(diretorio.length, 12);
  fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...locais, diretorio, fim]);
}

/** Abre um ZIP (sem comentário no fim): `[{ nome, dados, metodo, crc }]`; CRC errado é erro. */
function ler(zip) {
  const fim = zip.length - 22;
  if (fim < 0 || zip.readUInt32LE(fim) !== 0x06054b50) throw new Error('Não é um ZIP (sem o registro de fim).');
  const total = zip.readUInt16LE(fim + 10);
  let p = zip.readUInt32LE(fim + 16);
  const saida = [];
  for (let i = 0; i < total; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('Diretório central estragado.');
    const metodo = zip.readUInt16LE(p + 10);
    const crc = zip.readUInt32LE(p + 16);
    const tamanhoGravado = zip.readUInt32LE(p + 20);
    const tamanhoNome = zip.readUInt16LE(p + 28);
    const extra = zip.readUInt16LE(p + 30);
    const comentario = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const nome = zip.slice(p + 46, p + 46 + tamanhoNome).toString('utf8');
    const inicio = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const gravado = zip.slice(inicio, inicio + tamanhoGravado);
    const dados = metodo === 8 ? zlib.inflateRawSync(gravado) : Buffer.from(gravado);
    if (crc32(dados) !== crc) throw new Error(`CRC não confere: ${nome}`);
    saida.push({ nome, dados, metodo, crc });
    p += 46 + tamanhoNome + extra + comentario;
  }
  return saida;
}

module.exports = { crc32, dataDos, zipar, ler };
