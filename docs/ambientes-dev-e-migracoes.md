# Ambientes DEV, isolamento da VPS e migrações SQL

Regras permanentes do projeto (21/10/2026, versão definitiva). Valem para o dono
e para toda sessão do Claude, no Windows e na VPS. O resumo está no `CLAUDE.md`.

## 1. Os três ambientes — quem faz o quê

| | DEV VPS | DEV Windows | Produção |
| --- | --- | --- | --- |
| Banco | `Santissimo_Decor_App_Gestao_Dev_VPS` (127.0.0.1:5432, marca `app-gestao:dev-vps`) | o PostgreSQL local do dono | a API (`api.santissimodecor.com.br`) |
| Quem executa SQL | **o Claude, sozinho**, sem esperar OK | **o dono** (sincroniza, executa, homologa) | **ninguém** sem autorização específica e expressa do dono |
| O que o Claude faz | desenvolve, executa, testa, corrige, valida, registra | entrega o SQL no Git e diz qual aplicar; **nunca acessa esse banco** | entrega o SQL no Git; aplica só com ordem expressa para aquele SQL |
| Credenciais | exclusivas (`app_gestao_dev`, senha só no `~/.pgpass` e no `.env` local) | as do dono | exclusivas de produção, nunca no DEV |
| Integrações (BB, SEFAZ, SMTP, IA) | desligadas e bloqueadas (trava + barreira de rede) | as que o dono configurar | reais |

Regra curta:

- **VPS DEV:** o Claude desenvolve, executa e testa sozinho. Antes, sempre confere a
  identidade do banco, tem backup e garante que nada atinge a produção ou o Windows.
  Se houver risco, bloqueia até eliminá-lo.
- **Windows DEV:** o Claude entrega o SQL pelo Git. O dono executa e homologa. A
  homologação do Windows não é condição para o Claude seguir trabalhando na VPS.
- **Produção:** o SQL é desenvolvido e testado na VPS, versionado e entregue ao
  Windows. Depois cabe a decisão do dono. A homologação aprovada **não** autoriza a
  produção; só uma ordem específica e expressa autoriza.

## 2. O que sincroniza

O projeto é sincronizado nos dois sentidos pelo **Syncthing**. O `.stignore`
deixa de fora `.git`, `node_modules`, `.env`/`.env.*`, `*.log`, `*.pem`, `*.key`
e `.claude/settings.local.json`.

- **Cada máquina tem o seu git.** O dono commita no Windows. A VPS não dá pull,
  push, checkout, reset ou restore sem o dono pedir. O Claude não commita: deixa
  na árvore e sugere a mensagem.
- **O `.env` de cada máquina é dela.** O da VPS é o DEV seguro, e o do Windows
  não muda.
- **`sql/` está fora do Git** (é a pasta antiga, que o dono limpa).
  **SQL do aplicativo vai para `migracoes/`.** SQL exclusivo da VPS vai para
  `scripts/dev-vps/`.
- `migracoes/.estado/` (impressões digitais) fica fora do Git, mas o Syncthing
  leva de uma máquina à outra.

## 3. A VPS DEV isolada

### 3.1 Marcador da máquina e trava do `.env`

`/etc/app-gestao/ambiente-isolado` (dono root, `0644`), fora do repositório e do
Syncthing: `ambiente=dev-vps`, `banco=Santissimo_Decor_App_Gestao_Dev_VPS`,
`usuario=app_gestao_dev`. A variável `APP_GESTAO_AMBIENTE_ISOLADO=1` liga o mesmo.

Com ele, `backend/ambienteIsolado.js` (chamado por `backend/dataConfig.js`)
**recusa iniciar o app** se o `.env` não estiver no modo DEV seguro. Os
problemas aparecem só pelo nome da chave, nunca pelo valor. O que a trava exige:

- `BANCO=DEV`;
- `DB_HOST` local e `DB_NAME`/`DB_USER` iguais aos do marcador (nunca `postgres`);
- `NFE_AMBIENTE=homologacao`, `BB_AMBIENTE=sandbox`,
  `CONTABILIDADE_INTEGRACOES_AMBIENTE=homologacao`;
