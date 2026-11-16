import { useEffect, useState } from 'react';
import { apiFetch } from '../api';

type OrigineRepere = 'CHANTIER' | 'INTERVENTION' | 'CONTRAT';

// Texte de l'avertissement, qui nomme l'origine choisie.
const texteRepereDejaFacturee: Record<OrigineRepere, string> = {
  CHANTIER: 'Cette affaire a déjà une facture non annulée : vérifiez avant d’en créer une autre.',
  INTERVENTION: 'Cette intervention a déjà une facture non annulée : vérifiez avant d’en créer une autre.',
  CONTRAT: 'Ce contrat a déjà une facture non annulée : vérifiez avant d’en créer une autre.',
};

// Repère « déjà facturée » du formulaire de création (lot « Assistante technique », AT-4 ; message de Nelson du
// 09-11-2026, « Oui il faut un repere deja facturer ») : un avertissement, sans montant ni numéro, quand une
// facture non annulée porte déjà l'origine choisie, de qui qu'elle soit, hors facture émise à 0,00 € (décision du
// 16-11-2026, #529). Il ne bloque rien : la création reste possible, et une lecture qui échoue n'affiche rien.
// Affiché pour l'administration comme pour l'assistante technique (GET /api/factures/deja-facturee).
export default function RepereDejaFacturee({ origine, id }: { origine: OrigineRepere; id: string }) {
  const [dejaFacturee, setDejaFacturee] = useState(false);

  useEffect(() => {
    let actif = true;
    setDejaFacturee(false);
    (async () => {
      try {
        const reponse = await apiFetch(`/factures/deja-facturee?origine=${encodeURIComponent(origine)}&id=${encodeURIComponent(id)}`);
        if (!reponse.ok) return;
        const donnees = await reponse.json().catch(() => null);
        if (actif) setDejaFacturee(donnees?.dejaFacturee === true);
      } catch {
        // Avertissement facultatif : sans réponse, rien ne s'affiche.
      }
    })();
    return () => { actif = false; };
  }, [origine, id]);

  if (!dejaFacturee) return null;
  return <p role="status" aria-label="Origine déjà facturée" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">{texteRepereDejaFacturee[origine]}</p>;
}
