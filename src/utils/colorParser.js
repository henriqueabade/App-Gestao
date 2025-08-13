/**
 * Utilitário para resolver cores a partir de texto livre.
 * Não possui dependências externas e opera via espaço de cor HSL.
 */

/**
 * Normaliza uma string removendo acentos, hifens e espaços extras.
 * @param {string} text
 * @returns {string}
 * @example
 * normalize('  Verde   Água '); // 'verde agua'
 */
function normalize(text = '') {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/-/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w))
    .join(' ');
}

// Dicionário de cores fornecido externamente.
const colorDictionary = [
  {"name":"branco","hex":"#FFFFFF","keywords":["branco","white","neve","snow"]},
  {"name":"preto","hex":"#000000","keywords":["preto","black","carvão","carvao","coal","jet"]},
  {"name":"cinza","hex":"#808080","keywords":["cinza","cinzento","gray","grey","acinzentado"]},
  {"name":"cinza claro","hex":"#D3D3D3","keywords":["cinza claro","lightgray","light grey","gelo","ice"]},
  {"name":"cinza escuro","hex":"#505050","keywords":["cinza escuro","darkgray","dark grey","grafite","graphite","chumbo","lead"]},
  {"name":"prata","hex":"#C0C0C0","keywords":["prata","silver","metalico prata","metalico prateado"]},
  {"name":"off-white","hex":"#F5F5F5","keywords":["off white","offwhite","marfim claro","marfim suave","ivory light"]},
  {"name":"marfim","hex":"#FFFFF0","keywords":["marfim","ivory","creme claro"]},
  {"name":"bege","hex":"#F5DEB3","keywords":["bege","beige","areia clara","sand","trigo","wheat"]},
  {"name":"areia","hex":"#C2B280","keywords":["areia","sandstone","khaki claro","khaki light"]},
  {"name":"caqui","hex":"#BDB76B","keywords":["caqui","khaki","oliva claro","army light"]},
  {"name":"taupe","hex":"#8B8589","keywords":["taupe","topo","toupe"]},
  {"name":"caramelo","hex":"#AF6F2F","keywords":["caramelo","caramel","toffee","butterscotch"]},
  {"name":"marrom","hex":"#8B4513","keywords":["marrom","brown","terra","soil","saddle brown"]},
  {"name":"chocolate","hex":"#5D3A1A","keywords":["chocolate","cocoa","cacau"]},
  {"name":"cobre","hex":"#B87333","keywords":["cobre","copper"]},
  {"name":"bronze","hex":"#CD7F32","keywords":["bronze"]},
  {"name":"dourado","hex":"#C9A227","keywords":["dourado","gold","ouro","golden","amarelo dourado"]},
  {"name":"ouro velho","hex":"#B8860B","keywords":["ouro velho","goldenrod","dourado escuro"]},

  {"name":"vermelho","hex":"#FF0000","keywords":["vermelho","red","vermelho vivo","puro"]},
  {"name":"escarlate","hex":"#FF2400","keywords":["escarlate","scarlet"]},
  {"name":"carmim","hex":"#960018","keywords":["carmim","crimson dark","carmin"]},
  {"name":"crimson","hex":"#DC143C","keywords":["crimson","vermelho carmim"]},
  {"name":"bordô","hex":"#800020","keywords":["bordô","bordo","burdeos","bordeaux","burgundy","vinho"]},
  {"name":"rubi","hex":"#E0115F","keywords":["rubi","ruby"]},
  {"name":"cereja","hex":"#DE3163","keywords":["cereja","cherry"]},
  {"name":"salmon","hex":"#FA8072","keywords":["salmão","salmao","salmon"]},
  {"name":"coral","hex":"#FF7F50","keywords":["coral"]},

  {"name":"laranja","hex":"#FFA500","keywords":["laranja","orange","tangerina","mandarina"]},
  {"name":"âmbar","hex":"#FFBF00","keywords":["ambar","âmbar","amber"]},
  {"name":"abóbora","hex":"#FF7518","keywords":["abobora","abóbora","pumpkin"]},
  {"name":"pêssego","hex":"#FFDAB9","keywords":["pessego","pêssego","peach","damasco claro"]},
  {"name":"damasco","hex":"#FBCEB1","keywords":["damasco","apricot"]},

  {"name":"amarelo","hex":"#FFFF00","keywords":["amarelo","yellow","canário","canario","lemon"]},
  {"name":"mostarda","hex":"#D4AF37","keywords":["mostarda","mustard","amarelo queimado"]},
  {"name":"creme","hex":"#FFFDD0","keywords":["creme","cream","baunilha","vanilla","champagne"]},

  {"name":"verde","hex":"#008000","keywords":["verde","green"]},
  {"name":"lima","hex":"#32CD32","keywords":["lima","limão","limao","lime","verde limão"]},
  {"name":"menta","hex":"#98FF98","keywords":["menta","mint"]},
  {"name":"esmeralda","hex":"#50C878","keywords":["esmeralda","emerald"]},
  {"name":"jade","hex":"#00A86B","keywords":["jade"]},
  {"name":"oliva","hex":"#808000","keywords":["oliva","olive","militar","army","verde oliva"]},
  {"name":"musgo","hex":"#556B2F","keywords":["musgo","moss","verde musgo","selva","jungle"]},
  {"name":"petróleo (teal)","hex":"#008080","keywords":["teal","verde-azulado","petroleo","petróleo"]},
  {"name":"água-marinha","hex":"#7FFFD4","keywords":["agua marinha","água-marinha","aquamarine"]},
  {"name":"turquesa","hex":"#40E0D0","keywords":["turquesa","turquoise"]},
  {"name":"ciano","hex":"#00FFFF","keywords":["ciano","cyan","aqua"]},

  {"name":"azul","hex":"#0000FF","keywords":["azul","blue"]},
  {"name":"azul celeste","hex":"#87CEEB","keywords":["azul celeste","sky blue","azul céu","azul bebe","azul bebê"]},
  {"name":"azul claro","hex":"#ADD8E6","keywords":["azul claro","light blue"]},
  {"name":"azul royal","hex":"#4169E1","keywords":["azul royal","royal blue"]},
  {"name":"azul cobalto","hex":"#0047AB","keywords":["azul cobalto","cobalt"]},
  {"name":"azul marinho","hex":"#000080","keywords":["azul marinho","navy","marinho"]},
  {"name":"anil","hex":"#3F00FF","keywords":["anil","indigo blue"]},
  {"name":"índigo","hex":"#4B0082","keywords":["indigo","índigo"]},

  {"name":"roxo","hex":"#800080","keywords":["roxo","purple"]},
  {"name":"púrpura","hex":"#6A0DAD","keywords":["púrpura","purpura","tyrian purple"]},
  {"name":"violeta","hex":"#8F00FF","keywords":["violeta","violet"]},
  {"name":"lilás","hex":"#C8A2C8","keywords":["lilas","lilás","lilac"]},
  {"name":"lavanda","hex":"#E6E6FA","keywords":["lavanda","lavender"]},
  {"name":"ameixa","hex":"#8E4585","keywords":["ameixa","plum","uva","eggplant","berinjela"]},
  {"name":"magenta","hex":"#FF00FF","keywords":["magenta","fúcsia","fucsia","fuchsia","pink roxo"]},

  {"name":"rosa","hex":"#FFC0CB","keywords":["rosa","pink","rosa claro","baby pink"]},
  {"name":"rosa choque","hex":"#FF1493","keywords":["rosa choque","pink choque","hot pink","deep pink"]},
  {"name":"sépia","hex":"#704214","keywords":["sepia","sépia"]},
  {"name":"terracota","hex":"#E2725B","keywords":["terracota","terracotta","tijolo","brick"]},

  {"name":"petróleo escuro","hex":"#084C61","keywords":["petróleo escuro","petroleo escuro","teal dark","verde petróleo"]},
  {"name":"grafite","hex":"#2F2F2F","keywords":["grafite","graphite","charcoal","carvao vegetal"]},
  {"name":"fumaça","hex":"#738276","keywords":["fumaça","fumaca","smoke","smoky","sage"]},
  {"name":"azul petróleo","hex":"#0E4D64","keywords":["azul petróleo","azul petroleo","deep teal"]},
  {"name":"cinza azulado","hex":"#6B7C93","keywords":["cinza azulado","blue gray","bluegrey"]},
  {"name":"nude","hex":"#E3C7A8","keywords":["nude","pele","skin","champagne rose"]},
  {"name":"pêssego rosado","hex":"#FFC4B2","keywords":["pessego rosado","pêssego rosado","peach pink"]},

  {"name":"prata escuro","hex":"#A9A9A9","keywords":["prata escuro","dark silver"]},
  {"name":"dourado claro","hex":"#E1C16E","keywords":["dourado claro","light gold"]},
  {"name":"ouro rosa","hex":"#B76E79","keywords":["ouro rosa","rose gold","rosé"]},

  {"name":"transparente","hex":"#00000000","keywords":["transparente","sem cor","none","clear"]},

  {"name":"alaranjado","hex":"#FF8C00","keywords":["alaranjado","dark orange"]},
  {"name":"amarelo canário","hex":"#FFEF00","keywords":["amarelo canario","canary yellow"]},
  {"name":"verde pistache","hex":"#93C572","keywords":["pistache","pistachio"]},
  {"name":"verde água","hex":"#00FA9A","keywords":["verde agua","verde água","medium spring green"]},
  {"name":"azul piscina","hex":"#00BFFF","keywords":["azul piscina","deep sky blue"]},
  {"name":"azul petróleo claro","hex":"#2E8B91","keywords":["petroleo claro","teal medium"]},
  {"name":"roxo uva","hex":"#6F2DA8","keywords":["roxo uva","grape","amethyst"]},
  {"name":"mostarda escura","hex":"#7F6A00","keywords":["mostarda escura","dark mustard"]},
  {"name":"terracota escura","hex":"#C65D4E","keywords":["terracota escura","burnt terracotta"]},
  {"name":"vermelho queimado","hex":"#B22222","keywords":["vermelho queimado","firebrick","telha"]},
  {"name":"verde floresta","hex":"#228B22","keywords":["verde floresta","forest green"]},
  {"name":"azul aço","hex":"#4682B4","keywords":["azul aço","steel blue"]},
  {"name":"azul ardósia","hex":"#6A5ACD","keywords":["azul ardósia","slate blue"]},
  {"name":"cinza ardósia","hex":"#708090","keywords":["cinza ardósia","slate gray"]},
  {"name":"petróleo azulado","hex":"#0B3C49","keywords":["petroleo azulado","deep teal blue"]},
  {"name":"magenta escuro","hex":"#8B008B","keywords":["magenta escuro","dark magenta"]},
  {"name":"rosa antigo","hex":"#C08081","keywords":["rosa antigo","old rose","dusty rose"]},
  {"name":"azul petróleo esverdeado","hex":"#1B6A6F","keywords":["petroleo esverdeado","teal greenish"]}
];