- `EMAIL_SENDING_ENABLED` diferente de `true`, e `SMTP_HOST` vazio ou local;
- `API_BASE_URL`/`API_URL` vazias ou locais;
- **vazias:** `SEGREDOS_CHAVE_MESTRA`, `GH_TOKEN`, `SMTP_PASS`, `NFE_CERT_*`,
  `NFE_SMTP_SENHA`, `BB_CLIENT_SECRET_*`, `GEMINI_API_KEY`, `GROQ_API_KEY`,
  `API_BEARER_TOKEN`, `DEFAULT_API_TOKEN`.

No Windows não há marcador, e nada muda lá.

O `.env` da VPS é gerado por `scripts/dev-vps/gerar-env-dev-vps.js`, que
confere com a trava antes de gravar. A cópia do `.env` do Windows (com segredos
de produção), que ficou guardada durante a troca, foi apagada com `shred` em
22/10/2026, com autorização do dono, depois de conferido que o `.env` DEV não
tem nenhum valor dela. O original continua só no Windows.

### 3.2 Barreira de rede

- **Backend:** `backend/barreiraDeRede.js` intercepta `net.Socket#connect`, por onde
  passam http, https, fetch, pg e nodemailer. Só se conecta ao próprio computador.
- **Chromium:** `main.js` liga `host-resolver-rules`, que só resolve localhost.
- **Liberar um host** (por exemplo, a homologação do BB) só com autorização do dono:
  `DEV_REDE_PERMITIDA=host1,host2`. A trava recusa qualquer endereço de produção
  nessa lista.

### 3.3 Marca do banco

O banco tem `COMMENT ON DATABASE ... IS 'app-gestao:dev-vps'`.

- Na máquina isolada, `backend/localDatabase.js` confere a marca antes da primeira
  consulta. Sem ela, nada é lido nem gravado.
- A produção nunca tem marca (nem por túnel), e o executor de migrações exige a
  mesma marca.

### 3.4 PostgreSQL da VPS

- PostgreSQL 17 do PGDG. `conf.d/00-app-gestao-somente-local.conf` fixa
  `listen_addresses='localhost'` e scram. O firewall da Oracle só abre a 22.
- **`pg_hba`:** além do padrão, uma linha permite `app_gestao_dev` **só** no banco
  DEV, pelo socket local, com senha. Serve para rodar o app num namespace sem rede
  (seção 8). O backup do arquivo original está ao lado:
  `pg_hba.conf.antes-app-gestao-<carimbo>`.
- `app_gestao_dev`: sem superusuário, createdb, createrole, replication nem
  bypassrls; no máximo 20 conexões. É dono do banco DEV.

### 3.5 Contas DEV do aplicativo

A sanitização trocou todos os e-mails reais.

| Conta | E-mail DEV |
| --- | --- |
| A do dono | `dono@exemplo.invalid` |
| Outro Sup Admin | `sup-admin.<id>@exemplo.invalid` |
| As demais | `usuario.<id>@exemplo.invalid` |

- Todas usam a **senha DEV única**, que está em
  `~/app-gestao-dev-vps/senha-usuarios-dev.txt` (0600).
- Perfis e permissões não mudaram.
- Na máquina isolada, `backend/pedidoEdicao.js` aceita `dono@exemplo.invalid` como
  editor de pedidos. Fora dela, continuam só os dois e-mails reais do dono.

### 3.6 Arquivos fora do repositório (VPS)

| Caminho | O que é |
| --- | --- |
| `~/dumps-dev/backups/<carimbo>-banco-sanitizado-verificado/` | **o backup de referência do banco sanitizado**, com restauração testada (seção 3.7) |
| `~/dumps-dev/backups/<carimbo>-antes-de-*/` | backups `pg_dump -Fc` com `.sha256`, feitos pelo executor antes de cada operação nova |
| `~/app-gestao-dev-vps/registros/` | saída completa de cada operação exclusiva da VPS |
| `~/app-gestao-dev-vps/env.dev-vps.proposto` | o `.env` DEV seguro (o mesmo que está em uso) |
| `~/app-gestao-dev-vps/senha-usuarios-dev.{txt,bcrypt}` | senha DEV única dos usuários e o hash dela |

