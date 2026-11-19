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

## Configuração do primeiro administrador

A rota `POST /api/setup/first-admin` cria apenas o primeiro administrador. Ela fica indisponível se `ADMIN_SETUP_SECRET` não estiver configurado com pelo menos 32 caracteres. O segredo é validado em tempo constante, a criação usa bloqueio transacional no PostgreSQL e o banco impede uma segunda inicialização. Depois de criar a conta, remova imediatamente `ADMIN_SETUP_SECRET` das variáveis de ambiente do serviço. Nunca envie esse segredo pelo chat ou para o GitHub.

O formulário de primeiro administrador ainda não faz parte da interface pública; a criação deverá ser executada pela pessoa autorizada pela escola durante a implantação, com o segredo configurado diretamente no ambiente do servidor.

## Rotas

| Método | Rota | Finalidade |
| --- | --- | --- |
| GET | `/api/auth/csrf` | Cria/retorna token CSRF e inicia sessão anônima |
| POST | `/api/auth/register` | Cadastra professor como pendente |
| POST | `/api/auth/login` | Autentica conta ativa |
| GET | `/api/auth/me` | Consulta sessão atual |
| POST | `/api/auth/logout` | Encerra sessão |
| POST | `/api/setup/first-admin` | Cria o primeiro administrador uma única vez (com segredo de configuração) |
| GET | `/api/admin/teachers/pending` | Lista cadastros pendentes (admin) |
| POST | `/api/admin/teachers/:teacherId/approve` | Aprova professor (admin) |
| POST | `/api/admin/teachers/:teacherId/reject` | Rejeita cadastro (admin) |

Para `POST /register`, enviar `fullName`, `email`, `recoveryEmail` (opcional) e `password` em JSON, junto do cookie de sessão e do cabeçalho `x-csrf-token`. O login também exige o token CSRF. Clientes web devem enviar credenciais/cookies nas chamadas à API.

## Configuração obrigatória

Copie `.env.example` para `.env` e configure:
- `DATABASE_URL`: conexão PostgreSQL.
- `SESSION_SECRET`: segredo aleatório forte, com pelo menos 32 caracteres. Nunca versionar ou compartilhar.
- `ADMIN_SETUP_SECRET`: segredo temporário aleatório forte, com pelo menos 32 caracteres, usado uma única vez para criar o primeiro administrador; removê-lo imediatamente após o uso.
- `CORS_ORIGIN`: origens exatas permitidas, separadas por vírgula.
- `SESSION_COOKIE_SAME_SITE`: `lax` por padrão; `none` exige HTTPS e modo de produção.
- `ALLOWED_EMAIL_DOMAINS`: domínio institucional confirmado pela escola, sem `@`. Não inventar o domínio.

Em produção, servir tudo por HTTPS e definir `NODE_ENV=production`.

## Ainda não implementado

- Interface guiada para provisionar o primeiro administrador durante a implantação; a rota protegida de criação única já está preparada.
- Testes automatizados e teste integrado com PostgreSQL.
- Verificação de e-mail e fluxo de recuperação de senha.
- Segundo fator obrigatório para administradores após ativação do sistema.
- Formulário completo de disciplinas e turmas do professor.

Não criar contas administrativas padrão nem colocar senhas ou segredos no repositório. O uso da rota de bootstrap deve ocorrer somente após validar com a escola quem terá autoridade para criar a primeira conta administrativa.
