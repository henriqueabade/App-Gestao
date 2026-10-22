-- =============================================================================
-- SÓ DA VPS — Sanitização do banco DEV da VPS (Santissimo_Decor_App_Gestao_Dev_VPS)
-- =============================================================================
--
-- Só serve para a CÓPIA restaurada na VPS. Recusa qualquer outro banco: o
-- banco do Windows, a produção ou um nome parecido não passam da guarda.
-- Não é migração: não vai ao Windows nem à produção. Rode pelo executor das
-- operações da VPS (backup verificado + registro em controle.operacoes_dev_vps):
--   node scripts/dev-vps/operacao-vps.js scripts/dev-vps/sanitizar-banco-dev-vps.sql \
--        -v modo=aplicar -v confirmar_banco=Santissimo_Decor_App_Gestao_Dev_VPS \
--        -v senha_dev_hash="$(cat ~/app-gestao-dev-vps/senha-usuarios-dev.bcrypt)"
-- Sem -v modo=aplicar é simulação (termina em ROLLBACK). Ver
-- docs/ambientes-dev-e-migracoes.md, seção 4.
--
-- O que faz (tudo numa transação só):
--   A. BB, NF-e e integrações: tira as credenciais (produção e homologação),
--      apaga os segredos cifrados, desliga conciliação e boleto automático,
--      prende NF-e e integrações contábeis em homologação, sem SMTP.
--   B. Dados pessoais, com fictícios estáveis (o mesmo original vira o mesmo
--      fictício em todo o banco: colunas, JSON, XML e textos):
--      - e-mail @exemplo.invalid; telefone (00); nome de pessoa "Pessoa XXXXXX";
--        CPF fictício válido; redes sociais; fotos dos usuários;
--      - CNPJ: ficam reais SÓ o da própria empresa (emitente/beneficiário) e o
--        dos clientes que têm NF-e de homologação (os clientes de teste fiscal);
--        os demais viram CNPJ fictícios válidos e a IE vira dígitos fictícios;
--      - provável MEI/pessoa (razão social sem palavra de empresa): nome e rua
--        fictícios;
--      - XML fiscais (NF-e, NF-e de fora, CC-e): viram SINTÉTICOS identificados
--        — destinatário fictício (salvo cliente de teste fiscal), contato
--        fictício, assinatura removida e a marca "DOCUMENTO SINTÉTICO DE TESTE";
--      - o que veio do gerador de dados simulados (marca "Simulado (banco
--        DEV)": fornecedores, documentos, títulos, conta e extrato do BB
--        simulados, arquivos) FICA como está — é o cenário de teste da
--        Contabilidade e já é fictício. O que não tem a marca é anonimizado
--        (contraparte de PIX/TED nos lançamentos e no OFX; PDF trocado por um
--        sintético; XML sintético; SHA-256 e tamanho recalculados).
--   C. Usuários e avisos: e-mails fictícios (dono@exemplo.invalid para a conta
--      do dono, que a trava de edição de pedido aceita na máquina isolada),
--      senha DEV única (hash bcrypt), tokens apagados, os aparelhos do Windows
--      cancelados e a marca do banco (COMMENT ON DATABASE = app-gestao:dev-vps).
--   D. Sequências atrás do maior id: ALTER SEQUENCE ... RESTART (o setval NÃO
--      é desfeito pelo ROLLBACK da simulação; o ALTER SEQUENCE é).
--   E. Conferências: linhas de cada tabela, chaves estrangeiras, credenciais,
--      e-mails, telefones, nomes, CNPJs e XML. Falhou, aborta e desfaz tudo.
--
-- Muda SÓ DADOS (e o comentário do banco): nenhuma estrutura do aplicativo
-- muda, para a VPS continuar com a mesma estrutura do Windows. As funções de
-- apoio ficam em pg_temp e somem no fim da sessão.
-- =============================================================================

\set ON_ERROR_STOP on
\set QUIET on
\pset footer off

\if :{?modo}
\else
  \set modo simular
\endif
\if :{?senha_dev_hash}
\else
  \set senha_dev_hash ''
\endif
\if :{?confirmar_banco}
\else
  \set confirmar_banco ''
\endif
\if :{?operacao_sha256}
\else
  \set operacao_sha256 ''
\endif
\if :{?maquina}
\else
  \set maquina ''
\endif
\if :{?backup_arquivo}
\else
  \set backup_arquivo ''
\endif
\if :{?backup_sha256}
\else
  \set backup_sha256 ''
\endif

SELECT (:'modo' IN ('simular', 'aplicar')) AS modo_valido, (:'modo' = 'aplicar') AS aplicar \gset
\if :modo_valido
\else
  \echo 'ERRO: -v modo deve ser simular ou aplicar.'
  \quit
\endif

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '15min';
SELECT set_config('sanitizacao.modo', :'modo', true),
       set_config('sanitizacao.senha', :'senha_dev_hash', true),
       set_config('sanitizacao.confirmar', :'confirmar_banco', true),
       set_config('sanitizacao.sha', :'operacao_sha256', true),
       set_config('sanitizacao.maquina', :'maquina', true),
       set_config('sanitizacao.backup', :'backup_arquivo', true),
       set_config('sanitizacao.backup_sha', :'backup_sha256', true) \gset sanit_

-- -----------------------------------------------------------------------------
-- Guarda: só o banco DEV da VPS, só pelo usuário DEV, só conexão local.
-- -----------------------------------------------------------------------------
DO $guarda$
DECLARE
  alvo constant text := 'Santissimo_Decor_App_Gestao_Dev_VPS';
BEGIN
  IF current_database() <> alvo THEN
    RAISE EXCEPTION 'GUARDA: este script só roda em %, não em %.', alvo, current_database();
  END IF;
  IF current_user <> 'app_gestao_dev' THEN
    RAISE EXCEPTION 'GUARDA: rode como app_gestao_dev (sem superusuário), não como %.', current_user;
  END IF;
  IF inet_server_addr() IS NOT NULL AND NOT (inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet) THEN
    RAISE EXCEPTION 'GUARDA: conexão não local (%).', inet_server_addr();
  END IF;
  IF current_setting('sanitizacao.modo') = 'aplicar' THEN
    IF current_setting('sanitizacao.confirmar') <> alvo THEN
      RAISE EXCEPTION 'GUARDA: para aplicar, passe -v confirmar_banco=%', alvo;
    END IF;
    IF current_setting('sanitizacao.senha') !~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$' THEN
      RAISE EXCEPTION 'GUARDA: para aplicar, passe -v senha_dev_hash com um hash bcrypt válido.';
    END IF;
  END IF;
END
$guarda$;