Tudo isso fica em pastas 0700, com arquivos 0600, fora do repositório e fora do
Syncthing.

### 3.7 Backups e cópias com dados reais

Desde 22/10/2026 **não há na VPS nenhuma cópia com dados reais.** Com autorização
do dono, foram apagados:

- os 5 backups com dados pessoais reais, credenciais do BB e segredos cifrados de
  produção: o dump original do Windows (`20261021-182039-4da02c79`) e os backups
  `20261021-221025`, `-232246`, `-232257` e `-232310`;
- os 3 backups sanitizados redundantes (`20261022-005103`, `-005150`, `-005217`);
- a proposta antiga `~/dumps-dev/sanitizacao-proposta-20261021.sql`.

O disco tem `discard`, e depois rodou `fstrim`: os blocos liberados foram
descartados. As linhas de `controle.operacoes_dev_vps` ainda citam o caminho e
o SHA-256 dos backups apagados, como histórico.

**Ficou um só:** `backups/20261022-005412-banco-sanitizado-verificado/`, o banco
sanitizado e compactado. Para recuperar o DEV, use esse backup. Para re-clonar do
zero, peça ao dono um dump novo do Windows.

**Fora da VM:** só o console da Oracle Cloud mostra backups do volume de boot e
imagens personalizadas. Um backup tirado entre 21/10 (18h20) e 22/10 (01h)
contém os dados reais. Dentro da máquina não há snapshot (LVM, btrfs, zfs,
timeshift) nem CLI da OCI.

**Backup de referência do banco sanitizado** (`…-banco-sanitizado-verificado/`):

- `pg_dump -Fc -Z 6 --no-owner --no-acl`, com `.sha256` e `contagens-por-tabela.txt`
  (só nomes de tabela e contagens);
- **restauração testada** num cluster descartável (`--single-transaction
  --exit-on-error`): 186 tabelas, 15 306 linhas, 154 sequências e a estrutura
  (`public`, `rbac`, `controle`) idênticas ao banco vivo; nenhum e-mail real, e
  `segredos_app` vazia;
- o dump **não leva a marca do banco**: restaurado, o app recusa usar até marcar.

**Restaurar o backup de referência** (banco novo, nunca por cima do atual):

1. Como `postgres`: `createdb -O app_gestao_dev -E UTF8 -l pt_BR.UTF-8 -T template0 <banco>`.
2. `pg_restore -h 127.0.0.1 -U app_gestao_dev -d <banco> --no-owner --no-acl --single-transaction --exit-on-error <dump>`.
3. `node scripts/migracoes/cli.js marcar-ambiente dev-vps ... --confirmar-banco <banco>`.
4. Conferir com `contagens-por-tabela.txt` e com `cli.js impressao-digital`.

**Limpeza feita em 22/10/2026:**

- A sanitização troca o valor com `UPDATE`, e a versão antiga da linha fica no
  arquivo da tabela até ele ser regravado. `compactar-banco-dev-vps.sql` (seção 4.2)
  regravou as tabelas (316 versões antigas → 0) e refez as estatísticas.
- O WAL foi girado: os segmentos atuais só têm cabeçalhos.
- O cluster descartável dos ensaios e as saídas temporárias tiradas do banco antes
  da sanitização foram apagados.

## 4. SQL exclusivo da VPS (sem passar pelo Windows)

Infraestrutura, sanitização, configuração e controle do DEV da VPS. Os arquivos
ficam em `scripts/dev-vps/*.sql`, são executados pelo Claude e **nunca** vão ao
Windows nem à produção. Cada execução passa por
`node scripts/dev-vps/operacao-vps.js <script.sql> [-v nome=valor]`, que:

