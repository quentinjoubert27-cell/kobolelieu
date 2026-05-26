// ============================================================================
// api/webhook-stripe.js — Réception des événements Stripe
// ============================================================================
// Confirme la réservation côté serveur (source de vérité du paiement) et
// envoie DEUX emails : un au client, un à l'admin (notification).
// ============================================================================

import { supabaseAdmin, stripe } from '../lib/clients.js';
import {
  envoyerEmailConfirmation,
  envoyerEmailNotificationAdmin,
} from '../lib/email.js';

export const config = {
  api: { bodyParser: false },
};

function lireCorpsBrut(req) {
  return new Promise((resolve, reject) => {
    const morceaux = [];
    req.on('data', (c) => morceaux.push(c));
    req.on('end', () => resolve(Buffer.concat(morceaux)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  let event;

  // ----------------- Vérifier la signature Stripe -----------------
  try {
    const corpsBrut = await lireCorpsBrut(req);
    const signature = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(
      corpsBrut,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('[webhook] Signature invalide :', err.message);
    return res.status(400).json({ error: `Signature invalide : ${err.message}` });
  }

  // ----------------- Traiter l'événement -----------------
  try {
    switch (event.type) {

      // ---- Paiement réussi ----
      case 'checkout.session.completed': {
        const session = event.data.object;
        const reservationId = session.metadata?.reservation_id
          || session.client_reference_id;

        if (!reservationId) {
          console.warn('[webhook] session sans reservation_id');
          break;
        }

        // Marquer la résa "confirmee" (idempotent : seulement si "en_attente")
        const { data: resa, error } = await supabaseAdmin
          .from('reservations')
          .update({
            statut: 'confirmee',
            confirmed_at: new Date().toISOString(),
            stripe_payment_id: session.payment_intent,
          })
          .eq('id', reservationId)
          .eq('statut', 'en_attente')
          .select('*, salles(nom), formules(nom)')
          .single();

        if (error) {
          console.error('[webhook] échec confirmation résa :', error);
          break;
        }

        if (resa) {
          console.log(`[webhook] Réservation ${reservationId} confirmée.`);

          // Envoyer les emails en parallèle, sans bloquer le webhook
          const taches = [
            envoyerEmailConfirmation(resa)
              .catch(e => console.error('[webhook] email client :', e.message)),
            envoyerEmailNotificationAdmin(resa)
              .catch(e => console.error('[webhook] email admin :', e.message)),
          ];
          await Promise.allSettled(taches);
        }
        break;
      }

      // ---- Session expirée ----
      case 'checkout.session.expired': {
        const session = event.data.object;
        const reservationId = session.metadata?.reservation_id
          || session.client_reference_id;
        if (reservationId) {
          await supabaseAdmin
            .from('reservations')
            .update({ statut: 'expiree' })
            .eq('id', reservationId)
            .eq('statut', 'en_attente');
          console.log(`[webhook] Réservation ${reservationId} expirée.`);
        }
        break;
      }

      default:
        break;
    }

    return res.status(200).json({ recu: true });
  } catch (err) {
    console.error('[webhook] erreur traitement :', err);
    return res.status(500).json({ error: 'Erreur webhook' });
  }
}
