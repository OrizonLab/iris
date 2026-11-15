// Lot « marge d'un contrat de maintenance, heures valorisées au prix sous contrat » (cadrage version 3 du 15-11-2026,
// validé par le contrôle de cohérence ; lot de montants, tests classés C).
//
// Décisions appliquées :
//  - 27-10-2026, 10:27 UTC : « Oui prix du catalogue, continue » (la marge d'une visite de contrat et de ses suites
//    utilise le prix sous contrat) ; nuit du 26 au 27-10-2026, point 5 : « La marge se calcule a l’heure » ;
//  - 15-11-2026, réponses de Nelson aux questions du cadrage : « Celle de l'intervenant » (main d'œuvre rattachée à la
//    fiche, à son prix à l'heure sous contrat), « Figé à la saisie », « Par contrat », « Selon la politique »
//    (matériel inclus compté à son coût, hors forfait exclu de la marge), « Coût seul, non vendues » (contrat annulé ;
//    suspendu ou terminé : vendues), « Oui, valoriser » (main d'œuvre incluse ou hors forfait), « Depuis le début »,
//    « Coût gardé, signalée » (heure sans prix), « Coût seul » (intervention annulée), « Figée sur la visite »
//    (instantané de la couverture pris à la création de la visite).
// Lectures retenues et choix par défaut de montant, à confirmer par Nelson (cadrage, section du même nom) : arrondi au
// centime ligne par ligne ; matériel inclus des interventions annulées et d'un contrat annulé compté à son coût ;
// intervention sans instantané : politique matériel actuelle du contrat ; main d'œuvre désactivée qui valorise encore ;
// prix sous contrat à 0,00 € : heure valorisée à 0, non signalée. Droits : administration seule (SUPERADMIN, ADMIN,
// DIRECTEUR), choix par défaut, à confirmer.
//
// Chaque montant attendu est écrit en dur et recalculé par un témoin en décimal exact (centièmes entiers, BigInt) ; le
// commentaire de chaque attendu dit la lecture qu'il écarte. Prix hors contrat et prix sous contrat sont toujours
// distincts, si bien qu'une inversion des deux tarifs se voit.
//
// Fichier propre au lot, avec sa base jetable : `node --test` exécute les fichiers en parallèle, et api.test.mjs, qui
// tourne en même temps sur TEST_DATABASE_URL, purge les données « TEST ». TEST_DATABASE_URL ne sert donc ici que de
// connexion administrative : une base neuve est créée, migrée (`prisma migrate deploy`), servie à l'application montée
// en mémoire, puis supprimée. Sans TEST_DATABASE_URL, le fichier s'annonce ignoré : un SKIP n'est pas une réussite.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before, describe } from 'node:test';
import pg from 'pg';
import { empreinteBase, tablesDeLaBase } from './matrice-droits/outils.mjs';

const TITRE = 'Marge d’un contrat de maintenance : heures valorisées au prix sous contrat figé à la saisie, marge du contrat depuis son début';
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

// --- Témoin en décimal exact ---
// Heures et prix ont deux décimales au plus (colonnes DECIMAL(10,2) et DECIMAL(12,2)) : lus en centièmes entiers, leur
// produit est exact en dix-millièmes, puis arrondi au centime, demi-centime vers le haut (ROUND_HALF_UP ; montants
// positifs). Aucune virgule flottante.
const centiemes = (valeur) => {
  const [entier, decimales = ''] = String(valeur).split('.');
  assert.ok(decimales.length <= 2, `témoin : ${valeur} a plus de deux décimales`);
  return BigInt(entier) * 100n + BigInt(decimales.padEnd(2, '0'));
};
const ligneAuCentime = (heures, prix) => (centiemes(heures) * centiemes(prix) + 50n) / 100n;
const sommeLignes = (lignes) => lignes.reduce((total, [heures, prix]) => total + ligneAuCentime(heures, prix), 0n);
const sommeMontants = (montants) => montants.reduce((total, montant) => total + centiemes(montant), 0n);
const euros = (centimes) => Number(centimes) / 100;