1. confere que é a VPS marcada, o banco certo, o usuário DEV e a conexão local;
2. faz o backup verificado;
3. passa o SHA-256 do script, e o próprio SQL se registra em
   `controle.operacoes_dev_vps` (imutável);
4. guarda a saída em `~/app-gestao-dev-vps/registros/`.

### 4.1 Sanitização (`sanitizar-banco-dev-vps.sql`)

- **A.** Tira as credenciais do BB (produção e homologação) e apaga os segredos
  cifrados. Desliga a conciliação e o boleto automático. Prende NF-e e integrações
  em homologação, sem SMTP.
- **B. Dados pessoais**, com fictícios estáveis (o mesmo original vira o mesmo
  fictício em colunas, JSON, XML e textos):
  - e-mail `@exemplo.invalid` (RFC 2606); telefone com DDD `00`;
  - nomes de pessoa `Pessoa XXXXXX`, por um dicionário de nomes completos, que
    também pega os contatos apagados que só restam no histórico;
  - CPF fictício válido; redes sociais; fotos dos usuários.
- **CNPJ:**
  - Ficam reais **só** o da própria empresa e os dos **clientes de teste
    fiscal**, os que têm NF-e de homologação: os clientes 15 (BA) e 47 (SP).
  - Todos os outros CNPJs viram fictícios válidos, e a IE vira dígitos fictícios
    no mesmo formato. O app só confere o tamanho da IE; a SEFAZ confere o dígito,
    e por isso NF-e de teste vai para os clientes de teste fiscal.
  - Provável MEI ou pessoa (razão social sem palavra de empresa) ganha nome
    `Empresa XXXXXX` e rua fictícia.
- **XML fiscais:** as NF-e do app, a NF-e de fora e a CC-e viram **sintéticos de
  teste**. O destinatário e os contatos ficam fictícios (salvo cliente de teste
  fiscal), a assinatura é removida e entra a marca
  `<!-- DOCUMENTO SINTETICO DE TESTE (DEV VPS) ... SEM VALOR FISCAL -->`. A chave
  e o emitente (a própria empresa) ficam.
- **Gerador de simulados:** o que ele criou (marca "Simulado (banco DEV)":
  fornecedores, documentos, títulos, conta e extrato BB, OFX, PDF, XML) **fica
  como está**. Já é fictício e é o cenário da conciliação e da classificação.
  Só o e-mail e o telefone dos fornecedores simulados viram fictícios, porque o
  gerador usou `exemplo.com`, que é um domínio que existe.
- **Dados reais sem a marca de simulado:**
  - nos lançamentos e no OFX, a contraparte de PIX/TED/DOC vira
    `Contraparte XXXXXX`, e o prefixo, que é o que as regras de classificação
    olham, fica;
  - o PDF é trocado por um PDF sintético;
  - o XML vira sintético;
  - o SHA-256 e o tamanho são recalculados.
- **C.** Usuários (seção 3.5), tokens, os aparelhos de aviso do Windows
  cancelados e a marca do banco.
- **D.** Sequências atrasadas: `ALTER SEQUENCE ... RESTART`. O `setval` **não** é
  desfeito por ROLLBACK, por isso não é usado.
- **E.** Conferências: linhas, chaves estrangeiras, credenciais, e-mails,
  telefones, nomes, CNPJs e XML. Se falhar, aborta e desfaz tudo. No fim sai um
  relatório de resíduos em contagens.
- Muda **só dados** (e o comentário do banco). É **idempotente**: depois de
  registrada uma sanitização aplicada, CNPJ, CPF e IE não são trocados de novo.
- **Ficam de propósito:**
  - os e-mails da empresa nos Termos de Uso (`termos_versoes`, imutável e com hash
    próprio);
  - os nomes dos funcionários (login pelo nome; não são dados de terceiros);
  - o CNPJ e a IE da empresa e dos 2 clientes de teste fiscal;
  - a linha digitável e o Pix dos 5 boletos de produção (histórico; o código
    recusa operar boleto de produção fora da produção, e não há credencial).

