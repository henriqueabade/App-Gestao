-- =====================================================================
-- ESTRUTURA DE PERMISSÕES — App-Gestao
-- Gerado a partir do modal de permissões (fonte única: backend/permissionsCatalog.js)
--
-- Modelo:
--   modelos_permissoes  ......... perfis de permissão (ex.: "Vendedor", "Admin")
--   usuarios.modelo_permissoes_id  vincula o usuário a um perfil
--   perm_<modulo> ............... 1 linha por perfil, 1 coluna booleana por permissão
--                                 modulo_ativo = módulo visível no menu
--
-- Regra: TRUE = permitido (marcado) | FALSE = negado (desmarcado)
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1) Perfis de permissão
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS modelos_permissoes (
  id           SERIAL PRIMARY KEY,
  nome         VARCHAR(120) NOT NULL UNIQUE,
  descricao    TEXT,
  criado_em    TIMESTAMP NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- 2) Vínculo usuário -> perfil
-- ---------------------------------------------------------------------
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS modelo_permissoes_id INTEGER
  REFERENCES modelos_permissoes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_usuarios_modelo_permissoes
  ON usuarios(modelo_permissoes_id);

-- ---------------------------------------------------------------------
-- 3) Matéria-prima  (perm_mp)  —  22 ações, 25 colunas
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_mp (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE,

  -- Ações
  acao_view                          BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.view · Ver lista
  acao_search                        BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.search · Buscar/filtrar
  acao_export                        BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.export · Exportar lista
  acao_create                        BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.create · Cadastrar MP
  acao_edit                          BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.edit · Editar MP
  acao_delete                        BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.delete · Excluir MP
  acao_process_view                  BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.process.view · Ver processos
  acao_process_create                BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.process.create · Cadastrar processo
  acao_process_delete                BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.process.delete · Excluir processo
  acao_category_view                 BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.category.view · Ver categorias
  acao_category_create               BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.category.create · Cadastrar categoria
  acao_category_edit                 BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.category.edit · Editar categoria
  acao_category_delete               BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.category.delete · Excluir categoria
  acao_unit_view                     BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.unit.view · Ver unidades
  acao_unit_create                   BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.unit.create · Cadastrar unidade
  acao_unit_edit                     BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.unit.edit · Editar unidade
  acao_unit_delete                   BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.unit.delete · Excluir unidade
  acao_stock_view                    BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.stock.view · Ver estoque
  acao_stock_input                   BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.stock.input · Entrada de estoque
  acao_stock_output                  BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.stock.output · Saída de estoque
  acao_stock_adjust                  BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.stock.adjust · Ajustar estoque
  acao_stock_infinite_toggle         BOOLEAN NOT NULL DEFAULT FALSE,  -- mp.stock.infinite_toggle · Alternar estoque infinito

  -- Colunas visíveis
  col_mp_codigo                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Código
  col_mp_nome                        BOOLEAN NOT NULL DEFAULT FALSE,  -- Matéria-prima
  col_mp_categoria                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Categoria
  col_mp_unidade                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Unidade
  col_mp_estoque_atual               BOOLEAN NOT NULL DEFAULT FALSE,  -- Estoque atual
  col_mp_estoque_min                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Estoque mín.
  col_mp_custo_medio                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Custo médio
  col_mp_fornecedor                  BOOLEAN NOT NULL DEFAULT FALSE,  -- Fornecedor
  col_mp_status                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Status
  col_mp_atualizado_em               BOOLEAN NOT NULL DEFAULT FALSE,  -- Atualizado em
  col_mov_data                       BOOLEAN NOT NULL DEFAULT FALSE,  -- Data
  col_mov_tipo                       BOOLEAN NOT NULL DEFAULT FALSE,  -- Tipo
  col_mov_qtd                        BOOLEAN NOT NULL DEFAULT FALSE,  -- Quantidade
  col_mov_ref                        BOOLEAN NOT NULL DEFAULT FALSE,  -- Referência
  col_mov_usuario                    BOOLEAN NOT NULL DEFAULT FALSE,  -- Usuário
  col_proc_nome                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Processo
  col_proc_duracao                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Duração
  col_proc_custo                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Custo
  col_proc_ordem                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Ordem
  col_cat_nome                       BOOLEAN NOT NULL DEFAULT FALSE,  -- Categoria
  col_cat_desc                       BOOLEAN NOT NULL DEFAULT FALSE,  -- Descrição
  col_cat_itens                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Itens
  col_uni_sigla                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Unidade
  col_uni_desc                       BOOLEAN NOT NULL DEFAULT FALSE,  -- Descrição
  col_uni_precision                  BOOLEAN NOT NULL DEFAULT FALSE  -- Precisão
);

