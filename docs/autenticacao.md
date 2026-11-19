# Autenticação — primeira etapa

## O que está implementado

- Cadastro público cria somente contas com perfil `teacher` e estado `pending`.
- O cadastro aceita e-mail institucional e e-mail de recuperação opcional.
- A lista de domínios institucionais pode ser configurada por `ALLOWED_EMAIL_DOMAINS`; enquanto estiver vazia, a validação verifica apenas o formato do e-mail. O domínio oficial da escola ainda precisa ser confirmado.
- Senhas são armazenadas com Argon2id, nunca em texto puro.
- Login libera somente contas com estado `active`.
- Sessões ficam no PostgreSQL, com cookie HTTP-only, SameSite configurável e Secure em produção. Se frontend e API ficarem em sites diferentes, avaliar `SESSION_COOKIE_SAME_SITE=none` somente com HTTPS e `NODE_ENV=production`.
- Rotas que alteram estado exigem token CSRF.
- Cadastro e login têm limite de tentativas.
- A rota `GET /api/auth/me` consulta o estado atual da conta no banco.

## Rotas

| Método | Rota | Finalidade |
| --- | --- | --- |
| GET | `/api/auth/csrf` | Cria/retorna token CSRF e inicia sessão anônima |
| POST | `/api/auth/register` | Cadastra professor como pendente |
| POST | `/api/auth/login` | Autentica conta ativa |
| GET | `/api/auth/me` | Consulta sessão atual |
| POST | `/api/auth/logout` | Encerra sessão |

Para `POST /register`, enviar `fullName`, `email`, `recoveryEmail` (opcional) e `password` em JSON, junto do cookie de sessão e do cabeçalho `x-csrf-token`. O login também exige o token CSRF. Clientes web devem enviar credenciais/cookies nas chamadas à API.

## Configuração obrigatória

Copie `.env.example` para `.env` e configure:
- `DATABASE_URL`: conexão PostgreSQL.
- `SESSION_SECRET`: segredo aleatório forte, com pelo menos 32 caracteres. Nunca versionar ou compartilhar.
- `CORS_ORIGIN`: origens exatas permitidas, separadas por vírgula.
- `SESSION_COOKIE_SAME_SITE`: `lax` por padrão; `none` exige HTTPS e modo de produção.
- `ALLOWED_EMAIL_DOMAINS`: domínio institucional confirmado pela escola, sem `@`. Não inventar o domínio.

Em produção, servir tudo por HTTPS e definir `NODE_ENV=production`.

## Ainda não implementado

- Provisionamento seguro do primeiro administrador.
- Aprovação/rejeição de cadastros por administradores.
- Verificação de e-mail e fluxo de recuperação de senha.
- Segundo fator obrigatório para administradores após ativação do sistema.
- Formulário completo de disciplinas e turmas do professor.
- Testes automatizados e teste integrado com PostgreSQL.

Não criar contas administrativas padrão nem colocar senhas ou segredos no repositório. O fluxo de bootstrap administrativo será implementado após validar com a escola quem terá autoridade para ativar o sistema.
