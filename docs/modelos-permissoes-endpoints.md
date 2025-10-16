# Modelos de Permissões

Os endpoints abaixo permitem que Sup Admins criem e gerenciem modelos reutilizáveis de permissões. Todos os exemplos assumem que as requisições são autenticadas com um token **Sup Admin**.

## Estrutura dos dados

```json
{
  "nome": "Financeiro",
  "permissoes": {
    "usuarios": {
      "permissoes": {
        "permitido": true
      }
    }
  }
}
```

* `nome` — obrigatório e único.
* `permissoes` — objeto de permissões no mesmo formato aplicado diretamente em usuários.

## Endpoints

### GET `/api/usuarios/modelos-permissoes`
Lista todos os modelos cadastrados.

**Resposta**
```json
{
  "modelos": [
    {
      "id": 1,
      "nome": "Financeiro",
      "permissoes": { "usuarios": { "permissoes": { "permitido": true } } },
      "criadoEm": "2024-04-05T12:34:56.000Z",
      "atualizadoEm": "2024-04-05T12:34:56.000Z"
    }
  ]
}
```

### POST `/api/usuarios/modelos-permissoes`
Cria um novo modelo.

**Payload**
```json
{
  "nome": "Financeiro",
  "permissoes": { ... }
}
```

**Códigos de retorno**
* `201` — modelo criado com sucesso.
* `400` — payload inválido.
* `409` — já existe um modelo com o mesmo nome.

### PATCH `/api/usuarios/modelos-permissoes/:id`
Atualiza nome e/ou permissões do modelo.

**Payload**
```json
{
  "nome": "Financeiro Corporativo",
  "permissoes": { ... }
}
```

Retorna o modelo atualizado. Responde `404` se o ID não existir.

### DELETE `/api/usuarios/modelos-permissoes/:id`
Remove o modelo informado. Responde `204` para sucesso e `404` se não encontrado.

## Aplicando modelos em usuários

Quando um usuário é carregado pelos endpoints existentes (`/api/usuarios/me`, `/api/usuarios/:id`, listas, etc.), o campo `modeloPermissoesId` (e o alias `modelo_permissoes_id`) passa a compor a resposta.

Para vincular/aplicar um modelo durante a criação ou edição de usuários use o endpoint `PATCH /api/usuarios/:id` com Sup Admin autenticado.

```json
{
  "modeloPermissoesId": 3,
  "aplicarPermissoesDoModelo": true
}
```

* `modeloPermissoesId` ou `modelo_permissoes_id` define o modelo associado (use `null` para desvincular).
* `aplicarPermissoesDoModelo` (ou `sincronizarPermissoesDoModelo`) força a cópia das permissões do modelo para o usuário. Caso o campo seja omitido, as permissões são aplicadas automaticamente quando um novo modelo é informado e nenhum bloco `permissoes` personalizado é enviado.

Também é possível sobrescrever permissões manualmente no mesmo PATCH, enviando um objeto `permissoes`. Essa operação continua restrita a Sup Admins.
