# Roteirizador RRM

Sistema web de planejamento territorial, setorização e roteirização, inspirado no Omnitracs Roadnet / Territory Planner.
Roda no navegador e guarda os dados no Supabase, sem servidor próprio para instalar.

## Como rodar no VS Code (recomendado)

1. Descompacte a pasta `roteirizador` e abra no VS Code (**Arquivo → Abrir Pasta**).
2. Instale a extensão **Live Server** (o VS Code vai sugerir, ela está em `.vscode/extensions.json`).
3. Clique com o botão direito em `index.html` → **Open with Live Server**.
4. O navegador abre em `http://127.0.0.1:5500/index.html` com o mapa do OpenStreetMap e as rotas pelas ruas.

Alternativa sem extensão (precisa do Node.js instalado): no terminal do VS Code, rode `npm start` e acesse `http://localhost:5500`.

> Abrir o `index.html` com dois cliques (endereço `file://`) pode funcionar, mas alguns navegadores e a chave do Google bloqueiam. Prefira o Live Server.

## Como o sistema está organizado

- **Acesso**: a pessoa escolhe o ambiente (G4 Distribuidora, J.Arantes, Chok Distribuidora ou Grupo Arantes) e faz login. Cada ambiente tem usuários, clientes, colaboradores e estudos separados. Veja [Ambientes e login](#ambientes-e-login).
- **Início** (tela de abertura): atalhos para Listagens, Estudos, Importações e Configurações, botão **Mapa da base**, indicadores gerais (estudos, clientes, bases de saída, cidades), indicadores e gráficos do estudo em foco (KM por estudo e por setor, ocupação da jornada, visitas por dia), mapa de cobertura das bases, lista de colaboradores e tabela de estudos.
- **Planner**: o sistema de mapa, roteiros, estudos, clientes e colaboradores. Entre pelo botão **Abrir Planner**, que oferece: abrir um **estudo existente**, criar um **planner vazio e novo** ou **importar** um roteiro (Excel/CSV). Para voltar, clique em **Roteirizador RRM** no topo.
- **Importação** (aba do Planner, também acessível pela página inicial): baixe os modelos .xlsx de colaboradores, clientes e roteiro (cada um com exemplos e uma aba “Instruções”) e importe-os. Ordem recomendada: colaboradores → clientes → roteiro.
- **Configurações** (aba do Planner, também acessível pela página inicial): Minha conta, mapa de fundo, busca de endereços, servidores de rota, backup e dados de exemplo.

## Ambientes e login

- Os ambientes ficam em `js/config.js` (`empresas`). Cada um aceita valores próprios: `padroes` (jornada, velocidade, ciclo e dias dos novos estudos) e `pontoMar`. Não troque o `id` de um ambiente em uso: os dados ficam guardados por ele.
- **Primeiro acesso:** o primeiro login de um ambiente em cada navegador cria o administrador. Ele cadastra os demais em **Minha conta** (canto superior direito), com senha provisória que a pessoa troca no primeiro login.
- **Esqueci minha senha:** usa o código de recuperação mostrado quando a senha é criada. Sem o código, um administrador redefine a senha em **Minha conta**. O envio por e-mail depende de servidor.
- **Manter conectado:** mantém o login neste navegador por 30 dias. Sem marcar, o login vale até fechar a aba.
- **Dados antigos:** se o navegador tiver dados de antes da separação por ambiente, o login pergunta se eles pertencem àquele ambiente e os move. Com "Agora não", nada é apagado e a pergunta volta no próximo login.

> **Sem o Supabase configurado:** contas e dados ficam no navegador, com senhas guardadas só como hash. Isso separa as empresas e evita o acesso casual, mas não protege contra quem tem acesso ao computador, e os quatro ambientes dividem o limite de cerca de 5 MB do navegador.

## Visões do mapa

No mapa, o painel da esquerda (**Visualizar**) serve para escolher o que ver e o da direita (**Editar e roteirizar**) para alterar: setor, dias, semanas, modo de roteirização, cliente novo, inclusão e exclusão.

O painel da esquerda tem três visões:

- **Setores** (abre assim ao entrar em um estudo): todos os setores carregados e coloridos, sem linhas de rota. Abrir um setor ou filtrar semana e dia mostra as linhas.
- **Rotas**: começa sem ninguém marcado. Marque colaboradores ou clique em um dia para ver só aqueles roteiros; o painel direito lista as rotas marcadas com KM, tempo e ocupação, e cada uma abre com a sequência de visitas.
- **Base**: todos os clientes cadastrados, mesmo sem estudo. Filtre por uma ou mais cidades e por clientes específicos, buscando por nome ou SOLD ou colando uma lista de códigos. Também abre pelo botão **Mapa da base** na tela inicial, em Listagens e em **Clientes → Ver no mapa**, que leva o filtro daquela página.

As ferramentas de seleção (clique, retângulo e laço) ficam na barra de ferramentas do mapa e funcionam nas três visões.

## Da base de clientes às rotas diárias

1. Importe só a base de clientes. No mapa, eles aparecem na visão Base, sem precisar criar um estudo antes. Se a listagem tiver a coluna **Setor** (e, se quiser, **SOLD vendedor**), os setores já são carregados no estudo ao importar.
2. Selecione clientes com clique, retângulo ou laço e clique com o **botão direito → Criar setor com a seleção**. Se não houver estudo aberto, ele é criado com toda a base. Clientes de um setor existente podem ser levados para outro pelo mesmo menu.
3. Abra o setor no seletor **Setor** do painel Visualizar, clicando no nome dele na lista, ou pelo botão direito em um cliente dele. O mapa mostra só ele, colorido por dia, e o painel da direita mostra as ações do setor.
4. Selecione os clientes de cada rota. No painel à direita escolha o setor, os dias, as semanas e o modo, e clique em **Roteirizar**. Ou use **Dividir nos dias** para o sistema distribuir o setor inteiro.

O seletor **Setor** também oferece **Todos**, **Nenhum** e **Só clientes sem setor**. Para comparar mais ou menos setores, duplique o estudo em **Estudos → Duplicar como cenário** e use **Comparar cenários**.

## Roteirizar no mapa

Para rotas que já existem: escolha no painel **Visualizar** o que ver (setor, semanas e dias, podendo marcar mais de um) e, em **Editar e roteirizar**, escolha o modo e clique em **Roteirizar**.

| Formato | Servidor | O que faz |
|---|---|---|
| Mais rápida | OSRM | Menos tempo de viagem. É o padrão |
| Mais curta | Valhalla | Menos KM, mesmo que leve mais tempo |
| Evitar pedágios | Valhalla (ou Google, se for o motor escolhido na mais rápida) | Não usa vias com pedágio. Se não houver outro caminho, a rota passa por ele e avisa |
| Evitar estrada de terra e via precária | Valhalla | Não usa vias registradas como sem pavimento. O percurso calculado é medido, e a rota avisa quantos km de terra não puderam ser evitados |

O formato é salvo no estudo e também aparece em **Estudos e setores → Parâmetros de cálculo**. Trocá-lo não apaga o que já foi calculado: cada rota mostra em qual formato foi calculada.

A informação de pavimento vem do OpenStreetMap e pode faltar em vias rurais. O mapa não tem dados de acidentes nem de segurança, então "via precária" significa via sem pavimento registrado, e não risco medido.

## Banco de dados (Supabase)

O sistema grava no Supabase: clientes, colaboradores, estudos, setores, roteiros e percursos ficam no banco, por empresa, e cada usuário só acessa as empresas em que é membro (Row Level Security). O projeto é definido em `js/config.js` (`supabaseUrl` e `supabaseKey`, a chave pública). Sem esses dois valores, o sistema volta a guardar tudo no navegador, com login local.

- **Acesso:** o login usa as contas do Supabase Auth. O administrador inclui pessoas em **Minha conta**. Quem ainda não tem conta recebe uma senha provisória e a troca no primeiro login.
- **Confirmação de e-mail:** com "Confirm email" ligado no Supabase, a pessoa precisa abrir o link antes de entrar, e o envio padrão do Supabase só atende endereços da equipe do projeto. Para os demais, crie a conta em **Authentication → Users** e inclua o e-mail em **Minha conta**, ou configure um servidor de e-mail em **Authentication → Emails**.
- **Esqueci minha senha:** envia um link por e-mail. Para ele voltar ao sistema, cadastre o endereço em **Authentication → URL Configuration** (por exemplo `http://127.0.0.1:5500/**`).
- **Dados do navegador:** no login, se o banco do ambiente estiver vazio e o navegador tiver dados, o sistema oferece enviá-los. Eles continuam no navegador.
- **Várias pessoas ao mesmo tempo:** cada alteração é gravada linha a linha, e a última gravação vale. O que outra pessoa alterou aparece ao recarregar a página.

Em um projeto novo, rode `supabase/schema.sql` no **SQL Editor**, crie o usuário em **Authentication → Users** e dê acesso com o comando que está no fim do arquivo. Quem já tinha o schema roda também `supabase/migracao_02_usuarios.sql` e `supabase/migracao_03_importacoes.sql` (histórico de importações). Para carregar um backup direto por SQL, use `python ferramentas/backup_para_sql.py backup.json`.

## Importação pelo endereço

- **Clientes**: basta o SOLD e o endereço (bairro, cidade e UF deixam a busca mais precisa). Na importação, as coordenadas são buscadas automaticamente em segundo plano; o progresso aparece no canto inferior direito e o sistema continua utilizável.
- **Colaboradores**: a base de saída também é localizada pelo endereço.
- **Roteiro**: colunas SOLD cliente, SOLD vendedor, Dia, Semana e o endereço do cliente.
  - **Dia** em número: 2 = segunda, 3 = terça, 4 = quarta, 5 = quinta, 6 = sexta, 7 = sábado (1 = domingo). Mais de um dia: `2,5` ou `25`. Texto (Seg, Terça…) também é aceito.
  - **Semana** (ciclo de 4 semanas, cada algarismo é uma semana): mensal = `1`, `2`, `3` ou `4`; quinzenal = `1,3` ou `2,4`; semanal = `1234`.
  - A frequência do cliente na base é atualizada pelo roteiro (semanas × dias).
  Quem não estiver na base de clientes é cadastrado com esse endereço e localizado; cada SOLD vendedor vira um setor (acrescente uma coluna “Setor” para outros nomes).
- Só é aceito resultado no nível do endereço ou da rua, na cidade informada. **Endereços não encontrados** (ou encontrados só pela cidade/bairro) ficam **empilhados num único ponto no mar** e fora dos cálculos de KM. Para ajustar: em **Importação → Ajustar endereços** (ou no aviso do mapa) use *Marcar no mapa* (clique no local), *Usar sugestão*, *Buscar* de novo após corrigir o endereço, ou arraste o pino do mar até o local certo. No cadastro do cliente, colar no campo Latitude uma coordenada copiada do Google Maps (“-23.56, -46.65”) preenche os dois campos.
- O ponto no mar é configurável em `js/config.js` (`pontoMar`). O padrão fica cerca de 50 km do litoral norte de SP.
- Serviço de busca: OpenStreetMap/Nominatim (gratuito, ~1 endereço por segundo) ou Google (mais preciso; exige a Geocoding API ativa na chave). Se o Google recusar, a busca continua pelo OpenStreetMap.

## Estrutura

| Caminho | O que é |
|---|---|
| `index.html` | Página principal (estrutura das telas) |
| `css/style.css` | Visual: cores, tema claro/escuro, layout do mapa e painéis |
| `js/config.js` | **Configurações**: ambientes de login, chave do Google e servidores de rotas (OSRM e Valhalla) |
| `js/engine.js` | Motor de cálculo: setorização (k-means balanceado), distribuição em dias/semanas pela frequência, sequência (vizinho mais próximo + 2-opt + Or-opt), métricas de KM e tempo |
| `js/app.js` | Aplicação: bases, estudos, mapa (Leaflet), laço, régua, seleção, importação/exportação Excel, roteirização pelas ruas (OSRM), Google opcional |
| `exemplos/` | Modelos CSV de clientes, colaboradores e roteiro (os modelos .xlsx com instruções são baixados na aba Importação) |
| `ferramentas/build.py` | Gera `dist/roteirizador.html`, um arquivo único com tudo embutido |
| `supabase/schema.sql` | Estrutura do banco para o Supabase: tabelas, regras de acesso e consultas prontas |
| `ferramentas/backup_para_sql.py` | Converte um backup do sistema em SQL para carregar no Supabase |
| `dist/roteirizador.html` | Versão em arquivo único, pronta para enviar ou hospedar |

Bibliotecas usadas (carregadas por CDN, nada para instalar): Leaflet 1.9.4 (mapa), SheetJS 0.18.5 (Excel), Leaflet.GoogleMutant 0.16.0 (Google opcional). Fontes: IBM Plex (Google Fonts).

## Serviços externos

- **Mapa:** Esri (gratuito, sem chave): claro, escuro, ruas detalhadas e satélite; OpenStreetMap padrão também disponível. A CARTO foi removida porque passou a exigir chave de API e devolvia o mapa em branco com a marca d'água "API KEY REQUIRED".
- **Rotas pelas ruas:** OSRM público (`router.project-osrm.org`), gratuito, cerca de 1 consulta por segundo, sem trânsito em tempo real. Para uso intenso, suba um servidor OSRM próprio e troque em **Configurações** ou em `osrmUrl`, no `js/config.js`.
- **Formatos de rota:** Valhalla público (`valhalla1.openstreetmap.de`), gratuito, sem trânsito em tempo real e sem garantia de disponibilidade. Aceita 10 pontos por consulta, então rotas longas viram várias consultas, cerca de uma por segundo. Se ele estiver fora do ar, o cálculo para e avisa, sem trocar de formato em silêncio. Para uso intenso, suba um servidor próprio e troque `valhallaUrl` em `js/config.js`.
- **Google (opcional):** mapa, rotas e geocodificação. Só carrega se você escolher Google no seletor de mapa ou em "Motor de rotas". Precisa das APIs Maps JavaScript, Directions e Geocoding ativas e da chave restrita ao seu endereço (ex.: `http://127.0.0.1:5500/*`).
- **Geocodificação gratuita:** Nominatim (OpenStreetMap), 1 endereço por segundo.

## Onde ficam os dados

No Supabase, por ambiente (veja acima). Sem o Supabase configurado, ficam no navegador (localStorage), separados por ambiente, por navegador e por endereço. Em qualquer caso, para guardar uma cópia ou levar os dados, use **Estudos e setores → Exportar backup / Restaurar backup** (arquivo JSON). O backup leva os dados do ambiente aberto, mas não os usuários, e pede confirmação se for restaurado em outro ambiente.

## Atalhos do mapa

`H` mover · `V` selecionar · `B` retângulo · `L` laço · `M` régua · `E` enquadrar · `F` tela cheia · `Esc` limpar · `Ctrl+Z` desfazer · Shift soma à seleção, Alt remove.

## Próximos passos sugeridos

- Hospedar (Vercel, Netlify, servidor da empresa) para a equipe acessar por um link.
- Servidores OSRM e Valhalla próprios com o mapa do Sudeste, para roteirizar estudos grandes sem limite de consultas.
