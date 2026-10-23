/**
 * Autoridades do incidente eMudhra/emSign (outubro de 2026) em que o programa
 * deixa de confiar, em todos os clientes HTTPS do processo principal (Node) e
 * nas sessões do Chromium (janelas e atualização automática).
 *
 * Tudo por SHA-256 do SubjectPublicKeyInfo (DER), como no Node: assim cai
 * também uma cópia da mesma chave assinada por outra raiz (certificado
 * cruzado), e não só o certificado exato.
 *
 * - INTERMEDIARIAS: as 8 com chave privada comprometida. São os mesmos hashes
 *   compilados no Node 24.22.1 (nodejs/node 01acf0ee74, "tls: reject chains
 *   containing blocked public keys") e no Electron 43.8.3/44.9.3/45.0.0
 *   (electron/electron#55126).
 * - RAIZES: emSign ECC Root CA - G3 (removida pela Mozilla, pelo Ubuntu e pelo
 *   Node 24.22.1), emSign Root CA - C1 e emSign ECC Root CA - C3 (também fora
 *   da loja do Node 24.22.1). A emSign Root CA - G1 fica, como na Mozilla.
 *   Hashes calculados da loja embutida no Node 18.18.2 do Electron 28.
 */
const INTERMEDIARIAS = [
  { spki: '49dd353dc2b919a3770645117d0e60c16115e7d1bc259eefe734b00ea434fe5f', nome: 'EM DV TLS CA - G3C (eMudhra Inc)' },
  { spki: '5c0660a2b164910d8ff589c18e14552e9e0ec237dcefe2cb736d41a4811f81a0', nome: 'EM EV TLS CA - G3C (eMudhra Inc)' },
  { spki: '63ecefee431d49523bc1136c4e72d0206a477086caf606cd5cf025686c109cf8', nome: 'EM OV TLS CA - G3C (eMudhra Inc)' },
  { spki: '92c063d67e8f14db71d288e11266ffdaf69cbf115f7bab14f3bc2f68d25e0e30', nome: 'EM OV CS CA - G3C (eMudhra Inc)' },
  { spki: 'ebed6475c2c2d80fcb199f3fe8dd6e6b3ce60b77eb15d4e42c3dec0c6f5b5105', nome: 'EM DV TLS CA - G3B (eMudhra BV)' },
  { spki: 'ec4ffa1ad0ac88081314b7aaffef6a91f97cd57291bb5ba686c5415f5eb4f6b6', nome: 'EM OV CS CA - G3B (eMudhra BV)' },
  { spki: '43bffa19d6ef651451f6841e019931e96f6f2eaeff28ab4b6f1ce4576de2717b', nome: 'EM OV TLS CA - G3B (eMudhra BV)' },
  { spki: 'e0254c7fcdc265e2f0f8a428dabb75ab4ae039b4872d62f5ee57f0877d5a8a41', nome: 'EM EV TLS CA - G3B (eMudhra BV)' }
];

const RAIZES = [
  { spki: '8d417db2dd8bf5e3084d1e3f196d583849d81bdd4c00c70b9d39369e96b8c782', nome: 'emSign ECC Root CA - G3' },
  { spki: 'b7408b4d2be0238ba37004dd34e276c6019bd2f24c9db7d4980f5f6c359a4bcc', nome: 'emSign Root CA - C1' },
  { spki: 'eabc185c4e82d942b1a5978ba3c0181487d6b3b9974e5c49f72f6d0bd9637150', nome: 'emSign ECC Root CA - C3' }
];

module.exports = { INTERMEDIARIAS, RAIZES };