-- ---------------------------------------------------------------------
-- 4) Produtos  (perm_prod)  —  20 ações, 30 colunas
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_prod (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE,

  -- Ações
  acao_view                          BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.view · Ver lista
  acao_search                        BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.search · Buscar/filtrar
  acao_export                        BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.export · Exportar lista
  acao_create                        BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.create · Cadastrar produto
  acao_edit                          BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.edit · Editar produto
  acao_delete                        BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.delete · Excluir produto
  acao_details_view                  BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.details.view · Ver detalhes
  acao_pdf                           BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.pdf · Gerar PDF do produto
  acao_stage_view                    BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.stage.view · Ver etapas
  acao_stage_advance                 BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.stage.advance · Avançar etapa
  acao_stage_insert                  BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.stage.insert · Inserir etapa
  acao_collection_view               BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.collection.view · Ver coleções
  acao_collection_create             BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.collection.create · Cadastrar coleção
  acao_collection_edit               BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.collection.edit · Editar coleção
  acao_collection_delete             BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.collection.delete · Excluir coleção
  acao_stock_view                    BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.stock.view · Ver estoque
  acao_stock_input                   BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.stock.input · Entrada de estoque
  acao_stock_output                  BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.stock.output · Saída de estoque
  acao_stock_adjust                  BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.stock.adjust · Ajuste de estoque
  acao_stock_infinite_toggle         BOOLEAN NOT NULL DEFAULT FALSE,  -- prod.stock.infinite_toggle · Alternar estoque infinito

  -- Colunas visíveis
  col_prod_sku                       BOOLEAN NOT NULL DEFAULT FALSE,  -- SKU
  col_prod_nome                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Produto
  col_prod_colecao                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Coleção
  col_prod_categoria                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Categoria
  col_prod_preco_base                BOOLEAN NOT NULL DEFAULT FALSE,  -- Preço base
  col_prod_custo_total               BOOLEAN NOT NULL DEFAULT FALSE,  -- Custo total
  col_prod_margem                    BOOLEAN NOT NULL DEFAULT FALSE,  -- Margem
  col_prod_estoque                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Estoque
  col_prod_etapa_atual               BOOLEAN NOT NULL DEFAULT FALSE,  -- Etapa atual
  col_prod_status                    BOOLEAN NOT NULL DEFAULT FALSE,  -- Status
  col_prod_atualizado_em             BOOLEAN NOT NULL DEFAULT FALSE,  -- Atualizado em
  col_etp_ordem                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Ordem
  col_etp_nome                       BOOLEAN NOT NULL DEFAULT FALSE,  -- Etapa
  col_etp_resp                       BOOLEAN NOT NULL DEFAULT FALSE,  -- Responsável
  col_etp_inicio                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Início
  col_etp_fim                        BOOLEAN NOT NULL DEFAULT FALSE,  -- Fim
  col_etp_tempo_real                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Tempo real
  col_ins_mp                         BOOLEAN NOT NULL DEFAULT FALSE,  -- MP
  col_ins_qtd                        BOOLEAN NOT NULL DEFAULT FALSE,  -- Qtd.
  col_ins_custo_un                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Custo un.
  col_ins_custo_total                BOOLEAN NOT NULL DEFAULT FALSE,  -- Custo total
  col_ins_unidade                    BOOLEAN NOT NULL DEFAULT FALSE,  -- Unidade
  col_var_nome                       BOOLEAN NOT NULL DEFAULT FALSE,  -- Variação
  col_var_estoque                    BOOLEAN NOT NULL DEFAULT FALSE,  -- Estoque
  col_var_reservado                  BOOLEAN NOT NULL DEFAULT FALSE,  -- Reservado
  col_var_disponivel                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Disponível
  col_col_nome                       BOOLEAN NOT NULL DEFAULT FALSE,  -- Coleção
  col_col_periodo                    BOOLEAN NOT NULL DEFAULT FALSE,  -- Período
  col_col_status                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Status
  col_col_itens                      BOOLEAN NOT NULL DEFAULT FALSE  -- Itens
);

-- ---------------------------------------------------------------------
-- 5) Orçamentos  (perm_orc)  —  8 ações, 22 colunas
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_orc (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE,

  -- Ações
  acao_view                          BOOLEAN NOT NULL DEFAULT FALSE,  -- orc.view · Ver lista
  acao_search                        BOOLEAN NOT NULL DEFAULT FALSE,  -- orc.search · Buscar/filtrar
  acao_create                        BOOLEAN NOT NULL DEFAULT FALSE,  -- orc.create · Criar orçamento
  acao_edit                          BOOLEAN NOT NULL DEFAULT FALSE,  -- orc.edit · Editar orçamento
  acao_view_details                  BOOLEAN NOT NULL DEFAULT FALSE,  -- orc.view.details · Ver detalhes
  acao_item_replace                  BOOLEAN NOT NULL DEFAULT FALSE,  -- orc.item.replace · Trocar item
  acao_convert                       BOOLEAN NOT NULL DEFAULT FALSE,  -- orc.convert · Converter em pedido
  acao_export                        BOOLEAN NOT NULL DEFAULT FALSE,  -- orc.export · Baixar PDF

  -- Colunas visíveis
  col_orc_num                        BOOLEAN NOT NULL DEFAULT FALSE,  -- Nº orçamento
  col_orc_cliente                    BOOLEAN NOT NULL DEFAULT FALSE,  -- Cliente
  col_orc_vendedor                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Vendedor
  col_orc_data                       BOOLEAN NOT NULL DEFAULT FALSE,  -- Data
  col_orc_validade                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Validade
  col_orc_itens                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Itens
  col_orc_subtotal                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Subtotal
  col_orc_desc                       BOOLEAN NOT NULL DEFAULT FALSE,  -- Descontos
  col_orc_frete_outros               BOOLEAN NOT NULL DEFAULT FALSE,  -- Frete/outros
  col_orc_total                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Total
  col_orc_status                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Status
  col_orc_it_nome                    BOOLEAN NOT NULL DEFAULT FALSE,  -- Item
  col_orc_it_sku                     BOOLEAN NOT NULL DEFAULT FALSE,  -- SKU
  col_orc_it_qtd                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Qtd.
  col_orc_it_preco                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Preço
  col_orc_it_desc                    BOOLEAN NOT NULL DEFAULT FALSE,  -- Desc.
  col_orc_it_subtotal                BOOLEAN NOT NULL DEFAULT FALSE,  -- Subtotal
  col_orc_it_obs                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Observações
  col_orc_cond_pagto                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Pagamento
  col_orc_cond_parc                  BOOLEAN NOT NULL DEFAULT FALSE,  -- Parcelas
  col_orc_cond_prazo                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Prazo
  col_orc_cond_validade              BOOLEAN NOT NULL DEFAULT FALSE  -- Validade
);

