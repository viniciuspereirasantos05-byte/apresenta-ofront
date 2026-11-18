# Modelo inicial de dados — Kennedy Labs

Esta é a primeira versão do modelo relacional. Ela prepara a estrutura, mas não substitui a validação da grade oficial da escola.

## Entidades

- **users**: contas de professores e administradores, estado de aprovação e configuração de segundo fator.
- **subjects**, **class_groups** e **teacher_assignments**: matérias, turmas e vínculo entre professor, matéria e turma.
- **spaces**: Laboratório 1, Laboratório 2, Laboratório 3 e Auditório.
- **lesson_periods**: períodos/aulas por turno. Os horários exatos serão cadastrados somente após conferirmos a grade oficial.
- **reservations**: reserva principal, vinculada ao professor e à turma.
- **reservation_slots**: cada aula/período ocupado por uma reserva. Uma reserva de duas aulas terá dois registros.
- **calendar_blocks**: bloqueios de datas, períodos ou espaços feitos pela administração.
- **support_tickets**: chamados de professores, inclusive pedidos de alteração de reserva.
- **notifications**: avisos internos.
- **audit_logs**: histórico de ações administrativas e operações importantes.
- **app_settings**: configurações gerais do sistema, incluindo a ativação inicial.

## Regra de conflito

O índice parcial `reservation_slots_active_space_period_uq` impede que duas reservas ativas ocupem o mesmo espaço, data e período. Ao cancelar uma reserva, o backend deverá marcar seus itens em `reservation_slots` como `is_active = FALSE` dentro da mesma transação que atualiza a reserva. Assim, o horário poderá ser reservado novamente sem apagar o histórico.

O backend também deverá verificar bloqueios de calendário, estado da conta, antecedência de cancelamento e permissões. Essas regras não devem depender apenas da interface.

## Aplicação da migração

O projeto já inclui um executor de migrações em `backend/src/migrate.js`. Quando o PostgreSQL estiver instalado e o banco local criado, entre na pasta `backend`, configure `.env` a partir de `.env.example` e execute `npm run db:migrate`. O executor registra migrações aplicadas em `schema_migrations` e não as repete.

## Decisões ainda pendentes

1. Conferir os horários oficiais de cada turno e período.
2. Confirmar os nomes/códigos oficiais das turmas e matérias.
3. Definir a regra exata para cancelar até uma aula antes.
4. Definir se recorrências são criadas como várias reservas independentes ou como um grupo.
5. Confirmar domínio de e-mail institucional e política de segundo fator.
6. Definir quais dados de finalidade da reserva serão obrigatórios.

Nenhuma conta administrativa padrão, senha ou dado pessoal real foi inserido nesta migração.
