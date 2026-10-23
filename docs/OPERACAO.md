# Operação do ONLY

## Primeiro acesso

1. Crie uma empresa com nome, e-mail e senha de pelo menos oito caracteres.
2. Ao abrir o PDV, escolha **Agora não** se quiser cadastrar os produtos primeiro.
3. Em **Menu → Gestão da empresa → Configurações**, escolha moeda, idioma, nome e logo. Salve.
4. Em **Produtos → Novo produto**, informe nome, código, preços e estoque. Sem controle de estoque, desmarque a opção correspondente.
5. Informe separadamente os preços de cada moeda que pretende usar. Deixe as outras em branco.
6. Em **Equipe**, crie o acesso de cada operador.
7. Volte ao PDV e abra um caixa. Não há limite de quantidade de caixas no aplicativo; a capacidade simultânea depende do servidor.

## Venda e caixa

Cada caixa opera em uma moeda. Para receber em outra, abra ou selecione um caixa naquela moeda. A escolha da moeda padrão não altera preços ou vendas anteriores.

O saldo esperado contém o saldo inicial, pagamentos em dinheiro, recebimentos de contas em dinheiro e suprimentos, menos sangrias e vendas canceladas. Pix, QR, cartão e transferência ficam registrados nas vendas e não são somados ao dinheiro físico esperado.

Para gerenciar os caixas direto no PDV, clique em **Caixa** na barra superior, ao lado do Menu. O botão abre a lista atualizada dos caixas abertos; o administrador vê todos os caixas da empresa, mesmo os abertos em outros aparelhos. Operadores podem fechar os próprios caixas. Na mesma tela, use **Abrir caixa** para abrir outro caixa. No celular, o acesso fica no ícone de carteira na barra superior, disponível tanto em **Produtos** quanto em **Venda atual**.

Em cada caixa, clique em **Fechar caixa**, informe o dinheiro contado e a **Senha do caixa**, confira a diferença e confirme. A senha inicial é **1234**. O administrador pode trocá-la em **Configurações/Personalização → Segurança do caixa**, usando de 4 a 8 números. Deixar os campos de nova senha vazios mantém a senha atual. A senha é verificada no servidor, não é devolvida pela API e tem apenas sua representação protegida armazenada quando configurada. Tentativas são limitadas.

Depois de fechar um caixa pela lista, ela é atualizada para fechar o próximo sem sair da tela. Cancelar mantém o caixa aberto. O fechamento afeta somente o caixa indicado e mantém os itens ainda no carrinho. Quando não há caixas abertos, o botão **Caixa** continua abrindo essa tela, com a opção **Abrir caixa**.

A diferença é gravada junto com o horário de abertura e fechamento. O relatório inclui essas informações em tabela. O caminho **Menu → Gestão da empresa → Caixa** continua disponível.

O valor recebido menor que o total exige um cliente identificado e a confirmação para registrar o restante em conta. Receba depois em **Clientes → Receber**. O comprovante preserva o que foi recebido e o que ficou pendente no momento da venda.

Cancelamentos exigem administrador e caixa ainda aberto. Quando há recebimentos posteriores na conta, o sistema bloqueia o cancelamento automático para não invalidar os recebimentos já registrados.

## Sons e animações

Em **Menu → Personalização**, ative ou desative separadamente **Sons suaves nos botões e nas vendas** e **Brilho verde e confirmação ao concluir a venda**, depois salve. As preferências ficam salvas para a empresa. Os sons são sintetizados no próprio navegador em volume suave; o navegador libera o áudio após a primeira interação.

Som de conclusão, brilho e OK aparecem somente depois da confirmação do servidor. Reabrir ou reimprimir um comprovante não gera uma nova celebração. A animação não captura cliques nem altera o comprovante impresso. Com movimento reduzido ativado no aparelho, o brilho é removido e o OK aparece sem movimento.

## Pedidos e links

A loja virtual envia pedidos; o envio não representa pagamento. Ao concluir no PDV, o pedido muda para concluído, o estoque é baixado e a venda entra no relatório. O estoque é conferido de novo nessa etapa. Pedidos não reservam estoque.