-- ---------------------------------------------------------------------
-- 6) Pedidos  (perm_ped)  —  12 ações, 23 colunas
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_ped (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE,

  -- Ações
  acao_view                          BOOLEAN NOT NULL DEFAULT FALSE,  -- ped.view · Ver lista
  acao_search                        BOOLEAN NOT NULL DEFAULT FALSE,  -- ped.search · Buscar/filtrar
  acao_view_details                  BOOLEAN NOT NULL DEFAULT FALSE,  -- ped.view.details · Ver detalhes
  acao_cancel                        BOOLEAN NOT NULL DEFAULT FALSE,  -- ped.cancel · Cancelar pedido
  acao_stock_deduct                  BOOLEAN NOT NULL DEFAULT FALSE,  -- ped.stock.deduct · Abater estoque
  acao_stock_restore_on_cancel       BOOLEAN NOT NULL DEFAULT FALSE,  -- ped.stock.restore_on_cancel · Restaurar estoque ao cancelar
  acao_status_confirm                BOOLEAN NOT NULL DEFAULT FALSE,  -- ped.status.confirm · Confirmar pedido
  acao_status_invoice                BOOLEAN NOT NULL DEFAULT FALSE,  -- ped.status.invoice · Faturar pedido
  acao_status_ship                   BOOLEAN NOT NULL DEFAULT FALSE,  -- ped.status.ship · Despachar pedido
  acao_status_deliver                BOOLEAN NOT NULL DEFAULT FALSE,  -- ped.status.deliver · Dar como entregue
  acao_export                        BOOLEAN NOT NULL DEFAULT FALSE,  -- ped.export · Baixar PDF
  acao_report                        BOOLEAN NOT NULL DEFAULT FALSE,  -- ped.report · Ver relatório

  -- Colunas visíveis
  col_ped_num                        BOOLEAN NOT NULL DEFAULT FALSE,  -- Nº pedido
  col_ped_cliente                    BOOLEAN NOT NULL DEFAULT FALSE,  -- Cliente
  col_ped_vendedor                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Vendedor
  col_ped_data                       BOOLEAN NOT NULL DEFAULT FALSE,  -- Data
  col_ped_entrega                    BOOLEAN NOT NULL DEFAULT FALSE,  -- Entrega
  col_ped_itens                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Itens
  col_ped_total                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Total
  col_ped_abate_estoque              BOOLEAN NOT NULL DEFAULT FALSE,  -- Abate estoque
  col_ped_status                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Status
  col_ped_condicao                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Condição
  col_ped_origem                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Origem
  col_ped_it_nome                    BOOLEAN NOT NULL DEFAULT FALSE,  -- Item
  col_ped_it_sku                     BOOLEAN NOT NULL DEFAULT FALSE,  -- SKU
  col_ped_it_qtd                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Qtd.
  col_ped_it_preco                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Preço
  col_ped_it_desc                    BOOLEAN NOT NULL DEFAULT FALSE,  -- Desc.
  col_ped_it_subtotal                BOOLEAN NOT NULL DEFAULT FALSE,  -- Subtotal
  col_ped_it_situacao                BOOLEAN NOT NULL DEFAULT FALSE,  -- Situação
  col_log_transportadora             BOOLEAN NOT NULL DEFAULT FALSE,  -- Transportadora
  col_log_cod_rastreio               BOOLEAN NOT NULL DEFAULT FALSE,  -- Código rastreio
  col_log_frete_valor                BOOLEAN NOT NULL DEFAULT FALSE,  -- Frete
  col_log_data_envio                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Enviado em
  col_log_data_entrega               BOOLEAN NOT NULL DEFAULT FALSE  -- Entregue em
);

