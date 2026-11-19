# Kennedy Labs

Sistema web responsivo para organizar reservas dos laboratórios e do auditório do Colégio Presidente Kennedy.

> Projeto em desenvolvimento. Ainda não está pronto para uso escolar real.

## Estrutura do repositório

- `frontend/`: interface web (HTML, CSS e JavaScript).
- `backend/`: API Node.js + Express.
- `database/migrations/`: migrações SQL do PostgreSQL.
- `docs/`: arquitetura, modelo de dados e decisões do projeto.

## Requisitos locais

- Node.js 20 ou superior.
- PostgreSQL 15 ou superior.
- Git (opcional para baixar/atualizar o projeto).

## Preparar o backend

1. Entre na pasta `backend`.
2. Instale as dependências com `npm install`.
3. Copie `.env.example` para `.env` e preencha `DATABASE_URL`.
4. Gere um valor aleatório forte para `SESSION_SECRET` (pelo menos 32 caracteres).
5. Não compartilhe nem envie o arquivo `.env` ao GitHub.

### Criar o banco

Crie um banco vazio chamado `kennedy_labs`. Depois, na pasta `backend`, execute:

```bash
npm run db:migrate
```

O comando aplica os arquivos SQL ainda não registrados em `schema_migrations`. Cada migração é executada em transação e protegida por um bloqueio consultivo do PostgreSQL.

### Iniciar a API

```bash
npm run dev
```

Rotas técnicas:

- `GET /api/health`: verifica se a API está respondendo.
- `GET /api/health/database`: verifica a conexão com o PostgreSQL.

Rotas iniciais de autenticação:

- `GET /api/auth/csrf`: obtém token CSRF e cookie de sessão anônima.
- `POST /api/auth/register`: cadastra professor com conta pendente.
- `POST /api/auth/login`: autentica conta ativa.
- `GET /api/auth/me`: consulta a sessão atual.
- `POST /api/auth/logout`: encerra a sessão.
- `POST /api/setup/first-admin`: cria o primeiro administrador uma única vez, com segredo temporário de configuração.
- `GET /api/admin/teachers/pending`: lista cadastros pendentes (somente administradores).
- `POST /api/admin/teachers/:teacherId/approve`: aprova cadastro (somente administradores).
- `POST /api/admin/teachers/:teacherId/reject`: rejeita cadastro (somente administradores).
- `GET /api/admin/teachers/pending`: lista cadastros pendentes (somente administradores).
- `POST /api/admin/teachers/:teacherId/approve`: aprova cadastro (somente administradores).
- `POST /api/admin/teachers/:teacherId/reject`: rejeita cadastro (somente administradores).

As rotas de cadastro/login exigem o token CSRF no cabeçalho `x-csrf-token` e o envio dos cookies. Consulte [documentação de autenticação](docs/autenticacao.md) para o contrato das rotas.

## Segurança e dados

- Senhas são armazenadas com Argon2id, nunca em texto puro.
- Sessões ficam no PostgreSQL e usam cookie HTTP-only.
- Cadastro e login têm limitação inicial de tentativas.
- Rotas de alteração de estado exigem token CSRF.
- Não existem contas administrativas ou senhas padrão no código.
- Segredos ficam em variáveis de ambiente, nunca no repositório.
- Não use dados reais de estudantes ou professores sem autorização da escola.

## Estado do projeto

A fundação do backend, o modelo inicial do banco e a primeira etapa de autenticação estão preparados. A primeira versão das rotas de aprovação administrativa e da criação única do primeiro administrador foi adicionada. A interface inicial de login e cadastro também foi criada. Ainda faltam provisionamento seguro do primeiro administrador, verificação e recuperação de e-mail, segundo fator, reservas, interface completa, testes automatizados e implantação.

## Documentação

- [Arquitetura inicial](docs/arquitetura-inicial.md)
- [Modelo de dados](docs/modelo-de-dados.md)
- [Autenticação](docs/autenticacao.md)
