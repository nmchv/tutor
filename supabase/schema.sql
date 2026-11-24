-- NMCHV Tutor — общая база данных PostgreSQL (Supabase)
-- Применять в общем Supabase-проекте NMCHV.
-- Не создаёт отдельную базу данных, использует существующую схему public
-- и таблицу auth.users (Supabase Auth).

-- ──────────────────────────────────────────────
-- Вспомогательная функция: роль текущего пользователя
-- ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce((
    SELECT role FROM tutor_user_roles WHERE user_id = auth.uid()
  ), '');
$$;

-- ──────────────────────────────────────────────
-- profiles — общий профиль пользователя (id = auth.users.id)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL DEFAULT '',
  full_name text NOT NULL DEFAULT '',
  photo_url text,
  bio text NOT NULL DEFAULT '',
  main_goal text NOT NULL DEFAULT '',
  directions text NOT NULL DEFAULT '[]',
  start_date date,
  status text NOT NULL DEFAULT 'Активно занимается',
  motivation text NOT NULL DEFAULT '',
  notify_freq text NOT NULL DEFAULT 'all',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ──────────────────────────────────────────────
-- tutor_user_roles — роль пользователя в сервисе тьюторства
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tutor_user_roles (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('student', 'tutor', 'admin')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

-- ──────────────────────────────────────────────
-- tutor_profiles / tutor_student_profiles — расширенные профили
-- (созданы в рамках общей схемы, не дублируют auth.users)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tutor_profiles (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  education text NOT NULL DEFAULT '',
  experience text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tutor_student_profiles (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  grade text,
  school text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ──────────────────────────────────────────────
-- tutor_students — связь тьютор ↔ ученик
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tutor_students (
  tutor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tutor_id, student_id)
);

-- ──────────────────────────────────────────────
-- tutor_educational_goals
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tutor_educational_goals (
  id bigserial PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL,
  set_date date NOT NULL,
  target_date date,
  priority text NOT NULL DEFAULT 'Обычный',
  status text NOT NULL DEFAULT 'Активна',
  criteria text NOT NULL DEFAULT '[]',
  tutor_comment text NOT NULL DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ──────────────────────────────────────────────
-- tutor_learning_routes
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tutor_learning_routes (
  id bigserial PRIMARY KEY,
  student_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Образовательный маршрут',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ──────────────────────────────────────────────
-- tutor_route_stages
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tutor_route_stages (
  id bigserial PRIMARY KEY,
  route_id bigint NOT NULL REFERENCES tutor_learning_routes(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_id bigint REFERENCES tutor_educational_goals(id) ON DELETE SET NULL,
  position integer NOT NULL DEFAULT 0,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  start_date date,
  end_date date,
  weight integer NOT NULL DEFAULT 1,
  priority text NOT NULL DEFAULT 'Обычный'
);

-- ──────────────────────────────────────────────
-- tutor_milestones
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tutor_milestones (
  id bigserial PRIMARY KEY,
  stage_id bigint NOT NULL REFERENCES tutor_route_stages(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  title text NOT NULL,
  due_date date,
  done boolean NOT NULL DEFAULT false,
  done_at timestamptz
);

-- ──────────────────────────────────────────────
-- tutor_resource_categories
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tutor_resource_categories (
  id bigserial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  position integer NOT NULL DEFAULT 0
);

-- ──────────────────────────────────────────────
-- tutor_resources
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tutor_resources (
  id bigserial PRIMARY KEY,
  owner_student_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  tutor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL,
  url text,
  tutor_note text NOT NULL DEFAULT '',
  stage_id bigint REFERENCES tutor_route_stages(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'К изучению',
  favorite boolean NOT NULL DEFAULT false,
  added_by_self boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ──────────────────────────────────────────────
-- tutor_tasks
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tutor_tasks (
  id bigserial PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stage_id bigint REFERENCES tutor_route_stages(id) ON DELETE SET NULL,
  milestone_id bigint REFERENCES tutor_milestones(id) ON DELETE SET NULL,
  goal_id bigint REFERENCES tutor_educational_goals(id) ON DELETE SET NULL,
  resource_id bigint REFERENCES tutor_resources(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  instructions text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'Самостоятельная работа',
  direction text NOT NULL DEFAULT '',
  priority text NOT NULL DEFAULT 'Обычный',
  status text NOT NULL DEFAULT 'Не начато',
  due_date date,
  link text,
  source text NOT NULL DEFAULT 'tutor',
  minutes_spent integer NOT NULL DEFAULT 0,
  tutor_feedback text NOT NULL DEFAULT '',
  completed_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ──────────────────────────────────────────────
-- tutor_task_comments
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tutor_task_comments (
  id bigserial PRIMARY KEY,
  task_id bigint NOT NULL REFERENCES tutor_tasks(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ──────────────────────────────────────────────
-- tutor_progress_records
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tutor_progress_records (
  id bigserial PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  value text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  direction text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'manual',
  recorded_at date NOT NULL
);

-- ──────────────────────────────────────────────
-- tutor_reflections
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tutor_reflections (
  id bigserial PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  answers text NOT NULL DEFAULT '{}',
  is_private boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ──────────────────────────────────────────────
-- tutor_reflection_questions
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tutor_reflection_questions (
  id bigserial PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  text text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ──────────────────────────────────────────────
-- tutor_activity_logs
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tutor_activity_logs (
  id bigserial PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  kind text NOT NULL,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ──────────────────────────────────────────────
-- tutor_events
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tutor_events (
  id bigserial PRIMARY KEY,
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'session',
  title text NOT NULL,
  starts_at timestamptz NOT NULL,
  note text NOT NULL DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- ──────────────────────────────────────────────
-- tutor_tools
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tutor_tools (
  id bigserial PRIMARY KEY,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  icon text NOT NULL DEFAULT 'tool',
  url text,
  category text NOT NULL DEFAULT 'Инструменты',
  status text NOT NULL DEFAULT 'Доступно',
  position integer NOT NULL DEFAULT 0
);

-- ──────────────────────────────────────────────
-- tutor_task_attachments
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tutor_task_attachments (
  id bigserial PRIMARY KEY,
  task_id bigint NOT NULL REFERENCES tutor_tasks(id) ON DELETE CASCADE,
  url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ──────────────────────────────────────────────
-- tutor_resource_attachments
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tutor_resource_attachments (
  id bigserial PRIMARY KEY,
  resource_id bigint NOT NULL REFERENCES tutor_resources(id) ON DELETE CASCADE,
  url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ──────────────────────────────────────────────
-- tutor_goal_history
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tutor_goal_history (
  id bigserial PRIMARY KEY,
  goal_id bigint NOT NULL REFERENCES tutor_educational_goals(id) ON DELETE CASCADE,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  field text NOT NULL,
  old_value text,
  new_value text
);

-- ──────────────────────────────────────────────
-- tutor_route_history
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tutor_route_history (
  id bigserial PRIMARY KEY,
  route_id bigint NOT NULL REFERENCES tutor_learning_routes(id) ON DELETE CASCADE,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  field text NOT NULL,
  old_value text,
  new_value text
);

-- ──────────────────────────────────────────────
-- notifications — общие уведомления (user_id = auth.users.id)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  link text,
  ref text,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ──────────────────────────────────────────────
-- Индексы
-- ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tutor_tasks_student ON tutor_tasks(student_id, status);
CREATE INDEX IF NOT EXISTS idx_tutor_tasks_stage ON tutor_tasks(stage_id);
CREATE INDEX IF NOT EXISTS idx_tutor_route_stages_student ON tutor_route_stages(student_id);
CREATE INDEX IF NOT EXISTS idx_tutor_milestones_student ON tutor_milestones(student_id);
CREATE INDEX IF NOT EXISTS idx_tutor_resources_owner ON tutor_resources(owner_student_id);
CREATE INDEX IF NOT EXISTS idx_tutor_resources_tutor ON tutor_resources(tutor_id);
CREATE INDEX IF NOT EXISTS idx_tutor_activity_logs_student ON tutor_activity_logs(student_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_tutor_students_tutor ON tutor_students(tutor_id);
CREATE INDEX IF NOT EXISTS idx_tutor_students_student ON tutor_students(student_id);

-- ──────────────────────────────────────────────
-- RLS: включить на всех таблицах сервиса
-- ──────────────────────────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_student_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_educational_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_learning_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_route_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_resource_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_progress_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_reflections ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_reflection_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_task_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_resource_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_goal_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutor_route_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- ──────────────────────────────────────────────
-- Политики: profiles
-- ──────────────────────────────────────────────
CREATE POLICY profiles_own ON profiles
  FOR ALL USING (id = auth.uid());
CREATE POLICY profiles_staff_view ON profiles
  FOR SELECT USING (
    current_user_role() IN ('tutor', 'admin')
    OR EXISTS (
      SELECT 1 FROM tutor_students
      WHERE tutor_students.student_id = profiles.id
      AND tutor_students.tutor_id = auth.uid()
    )
  );

-- ──────────────────────────────────────────────
-- Политики: tutor_user_roles
-- ──────────────────────────────────────────────
CREATE POLICY roles_own ON tutor_user_roles
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY roles_staff_manage ON tutor_user_roles
  FOR ALL USING (current_user_role() = 'admin');

-- ──────────────────────────────────────────────
-- Политики: tutor_students
-- ──────────────────────────────────────────────
CREATE POLICY tutor_students_own_link ON tutor_students
  FOR ALL USING (tutor_id = auth.uid() OR student_id = auth.uid());
CREATE POLICY tutor_students_admin ON tutor_students
  FOR ALL USING (current_user_role() = 'admin');

-- ──────────────────────────────────────────────
-- Политики: tutor_educational_goals
-- ──────────────────────────────────────────────
CREATE POLICY goals_student_own ON tutor_educational_goals
  FOR ALL USING (student_id = auth.uid() AND current_user_role() = 'student');
CREATE POLICY goals_staff_linked ON tutor_educational_goals
  FOR ALL USING (
    current_user_role() IN ('tutor', 'admin')
    AND EXISTS (
      SELECT 1 FROM tutor_students
      WHERE tutor_students.student_id = tutor_educational_goals.student_id
      AND (tutor_students.tutor_id = auth.uid() OR current_user_role() = 'admin')
    )
  );

-- ──────────────────────────────────────────────
-- Политики: tutor_learning_routes
-- ──────────────────────────────────────────────
CREATE POLICY routes_student_own ON tutor_learning_routes
  FOR ALL USING (student_id = auth.uid() AND current_user_role() = 'student');
CREATE POLICY routes_staff_linked ON tutor_learning_routes
  FOR ALL USING (
    current_user_role() IN ('tutor', 'admin')
    AND (student_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM tutor_students
        WHERE tutor_students.student_id = tutor_learning_routes.student_id
        AND (tutor_students.tutor_id = auth.uid() OR current_user_role() = 'admin')
      )
    )
  );

-- ──────────────────────────────────────────────
-- Политики: tutor_route_stages
-- ──────────────────────────────────────────────
CREATE POLICY stages_student_own ON tutor_route_stages
  FOR SELECT USING (student_id = auth.uid() AND current_user_role() = 'student');
CREATE POLICY stages_staff_linked ON tutor_route_stages
  FOR ALL USING (
    current_user_role() IN ('tutor', 'admin')
    AND EXISTS (
      SELECT 1 FROM tutor_students
      WHERE tutor_students.student_id = tutor_route_stages.student_id
      AND (tutor_students.tutor_id = auth.uid() OR current_user_role() = 'admin')
    )
  );

-- ──────────────────────────────────────────────
-- Политики: tutor_milestones
-- ──────────────────────────────────────────────
CREATE POLICY milestones_student_own ON tutor_milestones
  FOR ALL USING (student_id = auth.uid() AND current_user_role() = 'student');
CREATE POLICY milestones_staff_linked ON tutor_milestones
  FOR ALL USING (
    current_user_role() IN ('tutor', 'admin')
    AND EXISTS (
      SELECT 1 FROM tutor_students
      WHERE tutor_students.student_id = tutor_milestones.student_id
      AND (tutor_students.tutor_id = auth.uid() OR current_user_role() = 'admin')
    )
  );

-- ──────────────────────────────────────────────
-- Политики: tutor_resource_categories
-- ──────────────────────────────────────────────
CREATE POLICY resource_categories_read ON tutor_resource_categories
  FOR SELECT USING (true);

-- ──────────────────────────────────────────────
-- Политики: tutor_resources
-- ──────────────────────────────────────────────
CREATE POLICY resources_student_own ON tutor_resources
  FOR ALL USING (
    owner_student_id = auth.uid()
    AND (current_user_role() = 'student' OR added_by_self = false OR tutor_id = auth.uid())
  );
CREATE POLICY resources_staff_linked ON tutor_resources
  FOR ALL USING (
    current_user_role() IN ('tutor', 'admin')
    AND (tutor_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM tutor_students
        WHERE tutor_students.student_id = tutor_resources.owner_student_id
        AND (tutor_students.tutor_id = auth.uid() OR current_user_role() = 'admin')
      )
    )
  );

-- ──────────────────────────────────────────────
-- Политики: tutor_tasks
-- ──────────────────────────────────────────────
CREATE POLICY tasks_student_own ON tutor_tasks
  FOR ALL USING (
    student_id = auth.uid()
    AND (current_user_role() = 'student' OR source = 'personal' OR created_by = auth.uid())
  );
CREATE POLICY tasks_staff_linked ON tutor_tasks
  FOR ALL USING (
    current_user_role() IN ('tutor', 'admin')
    AND EXISTS (
      SELECT 1 FROM tutor_students
      WHERE tutor_students.student_id = tutor_tasks.student_id
      AND (tutor_students.tutor_id = auth.uid() OR current_user_role() = 'admin')
    )
  );

-- ──────────────────────────────────────────────
-- Политики: tutor_task_comments
-- ──────────────────────────────────────────────
CREATE POLICY task_comments_linked ON tutor_task_comments
  FOR ALL USING (
    author_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM tutor_tasks
      WHERE tutor_tasks.id = tutor_task_comments.task_id
      AND tutor_tasks.student_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM tutor_tasks t
      JOIN tutor_students ts ON ts.student_id = t.student_id
      WHERE t.id = tutor_task_comments.task_id
      AND (ts.tutor_id = auth.uid() OR current_user_role() = 'admin')
    )
  );

-- ──────────────────────────────────────────────
-- Политики: tutor_progress_records
-- ──────────────────────────────────────────────
CREATE POLICY records_student_own ON tutor_progress_records
  FOR ALL USING (student_id = auth.uid() AND current_user_role() = 'student');
CREATE POLICY records_staff_linked ON tutor_progress_records
  FOR ALL USING (
    current_user_role() IN ('tutor', 'admin')
    AND EXISTS (
      SELECT 1 FROM tutor_students
      WHERE tutor_students.student_id = tutor_progress_records.student_id
      AND (tutor_students.tutor_id = auth.uid() OR current_user_role() = 'admin')
    )
  );

-- ──────────────────────────────────────────────
-- Политики: tutor_reflections
-- ──────────────────────────────────────────────
CREATE POLICY reflections_student_own ON tutor_reflections
  FOR ALL USING (student_id = auth.uid() AND current_user_role() = 'student');
CREATE POLICY reflections_staff_view ON tutor_reflections
  FOR SELECT USING (
    current_user_role() IN ('tutor', 'admin')
    AND NOT is_private
    AND EXISTS (
      SELECT 1 FROM tutor_students
      WHERE tutor_students.student_id = tutor_reflections.student_id
      AND (tutor_students.tutor_id = auth.uid() OR current_user_role() = 'admin')
    )
  );

-- ──────────────────────────────────────────────
-- Политики: tutor_reflection_questions
-- ──────────────────────────────────────────────
CREATE POLICY reflection_questions_linked ON tutor_reflection_questions
  FOR ALL USING (
    student_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM tutor_students
      WHERE tutor_students.student_id = tutor_reflection_questions.student_id
      AND (tutor_students.tutor_id = auth.uid() OR current_user_role() = 'admin')
    )
  );

-- ──────────────────────────────────────────────
-- Политики: tutor_activity_logs
-- ──────────────────────────────────────────────
CREATE POLICY activity_logs_linked ON tutor_activity_logs
  FOR ALL USING (
    student_id = auth.uid()
    OR actor_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM tutor_students
      WHERE tutor_students.student_id = tutor_activity_logs.student_id
      AND (tutor_students.tutor_id = auth.uid() OR current_user_role() = 'admin')
    )
  );

-- ──────────────────────────────────────────────
-- Политики: tutor_events
-- ──────────────────────────────────────────────
CREATE POLICY events_student_own ON tutor_events
  FOR ALL USING (student_id = auth.uid() AND current_user_role() = 'student');
CREATE POLICY events_staff_linked ON tutor_events
  FOR ALL USING (
    current_user_role() IN ('tutor', 'admin')
    AND EXISTS (
      SELECT 1 FROM tutor_students
      WHERE tutor_students.student_id = tutor_events.student_id
      AND (tutor_students.tutor_id = auth.uid() OR current_user_role() = 'admin')
    )
  );

-- ──────────────────────────────────────────────
-- Политики: tutor_tools (публичное чтение, админ — управление)
-- ──────────────────────────────────────────────
CREATE POLICY tools_read ON tutor_tools FOR SELECT USING (true);
CREATE POLICY tools_admin ON tutor_tools FOR ALL USING (current_user_role() = 'admin');

-- ──────────────────────────────────────────────
-- Политики: вложения и история (через связанные сущности)
-- ──────────────────────────────────────────────
CREATE POLICY task_attachments_linked ON tutor_task_attachments
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM tutor_tasks
      WHERE tutor_tasks.id = tutor_task_attachments.task_id
      AND (tutor_tasks.student_id = auth.uid() OR tutor_tasks.created_by = auth.uid())
    )
    OR current_user_role() IN ('tutor', 'admin')
  );
CREATE POLICY resource_attachments_linked ON tutor_resource_attachments
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM tutor_resources
      WHERE tutor_resources.id = tutor_resource_attachments.resource_id
      AND (tutor_resources.owner_student_id = auth.uid() OR tutor_resources.tutor_id = auth.uid())
    )
    OR current_user_role() IN ('tutor', 'admin')
  );
CREATE POLICY goal_history_linked ON tutor_goal_history
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM tutor_educational_goals
      WHERE tutor_educational_goals.id = tutor_goal_history.goal_id
      AND (tutor_educational_goals.student_id = auth.uid())
    )
    OR current_user_role() IN ('tutor', 'admin')
  );
CREATE POLICY route_history_linked ON tutor_route_history
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM tutor_learning_routes
      WHERE tutor_learning_routes.id = tutor_route_history.route_id
      AND (tutor_learning_routes.student_id = auth.uid())
    )
    OR current_user_role() IN ('tutor', 'admin')
  );

-- ──────────────────────────────────────────────
-- Политики: notifications
-- ──────────────────────────────────────────────
CREATE POLICY notifications_own ON notifications
  FOR ALL USING (user_id = auth.uid());