-- ---------------------------------------------------------------------
-- 7) Clientes  (perm_cli)  —  6 ações, 25 colunas
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_cli (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE,

  -- Ações
  acao_view                          BOOLEAN NOT NULL DEFAULT FALSE,  -- cli.view · Ver lista
  acao_search                        BOOLEAN NOT NULL DEFAULT FALSE,  -- cli.search · Buscar/filtrar
  acao_details_view                  BOOLEAN NOT NULL DEFAULT FALSE,  -- cli.details.view · Ver detalhes
  acao_create                        BOOLEAN NOT NULL DEFAULT FALSE,  -- cli.create · Cadastrar cliente
  acao_edit                          BOOLEAN NOT NULL DEFAULT FALSE,  -- cli.edit · Editar cliente
  acao_delete                        BOOLEAN NOT NULL DEFAULT FALSE,  -- cli.delete · Excluir cliente

  -- Colunas visíveis
  col_cli_nome_fantasia              BOOLEAN NOT NULL DEFAULT FALSE,  -- Nome fantasia
  col_cli_razao_social               BOOLEAN NOT NULL DEFAULT FALSE,  -- Razão social
  col_cli_cnpj                       BOOLEAN NOT NULL DEFAULT FALSE,  -- CNPJ
  col_cli_comprador                  BOOLEAN NOT NULL DEFAULT FALSE,  -- Comprador/contato
  col_cli_tel                        BOOLEAN NOT NULL DEFAULT FALSE,  -- Telefone
  col_cli_email                      BOOLEAN NOT NULL DEFAULT FALSE,  -- E-mail
  col_cli_cidade_uf                  BOOLEAN NOT NULL DEFAULT FALSE,  -- Cidade/UF
  col_cli_transportadora             BOOLEAN NOT NULL DEFAULT FALSE,  -- Transportadora
  col_cli_status                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Status
  col_cli_owner                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Dono
  col_end_tipo                       BOOLEAN NOT NULL DEFAULT FALSE,  -- Tipo
  col_end_logradouro                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Logradouro
  col_end_numero                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Nº
  col_end_complemento                BOOLEAN NOT NULL DEFAULT FALSE,  -- Compl.
  col_end_bairro                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Bairro
  col_end_cidade                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Cidade
  col_end_uf                         BOOLEAN NOT NULL DEFAULT FALSE,  -- UF
  col_end_cep                        BOOLEAN NOT NULL DEFAULT FALSE,  -- CEP
  col_ctt_nome                       BOOLEAN NOT NULL DEFAULT FALSE,  -- Contato
  col_ctt_cargo                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Cargo
  col_ctt_tel                        BOOLEAN NOT NULL DEFAULT FALSE,  -- Telefone
  col_ctt_email                      BOOLEAN NOT NULL DEFAULT FALSE,  -- E-mail
  col_ctt_tags                       BOOLEAN NOT NULL DEFAULT FALSE,  -- Tags
  col_ctt_status                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Status
  col_ctt_ult_interacao              BOOLEAN NOT NULL DEFAULT FALSE  -- Últ. interação
);

-- ---------------------------------------------------------------------
-- 8) Prospecções  (perm_pros)  —  8 ações, 14 colunas
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_pros (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE,

  -- Ações
  acao_view                          BOOLEAN NOT NULL DEFAULT FALSE,  -- pros.view · Ver lista
  acao_search                        BOOLEAN NOT NULL DEFAULT FALSE,  -- pros.search · Buscar/filtrar
  acao_details_view                  BOOLEAN NOT NULL DEFAULT FALSE,  -- pros.details.view · Ver detalhes
  acao_create                        BOOLEAN NOT NULL DEFAULT FALSE,  -- pros.create · Cadastrar prospecção
  acao_edit                          BOOLEAN NOT NULL DEFAULT FALSE,  -- pros.edit · Editar prospecção
  acao_delete                        BOOLEAN NOT NULL DEFAULT FALSE,  -- pros.delete · Excluir prospecção
  acao_stage_update                  BOOLEAN NOT NULL DEFAULT FALSE,  -- pros.stage.update · Atualizar etapa
  acao_next_step                     BOOLEAN NOT NULL DEFAULT FALSE,  -- pros.next.step · Definir próximo passo

  -- Colunas visíveis
  col_pros_id                        BOOLEAN NOT NULL DEFAULT FALSE,  -- ID
  col_pros_entidade                  BOOLEAN NOT NULL DEFAULT FALSE,  -- Entidade
  col_pros_origem                    BOOLEAN NOT NULL DEFAULT FALSE,  -- Origem
  col_pros_etapa                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Etapa
  col_pros_valor                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Valor
  col_pros_prob                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Prob. (%)
  col_pros_owner                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Dono
  col_pros_proximo_passo             BOOLEAN NOT NULL DEFAULT FALSE,  -- Próx. passo
  col_pros_proximo_passo_data        BOOLEAN NOT NULL DEFAULT FALSE,  -- Para quando
  col_pros_atualizado_em             BOOLEAN NOT NULL DEFAULT FALSE,  -- Atualizado em
  col_hist_data                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Data
  col_hist_tipo                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Tipo
  col_hist_resumo                    BOOLEAN NOT NULL DEFAULT FALSE,  -- Resumo
  col_hist_resp                      BOOLEAN NOT NULL DEFAULT FALSE  -- Responsável
);

-- ---------------------------------------------------------------------
-- 9) Contatos  (perm_ctt)  —  12 ações, 15 colunas
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_ctt (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE,

  -- Ações
  acao_view                          BOOLEAN NOT NULL DEFAULT FALSE,  -- ctt.view · Ver lista
  acao_search                        BOOLEAN NOT NULL DEFAULT FALSE,  -- ctt.search · Buscar/filtrar
  acao_details_view                  BOOLEAN NOT NULL DEFAULT FALSE,  -- ctt.details.view · Ver detalhes
  acao_create                        BOOLEAN NOT NULL DEFAULT FALSE,  -- ctt.create · Cadastrar contato
  acao_edit                          BOOLEAN NOT NULL DEFAULT FALSE,  -- ctt.edit · Editar contato
  acao_link_client                   BOOLEAN NOT NULL DEFAULT FALSE,  -- ctt.link.client · Vincular a cliente
  acao_unlink_client                 BOOLEAN NOT NULL DEFAULT FALSE,  -- ctt.unlink.client · Desvincular de cliente
  acao_log_add                       BOOLEAN NOT NULL DEFAULT FALSE,  -- ctt.log.add · Registrar interação
  acao_log_view                      BOOLEAN NOT NULL DEFAULT FALSE,  -- ctt.log.view · Ver interações
  acao_status_update                 BOOLEAN NOT NULL DEFAULT FALSE,  -- ctt.status.update · Atualizar status
  acao_tag_manage                    BOOLEAN NOT NULL DEFAULT FALSE,  -- ctt.tag.manage · Gerenciar tags
  acao_delete                        BOOLEAN NOT NULL DEFAULT FALSE,  -- ctt.delete · Excluir contato

  -- Colunas visíveis
  col_ctt_nome                       BOOLEAN NOT NULL DEFAULT FALSE,  -- Contato
  col_ctt_cliente                    BOOLEAN NOT NULL DEFAULT FALSE,  -- Cliente
  col_ctt_cargo                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Cargo
  col_ctt_tel                        BOOLEAN NOT NULL DEFAULT FALSE,  -- Telefone
  col_ctt_email                      BOOLEAN NOT NULL DEFAULT FALSE,  -- E-mail
  col_ctt_origem                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Origem
  col_ctt_tags                       BOOLEAN NOT NULL DEFAULT FALSE,  -- Tags
  col_ctt_status                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Status
  col_ctt_ult_interacao              BOOLEAN NOT NULL DEFAULT FALSE,  -- Últ. interação
  col_ctt_owner                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Dono
  col_log_data                       BOOLEAN NOT NULL DEFAULT FALSE,  -- Data
  col_log_canal                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Canal
  col_log_assunto                    BOOLEAN NOT NULL DEFAULT FALSE,  -- Assunto
  col_log_detalhes                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Detalhes
  col_log_resp                       BOOLEAN NOT NULL DEFAULT FALSE  -- Responsável
);

