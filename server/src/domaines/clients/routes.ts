import express from 'express';
import { Prisma } from '@prisma/client';
import type { Express } from 'express';
import { prisma, transactionVerifiee } from '../../db';
import { ROLE_TECHNICIEN } from '../../droits/roles';
import { requirePermission } from '../../droits/permissions';
import { perimetreChantiers } from '../../droits/perimetres';
import { type AuthRequest, requireAuth } from '../../http/auth';
import type { ApiRequest } from '../../http/cles-api';
import { paramId } from '../../http/requete';
import { routeMixte } from '../../http/routes-mixtes';
import { requireGestionClients } from '../../http/gardes';
import { ClientSaisieError, MESSAGE_SANS_SIRET_AVEC_SIREN, clientPayload, contactPayload, sitePayload, verifierSansSiret } from './metier';
import { listerEquipementsClient, creerEquipementClient, archiverEquipementClient } from './equipements';

// --- Référentiel Clients natif Iris ---
// Les handlers sont écrits UNE fois puis montés sur deux portes d'entrée (cf. routeMixte
// plus bas) : l'interface, pour une session (lectures avec clients:read ; écritures et parc pour
// l'administration et l'assistante technique, cf. requireGestionClients), et /api/v1, pour une clé
// d'intégration porteuse du bon scope. Un agent et un humain appliquent ainsi exactement
// les mêmes règles de validation — il n'existe pas de « chemin agent » plus permissif.
const clientDetailInclude = {
  contacts: { orderBy: [{ principal: 'desc' as const }, { nom: 'asc' as const }] },
  sites: { orderBy: [{ principal: 'desc' as const }, { nom: 'asc' as const }] },
};

function clientApiError(res: express.Response, error: unknown) {
  if ((error as { code?: string })?.code === 'P2002') {
    return res.status(409).json({ error: 'Ce SIREN, ce siège social ou cette adresse de facturation est déjà pris pour ce client.' });
  }
  if ((error as { code?: string })?.code === 'P2025') {
    return res.status(404).json({ error: 'Enregistrement introuvable.' });
  }
  if (error instanceof ClientSaisieError) return res.status(400).json({ error: error.message });
  // Filet de la contrainte de la base, si une écriture concurrente passait le contrôle de l'API.
  if (error instanceof Error && error.message.includes('Client_sansSiret_siren_check')) return res.status(400).json({ error: MESSAGE_SANS_SIRET_AVEC_SIREN });
  const message = error instanceof Error ? error.message : 'Erreur client.';
  const saisie = message.startsWith('Champ client invalide') || message.includes('obligatoire') || message.includes('SIREN');
  return res.status(saisie ? 400 : 500).json({ error: saisie ? message : 'Erreur client.' });
}

// Recherche plein texte simple sur la raison sociale, le nom commercial et le SIREN.
function clientRecherche(q: string) {
  if (!q) return {};
  return {
    OR: [
      { raisonSociale: { contains: q, mode: 'insensitive' as const } },
      { nomCommercial: { contains: q, mode: 'insensitive' as const } },
      { siren: { contains: q } },
    ],
  };
}

// Un technicien ne consulte que les clients actifs : les fiches désactivées lui sont fermées,
// en liste comme à l'unité (décision de Nelson du 14-10-2026).
function clientsActifsSeulement(req: express.Request): boolean {
  return !(req as ApiRequest).apiKey && (req as AuthRequest).user?.role === ROLE_TECHNICIEN;
}

const listerClients: express.RequestHandler = async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const actif = req.query.actif === 'false' && !clientsActifsSeulement(req) ? false : true;
  try {
    const clients = await prisma.client.findMany({
      where: { actif, ...clientRecherche(q) },
      orderBy: { raisonSociale: 'asc' },
      take: 200,
      include: clientDetailInclude,
    });
    res.json({ clients });
  } catch (error) {
    clientApiError(res, error);
  }
};

const lireClient: express.RequestHandler = async (req, res) => {
  try {
    const client = await prisma.client.findUnique({ where: { id: paramId(req) }, include: clientDetailInclude });
    if (!client || (!client.actif && clientsActifsSeulement(req))) return res.status(404).json({ error: 'Client introuvable.' });
    res.json(client);
  } catch (error) {
    clientApiError(res, error);
  }
};

const creerClient: express.RequestHandler = async (req, res) => {
  try {
    const data = clientPayload((req.body ?? {}) as Record<string, unknown>, true);
    res.status(201).json(await prisma.client.create({ data: data as never, include: clientDetailInclude }));
  } catch (error) {
    clientApiError(res, error);
  }
};