### 4.2 Compactação (`compactar-banco-dev-vps.sql`)

Roda depois da sanitização. `VACUUM (FULL, ANALYZE)` regrava cada tabela só com
as linhas vivas, já sanitizadas, e refaz as estatísticas do planejador, que
guardam amostras dos valores. Não muda nenhum dado.

- Recusa rodar se a sanitização não estiver registrada ou se houver outra conexão.
  Feche o app e os testes antes.
- Os 11 catálogos compartilhados do servidor ficam de fora (aviso "permission
  denied"). Eles não têm dado do app.
- Depois, como `postgres`, gire o WAL:

  ```sh
  sudo -u postgres psql -c CHECKPOINT -c "SELECT pg_switch_wal()" -c CHECKPOINT
  ```

  Repita até os segmentos de `pg_wal` serem só os novos.

**Re-clonar o banco do Windows:**

1. Banco novo, nunca sobrescrever: `createdb -O app_gestao_dev -E UTF8 -l pt_BR.UTF-8 -T template0`.
2. `pg_restore --no-owner --no-acl --single-transaction --exit-on-error`.
3. `cli.js marcar-ambiente dev-vps`.
4. `cli.js aplicar 20261021_2230`.
5. `operacao-vps.js registro-de-operacoes-dev-vps.sql`.
6. `operacao-vps.js sanitizar-banco-dev-vps.sql -v modo=aplicar -v confirmar_banco=… -v senha_dev_hash="$(cat ~/app-gestao-dev-vps/senha-usuarios-dev.bcrypt)"`.
7. `operacao-vps.js compactar-banco-dev-vps.sql` e girar o WAL (seção 4.2).
8. Fazer um backup de referência novo, com teste de restauração (seção 3.7), e
   apagar o dump com dados reais assim que o novo banco estiver conferido.
9. Reaplicar as migrações de `migracoes/` que o dump ainda não tiver.

Para conferir sem gravar nada, rode `sanitizar-banco-dev-vps.sql` sem
`-v modo=aplicar`: é uma simulação, que termina em ROLLBACK. Passe também
`-v senha_dev_hash=…`; sem ele, a simulação conta como "a trocar" a senha de
todos os usuários.

## 5. Fluxo das migrações do aplicativo

1. **O Claude cria** o SQL em `migracoes/AAAAMMDD_HHMM_descricao.sql`:
   - com cabeçalho e pré-condições, `-- escopo: app`;
   - registra o arquivo em `migracoes/manifesto.json`, o que congela o SHA-256;
   - confere com `node scripts/migracoes/cli.js verificar`.
2. **O Claude aplica na VPS** quando precisar, sem esperar ninguém:

   ```sh
   node scripts/migracoes/cli.js aplicar <id> --ambiente dev-vps --host 127.0.0.1 \
        --usuario app_gestao_dev --banco Santissimo_Decor_App_Gestao_Dev_VPS \
        --confirmar-banco Santissimo_Decor_App_Gestao_Dev_VPS \
        [--backup-dir ~/dumps-dev/backups/<carimbo>]   # obrigatório se destrutiva
   ```

   Testa no app, valida e corrige. Correção é **migração nova**: o arquivo
   aplicado ou registrado não muda mais.
3. **Entrega ao Windows:** avisa o dono qual id aplicar.
   - O dono sincroniza e roda no banco DEV dele, com o executor
     (`--ambiente dev-windows --do-env`) ou com psql + `registrar <id>`.
   - Depois homologa. Isso é responsabilidade dele e não trava o trabalho na VPS.
4. **Produção:** só migração `escopo: app` homologada, e só com ordem específica e
   expressa do dono para aquele SQL. Nada vai à produção automaticamente.
5. **Comparar:**
   - `impressao-digital` em cada banco (estrutura do aplicativo: `public` e
     `rbac`), e `comparar a.json b.json`.
   - Não se assume que os bancos são iguais só porque os scripts rodaram.
   - As divergências são informadas ao dono.
   - Um banco restaurado de dump (a VPS) escreve o CHECK `varchar IN (...)` de
     outro jeito que um criado à mão (o Windows). A impressão digital normaliza
     isso (`canonico` em `nucleo.js`), e só uma diferença de regra de verdade
     aparece.

## 6. Controle de migrações

**Arquivo:** `AAAAMMDD_HHMM_descricao.sql` (UTC), com cabeçalho:

```sql
-- migracao: 20261021_2230
-- descricao: o que faz, em uma linha
-- requer: (ids de que depende)
-- escopo: app            -- app = estrutura do aplicativo; infra = controle do próprio executor
-- transacao: sim         -- "nao" só para CONCURRENTLY/VACUUM
-- destrutiva: nao        -- "sim" se apaga, renomeia ou reescreve dados/estrutura
```

O que o executor recusa no arquivo:

- `BEGIN`/`COMMIT`: quem abre e fecha a transação é o executor;
- comandos do psql (`\`);
- `GRANT`/`REVOKE`, `CREATE EXTENSION`, papéis e bancos, `ALTER SYSTEM`,
  `COPY PROGRAM` e acesso a arquivo ou a outro servidor;
- comando destrutivo sem `destrutiva: sim`.

**Manifesto** (`migracoes/manifesto.json`): toda migração é registrada nele com
o SHA-256 (do conteúdo normalizado: sem BOM, LF), o escopo e os destinos. O que
estiver fora do manifesto ou diferente dele é recusado em qualquer ambiente. O
teste `scripts/migracoes/migracoes.test.js` falha se um arquivo mudar.

**No banco** (schema `controle`, criado pela `20261021_2230`, escopo infra):

- `controle.migracoes_aplicadas` guarda id, arquivo, sha256, ambiente, modo,
  data, duração, usuário, máquina, commit e se o arquivo estava commitado;
- `controle.migracoes_execucoes` é o diário de sucesso, falha e recusa. O erro
  fica sem valores de dados;
- na VPS, também `controle.operacoes_dev_vps` (seção 4);
- os três são imutáveis (trigger).

**Executor** (`scripts/migracoes/cli.js`):

- conecta só em banco local e marcado, e pede o nome do banco para confirmar;
- `dev-vps` só roda no Linux marcado, e `dev-windows` só no Windows;
- aplica uma migração por vez, em ordem, com as dependências aplicadas;
- usa transação com `pg_advisory_xact_lock` e confere de novo, dentro da trava;
- faz backup antes de migração destrutiva;
- a senha vem do pgpass ou de `PGPASSWORD`, nunca de argumento.

| Comando | Faz |
| --- | --- |
| `listar`, `verificar` | arquivos, checksums e manifesto (sem banco) |
| `estado` | o banco conectado e o que já foi aplicado (só leitura) |
| `impressao-digital [--salvar f]` | estrutura do aplicativo (nunca dados), em JSON |
| `comparar a.json b.json` | diferenças de estrutura e de migrações |
| `aplicar <id> --ambiente …` | aplica uma migração |
| `registrar <id>` | (Windows) registra uma aplicada à mão no psql |
| `marcar-ambiente dev-windows\|dev-vps` | grava a marca do banco (uma vez por banco) |

## 7. Registro: o que foi aplicado onde

| SQL | Tipo | VPS DEV | Windows DEV | Produção |
| --- | --- | --- | --- | --- |
| `cli.js marcar-ambiente dev-vps` (COMMENT ON DATABASE) | só da VPS | aplicado 21/10/2026 | — (lá seria `dev-windows`, opcional) | nunca |
| `migracoes/20261021_2230_controle_de_migracoes.sql` | migração, escopo **infra** | aplicada 21/10/2026 (`controle.migracoes_aplicadas`) | opcional: só se o dono quiser usar o executor lá | não se aplica, salvo decisão do dono |
| `scripts/dev-vps/registro-de-operacoes-dev-vps.sql` | só da VPS | aplicado 21/10/2026 (operação 1) | nunca | nunca |
| `scripts/dev-vps/sanitizar-banco-dev-vps.sql` | só da VPS | aplicado 21/10/2026 (operação 2); simulado de novo em 22/10, sem nada a trocar | nunca | **nunca** |
| `scripts/dev-vps/compactar-banco-dev-vps.sql` | só da VPS | aplicado 22/10/2026 (operação 3) + WAL girado | nunca | nunca |
| (nenhuma migração de escopo **app** ainda) | — | — | — | — |

Os registros detalhados estão nas tabelas `controle.*` do banco da VPS e em
`~/app-gestao-dev-vps/registros/`.

Impressão digital da estrutura do aplicativo (`public`, `rbac`) na VPS em
22/10/2026: `ed74b35d…`, 1 388 objetos (em
`migracoes/.estado/dev-vps-<banco>.json`). A soma `31bdd0cb…` citada em 21/10 era
da versão sem a normalização. A estrutura é a mesma.

## 8. Testes seguros na VPS

Sem rede (namespace só com loopback), com limite de tempo e `--test-force-exit`.
Sem ele, a bateria do backend trava em `clientesResumo.test.js`: os testes que
falham deixam servidores abertos.

```sh
sudo unshare -n sh -c 'ip link set lo up; cd /home/ubuntu/projetos/App-Gestao; exec sudo -u ubuntu env HOME=/home/ubuntu PATH=/usr/bin:/bin \
  node --test --test-force-exit --test-timeout=60000 "src/js/__tests__/*.test.js" "backend/**/*.test.js" "scripts/**/*.test.js"'
```

**O app real, sem rede.** O banco é acessado pelo socket, e o Xvfb e as
bibliotecas gráficas já estão instalados:

```sh
sudo unshare -n sh -c 'ip link set lo up; exec sudo -u ubuntu env HOME=/home/ubuntu PATH=/usr/bin:/bin DB_HOST=/var/run/postgresql \
  sh -c "cd /home/ubuntu/projetos/App-Gestao && xvfb-run -a node_modules/.bin/electron . --no-sandbox --disable-gpu --remote-debugging-port=9223"'
```

**Falhas que já existiam no HEAD** (66 em 21/10/2026, idênticas numa cópia limpa
do HEAD). Não são da VPS e não afetam a ativação do ambiente:

- **mocks antigos** (`pool.get is not a function`):
  - `atualizarMateriaAtualizaProdutos`, `atualizarPrecoMateriaPrima`;
  - `excluirProduto` (1), `materiaDuplicada` (2), `inserirLoteProduto` (2);
- **regras que mudaram depois do teste:**
  - `produtosDuplicados` (4, "Desenhado por é obrigatório");
  - `usuarioFluxoConfirmacao` (5, "nome e sobrenome");
  - `excluirProduto` (1), `pedidoPagamento` (2), `pedidoStatusDates` (1),
    `notificationsController` (2);
- **dependem da API remota**, barrados pela trava de testes do `apiHttpClient`:
  `usuariosController` (19), `clientesResumo` (3);
- **duplo local que não responde:** `produtoInsumoCodigoDuplicado` (7);
- **conhecidas:** `iaController` (14) e o logout de 30 min (`dailyChecks`, 1).

## 9. Responsabilidades e falhas

- **Claude:**
  - na VPS DEV, desenvolve, executa, testa, corrige, valida e registra sozinho;
  - para o Windows e a produção, só entrega arquivos e diz o que aplicar;
  - nunca commita, nunca toca a produção nem o banco do Windows, nunca expõe
    segredo nem dado pessoal (só nomes de chave e contagens).
- **Dono:**
  - homologa no Windows;
  - commita;
  - decide sobre produção, credenciais reais e integrações reais;
  - autoriza liberar hosts na barreira (`DEV_REDE_PERMITIDA`).
- **Em falha:**
  - parar;
  - preservar o estado, os backups e os registros;
  - mostrar o erro;
  - não improvisar correção destrutiva;
  - pedir orientação quando houver risco de perda de dados ou de atingir outro
    ambiente.
