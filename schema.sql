-- schema.sql
-- Tables : salles, réservations, horaires
CREATE TABLE salles (
  id uuid PRIMARY KEY,
  nom text NOT NULL,
  capacite int NOT NULL,
  description text,
  prix_base int NOT NULL
);

CREATE TABLE horaires (
  id uuid PRIMARY KEY,
  salle_id uuid REFERENCES salles(id) NOT NULL,
  date date NOT NULL,
  heure_debut int NOT NULL,
  heure_fin int NOT NULL,
  disponible boolean NOT NULL DEFAULT true
);

CREATE TABLE reservations (
  id uuid PRIMARY KEY,
  salle_id uuid REFERENCES salles(id) NOT NULL,
  formule_id uuid,
  client_nom text NOT NULL,
  client_email text NOT NULL,
  client_tel text,
  client_entreprise text,
  date_resa date NOT NULL,
  heure_debut int NOT NULL,
  heure_fin int NOT NULL,
  montant_total int NOT NULL,
  statut text NOT NULL DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);