-- ---------------------------------------------------------------------
-- 10) Relatórios  (perm_rel)  —  11 ações, 48 colunas
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_rel (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE,

  -- Ações
  acao_view                          BOOLEAN NOT NULL DEFAULT FALSE,  -- rel.view · Ver módulo
  acao_search                        BOOLEAN NOT NULL DEFAULT FALSE,  -- rel.search · Buscar/filtrar
  acao_run                           BOOLEAN NOT NULL DEFAULT FALSE,  -- rel.run · Rodar relatório
  acao_export_csv                    BOOLEAN NOT NULL DEFAULT FALSE,  -- rel.export.csv · Exportar CSV
  acao_export_xlsx                   BOOLEAN NOT NULL DEFAULT FALSE,  -- rel.export.xlsx · Exportar XLSX
  acao_export_pdf                    BOOLEAN NOT NULL DEFAULT FALSE,  -- rel.export.pdf · Exportar PDF
  acao_preset_save                   BOOLEAN NOT NULL DEFAULT FALSE,  -- rel.preset.save · Salvar preset
  acao_preset_load                   BOOLEAN NOT NULL DEFAULT FALSE,  -- rel.preset.load · Carregar preset
  acao_preset_manage                 BOOLEAN NOT NULL DEFAULT FALSE,  -- rel.preset.manage · Gerenciar presets
  acao_share_link                    BOOLEAN NOT NULL DEFAULT FALSE,  -- rel.share.link · Gerar link compartilhável
  acao_share_send                    BOOLEAN NOT NULL DEFAULT FALSE,  -- rel.share.send · Enviar relatório

  -- Colunas visíveis
  col_rel_estq_nome                  BOOLEAN NOT NULL DEFAULT FALSE,  -- Nome
  col_rel_estq_categoria             BOOLEAN NOT NULL DEFAULT FALSE,  -- Categoria
  col_rel_estq_unidade               BOOLEAN NOT NULL DEFAULT FALSE,  -- Unidade
  col_rel_estq_qtd                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Quantidade
  col_rel_estq_preco                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Preço
  col_rel_estq_processo              BOOLEAN NOT NULL DEFAULT FALSE,  -- Processo
  col_rel_estq_status                BOOLEAN NOT NULL DEFAULT FALSE,  -- Status
  col_rel_prod_codigo                BOOLEAN NOT NULL DEFAULT FALSE,  -- Código
  col_rel_prod_nome                  BOOLEAN NOT NULL DEFAULT FALSE,  -- Nome
  col_rel_prod_colecao               BOOLEAN NOT NULL DEFAULT FALSE,  -- Coleção
  col_rel_prod_preco_venda           BOOLEAN NOT NULL DEFAULT FALSE,  -- Preço de Venda
  col_rel_prod_margem                BOOLEAN NOT NULL DEFAULT FALSE,  -- Margem (%)
  col_rel_prod_qtd                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Quantidade
  col_rel_prod_status                BOOLEAN NOT NULL DEFAULT FALSE,  -- Status
  col_rel_cli_nome                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Nome
  col_rel_cli_cnpj                   BOOLEAN NOT NULL DEFAULT FALSE,  -- CNPJ
  col_rel_cli_pais                   BOOLEAN NOT NULL DEFAULT FALSE,  -- País
  col_rel_cli_estado                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Estado
  col_rel_cli_status                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Status
  col_rel_cli_dono                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Dono
  col_rel_ctt_contato                BOOLEAN NOT NULL DEFAULT FALSE,  -- Contato
  col_rel_ctt_tipo                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Tipo
  col_rel_ctt_empresa                BOOLEAN NOT NULL DEFAULT FALSE,  -- Empresa
  col_rel_ctt_celular                BOOLEAN NOT NULL DEFAULT FALSE,  -- Celular
  col_rel_ctt_telefone               BOOLEAN NOT NULL DEFAULT FALSE,  -- Telefone
  col_rel_ctt_email                  BOOLEAN NOT NULL DEFAULT FALSE,  -- E-mail
  col_rel_pros_nome                  BOOLEAN NOT NULL DEFAULT FALSE,  -- Nome do Lead
  col_rel_pros_email                 BOOLEAN NOT NULL DEFAULT FALSE,  -- E-mail
  col_rel_pros_status                BOOLEAN NOT NULL DEFAULT FALSE,  -- Status
  col_rel_pros_responsavel           BOOLEAN NOT NULL DEFAULT FALSE,  -- Responsável
  col_rel_orc_codigo                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Código
  col_rel_orc_cliente                BOOLEAN NOT NULL DEFAULT FALSE,  -- Cliente
  col_rel_orc_data                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Data
  col_rel_orc_valor                  BOOLEAN NOT NULL DEFAULT FALSE,  -- Valor Total
  col_rel_orc_condicao               BOOLEAN NOT NULL DEFAULT FALSE,  -- Condição
  col_rel_orc_status                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Status
  col_rel_ped_codigo                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Código
  col_rel_ped_cliente                BOOLEAN NOT NULL DEFAULT FALSE,  -- Cliente
  col_rel_ped_data                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Data
  col_rel_ped_valor                  BOOLEAN NOT NULL DEFAULT FALSE,  -- Valor Total
  col_rel_ped_condicao               BOOLEAN NOT NULL DEFAULT FALSE,  -- Condição
  col_rel_ped_status                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Status
  col_rel_usr_avatar                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Avatar
  col_rel_usr_nome                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Nome
  col_rel_usr_email                  BOOLEAN NOT NULL DEFAULT FALSE,  -- E-mail
  col_rel_usr_perfil                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Perfil
  col_rel_usr_situacao               BOOLEAN NOT NULL DEFAULT FALSE,  -- Situação
  col_rel_usr_status                 BOOLEAN NOT NULL DEFAULT FALSE  -- Status
);

