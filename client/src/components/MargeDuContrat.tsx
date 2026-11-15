import { useState } from 'react';
import { apiFetch } from '../api';
import { fmtEuroCentime } from '../lib/formats';
import { alertesMargeContrat, detailMargeContrat, type MargeContrat } from '../lib/margeContrat';

const ERREUR_LECTURE = 'Impossible de lire la marge du contrat.';

// Marge d'un contrat de maintenance (lot « marge d'un contrat »), chargée à la demande : l'écran ne l'affiche qu'à
// l'administration, comme le serveur ne l'envoie qu'à elle (choix par défaut, à confirmer).
export function MargeDuContrat({ contratId, titre }: { contratId: string; titre: string }) {
  const [marge, setMarge] = useState<MargeContrat | null>(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState('');

  const charger = async () => {
    setChargement(true);
    setErreur('');
    try {
      const reponse = await apiFetch(`/contrats-maintenance/${encodeURIComponent(contratId)}/marge`);
      const donnees = await reponse.json();
      if (!reponse.ok) throw new Error(donnees.error || ERREUR_LECTURE);
      setMarge(donnees as MargeContrat);
    } catch (error) {
      setMarge(null);
      setErreur(error instanceof Error ? error.message : ERREUR_LECTURE);
    } finally {
      setChargement(false);
    }
  };

  return <div className="mt-4 border-t border-gray-100 pt-3 text-sm">
    <button type="button" className="btn btn-secondary" data-testid={`marge-contrat-${contratId}`} aria-label={`Voir la marge du contrat ${titre}`} disabled={chargement} onClick={() => void charger()}>{chargement ? 'Chargement…' : 'Voir la marge'}</button>
    {erreur && <p role="alert" className="mt-2 text-red-700">{erreur}</p>}
    {marge && <div data-testid={`marge-contrat-detail-${contratId}`} className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="font-medium text-slate-800">Marge à l’heure : {fmtEuroCentime(marge.margeHT)} HT</p>
      <p className="text-xs text-slate-600">{detailMargeContrat(marge, fmtEuroCentime)}</p>
      {alertesMargeContrat(marge).map((alerte) => <p key={alerte} role="note" className="mt-1 text-xs text-amber-800">{alerte}</p>)}
    </div>}
  </div>;
}