// Índice de busca: keywords normalizadas ordenadas por tamanho descrescente.
const keywordIndex = [];
for (const entry of colorDictionary) {
  for (const keyword of entry.keywords) {
    keywordIndex.push({ keyword: normalize(keyword), hex: entry.hex });
  }
}
keywordIndex.sort((a, b) => b.keyword.length - a.keyword.length);

/**
 * Extrai modificadores reconhecidos e retorna o texto base remanescente.
 * @param {string} text Texto já normalizado.
 * @returns {{base: string, mods: string[]}}
 * @example
 * extractModifiers('verde agua claro'); // { base: 'verde agua', mods: ['lighten'] }
 */
function extractModifiers(text) {
  const tokens = text.split(' ');
  const mods = [];
  const base = [];
  for (const word of tokens) {
    if (word.startsWith('clar')) {
      mods.push('lighten');
    } else if (word.startsWith('escur')) {
      mods.push('darken');
    } else if (word === 'pastel') {
      mods.push('pastel');
    } else if (word === 'neon' || word === 'fluorescente' || word === 'vivo') {
      mods.push('neon');
    } else if (word.startsWith('queimad') || word === 'burnt') {
      mods.push('burnt');
    } else {
      base.push(word);
    }
  }
  return { base: base.join(' ').trim(), mods };
}

