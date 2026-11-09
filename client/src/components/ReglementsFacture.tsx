import { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { formatCompanyDateTime, formatDateOnly } from '../lib/dateFormatting';
import { libelleMoyen } from '../lib/reglements';
import { fmtEuroCentime } from '../lib/formats';

// Part d'un règlement affectée à la facture, telle que la lit GET /api/factures/:id/reglements : ni les autres
// factures du règlement, ni son montant total (AT-3 ; point 33 et réponse 1 du 09-11-2026).
type PartReglement = {
  id: string;
  montant: number;
  reglement: {
    id: string; dateReglement: string; moyen: string; reference: string | null;
    statut: 'ENREGISTRE' | 'CONTREPASSE'; contrepasseLe: string | null; motifContrepassation: string | null;
  };
};

// Règlements reçus par une facture, en lecture, sous la liste des factures : la saisie et la contre-passation
// restent à l'écran Règlements, réservé à l'administration.
export default function ReglementsFacture({ factureId, numero, fuseauHoraire, onFermer }: {
  factureId: string; numero: string | null; fuseauHoraire: string | null; onFermer: () => void;
}) {
  const [parts, setParts] = useState<PartReglement[] | null>(null);
  const [erreur, setErreur] = useState('');
  const [relecture, setRelecture] = useState(0);

  useEffect(() => {
    let actif = true;
    setParts(null);
    setErreur('');
    (async () => {
      try {
        const reponse = await apiFetch(`/factures/${factureId}/reglements`);
        const donnees = await reponse.json();
        if (!reponse.ok) throw new Error(donnees?.error || 'Lecture des règlements impossible.');
        if (actif) setParts(donnees as PartReglement[]);
      } catch (e) {
        if (actif) setErreur(e instanceof Error ? e.message : 'Lecture des règlements impossible.');
      }
    })();
    return () => { actif = false; };
  }, [factureId, relecture]);

  return (
    <section id="reglements-facture" role="region" aria-label="Règlements de la facture" className="rounded-xl border bg-white p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">Règlements de la facture {numero}</h2>
        <button type="button" className="btn btn-secondary" onClick={onFermer}>Fermer</button>
      </div>
      {!parts && !erreur && <p role="status">Chargement des règlements…</p>}
      {erreur && <div role="alert"><p>{erreur}</p><button type="button" className="btn btn-secondary" onClick={() => setRelecture((n) => n + 1)}>Réessayer</button></div>}
      {parts && !parts.length && <p className="text-sm text-gray-600">Aucun règlement reçu.</p>}
      {parts && parts.length > 0 && (
        <div className="overflow-x-auto">
          <table aria-label="Parts de règlement affectées à la facture" className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr><th className="p-3">Date</th><th className="p-3">Moyen</th><th className="p-3">Montant affecté</th><th className="p-3">Statut</th></tr>
            </thead>
            <tbody>
              {parts.map((part) => (
                <tr key={part.id} className="border-t align-top">
                  <td className="p-3">{formatDateOnly(part.reglement.dateReglement)}</td>
                  <td className="p-3">{libelleMoyen(part.reglement.moyen)}{part.reglement.reference && <span className="block text-xs text-gray-500">Réf. {part.reglement.reference}</span>}</td>
                  <td className="p-3">{fmtEuroCentime(part.montant)}</td>
                  <td className="p-3">
                    {part.reglement.statut === 'ENREGISTRE' ? 'Enregistré' : (
                      <span>Contre-passé{part.reglement.contrepasseLe && fuseauHoraire && ` le ${formatCompanyDateTime(part.reglement.contrepasseLe, fuseauHoraire)}`}
                        {part.reglement.motifContrepassation && <span className="block text-xs text-gray-500">Motif : {part.reglement.motifContrepassation}</span>}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
