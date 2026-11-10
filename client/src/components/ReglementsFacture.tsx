import { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { formatCompanyDateTime, formatDateOnly } from '../lib/dateFormatting';
import { libelleMoyen } from '../lib/reglements';
import { fmtEuroCentime } from '../lib/formats';
import { lignesReglementsFacture, type ReglementsDeLaFacture } from '../lib/reglementsFacture';

// Règlements et avoirs d'une facture, en lecture, sous la liste des factures : la saisie et la contre-passation
// restent à l'écran Règlements, réservé à l'administration. Les avoirs partiels émis y figurent comme des
// règlements (réponse de Nelson du 10-11-2026 au point 4, « avec le detail des avoir en tant que reglement ») ;
// la forme des lignes et le pied sont des choix d'affichage par défaut, à confirmer. Lignes et pied viennent
// de la même lecture : l'écran n'additionne rien.
export default function ReglementsFacture({ factureId, numero, fuseauHoraire, onFermer }: {
  factureId: string; numero: string | null; fuseauHoraire: string | null; onFermer: () => void;
}) {
  const [donnees, setDonnees] = useState<ReglementsDeLaFacture | null>(null);
  const [erreur, setErreur] = useState('');
  const [relecture, setRelecture] = useState(0);

  useEffect(() => {
    let actif = true;
    setDonnees(null);
    setErreur('');
    (async () => {
      try {
        const reponse = await apiFetch(`/factures/${factureId}/reglements`);
        const lu = await reponse.json();
        if (!reponse.ok) throw new Error(lu?.error || 'Lecture des règlements impossible.');
        if (actif) setDonnees(lu as ReglementsDeLaFacture);
      } catch (e) {
        if (actif) setErreur(e instanceof Error ? e.message : 'Lecture des règlements impossible.');
      }
    })();
    return () => { actif = false; };
  }, [factureId, relecture]);

  const lignes = donnees ? lignesReglementsFacture(donnees.parts, donnees.avoirs) : null;
  const solde = donnees?.solde ?? null;

  return (
    <section id="reglements-facture" role="region" aria-label="Règlements de la facture" className="rounded-xl border bg-white p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">Règlements de la facture {numero}</h2>
        <button type="button" className="btn btn-secondary" onClick={onFermer}>Fermer</button>
      </div>
      {!lignes && !erreur && <p role="status">Chargement des règlements…</p>}
      {erreur && <div role="alert"><p>{erreur}</p><button type="button" className="btn btn-secondary" onClick={() => setRelecture((n) => n + 1)}>Réessayer</button></div>}
      {lignes && !lignes.length && <p className="text-sm text-gray-600">Aucun règlement reçu.</p>}
      {lignes && lignes.length > 0 && (
        <div className="overflow-x-auto">
          <table aria-label="Règlements et avoirs de la facture" className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr><th className="p-3">Date</th><th className="p-3">Règlement</th><th className="p-3">Montant</th><th className="p-3">Statut</th></tr>
            </thead>
            <tbody>
              {lignes.map((ligne) => ligne.nature === 'AVOIR' ? (
                <tr key={`avoir-${ligne.id}`} className="border-t align-top">
                  <td className="p-3">{formatDateOnly(ligne.avoir.dateEmission)}</td>
                  <td className="p-3">Avoir {ligne.avoir.numero}</td>
                  <td className="p-3">{fmtEuroCentime(ligne.avoir.totalTtc)}</td>
                  <td className="p-3">Émis</td>
                </tr>
              ) : (
                <tr key={`part-${ligne.id}`} className="border-t align-top">
                  <td className="p-3">{formatDateOnly(ligne.part.reglement.dateReglement)}</td>
                  <td className="p-3">{libelleMoyen(ligne.part.reglement.moyen)}{ligne.part.reglement.reference && <span className="block text-xs text-gray-500">Réf. {ligne.part.reglement.reference}</span>}</td>
                  <td className="p-3">{fmtEuroCentime(ligne.part.montant)}</td>
                  <td className="p-3">
                    {ligne.part.reglement.statut === 'ENREGISTRE' ? 'Enregistré' : (
                      <span>Contre-passé{ligne.part.reglement.contrepasseLe && fuseauHoraire && ` le ${formatCompanyDateTime(ligne.part.reglement.contrepasseLe, fuseauHoraire)}`}
                        {ligne.part.reglement.motifContrepassation && <span className="block text-xs text-gray-500">Motif : {ligne.part.reglement.motifContrepassation}</span>}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            {solde && (
              <tfoot>
                <tr className="border-t font-medium">
                  <td className="p-3" colSpan={4}>
                    Paiements : {fmtEuroCentime(solde.montantRegle)} · Avoirs : {fmtEuroCentime(solde.montantAvoirs)} · {solde.resteDu < 0 ? `Trop-perçu : ${fmtEuroCentime(-solde.resteDu)}` : `Reste dû : ${fmtEuroCentime(solde.resteDu)}`}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </section>
  );
}
