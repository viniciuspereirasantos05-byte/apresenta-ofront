# Kennedy Labs

Sistema web responsivo para organizar reservas dos laboratórios e do auditório do Colégio Presidente Kennedy.

> Projeto em desenvolvimento. Ainda não está pronto para uso escolar real.

## Estrutura do repositório

- `frontend/`: interface web (HTML, CSS e JavaScript).
- `backend/`: API Node.js + Express.
- `database/migrations/`: migrações SQL do PostgreSQL.
- `docs/`: arquitetura e decisões do projeto.

## Requisitos locais

- Node.js 20 ou superior.
- PostgreSQL 15 ou superior.
- Git (opcional para baixar/atualizar o projeto).

## Preparar o backend

1. Entre na pasta `backend`.
2. Instale as dependências com `npm install`.
3. Copie `.env.example` para `.env` e preencha `DATABASE_URL` com os dados do PostgreSQL local.
4. Não compartilhe nem envie o arquivo `.env` ao GitHub.

### Criar o banco

Crie um banco vazio chamado `kennedy_labs` usando o usuário local do PostgreSQL. Depois, na pasta `backend`, execute:

```bash
npm run db:migrate
```

O comando aplica os arquivos SQL ainda não registrados em `schema_migrations`. Cada migração é executada em transação e protegida por um bloqueio consultivo do PostgreSQL.

### Iniciar a API

```bash
npm run dev
```

Rotas técnicas disponíveis:

- `GET /api/health`: verifica se a API está respondendo.
- `GET /api/health/database`: verifica a conexão com o PostgreSQL.

## Segurança e dados

- Não existem contas administrativas ou senhas padrão no código.
- Senhas deverão ser armazenadas somente como hashes seguros.
- Segredos ficam em variáveis de ambiente, nunca no repositório.
- Não use dados reais de estudantes ou professores sem autorização da escola.
- A API ainda não implementa autenticação, reservas ou notificações; essas etapas estão em desenvolvimento.

## Documentação

- [Arquitetura inicial](docs/arquitetura-inicial.md)
- [Modelo de dados](docs/modelo-de-dados.md)