const modifierClient: express.RequestHandler = async (req, res) => {
  try {
    const data = clientPayload((req.body ?? {}) as Record<string, unknown>);
    const id = paramId(req);
    const client = await transactionVerifiee(async tx => {
      // Fiche verrouillée : la case « pas de SIRET » et le SIREN se contrôlent sur l'état final,
      // requête et fiche réunies, sans qu'une modification concurrente s'intercale.
      const [actuel] = await tx.$queryRaw<Array<{ siren: string | null; sansSiret: boolean }>>`SELECT "siren", "sansSiret" FROM "Client" WHERE "id" = ${id} FOR UPDATE`;
      if (!actuel) return null;
      verifierSansSiret((data.sansSiret as boolean | undefined) ?? actuel.sansSiret, 'siren' in data ? (data.siren as string | null) : actuel.siren);
      return tx.client.update({ where: { id }, data: data as never, include: clientDetailInclude });
    });
    if (!client) return res.status(404).json({ error: 'Enregistrement introuvable.' });
    res.json(client);
  } catch (error) {
    clientApiError(res, error);
  }
};

// Désactivation, jamais suppression : un client porte un historique (chantiers, parc
// installé) qu'une suppression rendrait orphelin.
const desactiverClient: express.RequestHandler = async (req, res) => {
  try {
    res.json(await prisma.client.update({ where: { id: paramId(req) }, data: { actif: false } }));
  } catch (error) {
    clientApiError(res, error);
  }
};

// Drapeaux uniques par client (contact principal ; siège social, site de facturation et site
// principal) : poser le drapeau retire l'ancien. Le retrait et l'écriture du contact ou du site
// sont validés ensemble (#306) : un refus (404, base) ne fait perdre aucun drapeau, et une lecture
// concurrente, comme l'émission d'une facture ou la signature d'un devis qui copie l'adresse de
// facturation, ne voit jamais l'état intermédiaire. Le verrou du client, pris en tête de
// transaction, fait passer l'une après l'autre deux écritures simultanées sur un même client.
// READ COMMITTED explicite, comme ISOLATION_RETRAIT : après l'attente du verrou, chaque requête
// voit l'écriture qui vient d'aboutir (en REPEATABLE READ, l'instantané pris avant l'attente
// l'ignorerait, et la seconde écriture échouerait).
const ISOLATION_CLIENT = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted };
const verrouillerClient = (tx: Prisma.TransactionClient, clientId: string) => tx.$queryRaw`SELECT "id" FROM "Client" WHERE "id" = ${clientId} FOR UPDATE`;

const creerContact: express.RequestHandler = async (req, res) => {
  const clientId = String(req.params.clientId);
  try {
    const data = contactPayload((req.body ?? {}) as Record<string, unknown>, true);
    const contact = await transactionVerifiee(async tx => {
      await verrouillerClient(tx, clientId);
      // Un seul contact principal par client : poser le drapeau retire l'ancien.
      if (data.principal) await tx.clientContact.updateMany({ where: { clientId }, data: { principal: false } });
      return tx.clientContact.create({ data: { ...data, clientId } as never });
    }, ISOLATION_CLIENT);
    res.status(201).json(contact);
  } catch (error) {
    clientApiError(res, error);
  }
};

const modifierContact: express.RequestHandler = async (req, res) => {
  const clientId = String(req.params.clientId);
  const id = paramId(req);
  try {
    const data = contactPayload((req.body ?? {}) as Record<string, unknown>);
    const contact = await transactionVerifiee(async tx => {
      await verrouillerClient(tx, clientId);
      // Existence vérifiée avant de retirer le drapeau aux autres contacts. Le clientId de l'URL
      // fait partie des filtres : on ne peut pas modifier le contact d'un autre client en
      // devinant son identifiant.
      if (!await tx.clientContact.findFirst({ where: { id, clientId }, select: { id: true } })) return null;
      if (data.principal) await tx.clientContact.updateMany({ where: { clientId, id: { not: id } }, data: { principal: false } });
      // Un corps sans champ modifiable n'écrit rien (count à 0) : 404, comme avant (#426).
      const maj = await tx.clientContact.updateMany({ where: { id, clientId }, data: data as never });
      if (!maj.count) return null;
      return tx.clientContact.findUnique({ where: { id } });
    }, ISOLATION_CLIENT);
    if (!contact) return res.status(404).json({ error: 'Contact introuvable.' });
    res.json(contact);
  } catch (error) {
    clientApiError(res, error);
  }
};

// Siège social et adresse de facturation sont uniques par client (index partiels
// PostgreSQL). Comme pour le contact principal, poser le drapeau retire l'ancien plutôt
// que de renvoyer un conflit que l'utilisateur devrait résoudre à la main. Toujours appelée
// dans la transaction de l'écriture du site, sous le verrou du client.
async function libererDrapeauxSite(tx: Prisma.TransactionClient, clientId: string, data: Record<string, unknown>, sauf?: string) {
  const exclure = sauf ? { id: { not: sauf } } : {};
  if (data.estSiegeSocial) await tx.clientSite.updateMany({ where: { clientId, ...exclure }, data: { estSiegeSocial: false } });
  if (data.estSiteFacturation) await tx.clientSite.updateMany({ where: { clientId, ...exclure }, data: { estSiteFacturation: false } });
  if (data.principal) await tx.clientSite.updateMany({ where: { clientId, ...exclure }, data: { principal: false } });
}