Os produtos da loja precisam estar ativos e publicados. A vitrine usa a moeda padrão da empresa e só exibe itens com preço cadastrado nessa moeda.

Links móveis duram 30 dias; links de cadastro colaborativo duram sete dias. O administrador pode revogá-los antes. O código digitado em `/join` usa a mesma permissão e é revogado junto com o link original. Não compartilhe o link colaborativo além de quem vai ajudar; ele permite enviar sugestões de produtos, que aguardam aprovação.

Os pedidos são atualizados a cada 12 segundos enquanto a tela está ativa. Também há **Atualizar** no ERP. Operadores fazem login para receber pagamentos; clientes e auxiliares usam os links sem login.

## Publicação padrão: Pages e Supabase

O endereço `https://delta-1.github.io/ONLY/` usa a conexão Supabase definida em `public/site-config.json`. Cadastros, vendas, caixas e pedidos são salvos no esquema privado `only_app` do projeto WORKSPACE. Os links de clientes usam `#/store/...`, `#/mobile/...` e `#/collaborate/...`; a entrada com código usa `#/join`.

A chave publicável identifica a API, mas não libera as tabelas privadas. A função `only` valida a sessão de cada usuário e a empresa vinculada a ela. Auxiliares e clientes recebem apenas os dados permitidos pelo link, com validade e revogação.

Não há processo Node adicional para manter a publicação padrão. Para reinstalar em outro projeto Supabase, aplique a estrutura de banco e publique a função, depois troque somente a URL e a chave publicável da configuração. Preserve o endereço público autorizado na configuração do CORS e dos QR Codes da função.

## Publicação alternativa: Node e SQLite

O processo Node serve a interface e a API na mesma origem. Utilize Node 24+, um volume persistente montado em `DATA_DIR` e um proxy HTTPS. Com Docker, o arquivo `compose.yaml` já define o volume.

Exemplo de configuração atrás de um proxy:

```text
PORT=3000
DATA_DIR=/app/data
APP_ORIGIN=https://pdv.suaempresa.com
COOKIE_SECURE=true
```

Não coloque o banco ou uma cópia dele em `public/`, em commits ou em arquivos distribuídos aos clientes. Dados de cada empresa são separados pelo identificador de empresa em todas as consultas privadas. No servidor Node, as sessões usam cookies HttpOnly e senhas usam scrypt com salt individual. Na publicação Supabase, as sessões próprias são enviadas em cabeçalho autenticado e as senhas usam PBKDF2-SHA256 com salt individual.

O sistema permite criar empresas. Controle o acesso à implantação conforme seu modelo comercial; cobrança de assinatura, emissão fiscal, recuperação de senha por e-mail e gateway de pagamento não estão implementados.

## Backup do banco online

O ambiente online usa PostgreSQL no Supabase. Inclua o esquema `only_app` nas rotinas de backup/exportação do projeto e teste a restauração em um ambiente separado. O volume SQLite local não é uma cópia do banco online.

## Backup e restauração do SQLite (alternativa local)

Faça backup regular do volume. Para copiar os arquivos SQLite de forma simples e consistente, pare o processo antes de copiar **todo o diretório de dados**; isso inclui arquivos auxiliares que possam existir. Reinicie após a cópia. Se usar ferramenta de backup SQLite online, verifique que ela captura uma cópia consistente do WAL.

Para restaurar: pare o serviço, recupere o diretório completo no mesmo volume e inicie novamente. Teste a restauração periodicamente em ambiente separado.

## Conexão interrompida

Sem internet, o sistema informa que é necessário reconectar. Se a resposta da venda for perdida, o PDV mantém a solicitação pendente no navegador e apresenta **Tentar novamente**. A mesma solicitação recupera a venda já gravada sem baixar estoque ou cobrar duas vezes. Esse mecanismo não é um modo de venda offline.

A instalação como PWA depende do navegador e de HTTPS. Não há APK nativo neste repositório. Os arquivos da interface podem ser armazenados em cache; a API autenticada e os dados da empresa não são armazenados pelo service worker.
