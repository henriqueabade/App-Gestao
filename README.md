# Santissimo Decor Dashboard

Este projeto é um aplicativo desktop baseado em Electron para gerenciar o fluxo de trabalho interno da **Santíssimo Decor**. Ele incorpora uma API Express e se conecta a um banco PostgreSQL para lidar com autenticação de usuários, informações de clientes e estoque de matéria‑prima.

## Requisitos

- **Node.js** (testado na versão 18+)
- **npm**
- Servidor **PostgreSQL**

## Configuração

1. Instale o Node.js e o PostgreSQL em sua máquina.
2. Clone este repositório e instale as dependências:
   ```bash
   npm install
   ```
3. Crie um banco PostgreSQL chamado `Santissimo_Decor_App_Gestao` (ou defina a variável `DB_NAME` com outro nome). Configure também as variáveis de ambiente de conexão:
   - `DB_USER`
   - `DB_PASSWORD`
   - `DB_HOST` (opcional, padrão `localhost`)
   - `DB_PORT` (opcional, padrão `5432`) – valor inicial da porta, sobrescrito pelo **PIN** informado na tela de login
   - `DB_NAME` (opcional, padrão `Santissimo_Decor_App_Gestao`)
   - `API_PORT` (opcional, padrão `3000`)
   Essas variáveis podem ser colocadas em um arquivo `.env` ou exportadas no ambiente antes de iniciar o app. Um exemplo de
   configuração pode ser encontrado em [`.env.example`](./.env.example). Se o banco de dados estiver em outra máquina, defina
   `DB_HOST` com o endereço desse servidor. Por exemplo:

  ```bash
  DB_HOST=192.168.21.157
  ```
  O número informado no campo **PIN** da tela de login ou cadastro define a
  porta utilizada para conectar ao banco de dados. Uma vez autenticado com um
  PIN válido, ele é lembrado nas próximas sessões, sendo substituído caso outro
  código seja utilizado.
4. Crie manualmente as tabelas esperadas pelo aplicativo (`usuarios`, `clientes`, `materia_prima`, etc.), pois não há scripts de migração.

## Execução em desenvolvimento

Inicie o aplicativo Electron com:
```bash
npm start
```
Esse comando inicia o app desktop e também a API Express na porta `3000` por padrão.

Se desejar rodar apenas a API utilize:
```bash
node backend/server.js
```
A aplicação Electron se comunica com essa API durante o desenvolvimento.

## Geração de instalador

Para criar um instalador execute:
```bash
npm run dist
```
A saída será gerada na pasta `dist/` do projeto. O script do instalador fica em `build/installer.nsh`.
Ao rodar o instalador, ele verifica se o aplicativo já está presente no sistema.
Se a versão instalada for igual ou mais recente, a instalação é cancelada e
é exibida uma notificação. Se a versão nova for superior, o instalador
continua e realiza a atualização automaticamente.

Para publicar um build assinado e gerar os manifestos de atualização (`latest.yml` ou `app-update.yml`), execute:
```bash
npm run dist:publish
```
Esse script executa `electron-builder --publish onTagOrDraft`, que sobe os artefatos somente quando o commit estiver associado
a uma tag ou a um rascunho de release, evitando uploads acidentais.

## Publicação e atualizações automáticas

O `electron-builder` está configurado para publicar os artefatos da aplicação e gerar os feeds consumidos pelo
`electron-updater`. O comportamento é controlado pelas variáveis a seguir:

Variáveis comuns:

| Variável | Descrição |
| --- | --- |
| `ELECTRON_PUBLISH_PROVIDER` | Define o provedor usado (`github`, `generic` ou `spaces`). |
| `ELECTRON_UPDATE_URL` | (Opcional) Substitui a URL do feed de atualização gerado automaticamente. |
| `ELECTRON_UPDATE_DISABLE` | (Opcional) Quando definido como `true`, desativa a verificação automática de updates. |

### Publicação no GitHub Releases