/**
 * Encontra a cor base mais específica no dicionário.
 * @param {string} base Texto base para busca.
 * @returns {string|null}
 * @example
 * resolveBaseColor('azul petroleo'); // '#0E4D64'
 */
function resolveBaseColor(base) {
  const normalized = normalize(base);
  for (const entry of keywordIndex) {
    if (normalized === entry.keyword) return entry.hex;
  }
  return null;
}

/**
 * Converte um valor hexadecimal para HSL.
 * @param {string} hex
 * @returns {{h:number,s:number,l:number}}
 */
function hexToHsl(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 8) hex = hex.slice(0, 6);
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h;
  let s;
  const l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

/**
 * Converte valores HSL para hexadecimal.
 * @param {number} h
 * @param {number} s
 * @param {number} l
 * @returns {string}
 */
function hslToHex(h, s, l) {
  h /= 360;
  s /= 100;
  l /= 100;
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r;
  let g;
  let b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Aplica modificadores HSL em sequência sobre uma cor hexadecimal.
 * @param {string} hex
 * @param {string[]} mods
 * @returns {string}
 * @example
 * applyModifiers('#00fa9a', ['lighten']);
 */
function applyModifiers(hex, mods) {
  let { h, s, l } = hexToHsl(hex);
  const clamp = (v) => Math.max(0, Math.min(100, v));
  for (const mod of mods) {
    if (mod === 'lighten') {
      l = clamp(l + 22);
    } else if (mod === 'darken') {
      l = clamp(l - 22);
    } else if (mod === 'pastel') {
      s = clamp(s - 40);
      l = clamp(l + 20);
    } else if (mod === 'neon') {
      s = clamp(s + 30);
      l = clamp(l + 12);
    } else if (mod === 'burnt') {
      s = clamp(s - 10);
      l = clamp(l - 15);
    }
  }
  return hslToHex(h, s, l);
}

const FALLBACK_HEX = resolveBaseColor('cinza') || '#808080';

/**
 * Obtém um valor hexadecimal representando a cor do texto fornecido.
 * @param {string} text
 * @returns {string}
 * @example
 * getColorFromText('rosa choque'); // '#FF1493'
 */
function getColorFromText(text = '') {
  const normalized = normalize(text);
  const direct = resolveBaseColor(normalized);
  if (direct) return direct;
  const { base, mods } = extractModifiers(normalized);
  let hex = resolveBaseColor(base) || FALLBACK_HEX;
  if (hex === '#00000000') return hex;
  if (mods.length) hex = applyModifiers(hex, mods);
  return hex;
}

module.exports = {
  normalize,
  extractModifiers,
  resolveBaseColor,
  applyModifiers,
  getColorFromText,
  colorDictionary,
};

