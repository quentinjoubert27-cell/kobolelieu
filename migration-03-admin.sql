-- migration-03-admin.sql
CREATE TABLE admin_audit_logs (
  id uuid PRIMARY KEY,
  action text NOT NULL,
  admin_email text,
  reservation_id uuid,
  details jsonb,
  created_at timestamptz DEFAULT now()
);
