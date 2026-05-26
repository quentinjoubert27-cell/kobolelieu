-- migration-02-formules.sql
CREATE TABLE formules (
  id uuid PRIMARY KEY,
  nom text NOT NULL,
  description text,
  prix int NOT NULL
);
