-- Kennedy Labs: primeira estrutura relacional.
-- PostgreSQL 15+. Não inclui usuários reais nem credenciais.

CREATE TABLE app_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(140) NOT NULL,
  email VARCHAR(254) NOT NULL,
  password_hash TEXT,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'teacher')),
  account_status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (account_status IN ('pending', 'active', 'rejected', 'suspended')),
  two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX users_email_lower_uq ON users (LOWER(email));

CREATE TABLE subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE class_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(80) NOT NULL UNIQUE,
  school_year SMALLINT,
  shift VARCHAR(15) NOT NULL CHECK (shift IN ('morning', 'afternoon', 'evening')),
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE teacher_assignments (
  teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id),
  class_group_id UUID NOT NULL REFERENCES class_groups(id),
  PRIMARY KEY (teacher_id, subject_id, class_group_id)
);

CREATE TABLE spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(80) NOT NULL UNIQUE,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE lesson_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift VARCHAR(15) NOT NULL CHECK (shift IN ('morning', 'afternoon', 'evening')),
  period_number SMALLINT NOT NULL CHECK (period_number BETWEEN 1 AND 10),
  starts_at TIME NOT NULL,
  ends_at TIME NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  CHECK (ends_at > starts_at),
  UNIQUE (shift, period_number)
);

CREATE TABLE reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES users(id),
  class_group_id UUID NOT NULL REFERENCES class_groups(id),
  purpose TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ
);

-- Uma linha por aula reservada. A restrição UNIQUE impede duas reservas
-- ativas do mesmo espaço na mesma data e período, inclusive em concorrência.
CREATE TABLE reservation_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  space_id UUID NOT NULL REFERENCES spaces(id),
  reservation_date DATE NOT NULL,
  lesson_period_id UUID NOT NULL REFERENCES lesson_periods(id),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (reservation_id, lesson_period_id)
);
CREATE UNIQUE INDEX reservation_slots_active_space_period_uq
  ON reservation_slots (space_id, reservation_date, lesson_period_id)
  WHERE is_active = TRUE;
CREATE INDEX reservation_slots_date_idx ON reservation_slots (reservation_date);
CREATE INDEX reservations_teacher_idx ON reservations (teacher_id, created_at DESC);

CREATE TABLE calendar_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL REFERENCES users(id),
  space_id UUID REFERENCES spaces(id),
  block_date DATE NOT NULL,
  lesson_period_id UUID REFERENCES lesson_periods(id),
  reason VARCHAR(240) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (space_id IS NOT NULL OR lesson_period_id IS NOT NULL OR reason <> '')
);
CREATE INDEX calendar_blocks_date_idx ON calendar_blocks (block_date);

CREATE TABLE support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opened_by UUID NOT NULL REFERENCES users(id),
  reservation_id UUID REFERENCES reservations(id),
  subject VARCHAR(160) NOT NULL,
  description TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  assigned_to UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(160) NOT NULL,
  message TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX notifications_user_unread_idx ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE TABLE audit_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id UUID REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id UUID,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX audit_logs_created_at_idx ON audit_logs (created_at DESC);

-- Espaços iniciais: podem ser editados pelo painel administrativo.
INSERT INTO spaces (name, description) VALUES
  ('Laboratório 1', 'Laboratório de informática 1'),
  ('Laboratório 2', 'Laboratório de informática 2'),
  ('Laboratório 3', 'Laboratório de informática 3'),
  ('Auditório', 'Auditório da escola')
ON CONFLICT (name) DO NOTHING;
