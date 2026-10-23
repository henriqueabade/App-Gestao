# Segurança: falhas divulgadas em 20-23/10/2026

Correção direcionada aos avisos desta semana (Node.js 21/10, eMudhra/emSign,
TLS, keep-alive). Feita e testada na VPS DEV em 23/10/2026, numa cópia isolada
(`/home/ubuntu/projetos/App-Gestao-seguranca`, branch
`seguranca/2026-10-correcoes`), fora do Syncthing. Nada foi publicado.

## 1. O runtime do programa

| | Hoje (instalador 3.0.21) | Migração preparada |
| --- | --- | --- |
| Electron | 28.3.3 (sem suporte desde 10/06/2024) | 45.0.0 (20/10/2026) |
| Node do processo principal | 18.18.2 | 24.22.0 |
| Chromium | 120.0.6099.291 | 156.0.8078.48 |
| Brotli (do Chromium, usada também pelo Node) | sem a correção | com a correção |
| Lista das 8 intermediárias eMudhra | não tem | tem (electron/electron#55126) |
| Raízes emSign G3, C1, C3 na loja do Node | presentes | **ainda presentes** |

Nenhum Electron publicado até 23/10 traz o Node 24.22.1 (43.8.3, 44.9.3 e 45.0.0
trazem o 24.22.0).

## 2. O que mudou no código

Tudo em `backend/seguranca/`, ligado no começo do `main.js`.

### redeSegura.js — processo principal (Node)

1. **Brotli (CVE-2026-111497).** O Node do Electron é compilado com a brotli
   do Chromium (`//third_party/brotli`), e a do Chromium 120 tem o código antigo
   (`DecodeLiteralBlockSwitch` sem retorno de erro), igual ao do Node 24.22.0.
   - `zlib.createBrotliDecompress`, `brotliDecompress`, `brotliDecompressSync`,
     `BrotliDecompress` e `DecompressionStream('brotli')` não descomprimem nada.
     No fetch, o descompressor é um fluxo que falha no primeiro dado: lançar
     erro ali derruba o processo no Node 18 (testado).
   - O `fetch` pede `Accept-Encoding: gzip, deflate` e, se o servidor mandar
     `br` assim mesmo (o fetch descomprimiria — testado nos dois runtimes),
     recusa antes de ler o corpo.
2. **eMudhra/emSign.** `listaEmudhra.js` tem as 8 intermediárias (hashes
   SPKI iguais aos do Node 24.22.1) e as raízes G3, C1 e C3.
   - Toda conexão TLS (`tls.connect`: fetch, https, nodemailer, pg) usa a loja
     embutida sem essas raízes; uma lista `ca` própria (SEFAZ) também é filtrada.
   - O `checkServerIdentity` roda a checagem original do Node e, depois, recusa
     a cadeia que tiver qualquer chave bloqueada (`CERT_REVOKED`).
   - Nada desliga a verificação: nenhum `rejectUnauthorized: false`, nenhum
     `NODE_TLS_REJECT_UNAUTHORIZED`.
3. **Nome do servidor (CVE-2026-106069, -106072, -105483).** Host que só vira
   IP depois de normalizado (`127.1`, `0x7f.0.0.1`, dígitos de largura total) é
   recusado (`ERR_TLS_CERT_ALTNAME_INVALID`), como no Node 24.22.1. Sem isso, o
   Node 18 aceitava o host `127.1` com um certificado emitido para o nome
   "127.1" (testado).
4. **Keep-alive (CVE-2026-105481).** A falha é no `Agent` do `http`/`https`. O
   `Agent` global passa a não reaproveitar conexão (já é assim no Node 18; no
   Node 24 do Electron 45, não). O fetch (undici), usado com a API, o BB e as
   IAs, não é o componente corrigido. O monitor de conexão usa keep-alive só
   com o próprio backend local.

Cada parte se desliga em `instalar({ brotli, emudhra, hostCanonico, keepAlive })`
quando o runtime trouxer a correção.

### sessoesElectron.js — sessões do Chromium

Em toda sessão (janelas, PDF e a da atualização automática):

- pedidos para fora só aceitam gzip/deflate, e resposta `br` é cancelada antes
  do corpo (o Chromium respeita o cabeçalho: o cdnjs passou a mandar gzip);
- `setCertificateVerifyProc`: cadeia com chave bloqueada é recusada; o resto
  fica com o resultado do próprio Chromium (`-3`);
- o segredo do backend local só vai nos pedidos das telas do programa.

Fica de fora: fonte WOFF2 (Brotli por dentro), decodificada pelo Chromium 120.
Só a troca do Electron resolve.

### acessoLocal.js — backend local (127.0.0.1)

Antes, fora do DEV, ele respondia a qualquer origem, não conferia Origin nem
Host e punha o token de quem estava logado em todo pedido sem token. Agora,
com o programa rodando:

- Host só `127.0.0.1`/`localhost` na porta do servidor (barra DNS rebinding);
- Origin só a das telas (`null`, de file://) ou a do próprio servidor;
- todo pedido leva o segredo desta execução (`x-app-gestao-local`), que as
  telas não conhecem: o `main.js` o põe nos pedidos delas e nos dele;
- corpo com `Content-Encoding` diferente de `identity` recebe 415 antes do
  body-parser (vale sempre);
- os links de e-mail `GET /api/usuarios/confirmar-email` e `/aprovar` seguem
  abertos (têm token próprio), como já era no DEV.

Nenhuma rota nova. Sem `ativar()` (testes, `node backend/server.js`) o
comportamento é o de antes.

### Dependências (mesma linha principal)

express 5.1.0 → 5.3.0; body-parser 2.2.0 → 2.3.0; cors 2.8.5 → 2.8.6;
node-forge 1.3.1 → 1.4.0; electron-updater 6.6.2 → 6.8.9. Transitivas:
path-to-regexp 8.4.2, qs 6.16.1, proxy-addr 2.0.8, js-yaml 4.3.2,
builder-util-runtime 9.7.0 (o do electron-updater). `npm audit signatures`:
655 pacotes com assinatura conferida.

Fica: node-forge GHSA-86w9 (sem versão corrigida; o programa não usa a
verificação de assinatura do forge, só lê o .pfx). electron-builder 26.0.12
(ferramenta de build, leva builder-util-runtime 9.3.1 na publicação): fica
para a migração, com o instalador testado no Windows.

## 3. Testes (VPS, 23/10/2026)

- `backend/seguranca/*.test.js`: 13/13 no Node 24.22.1, no Node 18.18.2
  (Electron 28) e no Node 24.22.0 (Electron 45).
- Baterias completas, sem rede: tela 1509/1509 antes e depois; backend 2175
  testes, 2107 ok, 65 falhas — as mesmas 65 de antes, nenhuma nova.
  `instanciaUnica.test.js` e `connectionMonitor.test.js` recortam o main.js e
  passaram a receber o `acessoLocal` (o monitor agora confere que toda
  checagem leva o segredo).
- PDF do orçamento e do pedido (janela oculta com a página /pdf do backend
  local) e PDF de HTML: gerados no Electron 28 e no 45.
- E-mail pelo nodemailer contra um SMTP local de teste: STARTTLS (587) e TLS
  direto (465) enviam; com a intermediária de teste bloqueada, recusa.
- Instalador: pacote Linux (`--linux dir`) do Electron 28 e do 45 com os
  módulos novos no app.asar e as versões novas das dependências; o programa
  empacotado passou no roteiro de ponta a ponta. O pacote do Windows precisa
  do Wine, que a VPS não tem: fica para o Windows.
- Programa real (Electron 28, DEV, sem rede), antes × depois: login, Dashboard,
  Produtos (284), Matéria-prima (234), Pedidos (13), Orçamentos (20), modais de
  produto (lotes), insumo, pedido e orçamento, salvar orçamento, sessão após
  40 s, monitor de conexão (21/21 checagens ok). Sem erro na tela.
- Tentativas de fora contra o backend local: antes 200 (dados com o token da
  pessoa), depois 401/403.
- Aperto de mão TLS (sem pedido, sem credencial) com BB, SEFAZ nacional, NFS-e,
  GitHub, CDNs, ViaCEP, IBGE, Gemini e Groq: igual com e sem a proteção. A
  SEFAZ-MG exige o certificado A1 (mTLS) e recusa nos dois casos. A API central
  não foi tocada (proibido); pelo registro público de certificados (crt.sh), o
  domínio só tem certificados da Google Trust Services e da Let's Encrypt.
- Atualização automática: o feed público (latest.yml) é lido pela sessão
  "electron-updater", já protegida, no Electron 28 e no 45. Nenhum instalador
  foi baixado: ele leva o `.env` de produção.

Comandos: seção 8 de `docs/ambientes-dev-e-migracoes.md` (bateria sem rede).
Os roteiros de ponta a ponta ficaram no scratchpad da sessão.

## 4. O que depende de outra máquina ou de uma decisão

- **Windows (dono):** gerar o instalador com estas mudanças e testar lá:
  emissão na SEFAZ-MG (homologação), boletos no BB (homologação), e-mail,
  atualização automática instalando de verdade.
- **Electron:** adotar o 45 (ou o que vier com o Node 24.22.1) numa versão
  própria, com o instalador testado no Windows. A branch
  `seguranca/electron-45` tem a troca preparada e testada na VPS.
- **Desligar as mitigações** só quando o runtime trouxer cada correção (ver
  seção 2). A filtragem das raízes emSign continua necessária no Electron 45.