-- ---------------------------------------------------------------------
-- 11) Tarefas  (perm_tarefas)  —  6 ações, 11 colunas
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_tarefas (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE,

  -- Ações
  acao_view                          BOOLEAN NOT NULL DEFAULT FALSE,  -- tarefas.view · Ver tarefas/agenda
  acao_create                        BOOLEAN NOT NULL DEFAULT FALSE,  -- tarefas.create · Criar tarefa
  acao_edit                          BOOLEAN NOT NULL DEFAULT FALSE,  -- tarefas.edit · Editar tarefa
  acao_delete                        BOOLEAN NOT NULL DEFAULT FALSE,  -- tarefas.delete · Excluir tarefa
  acao_assign                        BOOLEAN NOT NULL DEFAULT FALSE,  -- tarefas.assign · Atribuir tarefa
  acao_calendar_view                 BOOLEAN NOT NULL DEFAULT FALSE,  -- tarefas.calendar.view · Ver calendário

  -- Colunas visíveis
  col_tsk_titulo                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Título
  col_tsk_resp                       BOOLEAN NOT NULL DEFAULT FALSE,  -- Responsável
  col_tsk_prazo                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Prazo
  col_tsk_status                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Status
  col_tsk_prioridade                 BOOLEAN NOT NULL DEFAULT FALSE,  -- Prioridade
  col_evt_titulo                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Evento
  col_evt_inicio                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Início
  col_evt_fim                        BOOLEAN NOT NULL DEFAULT FALSE,  -- Fim
  col_evt_local                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Local
  col_evt_participantes              BOOLEAN NOT NULL DEFAULT FALSE,  -- Participantes
  col_evt_status                     BOOLEAN NOT NULL DEFAULT FALSE  -- Status
);

-- ---------------------------------------------------------------------
-- 12) Configurações  (perm_cfg)  —  6 ações, 8 colunas
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_cfg (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE,

  -- Ações
  acao_view                          BOOLEAN NOT NULL DEFAULT FALSE,  -- cfg.view · Ver configurações
  acao_theme_edit                    BOOLEAN NOT NULL DEFAULT FALSE,  -- cfg.theme.edit · Editar tema
  acao_integrations_edit             BOOLEAN NOT NULL DEFAULT FALSE,  -- cfg.integrations.edit · Editar integrações
  acao_prefs_edit                    BOOLEAN NOT NULL DEFAULT FALSE,  -- cfg.prefs.edit · Editar preferências gerais
  acao_roles_view                    BOOLEAN NOT NULL DEFAULT FALSE,  -- cfg.roles.view · Ver papéis/perfis
  acao_roles_edit                    BOOLEAN NOT NULL DEFAULT FALSE,  -- cfg.roles.edit · Editar papéis/perfis

  -- Colunas visíveis
  col_role_code                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Código
  col_role_name                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Nome
  col_role_desc                      BOOLEAN NOT NULL DEFAULT FALSE,  -- Descrição
  col_role_modulos                   BOOLEAN NOT NULL DEFAULT FALSE,  -- Módulos
  col_role_features                  BOOLEAN NOT NULL DEFAULT FALSE,  -- Ações
  col_int_nome                       BOOLEAN NOT NULL DEFAULT FALSE,  -- Integração
  col_int_status                     BOOLEAN NOT NULL DEFAULT FALSE,  -- Status
  col_int_ult_sync                   BOOLEAN NOT NULL DEFAULT FALSE  -- Últ. sync
);

-- ---------------------------------------------------------------------
-- 13) Dashboard  (perm_dashboard)  —  módulo ainda não configurado (somente modulo_ativo)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_dashboard (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);

-- ---------------------------------------------------------------------
-- 14) Calendário  (perm_calendario)  —  módulo ainda não configurado (somente modulo_ativo)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_calendario (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);