| Variável | Descrição |
| --- | --- |
| `ELECTRON_PUBLISH_GITHUB_OWNER` | Organização ou usuário proprietário do repositório. |
| `ELECTRON_PUBLISH_GITHUB_REPO` | Nome do repositório que receberá as releases. |
| `ELECTRON_PUBLISH_GITHUB_SLUG` | (Opcional) Alternativa no formato `owner/repo` para preencher automaticamente `owner` e `repo`. |
| `ELECTRON_PUBLISH_GITHUB_RELEASE_TYPE` | (Opcional) Tipo de release (`draft`, `prerelease`, etc.). Padrão: `draft`. |
| `GH_TOKEN` | Personal access token com permissão para criar releases e enviar artefatos. |

O `electron-builder` gera automaticamente `latest.yml`, além do instalador `.exe` e do pacote `.blockmap`. Durante pipelines CI,
defina o token (`GH_TOKEN`) e execute `npm run dist:publish` após criar a tag. O release ficará em modo rascunho enquanto não for
publicado manualmente no GitHub.

### Publicação em servidor HTTP genérico

| Variável | Descrição |
| --- | --- |
| `ELECTRON_PUBLISH_GENERIC_URL` | URL base (HTTPS) onde os artefatos serão hospedados. |

Garanta que o servidor aceite `PUT` ou `POST` conforme o adaptador configurado (ex.: scripts de upload via CI) e sirva os arquivos
com cabeçalhos corretos. Os manifestos gerados devem ficar acessíveis na mesma URL base para que o `electron-updater` possa buscar
`latest.yml` (Windows) ou `app-update.yml` (macOS/Linux).

### Publicação no DigitalOcean Spaces / S3

| Variável | Descrição |
| --- | --- |
| `ELECTRON_PUBLISH_SPACES_NAME` | Nome do bucket. |
| `ELECTRON_PUBLISH_SPACES_REGION` | Região do bucket (ex.: `nyc3`). |
| `ELECTRON_PUBLISH_SPACES_ENDPOINT` | Endpoint HTTPS do Spaces/S3. |
| `ELECTRON_PUBLISH_SPACES_PATH` | (Opcional) Caminho dentro do bucket onde os artefatos serão gravados. |
| `AWS_ACCESS_KEY_ID` | Chave de acesso com permissão de escrita. |
| `AWS_SECRET_ACCESS_KEY` | Chave secreta correspondente. |
| `AWS_SESSION_TOKEN` | (Opcional) Token temporário, quando aplicável. |

Certifique-se de que o bucket esteja configurado para servir arquivos públicos via HTTPS. Os manifestos `latest.yml` e `app-update.yml`
serão carregados automaticamente na mesma pasta dos instaladores.

### Fluxo recomendado para uma release assinada

1. Configure as variáveis de ambiente apropriadas ao provedor e às credenciais de assinatura de código
   (`CSC_LINK`, `CSC_KEY_PASSWORD`, `WIN_CSC_LINK`, etc., se aplicável).
2. Rode `npm run dist` localmente ou em uma pipeline para validar o build.
3. Crie uma tag Git correspondente à versão do `package.json` e faça push para o repositório remoto.
4. Execute `npm run dist:publish` no ambiente de CI/CD com as variáveis acima exportadas.
5. Revise o rascunho de release (ou o upload no provedor selecionado), publique-o e distribua o instalador.
6. Os clientes receberão notificações de update através do `electron-updater`, que consumirá os manifestos gerados.

## Personalizando cores

O arquivo `src/utils/colorParser.js` possui a constante `colorDictionary`, um array com os nomes de cores reconhecidos.
Para adicionar uma nova cor ou sobrescrever um valor existente, edite essa constante inserindo um objeto com as propriedades `name`, `hex` e `keywords`:

```js
colorDictionary.push({
  name: 'meu custom',
  hex: '#123abc',
  keywords: ['meu custom']
});
```

As entradas em `keywords` são normalizadas em minúsculas e sem acentos ou hifens, portanto use esse formato ao adicionar novas cores.
