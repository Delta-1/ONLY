# Verificação — ONLY 1.0

História: o operador cadastra produtos e abre um caixa, recebe uma venda com troco, e um cliente usa outro aparelho para enviar um pedido que aparece no ERP e pode ser finalizado sem duplicar estoque ou valores.

## Testes automatizados de API e banco

Execute `npm run check` e `npm test` com Node.js 24+.

A suíte usa um servidor HTTP real e um banco temporário separado. Abrange:

1. Valores com vírgula/ponto e cálculo de troco em centavos, reaproveitados do projeto anterior.
2. Cadastro de empresas e restauração de sessão.
3. Isolamento entre empresas e preços independentes nas quatro moedas.
4. Abertura opcional na entrada e exigência de caixa para pagamento.
5. Preço recalculado no servidor, estoque transacional e reenvio sem duplicação.
6. Pagamento parcial, identificação de cliente e recebimento posterior.
7. Bloqueio de estoque insuficiente, quantidades duplicadas e moeda incompatível.
8. Catálogo público sem custo, preço de atacado, equipe ou clientes; total calculado no servidor.
9. Pedidos de múltiplos celulares, código móvel, geração de QR e revogação do código junto com o link.
10. Cadastro colaborativo submetido à aprovação.
11. Permissões do operador e proteção dos caixas de outros operadores.
12. Cancelamento, devolução de estoque, sangria e fechamento.
13. Finalização de um pedido apenas uma vez.
14. Proteção contra origem externa e acesso a arquivos do banco.
15. Persistência dos registros gravados em uma nova conexão ao banco.
16. Vendas em BOB, USD e EUR usando seus preços próprios, sem conversão.

A suíte é executada no GitHub Actions a cada push e pull request. Não usa o banco da loja original.

## Fluxo validado no navegador

O teste `npm run test:browser` inicia um servidor e banco temporários e verifica no Chromium:

- Cadastro da empresa pela tela e escolha **Agora não** na abertura de caixa.
- Cadastro de produto pelo formulário do ERP, quatro tabelas de preços e entrada no PDV.
- Pesquisa por código com Enter e adição ao carrinho.
- Abertura do caixa, venda com valor recebido de R$ 50,00 para total de R$ 12,50 e troco de R$ 37,50 no pagamento e no comprovante.
- Ativação da loja virtual e pedido enviado por outra página em largura de celular.
- Pedido recebido no ERP, importado e finalizado no PDV.
- Tema claro, idioma espanhol e retorno ao tema escuro/português.
- Tela de celular com 390 px de largura, sem rolagem horizontal.
- Ausência de exceções JavaScript e de falhas de API nos fluxos exercitados.

As prévias em `screenshots/` foram capturadas durante esse teste. O teste usa produtos fictícios apenas no banco temporário; não adiciona demonstração ao banco de uso real. O CI também executa o fluxo de navegador e guarda as capturas como artefato.

## Entrada no GitHub Pages

O teste `npm run test:pages` serve os arquivos estáticos sob `/ONLY/` e confirma que a raiz abre a tela de acesso do aplicativo, com estilos e módulos carregados. Também verifica a largura de celular, a indicação de serviço de dados ainda não conectado e a ausência de envio de credenciais para endpoints inexistentes no Pages. Com `systemUrl` configurado, verifica o encaminhamento para a aplicação hospedada.

## Limites da validação

Os pagamentos representam registros de meios de pagamento; não há confirmação com banco ou adquirente. A emissão fiscal, impressoras físicas e instalação PWA em aparelhos reais dependem dos equipamentos e não são cobertas pelos testes de API.