-- ---------------------------------------------------------------------
-- 15) Laminação · Clientes  (perm_lam_clientes)  —  módulo ainda não configurado (somente modulo_ativo)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_lam_clientes (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);

-- ---------------------------------------------------------------------
-- 16) Laminação · Serviços  (perm_lam_servicos)  —  módulo ainda não configurado (somente modulo_ativo)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_lam_servicos (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);

-- ---------------------------------------------------------------------
-- 17) Laminação · Precificação  (perm_lam_precificacao)  —  módulo ainda não configurado (somente modulo_ativo)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_lam_precificacao (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);

-- ---------------------------------------------------------------------
-- 18) Laminação · Relatórios  (perm_lam_relatorios)  —  módulo ainda não configurado (somente modulo_ativo)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_lam_relatorios (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);

-- ---------------------------------------------------------------------
-- 19) IA  (perm_ia)  —  módulo ainda não configurado (somente modulo_ativo)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_ia (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);

-- ---------------------------------------------------------------------
-- 20) Usuários  (perm_usuarios)  —  módulo ainda não configurado (somente modulo_ativo)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_usuarios (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);

-- ---------------------------------------------------------------------
-- 21) Financeiro  (perm_financeiro)  —  módulo ainda não configurado (somente modulo_ativo)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_financeiro (
  modelo_id    INTEGER PRIMARY KEY REFERENCES modelos_permissoes(id) ON DELETE CASCADE,
  modulo_ativo BOOLEAN NOT NULL DEFAULT FALSE
);

-- ---------------------------------------------------------------------
-- 22) Perfil padrão "Administrador" com tudo liberado
-- ---------------------------------------------------------------------
INSERT INTO modelos_permissoes (nome, descricao)
VALUES ('Administrador', 'Acesso total a todos os módulos')
ON CONFLICT (nome) DO NOTHING;

INSERT INTO perm_mp (modelo_id, modulo_ativo, acao_view, acao_search, acao_export, acao_create, acao_edit, acao_delete, acao_process_view, acao_process_create, acao_process_delete, acao_category_view, acao_category_create, acao_category_edit, acao_category_delete, acao_unit_view, acao_unit_create, acao_unit_edit, acao_unit_delete, acao_stock_view, acao_stock_input, acao_stock_output, acao_stock_adjust, acao_stock_infinite_toggle, col_mp_codigo, col_mp_nome, col_mp_categoria, col_mp_unidade, col_mp_estoque_atual, col_mp_estoque_min, col_mp_custo_medio, col_mp_fornecedor, col_mp_status, col_mp_atualizado_em, col_mov_data, col_mov_tipo, col_mov_qtd, col_mov_ref, col_mov_usuario, col_proc_nome, col_proc_duracao, col_proc_custo, col_proc_ordem, col_cat_nome, col_cat_desc, col_cat_itens, col_uni_sigla, col_uni_desc, col_uni_precision)
SELECT id, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

INSERT INTO perm_prod (modelo_id, modulo_ativo, acao_view, acao_search, acao_export, acao_create, acao_edit, acao_delete, acao_details_view, acao_pdf, acao_stage_view, acao_stage_advance, acao_stage_insert, acao_collection_view, acao_collection_create, acao_collection_edit, acao_collection_delete, acao_stock_view, acao_stock_input, acao_stock_output, acao_stock_adjust, acao_stock_infinite_toggle, col_prod_sku, col_prod_nome, col_prod_colecao, col_prod_categoria, col_prod_preco_base, col_prod_custo_total, col_prod_margem, col_prod_estoque, col_prod_etapa_atual, col_prod_status, col_prod_atualizado_em, col_etp_ordem, col_etp_nome, col_etp_resp, col_etp_inicio, col_etp_fim, col_etp_tempo_real, col_ins_mp, col_ins_qtd, col_ins_custo_un, col_ins_custo_total, col_ins_unidade, col_var_nome, col_var_estoque, col_var_reservado, col_var_disponivel, col_col_nome, col_col_periodo, col_col_status, col_col_itens)
SELECT id, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

INSERT INTO perm_orc (modelo_id, modulo_ativo, acao_view, acao_search, acao_create, acao_edit, acao_view_details, acao_item_replace, acao_convert, acao_export, col_orc_num, col_orc_cliente, col_orc_vendedor, col_orc_data, col_orc_validade, col_orc_itens, col_orc_subtotal, col_orc_desc, col_orc_frete_outros, col_orc_total, col_orc_status, col_orc_it_nome, col_orc_it_sku, col_orc_it_qtd, col_orc_it_preco, col_orc_it_desc, col_orc_it_subtotal, col_orc_it_obs, col_orc_cond_pagto, col_orc_cond_parc, col_orc_cond_prazo, col_orc_cond_validade)
SELECT id, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

INSERT INTO perm_ped (modelo_id, modulo_ativo, acao_view, acao_search, acao_view_details, acao_cancel, acao_stock_deduct, acao_stock_restore_on_cancel, acao_status_confirm, acao_status_invoice, acao_status_ship, acao_status_deliver, acao_export, acao_report, col_ped_num, col_ped_cliente, col_ped_vendedor, col_ped_data, col_ped_entrega, col_ped_itens, col_ped_total, col_ped_abate_estoque, col_ped_status, col_ped_condicao, col_ped_origem, col_ped_it_nome, col_ped_it_sku, col_ped_it_qtd, col_ped_it_preco, col_ped_it_desc, col_ped_it_subtotal, col_ped_it_situacao, col_log_transportadora, col_log_cod_rastreio, col_log_frete_valor, col_log_data_envio, col_log_data_entrega)
SELECT id, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