const creerSite: express.RequestHandler = async (req, res) => {
  const clientId = String(req.params.clientId);
  try {
    const data = sitePayload((req.body ?? {}) as Record<string, unknown>, true);
    const site = await transactionVerifiee(async tx => {
      await verrouillerClient(tx, clientId);
      await libererDrapeauxSite(tx, clientId, data);
      return tx.clientSite.create({ data: { ...data, clientId } as never });
    }, ISOLATION_CLIENT);
    res.status(201).json(site);
  } catch (error) {
    clientApiError(res, error);
  }
};

const modifierSite: express.RequestHandler = async (req, res) => {
  const clientId = String(req.params.clientId);
  const id = paramId(req);
  try {
    const data = sitePayload((req.body ?? {}) as Record<string, unknown>);
    const site = await transactionVerifiee(async tx => {
      await verrouillerClient(tx, clientId);
      // Existence vérifiée avant de retirer les drapeaux aux autres sites (même filtre par client).
      if (!await tx.clientSite.findFirst({ where: { id, clientId }, select: { id: true } })) return null;
      await libererDrapeauxSite(tx, clientId, data, id);
      // Un corps sans champ modifiable n'écrit rien (count à 0) : 404, comme avant (#426).
      const maj = await tx.clientSite.updateMany({ where: { id, clientId }, data: data as never });
      if (!maj.count) return null;
      return tx.clientSite.findUnique({ where: { id } });
    }, ISOLATION_CLIENT);
    if (!site) return res.status(404).json({ error: 'Site introuvable.' });
    res.json(site);
  } catch (error) {
    clientApiError(res, error);
  }
};

export function enregistrerRoutesClients(app: Express): void {
  // Écritures des clients et lecture du parc : l'administration et l'assistante technique (décision de Nelson
  // du 24-10-2026, point 24 : « gerer les client » ; cf. requireGestionClients) ; écriture du parc à
  // l'administration.
  routeMixte('get', '/clients', 'clients:read', listerClients, [requirePermission('clients:read')]);
  routeMixte('post', '/clients', 'clients:write', creerClient, [requireGestionClients]);
  routeMixte('get', '/clients/:id', 'clients:read', lireClient, [requirePermission('clients:read')]);
  routeMixte('put', '/clients/:id', 'clients:write', modifierClient, [requireGestionClients]);
  routeMixte('delete', '/clients/:id', 'clients:write', desactiverClient, [requireGestionClients]);
  routeMixte('post', '/clients/:clientId/contacts', 'clients:write', creerContact, [requireGestionClients]);
  routeMixte('put', '/clients/:clientId/contacts/:id', 'clients:write', modifierContact, [requireGestionClients]);
  routeMixte('post', '/clients/:clientId/sites', 'clients:write', creerSite, [requireGestionClients]);
  routeMixte('put', '/clients/:clientId/sites/:id', 'clients:write', modifierSite, [requireGestionClients]);
  routeMixte('get', '/clients/:clientId/equipements', 'equipements:read', listerEquipementsClient, [requireGestionClients]);
  routeMixte('post', '/clients/:clientId/equipements', 'equipements:write', creerEquipementClient);
  routeMixte('post', '/clients/:clientId/equipements/:id/archiver', 'equipements:write', archiverEquipementClient);

  // Historique des chantiers d'un client, sans aucun montant : de quoi les retrouver (nom,
  // adresse, période, statut), dans le périmètre de lecture du demandeur (cf. perimetreChantiers) ;
  // un technicien n'y voit que les chantiers dont il est chargé. Seuls les chantiers reliés à la
  // fiche (clientId) y figurent : un chantier qui ne porte que le libellé du client n'y est pas.
  // Réservée à l'interface (pas de porte /api/v1). chantiers:read est exigé par principe, la
  // route listant des chantiers : tous les types de compte le portent aujourd'hui.
  const CHANTIER_HISTORIQUE_CLIENT_SELECT = { id: true, nom: true, adresse: true, statut: true, dateDebut: true, dateFin: true } as const;
  app.get('/api/clients/:id/chantiers', requireAuth, requirePermission('clients:read'), requirePermission('chantiers:read'), async (req, res) => {
    try {
      const client = await prisma.client.findUnique({ where: { id: paramId(req) }, select: { id: true, actif: true } });
      if (!client || (!client.actif && clientsActifsSeulement(req))) return res.status(404).json({ error: 'Client introuvable.' });
      res.json(await prisma.chantier.findMany({
        where: { clientId: client.id, ...perimetreChantiers(req) },
        select: CHANTIER_HISTORIQUE_CLIENT_SELECT,
        orderBy: [{ dateDebut: 'desc' }, { nom: 'asc' }],
      }));
    } catch (error) {
      console.error('Erreur historique des chantiers du client', error);
      res.status(500).json({ error: 'Lecture de l’historique des chantiers impossible.' });
    }
  });
}
