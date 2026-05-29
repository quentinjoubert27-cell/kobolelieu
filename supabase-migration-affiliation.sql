-- ============================================================================
-- MIGRATION : Système d'affiliation Kōbō Le Lieu
-- À exécuter dans Supabase Dashboard > SQL Editor
-- ============================================================================

-- 1. Table des affiliés
CREATE TABLE IF NOT EXISTS affilies (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nom               TEXT NOT NULL,
  email             TEXT NOT NULL UNIQUE,
  code              TEXT NOT NULL UNIQUE,              -- ex: "MARIE" ou "JOHN"
  token             TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  stripe_account_id TEXT,                              -- Stripe Connect account ID
  stripe_onboarded  BOOLEAN NOT NULL DEFAULT false,
  taux_commission   DECIMAL(5,2) NOT NULL DEFAULT 10.00,
  statut            TEXT NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif', 'suspendu')),
  total_clics       INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Table des commissions (une par réservation affiliée)
CREATE TABLE IF NOT EXISTS commissions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affilie_id          UUID NOT NULL REFERENCES affilies(id) ON DELETE RESTRICT,
  reservation_id      UUID NOT NULL REFERENCES reservations(id) ON DELETE RESTRICT,
  montant_reservation INT  NOT NULL,                   -- centimes
  taux                DECIMAL(5,2) NOT NULL,           -- % appliqué
  montant_commission  INT  NOT NULL,                   -- centimes
  statut              TEXT NOT NULL DEFAULT 'en_attente'
                      CHECK (statut IN ('en_attente', 'verse', 'annule')),
  stripe_transfer_id  TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at             TIMESTAMPTZ,
  UNIQUE(reservation_id)                               -- une seule commission par résa
);

-- 3. Réglages globaux (taux par défaut, modifiable par l'admin)
CREATE TABLE IF NOT EXISTS affiliation_settings (
  id          INT PRIMARY KEY DEFAULT 1,
  taux_defaut DECIMAL(5,2) NOT NULL DEFAULT 10.00,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO affiliation_settings (id, taux_defaut)
VALUES (1, 10.00)
ON CONFLICT (id) DO NOTHING;

-- 4. Ajouter la colonne code affilié dans les réservations
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS affilie_code TEXT;

-- 5. Fonction pour incrémenter les clics (appelée depuis l'API)
CREATE OR REPLACE FUNCTION increment_clics(p_code TEXT)
RETURNS void
LANGUAGE SQL
SECURITY DEFINER
AS $$
  UPDATE affilies
  SET total_clics = total_clics + 1
  WHERE code = p_code AND statut = 'actif';
$$;

-- 6. Index pour les requêtes fréquentes
CREATE INDEX IF NOT EXISTS idx_commissions_affilie_id ON commissions(affilie_id);
CREATE INDEX IF NOT EXISTS idx_commissions_statut ON commissions(statut);
CREATE INDEX IF NOT EXISTS idx_affilies_code ON affilies(code);
CREATE INDEX IF NOT EXISTS idx_affilies_token ON affilies(token);
CREATE INDEX IF NOT EXISTS idx_reservations_affilie_code ON reservations(affilie_code);
