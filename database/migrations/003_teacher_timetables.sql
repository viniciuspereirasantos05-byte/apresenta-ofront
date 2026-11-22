-- Grade semanal dos professores. weekday ISO: 1=segunda ... 5=sexta.
CREATE TABLE teacher_timetable_entries (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 class_group_id UUID NOT NULL REFERENCES class_groups(id),
 subject_id UUID NOT NULL REFERENCES subjects(id),
 lesson_period_id UUID NOT NULL REFERENCES lesson_periods(id),
 weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 5),
 active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 FOREIGN KEY (teacher_id, subject_id, class_group_id)
   REFERENCES teacher_assignments (teacher_id, subject_id, class_group_id) ON DELETE CASCADE,
 UNIQUE (teacher_id, weekday, lesson_period_id),
 UNIQUE (class_group_id, weekday, lesson_period_id)
);
CREATE INDEX teacher_timetable_teacher_idx ON teacher_timetable_entries (teacher_id, weekday, lesson_period_id) WHERE active = TRUE;
CREATE TABLE timetable_change_requests (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 proposed_entries JSONB NOT NULL CHECK (jsonb_typeof(proposed_entries) = 'array'),
 message VARCHAR(500),
 status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
 reviewed_by UUID REFERENCES users(id),
 reviewed_at TIMESTAMPTZ,
 review_message VARCHAR(500),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX timetable_change_requests_pending_idx ON timetable_change_requests (created_at) WHERE status = 'pending';