INSERT INTO perm_cli (modelo_id, modulo_ativo, acao_view, acao_search, acao_details_view, acao_create, acao_edit, acao_delete, col_cli_nome_fantasia, col_cli_razao_social, col_cli_cnpj, col_cli_comprador, col_cli_tel, col_cli_email, col_cli_cidade_uf, col_cli_transportadora, col_cli_status, col_cli_owner, col_end_tipo, col_end_logradouro, col_end_numero, col_end_complemento, col_end_bairro, col_end_cidade, col_end_uf, col_end_cep, col_ctt_nome, col_ctt_cargo, col_ctt_tel, col_ctt_email, col_ctt_tags, col_ctt_status, col_ctt_ult_interacao)
SELECT id, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

INSERT INTO perm_pros (modelo_id, modulo_ativo, acao_view, acao_search, acao_details_view, acao_create, acao_edit, acao_delete, acao_stage_update, acao_next_step, col_pros_id, col_pros_entidade, col_pros_origem, col_pros_etapa, col_pros_valor, col_pros_prob, col_pros_owner, col_pros_proximo_passo, col_pros_proximo_passo_data, col_pros_atualizado_em, col_hist_data, col_hist_tipo, col_hist_resumo, col_hist_resp)
SELECT id, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

INSERT INTO perm_ctt (modelo_id, modulo_ativo, acao_view, acao_search, acao_details_view, acao_create, acao_edit, acao_link_client, acao_unlink_client, acao_log_add, acao_log_view, acao_status_update, acao_tag_manage, acao_delete, col_ctt_nome, col_ctt_cliente, col_ctt_cargo, col_ctt_tel, col_ctt_email, col_ctt_origem, col_ctt_tags, col_ctt_status, col_ctt_ult_interacao, col_ctt_owner, col_log_data, col_log_canal, col_log_assunto, col_log_detalhes, col_log_resp)
SELECT id, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

INSERT INTO perm_rel (modelo_id, modulo_ativo, acao_view, acao_search, acao_run, acao_export_csv, acao_export_xlsx, acao_export_pdf, acao_preset_save, acao_preset_load, acao_preset_manage, acao_share_link, acao_share_send, col_rel_estq_nome, col_rel_estq_categoria, col_rel_estq_unidade, col_rel_estq_qtd, col_rel_estq_preco, col_rel_estq_processo, col_rel_estq_status, col_rel_prod_codigo, col_rel_prod_nome, col_rel_prod_colecao, col_rel_prod_preco_venda, col_rel_prod_margem, col_rel_prod_qtd, col_rel_prod_status, col_rel_cli_nome, col_rel_cli_cnpj, col_rel_cli_pais, col_rel_cli_estado, col_rel_cli_status, col_rel_cli_dono, col_rel_ctt_contato, col_rel_ctt_tipo, col_rel_ctt_empresa, col_rel_ctt_celular, col_rel_ctt_telefone, col_rel_ctt_email, col_rel_pros_nome, col_rel_pros_email, col_rel_pros_status, col_rel_pros_responsavel, col_rel_orc_codigo, col_rel_orc_cliente, col_rel_orc_data, col_rel_orc_valor, col_rel_orc_condicao, col_rel_orc_status, col_rel_ped_codigo, col_rel_ped_cliente, col_rel_ped_data, col_rel_ped_valor, col_rel_ped_condicao, col_rel_ped_status, col_rel_usr_avatar, col_rel_usr_nome, col_rel_usr_email, col_rel_usr_perfil, col_rel_usr_situacao, col_rel_usr_status)
SELECT id, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

INSERT INTO perm_tarefas (modelo_id, modulo_ativo, acao_view, acao_create, acao_edit, acao_delete, acao_assign, acao_calendar_view, col_tsk_titulo, col_tsk_resp, col_tsk_prazo, col_tsk_status, col_tsk_prioridade, col_evt_titulo, col_evt_inicio, col_evt_fim, col_evt_local, col_evt_participantes, col_evt_status)
SELECT id, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

INSERT INTO perm_cfg (modelo_id, modulo_ativo, acao_view, acao_theme_edit, acao_integrations_edit, acao_prefs_edit, acao_roles_view, acao_roles_edit, col_role_code, col_role_name, col_role_desc, col_role_modulos, col_role_features, col_int_nome, col_int_status, col_int_ult_sync)
SELECT id, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

INSERT INTO perm_dashboard (modelo_id, modulo_ativo)
SELECT id, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

INSERT INTO perm_calendario (modelo_id, modulo_ativo)
SELECT id, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

INSERT INTO perm_lam_clientes (modelo_id, modulo_ativo)
SELECT id, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

INSERT INTO perm_lam_servicos (modelo_id, modulo_ativo)
SELECT id, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

INSERT INTO perm_lam_precificacao (modelo_id, modulo_ativo)
SELECT id, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

INSERT INTO perm_lam_relatorios (modelo_id, modulo_ativo)
SELECT id, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

INSERT INTO perm_ia (modelo_id, modulo_ativo)
SELECT id, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

INSERT INTO perm_usuarios (modelo_id, modulo_ativo)
SELECT id, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

INSERT INTO perm_financeiro (modelo_id, modulo_ativo)
SELECT id, TRUE FROM modelos_permissoes WHERE nome = 'Administrador'
ON CONFLICT (modelo_id) DO NOTHING;

COMMIT;