-- -----------------------------------------------------------------------------
-- Apoio (pg_temp: some no fim da sessão; nada fica no banco)
-- -----------------------------------------------------------------------------
CREATE TEMP TABLE efeitos (ordem serial, bloco text, item text, linhas bigint) ON COMMIT DROP;
CREATE TEMP TABLE contagem_antes (tabela text PRIMARY KEY, linhas bigint) ON COMMIT DROP;
CREATE TEMP TABLE nomes (original text PRIMARY KEY, ficticio text NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE cnpj_mantidos (digitos text PRIMARY KEY, motivo text) ON COMMIT DROP;
CREATE TEMP TABLE ie_mantidas (ie text PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE cnpj_trocados (digitos text PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE prov_mei (tabela text, id integer, PRIMARY KEY (tabela, id)) ON COMMIT DROP;

-- Já sanitizado antes (registro em controle.operacoes_dev_vps)? Então CNPJ, CPF
-- e IE não são trocados de novo: um fictício válido é indistinguível de um
-- real, e trocar de novo daria outro fictício. O resto já é idempotente.
DO $ja$
DECLARE ja boolean := false;
BEGIN
  IF to_regclass('controle.operacoes_dev_vps') IS NOT NULL THEN
    EXECUTE $q$SELECT EXISTS (SELECT 1 FROM controle.operacoes_dev_vps WHERE operacao = 'sanitizar-banco-dev-vps.sql' AND observacao = 'sanitização aplicada')$q$ INTO ja;
  END IF;
  PERFORM set_config('sanitizacao.ja', CASE WHEN ja THEN 'sim' ELSE 'nao' END, true);
END
$ja$;

CREATE FUNCTION pg_temp.num_de(t text, modulo bigint) RETURNS bigint
LANGUAGE sql IMMUTABLE AS $f$
  SELECT (('x' || substr(md5(coalesce(t, '')), 1, 12))::bit(48)::bigint) % modulo
$f$;

CREATE FUNCTION pg_temp.so_digitos(t text) RETURNS text
LANGUAGE sql IMMUTABLE AS $f$ SELECT regexp_replace(coalesce(t, ''), '\D', '', 'g') $f$;

CREATE FUNCTION pg_temp.email_ficticio(original text) RETURNS text
LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE
    WHEN original IS NULL OR btrim(original) = '' THEN original
    WHEN original ~* '@exemplo\.invalid$' THEN original
    ELSE 'contato.' || substr(md5(lower(btrim(original))), 1, 10) || '@exemplo.invalid'
  END
$f$;

-- DDD 00 não existe: o número não chama ninguém. Mantém o formato da máscara.
CREATE FUNCTION pg_temp.telefone_ficticio(original text) RETURNS text
LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE
    WHEN original IS NULL OR btrim(original) = '' THEN original
    WHEN original ~ '^\(00\)' THEN original
    WHEN length(pg_temp.so_digitos(original)) <= 10 THEN
      '(00) 3' || lpad(pg_temp.num_de('f' || original, 1000)::text, 3, '0') || '-' || lpad(pg_temp.num_de('g' || original, 10000)::text, 4, '0')
    ELSE
      '(00) 9' || lpad(pg_temp.num_de('c' || original, 10000)::text, 4, '0') || '-' || lpad(pg_temp.num_de('d' || original, 10000)::text, 4, '0')
  END
$f$;

CREATE FUNCTION pg_temp.nome_ficticio(original text) RETURNS text
LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE
    WHEN original IS NULL OR btrim(original) = '' THEN original
    WHEN original ~ '^(Pessoa|Empresa) [0-9A-F]{6}$' THEN original
    ELSE 'Pessoa ' || upper(substr(md5(lower(btrim(original))), 1, 6))
  END
$f$;

CREATE FUNCTION pg_temp.empresa_ficticia(original text) RETURNS text
LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE
    WHEN original IS NULL OR btrim(original) = '' THEN original
    WHEN original ~ '^(Pessoa|Empresa) [0-9A-F]{6}$' THEN original
    ELSE 'Empresa ' || upper(substr(md5('mei:' || lower(btrim(original))), 1, 6))
  END
$f$;

CREATE FUNCTION pg_temp.perfil_ficticio(original text) RETURNS text
LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE
    WHEN original IS NULL OR btrim(original) = '' THEN original
    WHEN original ~ '^perfil-teste-' THEN original
    ELSE 'perfil-teste-' || substr(md5(lower(btrim(original))), 1, 8)
  END
$f$;

-- CPF fictício válido, estável e no formato do original.
CREATE FUNCTION pg_temp.cpf_ficticio(original text) RETURNS text
LANGUAGE plpgsql STABLE AS $f$
DECLARE
  d text := pg_temp.so_digitos(original);
  base text; s int; i int; dv1 int; dv2 int;
BEGIN
  IF length(d) <> 11 OR current_setting('sanitizacao.ja') = 'sim' THEN RETURN original; END IF;
  base := lpad(pg_temp.num_de('cpf:' || d, 1000000000)::text, 9, '0');
  IF base ~ '^(.)\1*$' THEN base := '274638195'; END IF;
  s := 0; FOR i IN 1..9 LOOP s := s + substr(base, i, 1)::int * (11 - i); END LOOP;
  dv1 := (s * 10) % 11; IF dv1 = 10 THEN dv1 := 0; END IF;
  base := base || dv1;
  s := 0; FOR i IN 1..10 LOOP s := s + substr(base, i, 1)::int * (12 - i); END LOOP;
  dv2 := (s * 10) % 11; IF dv2 = 10 THEN dv2 := 0; END IF;
  base := base || dv2;
  IF original ~ '\.' THEN
    RETURN substr(base, 1, 3) || '.' || substr(base, 4, 3) || '.' || substr(base, 7, 3) || '-' || substr(base, 10, 2);
  END IF;
  RETURN base;
END
$f$;

-- O CNPJ tem os dígitos verificadores certos?
CREATE FUNCTION pg_temp.cnpj_valido(d text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $f$
DECLARE s int; i int; dv int;
  p1 int[] := ARRAY[5,4,3,2,9,8,7,6,5,4,3,2];
  p2 int[] := ARRAY[6,5,4,3,2,9,8,7,6,5,4,3,2];
BEGIN
  IF d !~ '^[0-9]{14}$' OR d ~ '^(.)\1*$' THEN RETURN false; END IF;
  s := 0; FOR i IN 1..12 LOOP s := s + substr(d, i, 1)::int * p1[i]; END LOOP;
  dv := 11 - (s % 11); IF dv >= 10 THEN dv := 0; END IF;
  IF dv <> substr(d, 13, 1)::int THEN RETURN false; END IF;
  s := 0; FOR i IN 1..13 LOOP s := s + substr(d, i, 1)::int * p2[i]; END LOOP;
  dv := 11 - (s % 11); IF dv >= 10 THEN dv := 0; END IF;
  RETURN dv = substr(d, 14, 1)::int;
END
$f$;

-- CNPJ fictício válido (matriz 0001), estável e no formato do original.
CREATE FUNCTION pg_temp.cnpj_ficticio(original text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $f$
DECLARE
  d text := pg_temp.so_digitos(original);
  base text; s int; i int; dv int;
  p1 int[] := ARRAY[5,4,3,2,9,8,7,6,5,4,3,2];
  p2 int[] := ARRAY[6,5,4,3,2,9,8,7,6,5,4,3,2];
BEGIN
  IF length(d) <> 14 THEN RETURN original; END IF;
  base := lpad(pg_temp.num_de('cnpj:' || d, 100000000)::text, 8, '0') || '0001';
  s := 0; FOR i IN 1..12 LOOP s := s + substr(base, i, 1)::int * p1[i]; END LOOP;
  dv := 11 - (s % 11); IF dv >= 10 THEN dv := 0; END IF;
  base := base || dv;
  s := 0; FOR i IN 1..13 LOOP s := s + substr(base, i, 1)::int * p2[i]; END LOOP;
  dv := 11 - (s % 11); IF dv >= 10 THEN dv := 0; END IF;
  base := base || dv;
  IF original ~ '[./-]' THEN
    RETURN substr(base, 1, 2) || '.' || substr(base, 3, 3) || '.' || substr(base, 6, 3) || '/' || substr(base, 9, 4) || '-' || substr(base, 13, 2);
  END IF;
  RETURN base;
END
$f$;

-- O CNPJ que vale no DEV: o mantido (empresa e clientes de teste fiscal) ou o fictício.
CREATE FUNCTION pg_temp.cnpj_dev(original text) RETURNS text
LANGUAGE plpgsql AS $f$
DECLARE d text := pg_temp.so_digitos(original);
BEGIN
  IF length(d) <> 14 OR current_setting('sanitizacao.ja') = 'sim'
     OR EXISTS (SELECT 1 FROM pg_temp.cnpj_mantidos m WHERE m.digitos = d) THEN RETURN original; END IF;
  RETURN pg_temp.cnpj_ficticio(original);
END
$f$;

-- IE fictícia: mesmos separadores e tamanho, dígitos estáveis; ISENTO e as dos
-- clientes de teste fiscal ficam. (O app só confere o tamanho; a SEFAZ confere
-- o dígito — por isso NF-e de teste vai para os clientes de teste fiscal.)
CREATE FUNCTION pg_temp.ie_dev(original text) RETURNS text
LANGUAGE plpgsql AS $f$
DECLARE r text := ''; c text; i int := 0;
BEGIN
  IF original IS NULL OR original !~ '[0-9]' OR original ~* 'isent' OR current_setting('sanitizacao.ja') = 'sim'
     OR EXISTS (SELECT 1 FROM pg_temp.ie_mantidas m WHERE m.ie = pg_temp.so_digitos(original)) THEN
    RETURN original;
  END IF;
  FOREACH c IN ARRAY regexp_split_to_array(original, '') LOOP
    IF c ~ '[0-9]' THEN
      i := i + 1;
      r := r || (pg_temp.num_de('ie:' || original || ':' || i, 10))::text;
    ELSE
      r := r || c;
    END IF;
  END LOOP;
  RETURN r;
END
$f$;

-- Chave de acesso com o CNPJ do emitente trocado e o dígito recalculado.
CREATE FUNCTION pg_temp.chave_com_cnpj(chave text, cnpj_novo text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $f$
DECLARE c text := pg_temp.so_digitos(chave); n text := pg_temp.so_digitos(cnpj_novo); s int := 0; p int := 2; i int; dv int;
BEGIN
  IF length(c) <> 44 OR length(n) <> 14 THEN RETURN chave; END IF;
  c := substr(c, 1, 6) || n || substr(c, 21, 23);
  FOR i IN REVERSE 43..1 LOOP
    s := s + substr(c, i, 1)::int * p;
    p := CASE WHEN p = 9 THEN 2 ELSE p + 1 END;
  END LOOP;
  dv := 11 - (s % 11); IF dv >= 10 THEN dv := 0; END IF;
  RETURN c || dv;
END
$f$;

-- Texto livre: nomes do dicionário -> fictícios; CNPJ (formatado, ou 14 dígitos
-- com DV válido) -> o do DEV; e-mail, telefone (só com parênteses ou "DD
-- espaço número", para não pegar decimais) e CPF formatado -> fictícios.
CREATE FUNCTION pg_temp.limpar_texto(t text) RETURNS text
LANGUAGE plpgsql AS $f$
DECLARE
  r text := t;
  n record;
  m text;
BEGIN
  IF r IS NULL OR r = '' THEN RETURN r; END IF;
  FOR n IN SELECT original, ficticio FROM pg_temp.nomes WHERE strpos(r, original) > 0 ORDER BY length(original) DESC LOOP
    r := replace(r, n.original, n.ficticio);
  END LOOP;
  FOR m IN SELECT DISTINCT x[1] FROM regexp_matches(r, '([0-9]{2}\.[0-9]{3}\.[0-9]{3}/[0-9]{4}-[0-9]{2})', 'g') x LOOP
    r := replace(r, m, pg_temp.cnpj_dev(m));
  END LOOP;
  FOR m IN SELECT DISTINCT x[1] FROM regexp_matches(r, '(?:^|[^0-9])([0-9]{14})(?![0-9])', 'g') x LOOP
    IF pg_temp.cnpj_valido(m) THEN r := replace(r, m, pg_temp.cnpj_dev(m)); END IF;
  END LOOP;
  r := regexp_replace(r, '[A-Za-z0-9._%+-]+@(?!exemplo\.invalid)[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}', 'email.removido@exemplo.invalid', 'g');
  r := regexp_replace(r, '\([1-9][0-9]\) ?9?[0-9]{4}-?[0-9]{4}', '(00) 00000-0000', 'g');
  r := regexp_replace(r, '\m[1-9][0-9] 9?[0-9]{4}-?[0-9]{4}\M', '(00) 00000-0000', 'g');
  r := regexp_replace(r, '\m[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}\M', '000.000.000-00', 'g');
  RETURN r;
END
$f$;

-- JSON: troca pelo nome da chave (e-mail, telefone, CPF/CNPJ/IE, nome de pessoa,
-- portador, perfil de rede social) e limpa os demais textos.
CREATE FUNCTION pg_temp.limpar_jsonb(j jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $f$
DECLARE
  r jsonb := '{}'::jsonb;
  k text; v jsonb; s text; dig int;
  pessoa boolean; rede boolean;
BEGIN
  IF j IS NULL THEN RETURN NULL; END IF;
  IF jsonb_typeof(j) = 'array' THEN
    RETURN coalesce((SELECT jsonb_agg(pg_temp.limpar_jsonb(e) ORDER BY n)
                       FROM jsonb_array_elements(j) WITH ORDINALITY AS a(e, n)), '[]'::jsonb);
  ELSIF jsonb_typeof(j) = 'string' THEN
    RETURN to_jsonb(pg_temp.limpar_texto(j #>> '{}'));
  ELSIF jsonb_typeof(j) <> 'object' THEN
    RETURN j;
  END IF;
  pessoa := (j ? 'cargo' OR j ? 'decisor' OR j ? 'telefone_celular' OR j ? 'telefone_fixo' OR j ? 'cpf')
            AND NOT (j ? 'razao_social' OR j ? 'nome_fantasia' OR j ? 'cnpj');
  rede := j ? 'rede' AND j ? 'valor';
  FOR k, v IN SELECT key, value FROM jsonb_each(j) LOOP
    IF jsonb_typeof(v) = 'string' THEN
      s := v #>> '{}';
      dig := length(pg_temp.so_digitos(s));
      IF k ~* '^(e_?mail|email_[a-z_]+|emails?)$' AND s ~ '@' THEN
        v := to_jsonb(pg_temp.email_ficticio(s));
      ELSIF k ~* '(telefone|celular|^fone|whats)' AND dig >= 8 THEN
        v := to_jsonb(pg_temp.telefone_ficticio(s));
      ELSIF k ~* '^cpf$' AND dig = 11 THEN
        v := to_jsonb(pg_temp.cpf_ficticio(s));
      ELSIF k ~* '^(documento|identidadePortador|numeroInscricao|emitente_documento|destinatario_documento|contrapartida_documento)$' AND dig = 11 THEN
        v := to_jsonb(pg_temp.cpf_ficticio(s));
      ELSIF k ~* '^(cnpj|documento|identidadePortador|numeroInscricao|emitente_documento|destinatario_documento|contrapartida_documento)$' AND dig = 14 THEN
        v := to_jsonb(pg_temp.cnpj_dev(s));
      ELSIF k ~* '^(inscricao_estadual|ie)$' THEN
        v := to_jsonb(pg_temp.ie_dev(s));
      ELSIF k = 'nomePortador' AND btrim(s) <> '' THEN
        v := to_jsonb('Portador de teste'::text);
      ELSIF k = 'nome' AND pessoa THEN
        v := to_jsonb(pg_temp.nome_ficticio(s));
      ELSIF k = 'valor' AND rede THEN
        v := to_jsonb(pg_temp.perfil_ficticio(s));
      ELSE
        v := to_jsonb(pg_temp.limpar_texto(s));
      END IF;
    ELSE
      v := pg_temp.limpar_jsonb(v);
    END IF;
    r := r || jsonb_build_object(k, v);
  END LOOP;
  RETURN r;
END
$f$;

-- Troca o conteúdo de uma tag em todo o texto, valor por valor.
CREATE FUNCTION pg_temp.trocar_tag(x text, tag text, funcao text) RETURNS text
LANGUAGE plpgsql AS $f$
DECLARE r text := x; v text; novo text;
BEGIN
  FOR v IN SELECT DISTINCT m[1] FROM regexp_matches(x, '<' || tag || '>([^<]*)</' || tag || '>', 'g') m LOOP
    EXECUTE format('SELECT %s($1)', funcao) INTO novo USING v;
    r := replace(r, '<' || tag || '>' || v || '</' || tag || '>', '<' || tag || '>' || coalesce(novo, '') || '</' || tag || '>');
  END LOOP;
  RETURN r;
END
$f$;

-- XML fiscal SINTÉTICO de teste: destinatário fictício (CNPJ/IE só ficam se
-- forem de cliente de teste fiscal), contato fictício, nomes do dicionário
-- trocados, assinatura removida e a marca de documento sintético no topo.
-- O emitente (a própria empresa) e a chave de acesso ficam.
CREATE FUNCTION pg_temp.xml_sintetico(x text) RETURNS text
LANGUAGE plpgsql AS $f$
DECLARE
  r text := x;
  dest text; novo text; n record; pf boolean;
  marca constant text := '<!-- DOCUMENTO SINTETICO DE TESTE (DEV VPS): destinatario e contatos ficticios, assinatura removida. SEM VALOR FISCAL. -->';
BEGIN
  IF r IS NULL OR r = '' THEN RETURN r; END IF;
  IF strpos(r, 'DOCUMENTO SINTETICO DE TESTE') > 0 THEN RETURN r; END IF;
  r := regexp_replace(r, '<Signature[ >].*?</Signature>', '', 'g');
  FOR dest IN SELECT DISTINCT m[1] FROM regexp_matches(r, '(<(?:dest|autXML|toma|tomador)>.*?</(?:dest|autXML|toma|tomador)>)', 'g') m LOOP
    pf := dest ~ '<CPF>';
    novo := pg_temp.trocar_tag(dest, 'CNPJ', 'pg_temp.cnpj_dev');
    novo := pg_temp.trocar_tag(novo, 'CPF', 'pg_temp.cpf_ficticio');
    novo := pg_temp.trocar_tag(novo, 'IE', 'pg_temp.ie_dev');
    novo := pg_temp.trocar_tag(novo, 'email', 'pg_temp.email_ficticio');
    novo := regexp_replace(novo, '<fone>[^<]*</fone>', '<fone>0000000000</fone>', 'g');
    IF pf THEN
      novo := regexp_replace(novo, '<xNome>[^<]*</xNome>', '<xNome>PESSOA FICTICIA DE TESTE</xNome>', 'g');
      novo := regexp_replace(novo, '<xLgr>[^<]*</xLgr>', '<xLgr>RUA DE TESTE</xLgr>', 'g');
      novo := regexp_replace(novo, '<nro>[^<]*</nro>', '<nro>0</nro>', 'g');
      novo := regexp_replace(novo, '<xCpl>[^<]*</xCpl>', '', 'g');
    END IF;
    r := replace(r, dest, novo);
  END LOOP;
  r := pg_temp.trocar_tag(r, 'email', 'pg_temp.email_ficticio');
  r := regexp_replace(r, '<fone>[^<]*</fone>', '<fone>0000000000</fone>', 'g');
  -- Fora do <dest> também (CC-e, retorno de evento, texto livre): todo CNPJ do
  -- documento passa pela troca (os da empresa e dos clientes de teste ficam).
  FOR dest IN SELECT DISTINCT m[1] FROM regexp_matches(r, '(?:^|[^0-9])([0-9]{14})(?![0-9])', 'g') m LOOP
    r := replace(r, '>' || dest || '<', '>' || pg_temp.cnpj_dev(dest) || '<');
  END LOOP;
  r := pg_temp.trocar_tag(r, 'CPF', 'pg_temp.cpf_ficticio');
  r := pg_temp.trocar_tag(r, 'CPFDest', 'pg_temp.cpf_ficticio');
  FOR n IN SELECT original, ficticio FROM pg_temp.nomes WHERE strpos(r, original) > 0 ORDER BY length(original) DESC LOOP
    r := replace(r, n.original, n.ficticio);
  END LOOP;
  FOR n IN SELECT original, upper(ficticio) AS ficticio FROM pg_temp.nomes WHERE strpos(r, upper(original)) > 0 ORDER BY length(original) DESC LOOP
    r := replace(r, upper(n.original), n.ficticio);
  END LOOP;
  r := regexp_replace(r, '[A-Za-z0-9._%+-]+@(?!exemplo\.invalid)[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}', 'nfe@exemplo.invalid', 'g');
  IF r ~ '^\s*<\?xml[^>]*\?>' THEN
    r := regexp_replace(r, '^(\s*<\?xml[^>]*\?>)', '\1' || marca);
  ELSE
    r := marca || r;
  END IF;
  RETURN r;
END
$f$;

-- Contraparte de transferência (PIX/TED/DOC/TEV/transferência): "<operação> - X"
-- vira "<operação> - Contraparte XXXXXX". O prefixo (que as regras de
-- classificação olham) fica.
CREATE FUNCTION pg_temp.contraparte(t text) RETURNS text
LANGUAGE plpgsql AS $f$
DECLARE p int;
BEGIN
  IF t IS NULL OR t !~* '^\s*(PIX|TED|DOC|TEV|TRANSF)' OR t ~ ' - Contraparte [0-9A-F]{6}$' THEN RETURN pg_temp.limpar_texto(t); END IF;
  p := strpos(t, ' - ');
  IF p = 0 THEN RETURN pg_temp.limpar_texto(t); END IF;
  RETURN substr(t, 1, p - 1) || ' - Contraparte ' || upper(substr(md5(lower(btrim(substr(t, p + 3)))), 1, 6));
END
$f$;

CREATE FUNCTION pg_temp.ofx_sintetico(x text) RETURNS text
LANGUAGE plpgsql AS $f$
DECLARE r text := x; v text;
BEGIN
  FOR v IN SELECT DISTINCT m[2] FROM regexp_matches(x, '<(MEMO|NAME)>([^<\r\n]*)', 'g') m LOOP
    r := replace(r, '>' || v, '>' || pg_temp.contraparte(v));
  END LOOP;
  RETURN r;
END
$f$;

-- PDF mínimo e válido (ASCII, xref certo) dizendo que o original saiu.
CREATE FUNCTION pg_temp.pdf_sintetico(rotulo text) RETURNS bytea
LANGUAGE plpgsql AS $f$
DECLARE
  txt text := regexp_replace(regexp_replace(coalesce(rotulo, ''), '[^ -~]', '', 'g'), '[()\\]', '', 'g');
  conteudo text;
  objs text[];
  pdf text := E'%PDF-1.4\n';
  offs int[] := '{}';
  i int; xref int;
BEGIN
  conteudo := 'BT /F1 16 Tf 50 780 Td (DOCUMENTO SINTETICO DE TESTE - DEV VPS) Tj 0 -26 Td /F1 11 Tf '
           || '(O arquivo original foi removido na sanitizacao do banco DEV.) Tj 0 -18 Td (' || txt || ') Tj ET';
  objs := ARRAY[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' || octet_length(conteudo) || E' >>\nstream\n' || conteudo || E'\nendstream'];
  FOR i IN 1..5 LOOP
    offs := offs || octet_length(pdf);
    pdf := pdf || i || E' 0 obj\n' || objs[i] || E'\nendobj\n';
  END LOOP;
  xref := octet_length(pdf);
  pdf := pdf || E'xref\n0 6\n0000000000 65535 f \n';
  FOR i IN 1..5 LOOP pdf := pdf || lpad(offs[i]::text, 10, '0') || E' 00000 n \n'; END LOOP;
  pdf := pdf || E'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' || xref || E'\n%%EOF\n';
  RETURN convert_to(pdf, 'UTF8');  -- só ASCII: os bytes são os do texto
END
$f$;

CREATE FUNCTION pg_temp.texto_do_arquivo(b bytea) RETURNS text
LANGUAGE plpgsql AS $f$
BEGIN
  RETURN convert_from(b, 'UTF8');
EXCEPTION WHEN OTHERS THEN
  RETURN convert_from(b, 'LATIN1');
END
$f$;

-- O que veio do gerador de dados simulados (já fictício; é o cenário de teste).
CREATE FUNCTION pg_temp.arquivo_simulado(arquivo integer) RETURNS boolean
LANGUAGE sql AS $f$
  SELECT EXISTS (SELECT 1 FROM contabil_arquivos a WHERE a.id = arquivo AND (a.nome_arquivo ~* 'simulad' OR a.descricao ~* 'simulad'))
      OR EXISTS (SELECT 1 FROM contabil_arquivo_vinculos v JOIN documentos_recebidos d ON v.alvo_tipo = 'documento_recebido' AND d.id::text = v.alvo_id
                  WHERE v.arquivo_id = arquivo AND d.observacao ~* 'simulad')
      OR EXISTS (SELECT 1 FROM contabil_arquivo_vinculos v JOIN titulos_pagar t ON v.alvo_tipo = 'titulo' AND t.id::text = v.alvo_id
                  WHERE v.arquivo_id = arquivo AND t.observacao ~* 'simulad')
      OR EXISTS (SELECT 1 FROM extrato_importacoes i JOIN contas_financeiras c ON c.id = i.conta_id
                  WHERE i.arquivo_id = arquivo AND (c.nome ~* 'simulad' OR c.observacao ~* 'simulad'))
$f$;

-- Retrato das linhas de cada tabela, para conferir no fim.
DO $retrato$
DECLARE t record; n bigint;
BEGIN
  FOR t IN SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE c.relkind = 'r' AND n.nspname IN ('public', 'rbac') LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I', t.nspname, t.relname) INTO n;
    INSERT INTO contagem_antes VALUES (t.nspname || '.' || t.relname, n);
  END LOOP;
END
$retrato$;

-- CNPJs que ficam reais: a própria empresa e os clientes de teste fiscal (os que
-- têm NF-e de homologação emitida pelo app).
INSERT INTO cnpj_mantidos (digitos, motivo)
SELECT DISTINCT pg_temp.so_digitos(cnpj), 'empresa (emitente)' FROM configuracao_fiscal WHERE cnpj IS NOT NULL
UNION SELECT DISTINCT pg_temp.so_digitos(beneficiario_cnpj), 'empresa (beneficiário BB)' FROM configuracao_cobranca WHERE beneficiario_cnpj IS NOT NULL
ON CONFLICT DO NOTHING;
INSERT INTO cnpj_mantidos (digitos, motivo)
SELECT DISTINCT pg_temp.so_digitos(c.cnpj), 'cliente de teste fiscal' FROM clientes c
 WHERE c.id IN (SELECT p.cliente_id FROM notas_fiscais n JOIN pedidos p ON p.id = n.pedido_id) AND length(pg_temp.so_digitos(c.cnpj)) = 14
ON CONFLICT DO NOTHING;
INSERT INTO ie_mantidas (ie)
SELECT DISTINCT pg_temp.so_digitos(inscricao_estadual) FROM configuracao_fiscal WHERE inscricao_estadual ~ '[0-9]'
UNION SELECT DISTINCT pg_temp.so_digitos(c.inscricao_estadual) FROM clientes c
 WHERE pg_temp.so_digitos(c.cnpj) IN (SELECT digitos FROM cnpj_mantidos) AND c.inscricao_estadual ~ '[0-9]'
ON CONFLICT DO NOTHING;
INSERT INTO efeitos (bloco, item, linhas) SELECT 'B', 'CNPJs mantidos reais (empresa + clientes de teste fiscal)', count(*) FROM cnpj_mantidos;

-- Os CNPJs que vão ser trocados (para conferir no fim que não sobrou nenhum).
INSERT INTO cnpj_trocados (digitos)
SELECT d FROM (
  SELECT pg_temp.so_digitos(cnpj) AS d FROM clientes
  UNION SELECT pg_temp.so_digitos(cnpj) FROM prospeccoes
  UNION SELECT pg_temp.so_digitos(cnpj) FROM contatos WHERE coalesce(anotacoes, '') !~* 'simulad'
  UNION SELECT pg_temp.so_digitos(destinatario_documento) FROM notas_fiscais_externas
  UNION SELECT pg_temp.so_digitos(pagador ->> 'documento') FROM boletos
) x WHERE length(d) = 14 AND d NOT IN (SELECT digitos FROM cnpj_mantidos) AND current_setting('sanitizacao.ja') = 'nao'
ON CONFLICT DO NOTHING;

-- Provável MEI / pessoa: razão social sem nenhuma palavra de empresa (fora os
-- clientes de teste fiscal).
INSERT INTO prov_mei (tabela, id)
SELECT 'clientes', id FROM clientes
 WHERE coalesce(razao_social, '') <> '' AND pg_temp.so_digitos(cnpj) NOT IN (SELECT digitos FROM cnpj_mantidos)
   AND razao_social !~* '(LTDA|S\.?A\.?|EIRELI|EPP|\mME\M|MEI|COM[EÉ]RCIO|IND[UÚ]STRIA|SERVI[CÇ]OS|DECORA|ARQUITETURA|CONSTRU|M[OÓ]VEIS|COMPANY|GROUP|STUDIO|ESTUDIO|DESIGN|PROJETOS|ENGENHARIA|EMPREEND|INCORPORA|HOTEL|RESTAURANTE|LOJA|CASA|ATELI)'
UNION ALL
SELECT 'prospeccoes', id FROM prospeccoes
 WHERE coalesce(razao_social, '') <> ''
   AND razao_social !~* '(LTDA|S\.?A\.?|EIRELI|EPP|\mME\M|MEI|COM[EÉ]RCIO|IND[UÚ]STRIA|SERVI[CÇ]OS|DECORA|ARQUITETURA|CONSTRU|M[OÓ]VEIS|COMPANY|GROUP|STUDIO|ESTUDIO|DESIGN|PROJETOS|ENGENHARIA|EMPREEND|INCORPORA|HOTEL|RESTAURANTE|LOJA|CASA|ATELI)';
INSERT INTO efeitos (bloco, item, linhas) SELECT 'B', 'prováveis MEI/pessoa (razão social sem palavra de empresa)', count(*) FROM prov_mei;

-- Dicionário de nomes a trocar em todo o banco (2+ palavras): pessoas dos
-- contatos (menos os do gerador de simulados), pessoas que só restam no
-- histórico, e as razões sociais de prováveis MEI.
INSERT INTO nomes (original, ficticio)
SELECT DISTINCT btrim(nome), pg_temp.nome_ficticio(nome)
  FROM (SELECT nome FROM contatos_cliente
        UNION ALL SELECT nome FROM prospeccao_contatos
        UNION ALL SELECT nome FROM contatos WHERE (tipo_pessoa = 'PF' OR cpf IS NOT NULL) AND coalesce(anotacoes, '') !~* 'simulad') p
 WHERE nome IS NOT NULL AND btrim(nome) ~ '\S+\s+\S+' AND length(btrim(nome)) >= 6 AND btrim(nome) !~ '^(Pessoa|Empresa) [0-9A-F]{6}$'
ON CONFLICT DO NOTHING;
INSERT INTO nomes (original, ficticio)
SELECT DISTINCT btrim(n), pg_temp.nome_ficticio(n)
  FROM (SELECT substr(entidade, 9) AS n FROM prospeccao_historico WHERE entidade ~ '^Contato \S+\s+\S+'
        UNION ALL SELECT substr(entidade, 9) FROM cliente_historico WHERE entidade ~ '^Contato \S+\s+\S+'
        UNION ALL SELECT o ->> 'nome' FROM prospeccao_historico,
                         jsonb_path_query(detalhe, 'lax $.** ? (@.type() == "object")') AS o
                   WHERE (o ? 'cargo' OR o ? 'decisor' OR o ? 'telefone_celular' OR o ? 'telefone_fixo')
                     AND NOT (o ? 'razao_social' OR o ? 'nome_fantasia' OR o ? 'cnpj')) h
 WHERE n IS NOT NULL AND btrim(n) ~ '\S+\s+\S+' AND length(btrim(n)) >= 6 AND btrim(n) !~ '^(Pessoa|Empresa) [0-9A-F]{6}$'
ON CONFLICT DO NOTHING;
INSERT INTO nomes (original, ficticio)
SELECT DISTINCT btrim(v), pg_temp.empresa_ficticia(v)
  FROM (SELECT c.razao_social AS v FROM clientes c JOIN prov_mei m ON m.tabela = 'clientes' AND m.id = c.id
        UNION ALL SELECT c.nome_fantasia FROM clientes c JOIN prov_mei m ON m.tabela = 'clientes' AND m.id = c.id
        UNION ALL SELECT p.razao_social FROM prospeccoes p JOIN prov_mei m ON m.tabela = 'prospeccoes' AND m.id = p.id
        UNION ALL SELECT p.nome_fantasia FROM prospeccoes p JOIN prov_mei m ON m.tabela = 'prospeccoes' AND m.id = p.id) x
 WHERE v IS NOT NULL AND btrim(v) ~ '\S+\s+\S+' AND length(btrim(v)) >= 6 AND btrim(v) !~ '^(Pessoa|Empresa) [0-9A-F]{6}$'
ON CONFLICT DO NOTHING;
INSERT INTO efeitos (bloco, item, linhas) SELECT 'B', 'dicionário de nomes completos a trocar (pessoas e prováveis MEI)', count(*) FROM nomes;

-- =============================================================================
-- BLOCO A — Banco do Brasil, NF-e e integrações
-- =============================================================================
WITH u AS (
  UPDATE configuracao_cobranca
     SET ambiente = 'sandbox',
         client_id_producao = NULL, app_key_producao = NULL,
         client_id_sandbox = NULL, app_key_sandbox = NULL,
         conciliacao_automatica = false,
         gerar_ao_emitir_nfe = false
   WHERE ambiente IS DISTINCT FROM 'sandbox'
      OR client_id_producao IS NOT NULL OR app_key_producao IS NOT NULL
      OR client_id_sandbox IS NOT NULL OR app_key_sandbox IS NOT NULL
      OR conciliacao_automatica OR gerar_ao_emitir_nfe
  RETURNING 1)
INSERT INTO efeitos (bloco, item, linhas) SELECT 'A', 'cobrança BB: sandbox, sem client_id/app_key (produção e homologação), conciliação e boleto automático desligados', count(*) FROM u;

WITH u AS (DELETE FROM segredos_app RETURNING 1)
INSERT INTO efeitos (bloco, item, linhas) SELECT 'A', 'segredos cifrados apagados (client secret BB produção e homologação)', count(*) FROM u;

WITH u AS (
  UPDATE configuracao_fiscal
     SET ambiente = 'homologacao',
         smtp_host = NULL, smtp_usuario = NULL, smtp_remetente = NULL, smtp_nome_remetente = NULL, email_copia = NULL,
         email = pg_temp.email_ficticio(email), telefone = pg_temp.telefone_ficticio(telefone),
         resp_tec_email = pg_temp.email_ficticio(resp_tec_email), resp_tec_fone = pg_temp.telefone_ficticio(resp_tec_fone)
   WHERE ambiente IS DISTINCT FROM 'homologacao' OR smtp_host IS NOT NULL OR smtp_usuario IS NOT NULL
      OR smtp_remetente IS NOT NULL OR email_copia IS NOT NULL
      OR email IS DISTINCT FROM pg_temp.email_ficticio(email) OR telefone IS DISTINCT FROM pg_temp.telefone_ficticio(telefone)
      OR resp_tec_email IS DISTINCT FROM pg_temp.email_ficticio(resp_tec_email)
  RETURNING 1)
INSERT INTO efeitos (bloco, item, linhas) SELECT 'A', 'NF-e: homologação, SMTP vazio, e-mail/telefone do emitente fictícios (CNPJ/IE da empresa ficam)', count(*) FROM u;

WITH u AS (
  UPDATE contabil_integracoes SET ativa = false, automatica = false, ambiente = 'homologacao', proxima_consulta_apos = NULL
   WHERE ativa OR automatica OR ambiente IS DISTINCT FROM 'homologacao' OR proxima_consulta_apos IS NOT NULL
  RETURNING 1)
INSERT INTO efeitos (bloco, item, linhas) SELECT 'A', 'integrações contábeis (BB DDA/extrato/investimentos, SEFAZ, NFS-e) inativas e em homologação', count(*) FROM u;

-- =============================================================================
-- BLOCO B — Dados pessoais e CNPJ
-- =============================================================================
WITH u AS (
  UPDATE contatos_cliente
     SET nome = pg_temp.nome_ficticio(nome), email = pg_temp.email_ficticio(email),
         telefone_celular = pg_temp.telefone_ficticio(telefone_celular), telefone_fixo = pg_temp.telefone_ficticio(telefone_fixo)
   WHERE nome IS DISTINCT FROM pg_temp.nome_ficticio(nome) OR email IS DISTINCT FROM pg_temp.email_ficticio(email)
      OR telefone_celular IS DISTINCT FROM pg_temp.telefone_ficticio(telefone_celular)
      OR telefone_fixo IS DISTINCT FROM pg_temp.telefone_ficticio(telefone_fixo)
  RETURNING 1)
INSERT INTO efeitos (bloco, item, linhas) SELECT 'B', 'contatos de clientes: nome, e-mail, celular, fixo', count(*) FROM u;

WITH u AS (
  UPDATE prospeccao_contatos
     SET nome = pg_temp.nome_ficticio(nome), email = pg_temp.email_ficticio(email),
         telefone_celular = pg_temp.telefone_ficticio(telefone_celular), telefone_fixo = pg_temp.telefone_ficticio(telefone_fixo),
         observacao = pg_temp.limpar_texto(observacao)
   WHERE nome IS DISTINCT FROM pg_temp.nome_ficticio(nome) OR email IS DISTINCT FROM pg_temp.email_ficticio(email)
      OR telefone_celular IS DISTINCT FROM pg_temp.telefone_ficticio(telefone_celular)
      OR telefone_fixo IS DISTINCT FROM pg_temp.telefone_ficticio(telefone_fixo)
      OR observacao IS DISTINCT FROM pg_temp.limpar_texto(observacao)
  RETURNING 1)
INSERT INTO efeitos (bloco, item, linhas) SELECT 'B', 'contatos de prospecções: nome, e-mail, telefones, observação', count(*) FROM u;

-- Contatos (terceiros) — os do gerador de simulados ficam (são o cenário da Contabilidade).
WITH u AS (
  UPDATE contatos
     SET email = pg_temp.email_ficticio(email),
         telefone_celular = pg_temp.telefone_ficticio(telefone_celular), telefone_fixo = pg_temp.telefone_ficticio(telefone_fixo),
         cpf = pg_temp.cpf_ficticio(cpf),
         cnpj = pg_temp.cnpj_dev(cnpj),
         inscricao_estadual = pg_temp.ie_dev(inscricao_estadual),
         anotacoes = pg_temp.limpar_texto(anotacoes),
         nome = CASE WHEN tipo_pessoa = 'PF' OR cpf IS NOT NULL THEN pg_temp.nome_ficticio(nome) ELSE pg_temp.limpar_texto(nome) END,
         razao_social = CASE WHEN tipo_pessoa = 'PF' OR cpf IS NOT NULL THEN pg_temp.nome_ficticio(razao_social) ELSE pg_temp.limpar_texto(razao_social) END,
         end_logradouro = CASE WHEN (tipo_pessoa = 'PF' OR cpf IS NOT NULL) AND end_logradouro IS NOT NULL THEN 'Rua de Teste' ELSE end_logradouro END,
         end_numero = CASE WHEN (tipo_pessoa = 'PF' OR cpf IS NOT NULL) AND end_numero IS NOT NULL THEN id::text ELSE end_numero END,
         end_complemento = CASE WHEN tipo_pessoa = 'PF' OR cpf IS NOT NULL THEN NULL ELSE end_complemento END
   WHERE coalesce(anotacoes, '') !~* 'simulad'
  RETURNING 1)
INSERT INTO efeitos (bloco, item, linhas) SELECT 'B', 'contatos de terceiros reais (os simulados ficam): contato, CPF/CNPJ/IE, PF com nome e rua fictícios', count(*) FROM u;
-- Nos simulados, só o canal de contato: o gerador usou financeiro@exemplo.com
-- (domínio que existe) e (31) 3333-0000. Nome e CNPJ ficam (são o cenário).
WITH u AS (
  UPDATE contatos
     SET email = pg_temp.email_ficticio(email),
         telefone_celular = pg_temp.telefone_ficticio(telefone_celular), telefone_fixo = pg_temp.telefone_ficticio(telefone_fixo)
   WHERE coalesce(anotacoes, '') ~* 'simulad'
     AND (email IS DISTINCT FROM pg_temp.email_ficticio(email)
          OR telefone_celular IS DISTINCT FROM pg_temp.telefone_ficticio(telefone_celular)
          OR telefone_fixo IS DISTINCT FROM pg_temp.telefone_ficticio(telefone_fixo))
  RETURNING 1)
INSERT INTO efeitos (bloco, item, linhas) SELECT 'B', 'contatos simulados: só e-mail e telefone fictícios (nome e CNPJ do cenário ficam)', count(*) FROM u;

-- Clientes: CNPJ/IE fictícios (menos os de teste fiscal); provável MEI com nome e rua fictícios.
WITH novo AS (
  SELECT c.id,
         pg_temp.cnpj_dev(c.cnpj) AS cnpj,
         CASE WHEN pg_temp.so_digitos(c.cnpj) IN (SELECT digitos FROM cnpj_mantidos) THEN c.inscricao_estadual ELSE pg_temp.ie_dev(c.inscricao_estadual) END AS inscricao_estadual,
         pg_temp.email_ficticio(c.email_nfe) AS email_nfe, pg_temp.cpf_ficticio(c.cpf) AS cpf,
         pg_temp.limpar_texto(c.anotacoes) AS anotacoes, pg_temp.limpar_jsonb(c.redes_sociais) AS redes_sociais,
         CASE WHEN m.id IS NOT NULL THEN pg_temp.empresa_ficticia(c.razao_social) ELSE pg_temp.limpar_texto(c.razao_social) END AS razao_social,
         CASE WHEN m.id IS NOT NULL THEN pg_temp.empresa_ficticia(coalesce(c.nome_fantasia, c.razao_social)) ELSE pg_temp.limpar_texto(c.nome_fantasia) END AS nome_fantasia,
         CASE WHEN m.id IS NOT NULL THEN NULL ELSE c.site END AS site,
         CASE WHEN m.id IS NOT NULL AND c.reg_logradouro IS NOT NULL THEN 'Rua de Teste' ELSE c.reg_logradouro END AS reg_logradouro,
         CASE WHEN m.id IS NOT NULL AND c.reg_numero IS NOT NULL THEN c.id::text ELSE c.reg_numero END AS reg_numero,
         CASE WHEN m.id IS NOT NULL THEN NULL ELSE c.reg_complemento END AS reg_complemento,
         CASE WHEN m.id IS NOT NULL AND c.cob_logradouro IS NOT NULL THEN 'Rua de Teste' ELSE c.cob_logradouro END AS cob_logradouro,
         CASE WHEN m.id IS NOT NULL AND c.cob_numero IS NOT NULL THEN c.id::text ELSE c.cob_numero END AS cob_numero,
         CASE WHEN m.id IS NOT NULL THEN NULL ELSE c.cob_complemento END AS cob_complemento,
         CASE WHEN m.id IS NOT NULL AND c.ent_logradouro IS NOT NULL THEN 'Rua de Teste' ELSE c.ent_logradouro END AS ent_logradouro,
         CASE WHEN m.id IS NOT NULL AND c.ent_numero IS NOT NULL THEN c.id::text ELSE c.ent_numero END AS ent_numero,
         CASE WHEN m.id IS NOT NULL THEN NULL ELSE c.ent_complemento END AS ent_complemento
    FROM clientes c LEFT JOIN prov_mei m ON m.tabela = 'clientes' AND m.id = c.id
), u AS (
  UPDATE clientes c
     SET cnpj = n.cnpj, inscricao_estadual = n.inscricao_estadual, email_nfe = n.email_nfe, cpf = n.cpf,
         anotacoes = n.anotacoes, redes_sociais = n.redes_sociais, razao_social = n.razao_social, nome_fantasia = n.nome_fantasia,
         site = n.site, reg_logradouro = n.reg_logradouro, reg_numero = n.reg_numero, reg_complemento = n.reg_complemento,
         cob_logradouro = n.cob_logradouro, cob_numero = n.cob_numero, cob_complemento = n.cob_complemento,
         ent_logradouro = n.ent_logradouro, ent_numero = n.ent_numero, ent_complemento = n.ent_complemento
    FROM novo n
   WHERE n.id = c.id
     AND (c.cnpj, c.inscricao_estadual, c.email_nfe, c.cpf, c.anotacoes, c.redes_sociais, c.razao_social, c.nome_fantasia, c.site,
          c.reg_logradouro, c.reg_numero, c.reg_complemento, c.cob_logradouro, c.cob_numero, c.cob_complemento,
          c.ent_logradouro, c.ent_numero, c.ent_complemento)
         IS DISTINCT FROM
         (n.cnpj, n.inscricao_estadual, n.email_nfe, n.cpf, n.anotacoes, n.redes_sociais, n.razao_social, n.nome_fantasia, n.site,
          n.reg_logradouro, n.reg_numero, n.reg_complemento, n.cob_logradouro, n.cob_numero, n.cob_complemento,
          n.ent_logradouro, n.ent_numero, n.ent_complemento)
  RETURNING 1)
INSERT INTO efeitos (bloco, item, linhas) SELECT 'B', 'clientes: CNPJ/IE fictícios (menos os de teste fiscal), e-mail NF-e, anotações; provável MEI com nome e rua fictícios', count(*) FROM u;

WITH novo AS (
  SELECT p.id,
         pg_temp.cnpj_dev(p.cnpj) AS cnpj, pg_temp.ie_dev(p.inscricao_estadual) AS inscricao_estadual,
         pg_temp.limpar_texto(p.anotacoes) AS anotacoes, pg_temp.limpar_texto(p.motivo_perda) AS motivo_perda,
         pg_temp.limpar_texto(p.proximo_passo) AS proximo_passo, pg_temp.limpar_jsonb(p.redes_sociais) AS redes_sociais,
         CASE WHEN m.id IS NOT NULL THEN pg_temp.empresa_ficticia(p.razao_social) ELSE pg_temp.limpar_texto(p.razao_social) END AS razao_social,
         CASE WHEN m.id IS NOT NULL THEN pg_temp.empresa_ficticia(p.nome_fantasia) ELSE pg_temp.limpar_texto(p.nome_fantasia) END AS nome_fantasia,
         CASE WHEN m.id IS NOT NULL THEN NULL ELSE p.site END AS site,
         CASE WHEN m.id IS NOT NULL AND p.end_logradouro IS NOT NULL THEN 'Rua de Teste' ELSE p.end_logradouro END AS end_logradouro,
         CASE WHEN m.id IS NOT NULL AND p.end_numero IS NOT NULL THEN p.id::text ELSE p.end_numero END AS end_numero,
         CASE WHEN m.id IS NOT NULL THEN NULL ELSE p.end_complemento END AS end_complemento
    FROM prospeccoes p LEFT JOIN prov_mei m ON m.tabela = 'prospeccoes' AND m.id = p.id
), u AS (
  UPDATE prospeccoes p
     SET cnpj = n.cnpj, inscricao_estadual = n.inscricao_estadual, anotacoes = n.anotacoes, motivo_perda = n.motivo_perda,
         proximo_passo = n.proximo_passo, redes_sociais = n.redes_sociais, razao_social = n.razao_social, nome_fantasia = n.nome_fantasia,
         site = n.site, end_logradouro = n.end_logradouro, end_numero = n.end_numero, end_complemento = n.end_complemento
    FROM novo n
   WHERE n.id = p.id
     AND (p.cnpj, p.inscricao_estadual, p.anotacoes, p.motivo_perda, p.proximo_passo, p.redes_sociais, p.razao_social, p.nome_fantasia,
          p.site, p.end_logradouro, p.end_numero, p.end_complemento)
         IS DISTINCT FROM
         (n.cnpj, n.inscricao_estadual, n.anotacoes, n.motivo_perda, n.proximo_passo, n.redes_sociais, n.razao_social, n.nome_fantasia,
          n.site, n.end_logradouro, n.end_numero, n.end_complemento)
  RETURNING 1)
INSERT INTO efeitos (bloco, item, linhas) SELECT 'B', 'prospecções: CNPJ/IE fictícios, anotações, redes; provável MEI com nome e rua fictícios', count(*) FROM u;

WITH u AS (
  UPDATE prospeccao_historico
     SET entidade = pg_temp.limpar_texto(entidade), valor_anterior = pg_temp.limpar_texto(valor_anterior),
         valor_novo = pg_temp.limpar_texto(valor_novo), observacao = pg_temp.limpar_texto(observacao),
         detalhe = pg_temp.limpar_jsonb(detalhe)
   WHERE entidade IS DISTINCT FROM pg_temp.limpar_texto(entidade) OR valor_anterior IS DISTINCT FROM pg_temp.limpar_texto(valor_anterior)
      OR valor_novo IS DISTINCT FROM pg_temp.limpar_texto(valor_novo) OR observacao IS DISTINCT FROM pg_temp.limpar_texto(observacao)
      OR detalhe IS DISTINCT FROM pg_temp.limpar_jsonb(detalhe)
  RETURNING 1)
INSERT INTO efeitos (bloco, item, linhas) SELECT 'B', 'histórico das prospecções: rótulos, valores antes/depois, observação, detalhe (JSON)', count(*) FROM u;

-- Textos narrativos (só os que não são do gerador de simulados).
DO $narrativos$
DECLARE
  alvo record; n bigint;
BEGIN
  FOR alvo IN SELECT * FROM (VALUES
      ('prospeccao_interacoes', 'detalhe', 'true'), ('prospeccao_interacoes', 'resumo', 'true'),
      ('prospeccao_etapas_historico', 'observacao', 'true'), ('prospeccao_notas', 'conteudo', 'true'), ('prospeccao_notas', 'titulo', 'true'),
      ('prospeccao_campanhas', 'observacao', 'true'),
      ('cliente_historico', 'entidade', 'true'), ('cliente_historico', 'valor_anterior', 'true'), ('cliente_historico', 'valor_novo', 'true'), ('cliente_historico', 'observacao', 'true'),
      ('tarefa_historico', 'entidade', 'true'), ('tarefa_historico', 'valor_anterior', 'true'), ('tarefa_historico', 'valor_novo', 'true'), ('tarefa_historico', 'observacao', 'true'),
      ('tarefas', 'titulo', 'true'), ('tarefas', 'descricao', 'true'), ('tarefas', 'resultado_nota', 'true'), ('tarefas', 'local', 'true'), ('tarefa_checklist', 'texto', 'true'),
      ('historico_comentarios', 'texto', 'true'), ('notificacoes', 'titulo', 'true'), ('notificacoes', 'mensagem', 'true'),
      ('pedido_historico_eventos', 'descricao', 'true'), ('financeiro_eventos', 'descricao', 'true'), ('financeiro_eventos', 'dados', 'true'),
      ('orcamentos', 'observacoes', 'true'), ('pedidos', 'observacoes', 'true'), ('pedidos', 'ajuste_historico', 'true'),
      ('documentos_recebidos', 'observacao', 'coalesce(observacao, '''') !~* ''simulad'''),
      ('documentos_recebidos', 'descricao', 'coalesce(observacao, '''') !~* ''simulad'''),
      ('documentos_recebidos', 'emitente_nome', 'coalesce(observacao, '''') !~* ''simulad'''),
      ('titulos_pagar', 'observacao', 'coalesce(observacao, '''') !~* ''simulad'''),
      ('titulos_pagar', 'descricao', 'coalesce(observacao, '''') !~* ''simulad'''),
      ('contabil_eventos', 'descricao', 'true'),
      ('boletos_eventos', 'mensagem', 'true'), ('boletos', 'observacao_baixa', 'true'),
      ('ia_extracao_arquivos', 'texto', 'true'), ('ia_extracao_arquivos', 'texto_ajustado', 'true'), ('ia_extracao_arquivos', 'nome_arquivo', 'true'),
      ('ia_extracao_itens', 'dados', 'true'), ('ia_extracao_itens', 'mensagem', 'true'),
      ('contabil_pacotes', 'envio_observacao', 'true'),
      ('contabil_arquivos', 'nome_arquivo', 'NOT pg_temp.arquivo_simulado(id)'), ('contabil_arquivos', 'descricao', 'NOT pg_temp.arquivo_simulado(id)'),
      ('extrato_importacoes', 'nome_arquivo', 'arquivo_id IS NULL OR NOT pg_temp.arquivo_simulado(arquivo_id)'),
      ('extrato_importacoes', 'observacao', 'arquivo_id IS NULL OR NOT pg_temp.arquivo_simulado(arquivo_id)'),
      ('transportadoras', 'transportadora', 'true')
    ) AS v(tabela, coluna, filtro)
  LOOP
    EXECUTE format('UPDATE public.%I SET %I = pg_temp.limpar_texto(%I) WHERE (%s) AND %I IS DISTINCT FROM pg_temp.limpar_texto(%I)',
                   alvo.tabela, alvo.coluna, alvo.coluna, alvo.filtro, alvo.coluna, alvo.coluna);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      INSERT INTO efeitos (bloco, item, linhas) VALUES ('B', 'texto livre ' || alvo.tabela || '.' || alvo.coluna, n);
    END IF;
  END LOOP;
END
$narrativos$;

-- JSON com dados de pessoa ou CNPJ: pagador e portador dos boletos (e o que foi
-- enviado ao BB), destinatário da NF-e, detalhes de históricos e eventos.
DO $jsons$
DECLARE
  alvo record; n bigint;
BEGIN
  FOR alvo IN SELECT * FROM (VALUES
      ('boletos', 'pagador'), ('boletos', 'requisicao'), ('boletos', 'resposta'), ('boletos_eventos', 'payload'),
      ('notas_fiscais', 'destinatario'), ('cliente_historico', 'detalhe'), ('tarefa_historico', 'detalhe'),
      ('cobranca_execucoes', 'resultado'), ('contabil_eventos', 'dados')
    ) AS v(tabela, coluna)
  LOOP
    EXECUTE format('UPDATE public.%I SET %I = pg_temp.limpar_jsonb(%I) WHERE %I IS DISTINCT FROM pg_temp.limpar_jsonb(%I)',
                   alvo.tabela, alvo.coluna, alvo.coluna, alvo.coluna, alvo.coluna);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      INSERT INTO efeitos (bloco, item, linhas) VALUES ('B', 'JSON ' || alvo.tabela || '.' || alvo.coluna, n);
    END IF;
  END LOOP;
END
$jsons$;

-- Documentos recebidos reais (os simulados ficam): CPF/CNPJ do emitente e a chave de acesso.
WITH u AS (
  UPDATE documentos_recebidos
     SET emitente_documento = CASE WHEN length(pg_temp.so_digitos(emitente_documento)) = 11 THEN pg_temp.cpf_ficticio(emitente_documento)
                                   ELSE pg_temp.cnpj_dev(emitente_documento) END,
         chave_acesso = CASE WHEN length(pg_temp.so_digitos(emitente_documento)) = 14 AND chave_acesso IS NOT NULL
                             THEN pg_temp.chave_com_cnpj(chave_acesso, pg_temp.cnpj_dev(emitente_documento)) ELSE chave_acesso END,
         itens = pg_temp.limpar_jsonb(itens)
   WHERE coalesce(observacao, '') !~* 'simulad'
     AND (emitente_documento IS DISTINCT FROM CASE WHEN length(pg_temp.so_digitos(emitente_documento)) = 11 THEN pg_temp.cpf_ficticio(emitente_documento)
                                                   ELSE pg_temp.cnpj_dev(emitente_documento) END
          OR itens IS DISTINCT FROM pg_temp.limpar_jsonb(itens))
  RETURNING 1)
INSERT INTO efeitos (bloco, item, linhas) SELECT 'B', 'documentos recebidos reais: CPF/CNPJ do emitente e chave de acesso', count(*) FROM u;

-- XML fiscais -> SINTÉTICOS de teste (sem assinatura, destinatário fictício, marca no topo).
WITH u AS (
  UPDATE notas_fiscais
     SET xml_envio = pg_temp.xml_sintetico(xml_envio), xml_autorizado = pg_temp.xml_sintetico(xml_autorizado),
         xml_cancelamento = pg_temp.xml_sintetico(xml_cancelamento)
   WHERE xml_envio IS DISTINCT FROM pg_temp.xml_sintetico(xml_envio) OR xml_autorizado IS DISTINCT FROM pg_temp.xml_sintetico(xml_autorizado)
      OR xml_cancelamento IS DISTINCT FROM pg_temp.xml_sintetico(xml_cancelamento)
  RETURNING 1)
INSERT INTO efeitos (bloco, item, linhas) SELECT 'B', 'NF-e do app: XML sintéticos de teste (sem assinatura, contato fictício; clientes de teste fiscal mantidos)', count(*) FROM u;
WITH u AS (
  UPDATE notas_fiscais_externas
     SET xml = pg_temp.xml_sintetico(xml),
         destinatario_documento = pg_temp.cnpj_dev(destinatario_documento),
         emitente_nome = pg_temp.limpar_texto(emitente_nome),
         observacao = left(trim(both ' ' FROM coalesce(observacao, '') || ' [DEV VPS] XML sintético de teste: destinatário fictício, assinatura removida.'), 300)
   WHERE coalesce(observacao, '') !~ '\[DEV VPS\]'
  RETURNING 1)
INSERT INTO efeitos (bloco, item, linhas) SELECT 'B', 'NF-e de fora: XML sintético de teste, destinatário com CNPJ fictício', count(*) FROM u;
WITH u AS (UPDATE notas_fiscais_externas_eventos SET xml = pg_temp.xml_sintetico(xml), correcao = pg_temp.limpar_texto(correcao)
            WHERE xml IS DISTINCT FROM pg_temp.xml_sintetico(xml) OR correcao IS DISTINCT FROM pg_temp.limpar_texto(correcao) RETURNING 1)
INSERT INTO efeitos (bloco, item, linhas) SELECT 'B', 'eventos (CC-e) das NF-e de fora: XML sintético de teste', count(*) FROM u;

-- Lançamentos bancários reais (fora da conta simulada): a contraparte das transferências.
WITH u AS (
  UPDATE movimentos_bancarios m
     SET descricao = pg_temp.contraparte(m.descricao),
         contrapartida_documento = CASE WHEN length(pg_temp.so_digitos(m.contrapartida_documento)) = 11 THEN pg_temp.cpf_ficticio(m.contrapartida_documento)
                                        ELSE pg_temp.cnpj_dev(m.contrapartida_documento) END,
         conciliacao_observacao = pg_temp.limpar_texto(m.conciliacao_observacao)
    FROM contas_financeiras c
   WHERE c.id = m.conta_id AND NOT (coalesce(c.nome, '') ~* 'simulad' OR coalesce(c.observacao, '') ~* 'simulad')
     AND (m.descricao IS DISTINCT FROM pg_temp.contraparte(m.descricao)
          OR m.contrapartida_documento IS DISTINCT FROM CASE WHEN length(pg_temp.so_digitos(m.contrapartida_documento)) = 11
                                                             THEN pg_temp.cpf_ficticio(m.contrapartida_documento)
                                                             ELSE pg_temp.cnpj_dev(m.contrapartida_documento) END
          OR m.conciliacao_observacao IS DISTINCT FROM pg_temp.limpar_texto(m.conciliacao_observacao))
  RETURNING 1)
INSERT INTO efeitos (bloco, item, linhas) SELECT 'B', 'lançamentos bancários reais: contraparte das transferências (os da conta simulada ficam)', count(*) FROM u;

-- Arquivos da Contabilidade reais (os do gerador de simulados ficam): OFX com a
-- contraparte trocada, XML sintético, PDF trocado por um PDF sintético de teste;
-- SHA-256, tamanho e partes recalculados.
DO $arquivos$
DECLARE
  a record; bruto bytea; novo bytea; n bigint := 0;
BEGIN
  FOR a IN SELECT id, tipo_mime, nome_arquivo FROM contabil_arquivos WHERE NOT pg_temp.arquivo_simulado(id) ORDER BY id LOOP
    SELECT string_agg(decode(dados, 'base64'), ''::bytea ORDER BY ordem) INTO bruto FROM contabil_arquivo_partes WHERE arquivo_id = a.id;
    IF bruto IS NULL THEN CONTINUE; END IF;
    IF a.tipo_mime ~* 'ofx' THEN
      novo := convert_to(pg_temp.ofx_sintetico(pg_temp.texto_do_arquivo(bruto)), 'UTF8');
    ELSIF a.tipo_mime ~* 'xml' THEN
      novo := convert_to(pg_temp.xml_sintetico(pg_temp.texto_do_arquivo(bruto)), 'UTF8');
    ELSE
      novo := pg_temp.pdf_sintetico('Arquivo ' || a.id || ' (' || coalesce(a.tipo_mime, '?') || ')');
    END IF;
    IF novo IS DISTINCT FROM bruto THEN
      DELETE FROM contabil_arquivo_partes WHERE arquivo_id = a.id;
      INSERT INTO contabil_arquivo_partes (arquivo_id, ordem, dados) VALUES (a.id, 0, encode(novo, 'base64'));
      UPDATE contabil_arquivos
         SET sha256 = encode(sha256(novo), 'hex'), tamanho_bytes = octet_length(novo), partes = 1,
             tipo_mime = CASE WHEN a.tipo_mime ~* '(ofx|xml)' THEN a.tipo_mime ELSE 'application/pdf' END
       WHERE id = a.id;
      n := n + 1;
    END IF;
  END LOOP;
  INSERT INTO efeitos (bloco, item, linhas) VALUES ('B', 'arquivos da Contabilidade reais trocados por sintéticos/anonimizados (os simulados ficam)', n);
END
$arquivos$;

WITH u AS (UPDATE contabil_pacotes SET enviado_para = pg_temp.email_ficticio(enviado_para)
            WHERE enviado_para IS DISTINCT FROM pg_temp.email_ficticio(enviado_para) RETURNING 1)
INSERT INTO efeitos (bloco, item, linhas) SELECT 'B', 'pacotes contábeis: e-mail de destino', count(*) FROM u;

WITH u AS (UPDATE cobranca_execucoes SET maquina = 'maquina-' || substr(md5(maquina), 1, 6)
            WHERE maquina IS NOT NULL AND maquina !~ '^maquina-[0-9a-f]{6}$' RETURNING 1)
INSERT INTO efeitos (bloco, item, linhas) SELECT 'B', 'execuções da cobrança: nome do computador', count(*) FROM u;

-- =============================================================================
-- BLOCO C — Usuários, sessões, avisos e marca do banco
-- =============================================================================
-- E-mails: a conta do dono (a dos e-mails que backend/pedidoEdicao.js aceita)
-- vira dono@exemplo.invalid; outro Sup Admin, sup-admin.<id>@…; os demais,
-- usuario.<id>@…. Nenhum e-mail real fica. Perfil e permissões não mudam.
WITH donos AS (
  SELECT id, count(*) OVER () AS quantos FROM usuarios
   WHERE lower(email) IN ('henrique.abade@santissimodecor.com.br', 'henrique.vabade@gmail.com')
), novo AS (
  SELECT s.id,
         CASE
           WHEN d.id IS NOT NULL AND d.quantos = 1 THEN 'dono@exemplo.invalid'
           WHEN d.id IS NOT NULL THEN 'dono.' || s.id || '@exemplo.invalid'
           WHEN s.email ~* '@exemplo\.invalid$' THEN s.email
           WHEN s.perfil = 'Sup Admin' THEN 'sup-admin.' || s.id || '@exemplo.invalid'
           ELSE 'usuario.' || s.id || '@exemplo.invalid'
         END AS email,
         pg_temp.telefone_ficticio(s.telefone) AS telefone,
         CASE
           WHEN current_setting('sanitizacao.senha') ~ '^\$2[aby]\$' THEN current_setting('sanitizacao.senha')
           WHEN current_setting('sanitizacao.modo') = 'simular' THEN '$2b$10$' || repeat('S', 53)
           ELSE s.senha
         END AS senha
    FROM usuarios s LEFT JOIN donos d ON d.id = s.id
), u AS (
  UPDATE usuarios s
     SET email = n.email, telefone = n.telefone, senha = n.senha,
         foto_perfil = NULL, foto_usuario = NULL, foto_mime = NULL,
         confirmacao_token = NULL, aprovacao_token = NULL
    FROM novo n
   WHERE n.id = s.id
     AND (s.email, s.telefone, s.senha) IS DISTINCT FROM (n.email, n.telefone, n.senha)
      OR (n.id = s.id AND (s.foto_perfil IS NOT NULL OR s.foto_usuario IS NOT NULL OR s.foto_mime IS NOT NULL
                           OR s.confirmacao_token IS NOT NULL OR s.aprovacao_token IS NOT NULL))
  RETURNING 1)
INSERT INTO efeitos (bloco, item, linhas) SELECT 'C', 'usuários: e-mails fictícios (dono@exemplo.invalid para o dono), telefone, fotos, tokens, senha DEV única', count(*) FROM u;

WITH u AS (DELETE FROM password_reset_tokens RETURNING 1)
INSERT INTO efeitos (bloco, item, linhas) SELECT 'C', 'tokens de redefinição de senha apagados', count(*) FROM u;
WITH u AS (DELETE FROM usuarios_confirmacoes RETURNING 1)
INSERT INTO efeitos (bloco, item, linhas) SELECT 'C', 'confirmações de e-mail pendentes apagadas', count(*) FROM u;

WITH u AS (
  UPDATE avisos_dispositivos
     SET cancelado_em = coalesce(cancelado_em, now()), cancelado_por = NULL,
         computador = 'computador-' || id, usuario_windows = 'usuario-' || id
   WHERE cancelado_em IS NULL OR computador IS DISTINCT FROM 'computador-' || id OR usuario_windows IS DISTINCT FROM 'usuario-' || id
  RETURNING 1)
INSERT INTO efeitos (bloco, item, linhas) SELECT 'C', 'aparelhos de aviso do Windows cancelados e renomeados', count(*) FROM u;

-- Marca do banco (COMMENT é transacional: a simulação desfaz).
DO $marca$
BEGIN
  IF shobj_description((SELECT oid FROM pg_database WHERE datname = current_database()), 'pg_database') IS DISTINCT FROM 'app-gestao:dev-vps' THEN
    EXECUTE format('COMMENT ON DATABASE %I IS %L', current_database(), 'app-gestao:dev-vps');
    INSERT INTO efeitos (bloco, item, linhas) VALUES ('C', 'marca do banco gravada: COMMENT ON DATABASE = app-gestao:dev-vps', 1);
  END IF;
END
$marca$;

-- =============================================================================
-- BLOCO D — Sequências atrás do maior id (transacional: ALTER SEQUENCE RESTART)
-- =============================================================================
DO $sequencias$
DECLARE
  s record; maior bigint; ultimo bigint; chamado boolean; proximo bigint;
BEGIN
  FOR s IN
    SELECT seq.oid::regclass AS seq, tn.nspname, t.relname, a.attname
      FROM pg_class seq
      JOIN pg_depend d ON d.objid = seq.oid AND d.deptype IN ('a', 'i')
      JOIN pg_class t ON t.oid = d.refobjid
      JOIN pg_namespace tn ON tn.oid = t.relnamespace
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
     WHERE seq.relkind = 'S' AND tn.nspname IN ('public', 'rbac')
  LOOP
    EXECUTE format('SELECT coalesce(max(%I), 0) FROM %I.%I', s.attname, s.nspname, s.relname) INTO maior;
    EXECUTE format('SELECT last_value, is_called FROM %s', s.seq) INTO ultimo, chamado;
    proximo := CASE WHEN chamado THEN ultimo + 1 ELSE ultimo END;
    IF proximo <= maior THEN
      EXECUTE format('ALTER SEQUENCE %s RESTART WITH %s', s.seq, maior + 1);
      INSERT INTO efeitos (bloco, item, linhas) VALUES ('D', format('sequência %s: próximo %s -> %s', s.seq, proximo, maior + 1), 1);
    END IF;
  END LOOP;
END
$sequencias$;

-- =============================================================================
-- BLOCO E — Conferências (qualquer falha aborta e desfaz tudo)
-- =============================================================================
DO $conferencia$
DECLARE
  t record; n bigint; fk record; problemas text[] := '{}';
BEGIN
  -- 1. Nenhuma tabela perdeu ou ganhou linha, salvo as apagadas de propósito.
  FOR t IN SELECT tabela, linhas FROM contagem_antes LOOP
    EXECUTE format('SELECT count(*) FROM %s', t.tabela) INTO n;
    IF n <> t.linhas AND t.tabela NOT IN ('public.segredos_app', 'public.password_reset_tokens', 'public.usuarios_confirmacoes', 'public.contabil_arquivo_partes') THEN
      problemas := problemas || format('%s: %s linhas antes, %s depois', t.tabela, t.linhas, n);
    END IF;
  END LOOP;

  -- 2. Nenhuma chave estrangeira órfã.
  FOR fk IN
    SELECT c.conname, c.conrelid::regclass AS filha, c.confrelid::regclass AS mae,
           string_agg(format('f.%I', af.attname), ', ' ORDER BY k.ord) AS cols_f,
           string_agg(format('m.%I', am.attname), ', ' ORDER BY k.ord) AS cols_m,
           string_agg(format('f.%I IS NOT NULL', af.attname), ' AND ' ORDER BY k.ord) AS nao_nulos
      FROM pg_constraint c
      JOIN pg_namespace ns ON ns.oid = c.connamespace AND ns.nspname IN ('public', 'rbac')
      CROSS JOIN LATERAL unnest(c.conkey, c.confkey) WITH ORDINALITY AS k(fcol, mcol, ord)
      JOIN pg_attribute af ON af.attrelid = c.conrelid AND af.attnum = k.fcol
      JOIN pg_attribute am ON am.attrelid = c.confrelid AND am.attnum = k.mcol
     WHERE c.contype = 'f'
     GROUP BY c.oid, c.conname, c.conrelid, c.confrelid
  LOOP
    EXECUTE format('SELECT count(*) FROM %s f WHERE %s AND NOT EXISTS (SELECT 1 FROM %s m WHERE (%s) = (%s))',
                   fk.filha, fk.nao_nulos, fk.mae, fk.cols_m, fk.cols_f) INTO n;
    IF n > 0 THEN problemas := problemas || format('FK %s: %s órfãs', fk.conname, n); END IF;
  END LOOP;

  -- 3. Nada de credencial ou envio real sobrando.
  SELECT count(*) INTO n FROM configuracao_cobranca
   WHERE ambiente <> 'sandbox' OR client_id_producao IS NOT NULL OR app_key_producao IS NOT NULL
      OR client_id_sandbox IS NOT NULL OR app_key_sandbox IS NOT NULL OR conciliacao_automatica OR gerar_ao_emitir_nfe;
  IF n > 0 THEN problemas := problemas || 'cobrança BB ainda com credencial ou rotina ligada'::text; END IF;
  SELECT count(*) INTO n FROM segredos_app;
  IF n > 0 THEN problemas := problemas || format('segredos_app ainda tem %s linha(s)', n); END IF;
  SELECT count(*) INTO n FROM configuracao_fiscal WHERE ambiente <> 'homologacao' OR smtp_host IS NOT NULL;
  IF n > 0 THEN problemas := problemas || 'NF-e fora de homologação ou com SMTP'::text; END IF;
  SELECT count(*) INTO n FROM contabil_integracoes WHERE ativa OR automatica OR ambiente <> 'homologacao';
  IF n > 0 THEN problemas := problemas || 'integração contábil ainda ligada'::text; END IF;
  SELECT count(*) INTO n FROM avisos_dispositivos WHERE cancelado_em IS NULL;
  IF n > 0 THEN problemas := problemas || 'aparelho de aviso ainda ativo'::text; END IF;
  IF shobj_description((SELECT oid FROM pg_database WHERE datname = current_database()), 'pg_database') IS DISTINCT FROM 'app-gestao:dev-vps' THEN
    problemas := problemas || 'marca do banco ausente'::text;
  END IF;

  -- 4. Nenhum e-mail real nas colunas de contato (nem o do dono).
  SELECT count(*) INTO n FROM (
    SELECT email AS e FROM contatos_cliente UNION ALL SELECT email FROM prospeccao_contatos
    UNION ALL SELECT email FROM contatos UNION ALL SELECT email FROM usuarios
    UNION ALL SELECT email_nfe FROM clientes UNION ALL SELECT email FROM configuracao_fiscal
    UNION ALL SELECT enviado_para FROM contabil_pacotes UNION ALL SELECT pagador->>'email' FROM boletos
    UNION ALL SELECT destinatario->>'email' FROM notas_fiscais) x
   WHERE e IS NOT NULL AND btrim(e) <> '' AND e !~* '@exemplo\.invalid$';
  IF n > 0 THEN problemas := problemas || format('%s e-mail(s) real(is) sobrando em colunas de contato', n); END IF;
  SELECT count(*) INTO n FROM usuarios WHERE email = 'dono@exemplo.invalid' OR email ~ '^dono\.[0-9]+@exemplo\.invalid$';
  IF n = 0 THEN problemas := problemas || 'a conta do dono não ficou com dono@exemplo.invalid'::text; END IF;

  -- 5. Nenhum telefone real nas colunas de contato.
  SELECT count(*) INTO n FROM (
    SELECT telefone_celular AS f FROM contatos_cliente UNION ALL SELECT telefone_fixo FROM contatos_cliente
    UNION ALL SELECT telefone_celular FROM prospeccao_contatos UNION ALL SELECT telefone_fixo FROM prospeccao_contatos
    UNION ALL SELECT telefone_celular FROM contatos
    UNION ALL SELECT telefone_fixo FROM contatos
    UNION ALL SELECT telefone FROM usuarios UNION ALL SELECT pagador->>'telefone' FROM boletos) x
   WHERE f IS NOT NULL AND btrim(f) <> '' AND f !~ '^\(00\)';
  IF n > 0 THEN problemas := problemas || format('%s telefone(s) real(is) sobrando em colunas de contato', n); END IF;

  -- 6. Nenhum nome do dicionário sobrando nas colunas tratadas.
  SELECT count(*) INTO n FROM (
    SELECT nome AS v FROM contatos_cliente UNION ALL SELECT nome FROM prospeccao_contatos
    UNION ALL SELECT razao_social FROM clientes UNION ALL SELECT nome_fantasia FROM clientes
    UNION ALL SELECT razao_social FROM prospeccoes UNION ALL SELECT nome_fantasia FROM prospeccoes
    UNION ALL SELECT entidade FROM prospeccao_historico UNION ALL SELECT detalhe::text FROM prospeccao_historico
    UNION ALL SELECT valor_anterior FROM prospeccao_historico UNION ALL SELECT valor_novo FROM prospeccao_historico
    UNION ALL SELECT mensagem FROM notificacoes UNION ALL SELECT titulo FROM notificacoes) x
   WHERE EXISTS (SELECT 1 FROM nomes WHERE strpos(x.v, nomes.original) > 0);
  IF n > 0 THEN problemas := problemas || format('%s valor(es) ainda com nome completo de pessoa/MEI', n); END IF;

  -- 7. CNPJs trocados não sobram nas colunas de CNPJ; os mantidos são só os previstos.
  SELECT count(*) INTO n FROM (
    SELECT cnpj AS d FROM clientes UNION ALL SELECT cnpj FROM prospeccoes
    UNION ALL SELECT cnpj FROM contatos WHERE coalesce(anotacoes, '') !~* 'simulad'
    UNION ALL SELECT destinatario_documento FROM notas_fiscais_externas UNION ALL SELECT pagador->>'documento' FROM boletos
    UNION ALL SELECT destinatario->>'documento' FROM notas_fiscais) x
   WHERE pg_temp.so_digitos(d) IN (SELECT digitos FROM cnpj_trocados);
  IF n > 0 THEN problemas := problemas || format('%s CNPJ(s) que deviam ser fictícios sobraram', n); END IF;

  -- 8. Nenhum XML fiscal com assinatura (todos sintéticos e marcados).
  SELECT count(*) INTO n FROM (
    SELECT xml_envio AS x FROM notas_fiscais UNION ALL SELECT xml_autorizado FROM notas_fiscais UNION ALL SELECT xml_cancelamento FROM notas_fiscais
    UNION ALL SELECT xml FROM notas_fiscais_externas UNION ALL SELECT xml FROM notas_fiscais_externas_eventos) y
   WHERE x IS NOT NULL AND (x ~ '<Signature[ >]' OR strpos(x, 'DOCUMENTO SINTETICO DE TESTE') = 0);
  IF n > 0 THEN problemas := problemas || format('%s XML fiscal sem a marca de sintético ou ainda assinado', n); END IF;

  IF array_length(problemas, 1) > 0 THEN
    RAISE EXCEPTION 'CONFERÊNCIA FALHOU (nada foi gravado): %', array_to_string(problemas, ' | ');
  END IF;
  INSERT INTO efeitos (bloco, item, linhas) VALUES ('E', 'conferências: linhas, chaves estrangeiras, credenciais, e-mails, telefones, nomes, CNPJs, XML — tudo ok', 0);
END
$conferencia$;

-- Resíduos (informativo, não aborta): o que ainda parece e-mail, telefone,
-- CPF, nome do dicionário ou CNPJ trocado em QUALQUER coluna de texto.
CREATE TEMP TABLE residuos (coluna text, emails bigint, telefones bigint, cpfs bigint, nomes bigint, cnpjs bigint) ON COMMIT DROP;
DO $residuos$
DECLARE c record; e bigint; f bigint; p bigint; nn bigint; cj bigint;
BEGIN
  FOR c IN SELECT table_schema, table_name, column_name FROM information_schema.columns
            WHERE table_schema IN ('public', 'rbac') AND data_type IN ('text', 'character varying', 'character', 'jsonb', 'json')
              AND (table_schema, table_name) IN (SELECT table_schema, table_name FROM information_schema.tables WHERE table_type = 'BASE TABLE')
  LOOP
    EXECUTE format($q$SELECT
        count(*) FILTER (WHERE v ~* '[a-z0-9._%%+-]+@(?!exemplo\.invalid)[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}'),
        count(*) FILTER (WHERE v ~ '\([1-9][0-9]\) ?9?[0-9]{4}-?[0-9]{4}' OR v ~ '\m[1-9][0-9] 9?[0-9]{4}-?[0-9]{4}\M'),
        count(*) FILTER (WHERE v ~ '\m[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}\M' AND v !~ '000\.000\.000-00'),
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM pg_temp.nomes WHERE strpos(v, nomes.original) > 0)),
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM pg_temp.cnpj_trocados t WHERE strpos(v, t.digitos) > 0
                                        OR strpos(v, substr(t.digitos,1,2)||'.'||substr(t.digitos,3,3)||'.'||substr(t.digitos,6,3)||'/'||substr(t.digitos,9,4)||'-'||substr(t.digitos,13,2)) > 0))
      FROM (SELECT %I::text AS v FROM %I.%I) s$q$, c.column_name, c.table_schema, c.table_name) INTO e, f, p, nn, cj;
    IF e + f + p + nn + cj > 0 THEN
      INSERT INTO residuos VALUES (c.table_schema || '.' || c.table_name || '.' || c.column_name, e, f, p, nn, cj);
    END IF;
  END LOOP;
END
$residuos$;

-- Registro da operação (só quando aplicada e com o registro da VPS já criado).
DO $registro$
BEGIN
  IF current_setting('sanitizacao.modo') = 'aplicar' AND to_regclass('controle.operacoes_dev_vps') IS NOT NULL THEN
    EXECUTE 'INSERT INTO controle.operacoes_dev_vps (operacao, sha256, maquina, backup_arquivo, backup_sha256, resumo, observacao) VALUES ($1, $2, $3, $4, $5, $6, $7)'
      USING 'sanitizar-banco-dev-vps.sql', nullif(current_setting('sanitizacao.sha'), ''), nullif(current_setting('sanitizacao.maquina'), ''),
            nullif(current_setting('sanitizacao.backup'), ''), nullif(current_setting('sanitizacao.backup_sha'), ''),
            (SELECT jsonb_agg(jsonb_build_object('bloco', bloco, 'item', item, 'linhas', linhas) ORDER BY ordem) FROM efeitos),
            'sanitização aplicada';
  END IF;
END
$registro$;

\pset format aligned
\pset border 1
\echo
\echo '================ EFEITOS (contagens; nenhum valor) ================'
SELECT bloco, item, linhas FROM efeitos ORDER BY ordem;
\echo
\echo '================ RESÍDUOS (linhas que ainda parecem dado pessoal) ================'
SELECT coluna, emails, telefones, cpfs, nomes, cnpjs FROM residuos ORDER BY coluna;
SELECT current_database() AS banco, current_user AS usuario, :'modo' AS modo;

\if :aplicar
  COMMIT;
  \echo 'APLICADO: transação gravada (COMMIT).'
\else
  ROLLBACK;
  \echo 'SIMULAÇÃO: nada foi gravado (ROLLBACK).'
\endif
