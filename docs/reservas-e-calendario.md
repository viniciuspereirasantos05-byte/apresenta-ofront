# Reservas e calendário — Kennedy Labs

## API do professor

Todas as rotas abaixo exigem sessão autenticada de professor ativo:

- `GET /api/teacher/spaces`: lista espaços ativos.
- `GET /api/teacher/class-groups`: lista turmas ativas.
- `GET /api/teacher/periods`: lista períodos cadastrados.
- `GET /api/teacher/availability?date=AAAA-MM-DD&spaceId=UUID`: consulta horários reservados e bloqueados.
- `POST /api/teacher/reservations`: cria uma reserva.
- `GET /api/teacher/reservations/mine`: histórico do professor.
- `GET /api/teacher/notifications`: avisos internos.
- `POST /api/teacher/notifications/:notificationId/read`: marca um aviso como lido.

A criação exige token CSRF no cabeçalho `x-csrf-token`. O corpo de uma reserva contém `date`, `spaceId`, `classGroupId`, `purpose` e uma lista `periodIds`.

## Garantias da reserva

- A conta deve estar ativa e ter perfil de professor.
- Espaço, turma e períodos precisam estar ativos.
- Os períodos selecionados devem pertencer ao turno da turma.
- Datas passadas são recusadas usando o fuso configurado em `SCHOOL_TIME_ZONE` (padrão `America/Sao_Paulo`).
- A finalidade precisa ter de 3 a 500 caracteres.
- Todos os períodos são inseridos em uma única transação. Se um período estiver ocupado, a operação inteira é desfeita.
- Um índice único parcial no PostgreSQL impede duas reservas ativas para o mesmo espaço, data e período, inclusive em solicitações concorrentes.
- Bloqueios de calendário são verificados no servidor, não apenas na interface.
- O histórico não permite ao professor editar uma reserva confirmada. O fluxo de cancelamento/solicitação de alteração ainda depende da definição da regra escolar.

## Bloqueios administrativos

Rotas administrativas (somente administrador ativo):

- `GET /api/admin/spaces` e `GET /api/admin/periods`: opções para o painel.
- `GET /api/admin/calendar-blocks`: lista bloqueios.
- `POST /api/admin/calendar-blocks`: cria bloqueio de dia inteiro, espaço ou período.
- `DELETE /api/admin/calendar-blocks/:blockId`: remove bloqueio.

O corpo de criação contém `date`, `spaceId` (opcional), `periodId` (opcional) e `reason`. Quando o bloqueio coincide com reservas confirmadas, a API retorna um aviso com a quantidade de professores afetados. A administração precisa confirmar explicitamente; então os professores afetados recebem uma notificação interna.

## Dados que ainda precisam ser cadastrados

Não foram inventados horários, turmas ou períodos. A tabela `lesson_periods` e `class_groups` ainda precisam receber a grade oficial da escola. A interface informa quando esses dados não estão configurados.

## Pendências de regra

- Definir com a escola o prazo exato de cancelamento ("até uma aula antes").
- Definir como funcionam reservas recorrentes.
- Definir a política para reagendar ou cancelar reservas que já foram afetadas por um bloqueio administrativo.
- Implantar envio de avisos por e-mail; nesta etapa, os avisos são internos.