if (!TEST_DATABASE_URL) {
  describe(TITRE, { skip: 'TEST_DATABASE_URL absent — voir tests/README.md' }, () => {
    test('non exécuté', () => {});
  });
} else {
  describe(TITRE, () => {
    const source = new URL(TEST_DATABASE_URL);
    const nomBase = `iris_test_marge_contrat_${randomBytes(6).toString('hex')}`;
    const maintenance = new URL(source);
    maintenance.pathname = '/postgres';
    const cible = new URL(source);
    cible.pathname = `/${nomBase}`;
    const administrationPg = new pg.Client({ connectionString: maintenance.toString() });
    let baseCreee = false;

    let request; let app; let prisma; let appPrisma; let jwt; let jourCivilEntreprise;
    let admin = {};
    let adminId = '';
    let client = null;
    let site = null;
    let fournisseur = null;
    const suffixe = `${Date.now()}`;
    let rang = 0;
    const unique = () => `${suffixe}-${(rang += 1)}`;

    const envoyer = (methode, chemin, auth, corps) => request(app)[methode](chemin).set(auth).send(corps);
    const parJeton = (id) => ({ Authorization: `Bearer ${jwt.sign({ id }, process.env.JWT_SECRET)}` });
    const couts = (id, auth = admin) => request(app).get(`/api/interventions/${id}/couts`).set(auth);
    const marge = (contratId, auth = admin) => request(app).get(`/api/contrats-maintenance/${contratId}/marge`).set(auth);
    const lireMarge = async (contratId) => {
      const res = await marge(contratId);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      return res.body;
    };
    const aujourdhui = async () => {
      const societe = await prisma.companySettings.findUnique({ where: { id: 'singleton' } });
      return jourCivilEntreprise(new Date(), societe?.fuseauHoraire || 'Europe/Paris').split('-').reverse().join('-');
    };

    // Main d'œuvre du catalogue : prix de vente à l'heure hors contrat (prixVenteHt) et sous contrat
    // (prixHeureSousContratHt), toujours distincts dans ce fichier ; les autres prix sont sans effet sur le lot.
    const corpsMainOeuvre = (reference, { horsContrat, sousContrat }) => ({
      estMainOeuvre: true, reference, nom: `TEST Main d’œuvre ${reference}`, tauxTva: '20',
      prixVenteHt: horsContrat, prixJourHorsContratHt: '300', prixHeureSousContratHt: sousContrat, prixJourSousContratHt: '280', heuresParJour: '7',
    });
    const creerMainOeuvre = async (prix) => {
      const reference = `TEST-MC-${unique()}`;
      const res = await envoyer('post', '/api/catalogue/prestations', admin, corpsMainOeuvre(reference, prix));
      assert.equal(res.status, 201, JSON.stringify(res.body));
      return { ...res.body, reference };
    };
    const changerTarif = async (mainOeuvre, prix) => {
      const res = await envoyer('put', `/api/catalogue/prestations/${mainOeuvre.id}`, admin, corpsMainOeuvre(mainOeuvre.reference, prix));
      assert.equal(res.status, 200, JSON.stringify(res.body));
    };
    const rattacher = async (fiche, mainOeuvreId) => {
      const res = await envoyer('put', `/api/intervenants/${fiche.id}/main-oeuvre`, admin, { mainOeuvreId });
      assert.equal(res.status, 200, JSON.stringify(res.body));
    };
    // Compte d'un type donné, avec sa fiche intervenant pour un technicien.
    const creerCompte = async (role, cle) => {
      const s = unique();
      const compte = await prisma.user.create({ data: { email: `marge-contrat.${cle}.${s}@iris.test`, name: `TEST Marge contrat ${cle} ${s}`, role } });
      return { compte, auth: parJeton(compte.id) };
    };
    const technicien = async (cle, tauxHoraireCharge, mainOeuvreId) => {
      const { compte, auth } = await creerCompte('TECHNICIEN', cle);
      const fiche = await prisma.intervenant.create({ data: { nom: `TEST Marge contrat ${cle} ${unique()}`, role: 'Technicien', tauxHoraireCharge, userId: compte.id } });
      if (mainOeuvreId) await rattacher(fiche, mainOeuvreId);
      return { compte, fiche, auth };
    };
    // Intervenant sans compte, pour les heures écrites directement en base.
    const fiche = (nom, tauxHoraireCharge = 30) => prisma.intervenant.create({ data: { nom, role: 'Technicien', tauxHoraireCharge } });

    // Contrat créé par l'API (actif, première échéance au 01-01-2026), sur le client et le site communs à tout le
    // fichier : chaque marge lue côtoie donc les interventions des autres contrats et les curatives du même client et
    // du même site, qui ne doivent jamais y entrer.
    const creerContrat = async ({ politiqueMainOeuvre = 'HORS_FORFAIT', politiqueMateriel = 'INCLUS' } = {}) => {
      const res = await envoyer('post', '/api/contrats-maintenance', admin, {
        clientId: client.id, siteId: site.id, titre: `TEST Contrat marge ${unique()}`, periodiciteMois: 12, dureePrevisionnelleMinutes: 60,
        dateDebut: '01-01-2026', politiqueMainOeuvre, politiqueMateriel,
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      return res.body;
    };
    // Visite de l'échéance courante, créée par l'API : elle reçoit l'instantané de la couverture du contrat.
    const genererVisite = async (contrat) => {
      const res = await envoyer('post', `/api/contrats-maintenance/${contrat.id}/generer-intervention`, admin, {});
      assert.equal(res.status, 201, JSON.stringify(res.body));
      return res.body;
    };
    // Autre visite du contrat, écrite en base comme la génération l'écrirait à une échéance suivante (instantané
    // donné), ou sans instantané (`couverture: null`) comme une visite antérieure à la migration 20260925100000 :
    // aucun chemin de l'API n'en crée, et l'instantané d'une visite existante ne se vide pas (déclencheur
    // Intervention_couvertureContrat_immutable).
    const visiteEnBase = async (contrat, mois, couverture) => {
      const echeance = new Date(Date.UTC(2026, mois, 1));
      return prisma.intervention.create({ data: {
        reference: `I26-MC-${unique()}`, clientId: contrat.clientId, siteId: contrat.siteId, contratMaintenanceId: contrat.id,
        echeanceContrat: echeance, dateDemande: echeance, titre: `TEST Marge contrat visite ${mois + 1}`,
        ...(couverture ? { couvertureContrat: couverture } : {}),
      } });
    };
    const couverture = (politiqueMateriel, politiqueMainOeuvre = 'HORS_FORFAIT') => ({ politiqueMainOeuvre, politiqueMateriel, noteCouverture: null });
    const suiteDe = async (id) => {
      const res = await envoyer('post', `/api/interventions/${id}/suites`, admin, {});
      assert.equal(res.status, 201, JSON.stringify(res.body));
      return res.body;
    };
    const annuler = async (id) => {
      const res = await envoyer('patch', `/api/interventions/${id}/statut`, admin, { statut: 'ANNULEE', motif: 'TEST annulation pour la marge du contrat' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
    };
    const changerStatutContrat = async (contrat, statut) => {
      const res = await envoyer('patch', `/api/contrats-maintenance/${contrat.id}/statut`, admin, { statut, motif: `TEST passage ${statut}` });
      assert.equal(res.status, 200, JSON.stringify(res.body));
    };
    const changerCouverture = async (contrat, champs) => {
      const res = await envoyer('patch', `/api/contrats-maintenance/${contrat.id}`, admin, { ...champs, motif: 'TEST couverture changée après coup' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
    };
    // Annulation d'un contrat avec son devis (devis/annulation.ts), écrite en base : statut, date, auteur et motif
    // exigés ensemble par la contrainte ContratMaintenance_annulation_check ; ses visites terminées restent.
    const annulerContrat = (contrat) => prisma.contratMaintenance.update({ where: { id: contrat.id }, data: {
      statut: 'ANNULE', annuleLe: new Date(), annuleParId: adminId, motifAnnulation: 'TEST annulation du devis du contrat',
    } });
    const affecter = (interventionId, ...fiches) => prisma.interventionAffectation.createMany({ data: fiches.map((f) => ({ interventionId, intervenantId: f.id })) });
    const saisir = async (tech, interventionId, nbrHeures) => {
      const res = await envoyer('post', `/api/interventions/${interventionId}/couts/heures`, tech.auth, { date: await aujourdhui(), nbrHeures });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal('prixVenteHoraireApplique' in res.body, false, 'aucun prix renvoyé au technicien');
      assert.equal('tauxHoraireApplique' in res.body, false, 'aucun taux renvoyé au technicien');
      return res.body;
    };
    const prixEnBase = async (id) => {
      const ligne = await prisma.coutInterventionHeure.findUniqueOrThrow({ where: { id } });
      return ligne.prixVenteHoraireApplique === null ? null : Number(ligne.prixVenteHoraireApplique);
    };
    // Heure écrite en base, au taux et au prix figés donnés (les montants passent en chaîne : aucun flottant).
    const heure = (interventionId, intervenant, nbrHeures, tauxHoraireApplique, prixVenteHoraireApplique, { archivee = false } = {}) => prisma.coutInterventionHeure.create({ data: {
      interventionId, intervenantId: intervenant.id, date: new Date('2026-10-20T00:00:00Z'), nbrHeures, tauxHoraireApplique, prixVenteHoraireApplique, createdById: adminId,
      ...(archivee ? { archivedAt: new Date(), archivedById: adminId, motifArchivage: 'TEST archivée' } : {}),
    } });
    const achat = (interventionId, montantHT, { archive = false } = {}) => prisma.coutInterventionAchat.create({ data: {
      interventionId, fournisseurId: fournisseur.id, date: new Date('2026-10-20T00:00:00Z'), description: 'TEST matériel', montantHT, createdById: adminId,
      ...(archive ? { archivedAt: new Date(), archivedById: adminId, motifArchivage: 'TEST archivé' } : {}),
    } });
    const MARGE_VIDE = {
      ventesHT: 0, coutsHT: 0, materielHT: 0, materielExcluHT: 0, margeHT: 0, heuresValorisees: 0, heuresNonValorisees: 0,
      intervenantsNonValorises: [], heuresAnnulees: 0, contratAnnule: false, nombreInterventions: 0, nombreInterventionsAnnulees: 0,
    };
    // Une course : la transaction du test tient ce que le rattachement doit prendre après la fiche intervenant, si bien
    // que la saisie part pendant qu'il attend, la fiche déjà prise (même montage que api.test.mjs, #354, audits n° 1 et 2).
    const attendre = async (condition, message) => {
      let vrai = false;
      for (let tour = 0; tour < 250 && !vrai; tour += 1) {
        vrai = await condition();
        if (!vrai) await new Promise((r) => setTimeout(r, 20));
      }
      assert.equal(vrai, true, message);
    };
    const course = async (tech, interventionId, mainOeuvreId, tenir) => {
      const date = await aujourdhui();
      let rattachement;
      let saisie;
      await prisma.$transaction(async (tx) => {
        await tenir(tx);
        const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
        rattachement = envoyer('put', `/api/intervenants/${tech.fiche.id}/main-oeuvre`, admin, { mainOeuvreId }).then((r) => r);
        await attendre(async () => (await prisma.$queryRaw`SELECT count(*)::int AS n FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))`)[0].n > 0, 'le rattachement attend, la fiche déjà prise');
        saisie = envoyer('post', `/api/interventions/${interventionId}/couts/heures`, tech.auth, { date, nbrHeures: 1 }).then((r) => r);
        await attendre(async () => (await prisma.$queryRaw`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FROM "Intervenant"%FOR UPDATE%'`)[0].n > 0, 'la saisie attend le verrou de la fiche');
      }, { timeout: 20000 });
      assert.equal((await rattachement).status, 200);
      return saisie;
    };
    const verifierCourse = async (reponse, interventionId, prixAttendu) => {
      if (reponse.status === 201) {
        assert.equal(await prixEnBase(reponse.body.id), prixAttendu, 'le rattachement validé avant la lecture du prix est relu');
      } else {
        assert.equal(reponse.status, 409, JSON.stringify(reponse.body));
        assert.equal(await prisma.coutInterventionHeure.count({ where: { interventionId } }), 0, 'la saisie refusée n’écrit rien');
      }
    };

    before(async () => {
      assert.ok(['127.0.0.1', 'localhost'].includes(source.hostname), 'seul un PostgreSQL local est autorisé');
      await administrationPg.connect();
      await administrationPg.query(`CREATE DATABASE "${nomBase}"`);
      baseCreee = true;
      const dossierServeur = resolve(dirname(fileURLToPath(import.meta.url)), '..');
      execFileSync(resolve(dossierServeur, 'node_modules/.bin/prisma'), ['migrate', 'deploy', '--schema', resolve(dossierServeur, 'prisma/schema.prisma')], {
        env: { ...process.env, DATABASE_URL: cible.toString() }, encoding: 'utf8', stdio: 'pipe', timeout: 180_000,
      });
      process.env.DATABASE_URL = cible.toString();
      process.env.NODE_ENV = 'test';
      process.env.JWT_SECRET = 'secret-de-test-uniquement';
      process.env.BREAK_GLASS_EMAIL = 'secours@iris.test';
      process.env.BREAK_GLASS_TOKEN = 'jeton-de-secours-de-test-au-moins-32-caracteres';
      process.env.SUPERADMIN_EMAILS = 'secours@iris.test';
      request = (await import('supertest')).default;
      const serveur = await import('../dist/index.js');
      app = serveur.app;
      appPrisma = serveur.prisma;
      jourCivilEntreprise = serveur.jourCivilEntreprise;
      const { PrismaClient } = await import('@prisma/client');
      prisma = new PrismaClient({ datasources: { db: { url: cible.toString() } } });
      jwt = (await import('jsonwebtoken')).default;
      await serveur.initDb();
      await serveur.ensureSuperAdmins();
      const secours = await request(app).post('/api/auth/secours').send({ token: process.env.BREAK_GLASS_TOKEN });
      assert.equal(secours.status, 200, JSON.stringify(secours.body));
      admin = { Authorization: `Bearer ${secours.body.token}` };
      adminId = secours.body.user.id;
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: adminId } })).role, 'SUPERADMIN');
      const cree = await envoyer('post', '/api/clients', admin, { raisonSociale: `TEST Client marge contrat ${suffixe}` });
      assert.equal(cree.status, 201, JSON.stringify(cree.body));
      client = cree.body;
      site = await prisma.clientSite.create({ data: { clientId: client.id, nom: 'TEST Site marge contrat', adresse: '1 rue des Contrats', codePostal: '14000', ville: 'Caen' } });
      fournisseur = await prisma.fournisseur.create({ data: { nom: `TEST Fournisseur marge contrat ${suffixe}` } });
    });

    // La connexion administrative est fermée même si la suppression de la base échoue : sinon le processus du fichier ne
    // se termine jamais (constaté une fois pendant la rédaction), et l'échec, qui doit rester visible, n'est jamais
    // rapporté. Une connexion de l'application rouverte pendant la suppression la fait échouer : elle est retentée deux
    // fois, puis l'erreur est rapportée.
    after(async () => {
      await prisma?.$disconnect().catch(() => {});
      await appPrisma?.$disconnect().catch(() => {});
      try {
        for (let essai = 1; baseCreee; essai += 1) {
          try {
            await administrationPg.query(`DROP DATABASE IF EXISTS "${nomBase}" WITH (FORCE)`);
            baseCreee = false;
          } catch (erreur) {
            if (essai >= 3) throw erreur;
            await new Promise((r) => setTimeout(r, 500));
          }
        }
      } finally {
        await administrationPg.end().catch(() => {});
      }
    });

    // ===================== Copie du prix sous contrat à la saisie (cadrage, périmètre 1) =====================

    // « Celle de l'intervenant », « Figé à la saisie » ; la suite d'une visite, et la suite de cette suite, héritent du
    // contrat (interventions/suites.ts). Hors contrat, le prix hors contrat reste copié (lot « marge d'un SAV hors
    // contrat », #354). Le technicien n'en reçoit jamais la valeur.
    test('une heure saisie sur une visite, sur sa suite et sur la suite de sa suite fige le prix à l’heure sous contrat de la main d’œuvre de l’intervenant ; hors contrat, son prix hors contrat', async () => {
      const frigoriste = await creerMainOeuvre({ horsContrat: '52.30', sousContrat: '43.70' });
      const tech = await technicien('copie', '30.50', frigoriste.id);
      const sansMainOeuvre = await technicien('copie-sans-mo', '28');
      const contrat = await creerContrat();
      const visite = await genererVisite(contrat);
      const suite = await suiteDe(visite.id);
      const suiteDeSuite = await suiteDe(suite.id);
      assert.deepEqual([suite.contratMaintenanceId, suiteDeSuite.contratMaintenanceId], [contrat.id, contrat.id], 'les suites héritent du contrat');
      await affecter(visite.id, tech.fiche, sansMainOeuvre.fiche);
      await affecter(suite.id, tech.fiche);
      await affecter(suiteDeSuite.id, tech.fiche);

      const surVisite = await saisir(tech, visite.id, 1);
      const surSuite = await saisir(tech, suite.id, 0.5);
      const surSuiteDeSuite = await saisir(tech, suiteDeSuite.id, 0.25);
      const sansPrix = await saisir(sansMainOeuvre, visite.id, 0.5);
      // 43,70 € (prix sous contrat) ; écarte le prix hors contrat (52,30 €) et l'ancien comportement (aucun prix).
      assert.deepEqual(
        [await prixEnBase(surVisite.id), await prixEnBase(surSuite.id), await prixEnBase(surSuiteDeSuite.id), await prixEnBase(sansPrix.id)],
        [43.7, 43.7, 43.7, null],
      );
      // Non-régression hors contrat : même intervenant, même jour, curative du même client et du même site : 52,30 €.
      const curative = await envoyer('post', '/api/interventions', admin, { clientId: client.id, siteId: site.id, titre: 'TEST Marge contrat curative du même site' });
      assert.equal(curative.status, 201, JSON.stringify(curative.body));
      await affecter(curative.body.id, tech.fiche);
      assert.equal(await prixEnBase((await saisir(tech, curative.body.id, 1)).id), 52.3);
      // Le journal de la saisie garde le prix figé, que l'administration lit.
      const journal = await request(app).get(`/api/interventions/${visite.id}/journal-saisies`).set(admin);
      assert.equal(journal.status, 200, JSON.stringify(journal.body));
      assert.ok(journal.body.some((entree) => entree.cibleId === surVisite.id && entree.apres?.prixVenteHoraireApplique === 43.7), 'journal : prix sous contrat figé');

      // De bout en bout : la marge du contrat lit ces prix figés, ligne par ligne.
      // Ventes : 1 × 43,70 + 0,5 × 43,70 (21,85) + 0,25 × 43,70 (10,925 → 10,93) = 76,48 ; au prix hors contrat, 91,53.
      // Coûts : 1 × 30,50 + 0,5 × 30,50 (15,25) + 0,25 × 30,50 (7,625 → 7,63) + 0,5 × 28 (14) = 67,38 ; la curative
      // (30,50) n'y entre pas.
      const ventes = sommeLignes([['1', '43.70'], ['0.5', '43.70'], ['0.25', '43.70']]);
      const coutsHT = sommeLignes([['1', '30.50'], ['0.5', '30.50'], ['0.25', '30.50'], ['0.5', '28']]);
      assert.deepEqual([euros(ventes), euros(coutsHT)], [76.48, 67.38]);
      assert.notEqual(euros(sommeLignes([['1', '52.30'], ['0.5', '52.30'], ['0.25', '52.30']])), 76.48, 'témoin : le prix hors contrat donnerait un autre total');
      assert.deepEqual(await lireMarge(contrat.id), {
        ...MARGE_VIDE, ventesHT: 76.48, coutsHT: 67.38, margeHT: 9.1, heuresValorisees: 1.75, heuresNonValorisees: 0.5,
        intervenantsNonValorises: [sansMainOeuvre.fiche.nom], nombreInterventions: 3,
      });
    });

    // Lectures retenues du cadrage : main d'œuvre désactivée qui valorise encore (son prix est lu sur la main d'œuvre
    // rattachée, le rattachement étant gardé) ; prix sous contrat à 0,00 € valorisé à 0, non signalé.
    test('main d’œuvre désactivée : ses intervenants restent valorisés au prix sous contrat ; prix sous contrat à 0,00 € : heure figée à zéro, vendue à zéro, non signalée', async () => {
      const mainOeuvre = await creerMainOeuvre({ horsContrat: '52.30', sousContrat: '43.70' });
      const gratuite = await creerMainOeuvre({ horsContrat: '48', sousContrat: '0' });
      const tech = await technicien('desactivee', '30', mainOeuvre.id);
      const techGratuit = await technicien('gratuite', '29', gratuite.id);
      const contrat = await creerContrat();
      const visite = await genererVisite(contrat);
      await affecter(visite.id, tech.fiche, techGratuit.fiche);

      assert.equal(await prixEnBase((await saisir(tech, visite.id, 1)).id), 43.7);
      assert.equal((await request(app).delete(`/api/catalogue/prestations/${mainOeuvre.id}`).set(admin)).status, 200);
      assert.equal((await prisma.cataloguePrestation.findUniqueOrThrow({ where: { id: mainOeuvre.id } })).actif, false, 'main d’œuvre désactivée');
      // Écarte : rattachement ignoré une fois la main d'œuvre désactivée (prix vide).
      assert.equal(await prixEnBase((await saisir(tech, visite.id, 0.5)).id), 43.7);
      // Écarte : 0 pris pour une absence de prix (vide) et le prix hors contrat (48 €).
      assert.equal(await prixEnBase((await saisir(techGratuit, visite.id, 2)).id), 0);

      // Ventes : 43,70 + 21,85 + 0 = 65,55 ; coûts : 30 + 15 + 2 × 29 (58) = 103 ; marge −37,45. L'heure à 0,00 € est
      // valorisée (3,5 h vendues), sans signalement ; la lire comme sans prix donnerait 1,5 h et 2 h non valorisées.
      assert.deepEqual(await lireMarge(contrat.id), {
        ...MARGE_VIDE, ventesHT: 65.55, coutsHT: 103, margeHT: -37.45, heuresValorisees: 3.5, nombreInterventions: 1,
      });
    });

    // « Figé à la saisie » : un changement de tarif ultérieur ne modifie pas les heures déjà saisies ; un changement de
    // rattachement non plus ; la correction d'une heure par le technicien ne recopie pas le prix ; la base refuse toute
    // réécriture (déclencheur d'immuabilité).
    test('changement de tarif sous contrat ou de rattachement après coup, correction de l’heure : le prix figé ne bouge pas, les heures suivantes prennent le nouveau prix', async () => {
      const premiere = await creerMainOeuvre({ horsContrat: '52.30', sousContrat: '43.70' });
      const seconde = await creerMainOeuvre({ horsContrat: '49', sousContrat: '39.90' });
      const tech = await technicien('tarif', '30', premiere.id);
      const contrat = await creerContrat();
      const visite = await genererVisite(contrat);
      await affecter(visite.id, tech.fiche);

      const h1 = await saisir(tech, visite.id, 1);
      assert.equal(await prixEnBase(h1.id), 43.7);
      await changerTarif(premiere, { horsContrat: '52.30', sousContrat: '47.10' });
      assert.equal(await prixEnBase(h1.id), 43.7, 'le nouveau tarif ne touche pas l’heure déjà saisie');
      const h2 = await saisir(tech, visite.id, 0.5);
      assert.equal(await prixEnBase(h2.id), 47.1);
      await rattacher(tech.fiche, seconde.id);
      assert.deepEqual([await prixEnBase(h1.id), await prixEnBase(h2.id)], [43.7, 47.1], 'le nouveau rattachement ne touche pas les heures saisies');
      const h3 = await saisir(tech, visite.id, 0.25);
      assert.equal(await prixEnBase(h3.id), 39.9);
      const correction = await envoyer('patch', `/api/interventions/${visite.id}/couts/heures/${h1.id}`, tech.auth, { nbrHeures: 2, motifCorrection: 'TEST correction des heures de la visite' });
      assert.equal(correction.status, 200, JSON.stringify(correction.body));
      assert.equal(Number((await prisma.coutInterventionHeure.findUniqueOrThrow({ where: { id: h1.id } })).nbrHeures), 2);
      assert.equal(await prixEnBase(h1.id), 43.7, 'la correction ne recopie pas le prix');
      await assert.rejects(prisma.coutInterventionHeure.update({ where: { id: h1.id }, data: { prixVenteHoraireApplique: 47.1 } }), /prix de vente horaire appliqué immuable/);

      // Ventes : 2 × 43,70 (87,40) + 0,5 × 47,10 (23,55) + 0,25 × 39,90 (9,975 → 9,98) = 120,93. Écarte un prix relu au
      // catalogue courant (2,75 × 39,90 = 109,73) ou au tarif de la première main d'œuvre changé (2,75 × 47,10 = 129,53).
      // Coûts : 60 + 15 + 7,50 = 82,50 ; marge 38,43.
      assert.equal(euros(sommeLignes([['2', '43.70'], ['0.5', '47.10'], ['0.25', '39.90']])), 120.93);
      assert.deepEqual(await lireMarge(contrat.id), {
        ...MARGE_VIDE, ventesHT: 120.93, coutsHT: 82.5, margeHT: 38.43, heuresValorisees: 2.75, nombreInterventions: 1,
      });
    });

    // Cadrage, périmètre 1 : « Même transaction, mêmes verrous, même course avec le rattachement (409) » ; extension
    // au contrat des deux tests de course du hors contrat (api.test.mjs, audits n° 1 et 2 de #354) : un rattachement
    // validé pendant que la saisie attend le verrou de la fiche ne laisse figer ni le prix sous contrat de l'ancienne
    // main d'œuvre, ni l'absence de prix d'avant le premier rattachement.
    test('heure de visite saisie pendant un changement, un retrait ou un premier rattachement : jamais figée selon le rattachement d’avant', async () => {
      const ancienne = await creerMainOeuvre({ horsContrat: '45.50', sousContrat: '43.70' });
      const nouvelle = await creerMainOeuvre({ horsContrat: '60', sousContrat: '58.20' });
      const contrat = await creerContrat();

      // Changement : ni l'ancien prix sous contrat (43,70), ni le nouveau prix hors contrat (60).
      const change = await technicien('course-changement', '30', ancienne.id);
      const surChangement = await genererVisite(contrat);
      await affecter(surChangement.id, change.fiche);
      const pendantChangement = await course(change, surChangement.id, nouvelle.id, (tx) => tx.$queryRaw`SELECT "id" FROM "CataloguePrestation" WHERE "id" = ${nouvelle.id} FOR UPDATE`);
      await verifierCourse(await pendantChangement, surChangement.id, 58.2);
      assert.equal(await prixEnBase((await saisir(change, surChangement.id, 1)).id), 58.2);

      // Retrait : la saisie ne fige pas l'ancien prix ; la suivante n'a pas de prix.
      const retire = await technicien('course-retrait', '30', ancienne.id);
      const surRetrait = await suiteDe(surChangement.id);
      await affecter(surRetrait.id, retire.fiche);
      const pendantRetrait = await course(retire, surRetrait.id, null, (tx) => tx.$queryRaw`SELECT "intervenantId" FROM "IntervenantMainOeuvre" WHERE "intervenantId" = ${retire.fiche.id} FOR UPDATE`);
      await verifierCourse(await pendantRetrait, surRetrait.id, null);
      assert.equal(await prixEnBase((await saisir(retire, surRetrait.id, 1)).id), null);

      // Premier rattachement : la saisie ne fige pas l'absence de prix ; la suivante prend le prix sous contrat.
      const pose = await technicien('course-premier', '30');
      const surPose = await suiteDe(surChangement.id);
      await affecter(surPose.id, pose.fiche);
      const pendantPose = await course(pose, surPose.id, ancienne.id, (tx) => tx.$queryRaw`SELECT "id" FROM "CataloguePrestation" WHERE "id" = ${ancienne.id} FOR UPDATE`);
      await verifierCourse(await pendantPose, surPose.id, 43.7);
      assert.equal(await prixEnBase((await saisir(pose, surPose.id, 1)).id), 43.7);
    });

    // T1 du contrôle de cohérence : le prix figé d'une heure de visite suit le taux (voitCoutMainOeuvre, réservé à
    // l'administration) : absent pour le conducteur (coûts et journal des saisies), pour l'assistante technique
    // (réponse 4 du 06-11-2026, « Prix d'achat oui, coûts non ») et pour le technicien. La marge à l'heure d'une
    // intervention (margeSav) reste nulle pour une intervention de contrat (« Par contrat »).
    test('le prix figé d’une heure de visite n’est montré qu’à l’administration ; la visite et sa suite n’ont pas de marge à l’heure propre', async () => {
      const mainOeuvre = await creerMainOeuvre({ horsContrat: '52.30', sousContrat: '43.70' });
      const tech = await technicien('masquage', '30', mainOeuvre.id);
      const conducteur = await creerCompte('CONDUCTEUR_TRAVAUX', 'conducteur-masquage');
      const ficheConducteur = await prisma.intervenant.create({ data: { nom: `TEST Marge contrat conducteur ${unique()}`, role: 'Conducteur', tauxHoraireCharge: 40, userId: conducteur.compte.id } });
      const assistante = await creerCompte('ASSISTANTE_TECHNIQUE', 'assistante-masquage');
      const contrat = await creerContrat();
      const visite = await genererVisite(contrat);
      const suite = await suiteDe(visite.id);
      // Le conducteur est affecté à la visite : elle entre dans son périmètre SAV.
      await affecter(visite.id, tech.fiche, ficheConducteur);
      await affecter(suite.id, tech.fiche);
      const h = await saisir(tech, visite.id, 1.5);
      await saisir(tech, suite.id, 1);

      const lectureAdmin = await couts(visite.id);
      assert.equal(lectureAdmin.status, 200, JSON.stringify(lectureAdmin.body));
      assert.deepEqual(lectureAdmin.body.heures.map((ligne) => [ligne.id, ligne.prixVenteHoraireApplique]), [[h.id, 43.7]]);
      assert.equal(lectureAdmin.body.margeSav, null, 'une visite de contrat n’a pas de marge à l’heure propre');
      const lectureSuite = await couts(suite.id);
      assert.equal(lectureSuite.status, 200, JSON.stringify(lectureSuite.body));
      assert.equal(lectureSuite.body.heures[0].prixVenteHoraireApplique, 43.7);
      assert.equal(lectureSuite.body.margeSav, null, 'la suite d’une visite n’a pas de marge à l’heure propre');

      for (const [qui, auth] of [['conducteur', conducteur.auth], ['assistante technique', assistante.auth]]) {
        const lecture = await couts(visite.id, auth);
        assert.equal(lecture.status, 200, `${qui} : ${JSON.stringify(lecture.body)}`);
        assert.equal(lecture.body.heures.length, 1, qui);
        assert.equal(lecture.body.heures.some((ligne) => 'prixVenteHoraireApplique' in ligne || 'tauxHoraireApplique' in ligne), false, `${qui} : ni prix ni taux`);
        assert.equal('margeSav' in lecture.body, false, qui);
        const journal = await request(app).get(`/api/interventions/${visite.id}/journal-saisies`).set(auth);
        assert.equal(journal.status, 200, `${qui} : ${JSON.stringify(journal.body)}`);
        assert.ok(journal.body.some((entree) => entree.cibleId === h.id), `${qui} : l’entrée de la saisie est lue`);
        assert.equal(journal.body.some((entree) => (entree.avant && 'prixVenteHoraireApplique' in entree.avant) || (entree.apres && 'prixVenteHoraireApplique' in entree.apres)), false, `${qui} : journal sans prix`);
        // Elle ne lit pas davantage la marge du contrat.
        assert.equal((await marge(contrat.id, auth)).status, 403, qui);
      }
      const lectureTechnicien = await couts(visite.id, tech.auth);
      assert.equal(lectureTechnicien.status, 200, JSON.stringify(lectureTechnicien.body));
      assert.equal(lectureTechnicien.body.heures.length, 1);
      assert.equal(lectureTechnicien.body.heures.some((ligne) => 'prixVenteHoraireApplique' in ligne), false, 'technicien : aucun prix');
      assert.equal('margeSav' in lectureTechnicien.body, false);
    });

    // ===================== Marge du contrat (cadrage, périmètre 2) =====================

    // « Par contrat », « Depuis le début » : toutes les interventions du contrat, visites, suites et suites de suites ;
    // ventes et coûts arrondis au centime ligne par ligne (lecture retenue, comme la marge à l'heure d'un SAV hors
    // contrat) ; heure archivée exclue, restaurée revendue à son prix figé ; heure sans prix au coût, signalée.
    test('marge d’un contrat : visites, suites et suite de suite depuis son début, ventes au prix figé et coûts au taux figé arrondis ligne par ligne, archivées exclues puis restaurées à leur prix figé, heures sans prix signalées', async () => {
      const mainOeuvre = await creerMainOeuvre({ horsContrat: '52.30', sousContrat: '43.70' });
      const tech = await technicien('marge-archivee', '30', mainOeuvre.id);
      const contrat = await creerContrat({ politiqueMateriel: 'INCLUS' });
      const visite = await genererVisite(contrat);
      const suite = await suiteDe(visite.id);
      const suiteDeSuite = await suiteDe(suite.id);
      const visite2 = await visiteEnBase(contrat, 6, couverture('INCLUS'));
      const a = await fiche(`TEST Marge contrat A ${unique()}`);
      const zoe = await fiche(`TEST Marge contrat Zoé ${unique()}`, 32);
      const albert = await fiche(`TEST Marge contrat Albert ${unique()}`, 32);
      await heure(visite.id, a, '0.11', '30.50', '45.50'); // vente 5,005 → 5,01 ; coût 3,355 → 3,36
      await heure(visite.id, a, '0.11', '30.50', '45.50'); // idem (et non 10,01 et 6,71 sur la somme des deux)
      await heure(visite.id, a, '1.25', '35', '43.70'); // vente 54,625 → 54,63 ; coût 43,75
      await heure(suite.id, a, '3', '30', '41.15'); // vente 123,45 ; coût 90,00
      await heure(suiteDeSuite.id, a, '0.29', '30', '45.50'); // vente 13,195 → 13,20 (13,19 en virgule flottante) ; coût 8,70
      await heure(visite2.id, zoe, '0.5', '32', null); // coût 16,00, sans vente : signalée
      await heure(visite2.id, albert, '0.75', '32', null); // coût 24,00, sans vente : signalée
      await achat(visite.id, '4.34'); // matériel inclus (instantané de la visite)
      await achat(suiteDeSuite.id, '1.66'); // matériel inclus (instantané recopié sur la suite de suite)
      await achat(visite.id, '100', { archive: true }); // archivé : hors marge
      // Heure saisie par l'API, puis archivée par l'administration : hors marge.
      await affecter(visite.id, tech.fiche);
      const archivee = await saisir(tech, visite.id, 5);
      const archivage = await envoyer('post', `/api/interventions/${visite.id}/couts/heures/${archivee.id}/archiver`, admin, { motif: 'TEST archivage de l’heure' });
      assert.equal(archivage.status, 200, JSON.stringify(archivage.body));

      // Témoin : ventes 201,30 et coûts 189,17 ligne par ligne ; arrondis une fois sur la somme, 201,28 et 189,16.
      const lignesVendues = [['0.11', '45.50'], ['0.11', '45.50'], ['1.25', '43.70'], ['3', '41.15'], ['0.29', '45.50']];
      const lignesCoutees = [['0.11', '30.50'], ['0.11', '30.50'], ['1.25', '35'], ['3', '30'], ['0.29', '30'], ['0.5', '32'], ['0.75', '32']];
      assert.deepEqual([euros(sommeLignes(lignesVendues)), euros(sommeLignes(lignesCoutees))], [201.3, 189.17]);
      assert.equal(euros(sommeMontants(['4.34', '1.66'])), 6);
      // Marge = 201,30 − 189,17 − 6,00 = 6,13. Écarte : arrondi global des ventes (6,11), des coûts (6,14) ou des deux
      // (6,12) ; virgule flottante ligne par ligne (ventes 201,27) ; heure archivée comptée (ventes +218,50, coûts +150) ;
      // matériel archivé compté (+100) ; heures sans prix hors du coût (149,17) ; suites oubliées (visites seules).
      assert.deepEqual(await lireMarge(contrat.id), {
        ...MARGE_VIDE, ventesHT: 201.3, coutsHT: 189.17, materielHT: 6, margeHT: 6.13, heuresValorisees: 4.76, heuresNonValorisees: 1.25,
        intervenantsNonValorises: [albert.nom, zoe.nom], nombreInterventions: 4,
      });

      // Le tarif change, puis l'heure archivée est restaurée : elle revient à son prix figé (5 × 43,70 = 218,50), et non au
      // nouveau tarif sous contrat (5 × 47,10 = 235,50) ni au prix hors contrat (5 × 52,30 = 261,50).
      await changerTarif(mainOeuvre, { horsContrat: '52.30', sousContrat: '47.10' });
      const restauration = await envoyer('post', `/api/interventions/${visite.id}/couts/heures/${archivee.id}/restaurer`, admin, { motif: 'TEST restauration de l’heure' });
      assert.equal(restauration.status, 200, JSON.stringify(restauration.body));
      assert.equal(await prixEnBase(archivee.id), 43.7);
      // Ventes 201,30 + 218,50 = 419,80 ; coûts 189,17 + 150 = 339,17 ; marge 419,80 − 339,17 − 6 = 74,63.
      assert.deepEqual(await lireMarge(contrat.id), {
        ...MARGE_VIDE, ventesHT: 419.8, coutsHT: 339.17, materielHT: 6, margeHT: 74.63, heuresValorisees: 9.76, heuresNonValorisees: 1.25,
        intervenantsNonValorises: [albert.nom, zoe.nom], nombreInterventions: 4,
      });
    });

    // « Coût seul (Recommandé) » pour les heures d'une visite ou d'une suite annulée ; lecture retenue : leur matériel
    // inclus compte à son coût (comme leurs heures), leur matériel hors forfait reste exclu. Une heure sans prix d'une
    // intervention annulée n'est pas signalée : elle n'aurait de toute façon pas été vendue.
    test('interventions annulées : heures au coût seul, ni vendues ni signalées ; matériel inclus compté à son coût, matériel hors forfait exclu', async () => {
      const contrat = await creerContrat({ politiqueMateriel: 'INCLUS' });
      const visite = await genererVisite(contrat);
      const suiteAnnulee = await suiteDe(visite.id);
      const visiteHorsForfaitAnnulee = await visiteEnBase(contrat, 6, couverture('HORS_FORFAIT'));
      const visiteInclusAnnulee = await visiteEnBase(contrat, 9, couverture('INCLUS'));
      const a = await fiche(`TEST Marge contrat annulées ${unique()}`);
      const annule = await fiche(`TEST Marge contrat Annulé sans prix ${unique()}`);
      await heure(visite.id, a, '1', '30', '43.70'); // vente 43,70 ; coût 30
      await achat(visite.id, '3.21'); // inclus
      await heure(suiteAnnulee.id, a, '2', '30', '43.70'); // coût 60, sans vente
      await heure(suiteAnnulee.id, annule, '0.5', '30', null); // coût 15, sans vente ni signalement
      await achat(suiteAnnulee.id, '10'); // inclus, compté
      await heure(visiteHorsForfaitAnnulee.id, a, '1.5', '30', '43.70'); // coût 45, sans vente
      await achat(visiteHorsForfaitAnnulee.id, '25'); // hors forfait, exclu
      await achat(visiteInclusAnnulee.id, '4'); // inclus, compté
      for (const id of [suiteAnnulee.id, visiteHorsForfaitAnnulee.id, visiteInclusAnnulee.id]) await annuler(id);

      // Ventes 43,70 (annulées vendues : 196,65) ; coûts 30 + 60 + 15 + 45 = 150 (heures annulées hors coût : 30) ;
      // matériel inclus 3,21 + 10 + 4 = 17,21 (annulées exclues : 3,21 ; hors forfait compté : 42,21) ; exclu 25 ;
      // marge 43,70 − 150 − 17,21 = −123,51. Heures annulées 2 + 0,5 + 1,5 = 4 ; aucune heure non valorisée signalée
      // (lecture écartée : 0,5 h de « Annulé sans prix »).
      assert.equal(euros(sommeMontants(['3.21', '10', '4'])), 17.21);
      assert.deepEqual(await lireMarge(contrat.id), {
        ...MARGE_VIDE, ventesHT: 43.7, coutsHT: 150, materielHT: 17.21, materielExcluHT: 25, margeHT: -123.51, heuresValorisees: 1,
        heuresAnnulees: 4, nombreInterventions: 4, nombreInterventionsAnnulees: 3,
      });
    });

    // « Coût seul, non vendues (Recommandé) » pour un contrat annulé (« la marge n'est jamais surestimée ») ;
    // « Contrat suspendu ou terminé : heures vendues normalement ». Le contrat est annulé comme par l'annulation de son
    // devis : sa visite terminée reste terminée (devis/annulation.ts), sa visite annulée reste annulée.
    test('contrat annulé : aucune heure vendue, toutes au coût, son matériel inclus compté, plus aucun signalement d’heure sans prix ; suspendu juste avant, ses heures restaient vendues', async () => {
      const contrat = await creerContrat({ politiqueMateriel: 'INCLUS' });
      const visite = await genererVisite(contrat);
      const visiteAnnulee = await visiteEnBase(contrat, 6, couverture('HORS_FORFAIT'));
      const a = await fiche(`TEST Marge contrat annulé ${unique()}`);
      const sansPrix = await fiche(`TEST Marge contrat Sans prix ${unique()}`, 32);
      await heure(visite.id, a, '1', '30', '43.70'); // vente 43,70 ; coût 30
      await heure(visite.id, sansPrix, '0.5', '32', null); // coût 16 ; signalée tant que le contrat vit
      await achat(visite.id, '8'); // inclus
      await heure(visiteAnnulee.id, a, '0.25', '30', '43.70'); // coût 7,50, sans vente (10,93 si vendue)
      await achat(visiteAnnulee.id, '2.5'); // hors forfait, exclu
      await annuler(visiteAnnulee.id);
      await prisma.intervention.update({ where: { id: visite.id }, data: { statut: 'TERMINEE' } });

      // Contrat actif : ventes 43,70 ; coûts 30 + 16 + 7,50 = 53,50 ; matériel 8 ; exclu 2,50 ; marge −17,80.
      const vivant = {
        ...MARGE_VIDE, ventesHT: 43.7, coutsHT: 53.5, materielHT: 8, materielExcluHT: 2.5, margeHT: -17.8, heuresValorisees: 1, heuresNonValorisees: 0.5,
        intervenantsNonValorises: [sansPrix.nom], heuresAnnulees: 0.25, nombreInterventions: 2, nombreInterventionsAnnulees: 1,
      };
      assert.deepEqual(await lireMarge(contrat.id), vivant);
      await changerStatutContrat(contrat, 'SUSPENDU');
      assert.deepEqual(await lireMarge(contrat.id), vivant, 'contrat suspendu : heures vendues normalement');

      await annulerContrat(contrat);
      // Contrat annulé : ventes 0 (lecture écartée : 43,70) ; coûts gardés 53,50 ; matériel inclus gardé 8 (lecture
      // écartée : 0) ; marge −61,50 ; toutes les heures en heures annulées, 1 + 0,5 + 0,25 = 1,75 (et non 0,25) ; plus
      // d'heure non valorisée ni d'intervenant signalé.
      assert.deepEqual(await lireMarge(contrat.id), {
        ...MARGE_VIDE, coutsHT: 53.5, materielHT: 8, materielExcluHT: 2.5, margeHT: -61.5, heuresAnnulees: 1.75, contratAnnule: true,
        nombreInterventions: 2, nombreInterventionsAnnulees: 1,
      });
    });

    test('contrat suspendu puis terminé : ses heures restent vendues, sa marge inchangée', async () => {
      const contrat = await creerContrat({ politiqueMateriel: 'HORS_FORFAIT' });
      const visite = await genererVisite(contrat);
      const a = await fiche(`TEST Marge contrat terminé ${unique()}`);
      await heure(visite.id, a, '1.5', '30', '43.70'); // vente 65,55 ; coût 45
      await achat(visite.id, '6.4'); // hors forfait : exclu
      // Marge 65,55 − 45 = 20,55 (le matériel hors forfait, 6,40, n'y entre pas).
      const attendu = { ...MARGE_VIDE, ventesHT: 65.55, coutsHT: 45, materielExcluHT: 6.4, margeHT: 20.55, heuresValorisees: 1.5, nombreInterventions: 1 };
      assert.deepEqual(await lireMarge(contrat.id), attendu);
      await changerStatutContrat(contrat, 'SUSPENDU');
      assert.deepEqual(await lireMarge(contrat.id), attendu, 'suspendu');
      await changerStatutContrat(contrat, 'TERMINE');
      assert.equal((await prisma.contratMaintenance.findUniqueOrThrow({ where: { id: contrat.id } })).statut, 'TERMINE');
      assert.deepEqual(await lireMarge(contrat.id), attendu, 'terminé');
    });

    // « Oui, valoriser (Recommandé) » : « Même prix sous contrat, que la main d'œuvre soit incluse ou hors forfait ».
    test('politique de main d’œuvre incluse ou hors forfait : même marge, et un changement de cette politique ne la modifie pas', async () => {
      const incluse = await creerContrat({ politiqueMainOeuvre: 'INCLUSE', politiqueMateriel: 'INCLUS' });
      const horsForfait = await creerContrat({ politiqueMainOeuvre: 'HORS_FORFAIT', politiqueMateriel: 'INCLUS' });
      const a = await fiche(`TEST Marge contrat politique ${unique()}`, '31.40');
      for (const contrat of [incluse, horsForfait]) {
        const visite = await genererVisite(contrat);
        assert.equal(visite.couvertureContrat?.politiqueMainOeuvre, contrat.politiqueMainOeuvre);
        await heure(visite.id, a, '2.25', '31.40', '43.70'); // vente 98,325 → 98,33 ; coût 70,65
        await achat(visite.id, '5.55');
      }
      // Marge 98,33 − 70,65 − 5,55 = 22,13 pour les deux ; une main d'œuvre incluse non vendue donnerait −76,20.
      const attendu = { ...MARGE_VIDE, ventesHT: 98.33, coutsHT: 70.65, materielHT: 5.55, margeHT: 22.13, heuresValorisees: 2.25, nombreInterventions: 1 };
      assert.deepEqual(await lireMarge(incluse.id), attendu);
      assert.deepEqual(await lireMarge(horsForfait.id), attendu);
      await changerCouverture(incluse, { politiqueMainOeuvre: 'HORS_FORFAIT' });
      await changerCouverture(horsForfait, { politiqueMainOeuvre: 'INCLUSE' });
      assert.deepEqual(await lireMarge(incluse.id), attendu);
      assert.deepEqual(await lireMarge(horsForfait.id), attendu);
    });

    // « Selon la politique » et « Figée sur la visite (Recommandé) » : chaque intervention garde l'instantané de la
    // couverture pris à sa création ; un changement de couverture ne modifie pas les visites passées. Lecture retenue :
    // une intervention sans instantané suit la politique matériel actuelle du contrat.
    test('matériel compté selon l’instantané de chaque intervention et non la politique actuelle du contrat ; sans instantané, selon la politique actuelle', async () => {
      const contrat = await creerContrat({ politiqueMateriel: 'INCLUS' });
      const visiteInclus = await genererVisite(contrat);
      await changerCouverture(contrat, { politiqueMateriel: 'HORS_FORFAIT' });
      const suiteInclus = await suiteDe(visiteInclus.id);
      const visiteHorsForfait = await visiteEnBase(contrat, 6, couverture('HORS_FORFAIT'));
      const visiteSansInstantane = await visiteEnBase(contrat, 9, null);
      // Faits de la fixture : instantanés relus en base.
      const instantanes = await prisma.intervention.findMany({ where: { id: { in: [visiteInclus.id, suiteInclus.id, visiteHorsForfait.id, visiteSansInstantane.id] } }, select: { id: true, couvertureContrat: true } });
      const politique = (id) => instantanes.find((i) => i.id === id).couvertureContrat?.politiqueMateriel ?? null;
      assert.deepEqual([politique(visiteInclus.id), politique(suiteInclus.id), politique(visiteHorsForfait.id), politique(visiteSansInstantane.id)], ['INCLUS', 'INCLUS', 'HORS_FORFAIT', null]);
      const a = await fiche(`TEST Marge contrat instantané ${unique()}`);
      await heure(visiteInclus.id, a, '1', '30', '43.70'); // vente 43,70 ; coût 30
      await achat(visiteInclus.id, '11.11'); // instantané INCLUS
      await achat(suiteInclus.id, '2.22'); // instantané INCLUS, recopié de la visite malgré la couverture changée
      await achat(visiteHorsForfait.id, '33.33'); // instantané HORS_FORFAIT
      await achat(visiteSansInstantane.id, '44.44'); // sans instantané : politique actuelle du contrat

      // Politique actuelle HORS_FORFAIT : inclus 11,11 + 2,22 = 13,33 ; exclu 33,33 + 44,44 = 77,77 ; marge
      // 43,70 − 30 − 13,33 = 0,37. Écarte la politique actuelle pour toutes (inclus 0, exclu 91,10).
      assert.deepEqual(await lireMarge(contrat.id), {
        ...MARGE_VIDE, ventesHT: 43.7, coutsHT: 30, materielHT: 13.33, materielExcluHT: 77.77, margeHT: 0.37, heuresValorisees: 1, nombreInterventions: 4,
      });
      await changerCouverture(contrat, { politiqueMateriel: 'INCLUS' });
      // Politique actuelle INCLUS : seule l'intervention sans instantané change de côté. Inclus 13,33 + 44,44 = 57,77 ;
      // exclu 33,33 ; marge 43,70 − 30 − 57,77 = −44,07. Écarte la politique actuelle pour toutes (inclus 91,10, exclu 0).
      assert.deepEqual(await lireMarge(contrat.id), {
        ...MARGE_VIDE, ventesHT: 43.7, coutsHT: 30, materielHT: 57.77, materielExcluHT: 33.33, margeHT: -44.07, heuresValorisees: 1, nombreInterventions: 4,
      });
    });

    // Cadrage, périmètre 2 : « sur toutes les interventions dont contratMaintenanceId est le contrat […] ; jamais un
    // filtre par client ou par site ». Même client et même site pour tous les contrats de ce fichier.
    test('isolation : une curative et la visite d’un autre contrat, du même client et du même site, avec heures valorisées, heures sans prix et matériel, n’entrent pas dans la marge', async () => {
      const contrat = await creerContrat({ politiqueMateriel: 'INCLUS' });
      const autre = await creerContrat({ politiqueMateriel: 'INCLUS' });
      const visite = await genererVisite(contrat);
      const visiteAutre = await genererVisite(autre);
      const curative = await envoyer('post', '/api/interventions', admin, { clientId: client.id, siteId: site.id, titre: 'TEST Marge contrat curative voisine' });
      assert.equal(curative.status, 201, JSON.stringify(curative.body));
      assert.deepEqual([visite.siteId, visiteAutre.siteId, curative.body.siteId], [site.id, site.id, site.id], 'même site');
      const a = await fiche(`TEST Marge contrat isolation ${unique()}`);
      const intrusAutre = await fiche(`TEST Marge contrat Intrus autre contrat ${unique()}`);
      const intrusSav = await fiche(`TEST Marge contrat Intrus SAV ${unique()}`);
      await heure(visite.id, a, '1', '30', '43.70');
      await achat(visite.id, '5');
      await heure(visiteAutre.id, a, '2', '30', '43.70');
      await heure(visiteAutre.id, intrusAutre, '0.5', '30', null);
      await achat(visiteAutre.id, '7');
      await heure(curative.body.id, a, '3', '30', '52.30');
      await heure(curative.body.id, intrusSav, '0.25', '30', null);
      await achat(curative.body.id, '9');

      // Contrat : 43,70 − 30 − 5 = 8,70, une intervention. Un filtre par client ou par site y mettrait l'autre contrat
      // et la curative (ventes 43,70 + 87,40 + 156,90).
      assert.deepEqual(await lireMarge(contrat.id), {
        ...MARGE_VIDE, ventesHT: 43.7, coutsHT: 30, materielHT: 5, margeHT: 8.7, heuresValorisees: 1, nombreInterventions: 1,
      });
      // Autre contrat : 87,40 − (60 + 15) − 7 = 5,40 ; son seul intervenant sans prix.
      assert.deepEqual(await lireMarge(autre.id), {
        ...MARGE_VIDE, ventesHT: 87.4, coutsHT: 75, materielHT: 7, margeHT: 5.4, heuresValorisees: 2, heuresNonValorisees: 0.5,
        intervenantsNonValorises: [intrusAutre.nom], nombreInterventions: 1,
      });
    });

    // #355, N7 : intervenants dédoublonnés par identifiant (deux homonymes distincts donnent deux fois le nom), triés dans
    // l'ordre alphabétique français (Émile entre Dupont et Martin).
    test('heures sans prix : chaque intervenant nommé une fois, deux homonymes distincts deux fois, dans l’ordre alphabétique français', async () => {
      const contrat = await creerContrat();
      const visite = await genererVisite(contrat);
      const martin1 = await fiche(`TEST Martin ${suffixe}`);
      const martin2 = await fiche(`TEST Martin ${suffixe}`);
      const emile = await fiche(`TEST Émile ${suffixe}`);
      const dupont = await fiche(`TEST Dupont ${suffixe}`);
      const a = await fiche(`TEST Marge contrat homonymes ${unique()}`);
      await heure(visite.id, martin1, '0.5', '30', null);
      await heure(visite.id, martin1, '0.25', '30', null);
      await heure(visite.id, martin2, '1', '30', null);
      await heure(visite.id, emile, '0.5', '30', null);
      await heure(visite.id, dupont, '0.25', '30', null);
      await heure(visite.id, a, '1', '30', '43.70');
      // Écarte : dédoublonnage par nom (Martin une fois), aucun dédoublonnage (Martin trois fois), tri par point de code
      // (Émile en dernier). Heures non valorisées 2,5 ; coûts 3,5 × 30 = 105 ; marge 43,70 − 105 = −61,30.
      assert.deepEqual(await lireMarge(contrat.id), {
        ...MARGE_VIDE, ventesHT: 43.7, coutsHT: 105, margeHT: -61.3, heuresValorisees: 1, heuresNonValorisees: 2.5,
        intervenantsNonValorises: [dupont.nom, emile.nom, martin1.nom, martin2.nom], nombreInterventions: 1,
      });
    });

    test('contrat sans intervention, puis avec une visite sans heure ni matériel : marge nulle, sans signalement', async () => {
      const contrat = await creerContrat();
      assert.deepEqual(await lireMarge(contrat.id), MARGE_VIDE);
      await genererVisite(contrat);
      assert.deepEqual(await lireMarge(contrat.id), { ...MARGE_VIDE, nombreInterventions: 1 });
    });

    // ===================== Droits (cadrage, périmètre 3 ; choix par défaut, à confirmer) =====================

    // GET /api/contrats-maintenance/:id/marge, sous requireAuth et requireAdmin : l'administration (SUPERADMIN, ADMIN,
    // DIRECTEUR) ; 403 « Accès réservé aux administrateurs » pour tout autre type, assistante technique comprise
    // (mutant : requireGestionContrats) ; 401 sans session ou par une clé d'intégration (aucune route /api/v1) ; 404
    // pour un contrat inexistant. Aucune lecture n'écrit : empreinte de toute la base.
    test('droits : l’administration lit la marge du contrat ; tout autre type est refusé (403), sans session ou par une clé (401), contrat inexistant (404), sans rien écrire', async () => {
      const contrat = await creerContrat();
      const visite = await genererVisite(contrat);
      await heure(visite.id, await fiche(`TEST Marge contrat droits ${unique()}`), '1', '30', '43.70');
      const attendu = { ...MARGE_VIDE, ventesHT: 43.7, coutsHT: 30, margeHT: 13.7, heuresValorisees: 1, nombreInterventions: 1 };
      const cle = await envoyer('post', '/api/admin/api-keys', admin, { nom: `TEST clé marge contrat ${suffixe}`, scopes: ['clients:read'] });
      assert.equal(cle.status, 201, JSON.stringify(cle.body));
      assert.match(cle.body.apiKey, /^iris_/);
      const comptes = {};
      for (const role of ['ADMIN', 'DIRECTEUR', 'ASSISTANTE_TECHNIQUE', 'CONDUCTEUR_TRAVAUX', 'RESPONSABLE', 'TECHNICIEN', 'COMMERCIAL', 'DIRECTEUR_COMMERCIAL', 'ASSISTANTE_COMMERCIALE', 'COMPTABLE']) {
        comptes[role] = (await creerCompte(role, `droits-${role.toLowerCase()}`)).auth;
      }
      const tables = await tablesDeLaBase(prisma);
      const avant = await empreinteBase(prisma, tables);

      for (const [qui, auth] of [['SUPERADMIN', admin], ['ADMIN', comptes.ADMIN], ['DIRECTEUR', comptes.DIRECTEUR]]) {
        const res = await marge(contrat.id, auth);
        assert.equal(res.status, 200, `${qui} : ${JSON.stringify(res.body)}`);
        assert.deepEqual(res.body, attendu, qui);
      }
      for (const role of ['ASSISTANTE_TECHNIQUE', 'CONDUCTEUR_TRAVAUX', 'RESPONSABLE', 'TECHNICIEN', 'COMMERCIAL', 'DIRECTEUR_COMMERCIAL', 'ASSISTANTE_COMMERCIALE', 'COMPTABLE']) {
        const res = await marge(contrat.id, comptes[role]);
        assert.equal(res.status, 403, `${role} : ${JSON.stringify(res.body)}`);
        assert.deepEqual(res.body, { error: 'Accès réservé aux administrateurs' }, role);
      }
      const sansSession = await request(app).get(`/api/contrats-maintenance/${contrat.id}/marge`);
      assert.equal(sansSession.status, 401);
      assert.deepEqual(sansSession.body, { error: 'Authentification requise' });
      const parCle = await marge(contrat.id, { Authorization: `Bearer ${cle.body.apiKey}` });
      assert.equal(parCle.status, 401);
      assert.deepEqual(parCle.body, { error: 'Session expirée ou invalide' });
      assert.equal((await request(app).get(`/api/v1/contrats-maintenance/${contrat.id}/marge`).set({ Authorization: `Bearer ${cle.body.apiKey}` })).status, 404, 'aucune route /api/v1');
      const inexistant = await marge('00000000-0000-4000-8000-00000000abcd');
      assert.equal(inexistant.status, 404);
      assert.deepEqual(inexistant.body, { error: 'Contrat de maintenance introuvable.' });
      // Le 403 passe avant le 404 : un compte refusé n'apprend pas si le contrat existe.
      const inexistantRefuse = await marge('00000000-0000-4000-8000-00000000abcd', comptes.ASSISTANTE_TECHNIQUE);
      assert.equal(inexistantRefuse.status, 403);

      assert.deepEqual(await empreinteBase(prisma, tables), avant, 'aucune lecture de la marge n’écrit');
    });
  });
}
