# Kennedy Labs — arquitetura inicial

## Objetivo
Aplicação web responsiva para organizar reservas dos Laboratórios 1, 2, 3 e Auditório do Colégio Presidente Kennedy.

## Estrutura
- `frontend/`: interface HTML, CSS e JavaScript.
- `backend/`: API Node.js + Express.
- `database/`: migrações PostgreSQL (a criar após validar a grade e as regras finais).
- `docs/`: decisões, requisitos e contratos da aplicação.

## Princípios
1. O backend é a fonte de verdade para autenticação, permissões, disponibilidade e conflitos.
2. O PostgreSQL será compartilhado por todos os usuários; localStorage não será o banco oficial.
3. Senhas nunca serão armazenadas em texto puro.
4. Segredos e credenciais ficam em variáveis de ambiente, nunca no repositório.
5. Reservas conflitantes precisam ser impedidas no servidor e no banco.
6. Dados reais da escola só serão usados após autorização e configuração adequada de privacidade e segurança.

## Primeira API
- `GET /api/health`: verificação técnica de disponibilidade da API.

## Próximas etapas
1. Validar os horários oficiais de cada turno e turma.
2. Fechar o modelo relacional e criar a primeira migração SQL.
3. Implementar autenticação, sessões e permissões.
4. Implementar disponibilidade, reservas e bloqueios em transações.
5. Construir os painéis de professor e administração.

## Pendências que não devem ser inventadas
- Horários oficiais completos da manhã e da tarde.
- Domínio real dos e-mails institucionais.
- Política final de segundo fator para professores.
- Regra exata do prazo de cancelamento e das recorrências.
