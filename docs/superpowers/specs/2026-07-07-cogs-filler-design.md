# COGS Filler — onglet Cockpit Louna

## Objectif
Calculer le COGS d'un filler (gamme **Louna Filler** ou **Essentyal**) à partir du **nombre de boîtes** saisi par variant + taille de cuve, en rejouant le mécanisme des BOM Excel, avec les prix unitaires MP/AC tirés d'Odoo (standard_price).

## Décisions (validées par Abdel)
- Saisie **campagne multi-variantes** (4 variants + taille de cuve par variant).
- Quantités BOM : **moteur Excel encodé dans l'app** (paramètres éditables), pas de BOM live Odoo.
- COGS = **MP + AC + coûts process paramétrables**.
- Prix Odoo = **standard_price** (product.product, par default_code).

## Moteur de calcul (src/cogsFiller.ts, fonction pure `computeCogsFiller`)
Par variant (boxes, tank) :
1. sgConformes = boxes × syringesPerBox (Louna 2 / Essentyal 1)
2. sgARepartir = sgConformes / (RF_FORM × RF_FILL × RF_MIR × RF_COND)
3. besoinPR = tablePR[variant][tank] ; besoinPNR = tablePNR[variant][tank] (g)
Totaux campagne :
- totalPR = Σ besoinPR ; totalPNR = Σ besoinPNR
- runsPR = ceil(totalPR / runYieldPR) ; runsPNR = ceil(totalPNR / runYieldPNR)
- totalBoxes = Σ boxes ; totalSg = Σ sgConformes ; batchesActifs = nb variants avec boxes>0
Quantités :
- MP phase PR = ligne.qtyPerRun × runsPR ; MP phase PNR = ligne.qtyPerRun × runsPNR
- actifs gel = ligne.qtyPerBatch × batchesActifs
- AC = ligne.qtyPerBox × boxes(variant), sommé par code
COGS :
- coûtMP = Σ(qté × prixOdoo) ; coûtAC = Σ(qté × prixOdoo) ; coûtProcess = Σ lignes process (base per_box/per_syringe/per_run/per_lot)
- cogsLot = coûtMP + coûtAC + coûtProcess
- cogsBox = cogsLot / totalBoxes ; cogsSg = cogsLot / totalSg
- par variant : allocation MP/AC/process au prorata (AC direct par variant ; gel PR/PNR au prorata du besoin gel du variant)

## Données (settings.cogsFillerModels, éditable ; seed depuis les 2 Excel)
Par gamme : params (rendements, gelMassPerSyringe, runYieldPR/PNR, syringesPerBox), variants[{code,label}], tablePR/tablePNR par tank, bomPR[], bomPNR[], actifs[], acParVariant{variant:[{code,qtyPerBox}]}, processCosts[{label,cost,basis}].
Valeurs incertaines (tables PR/PNR par cuve) éditables dans l'UI → Abdel valide contre son Excel.

## Serveur (server.ts)
- `GET /api/cogs-filler/prices?codes=MP-010,AC-030,...` → odooKw product.product read standard_price par default_code → { code: prix }. requireView('cockpit').
- `GET /api/settings/cogsFillerModels` / `PUT` (admin) — pattern productCatalog.

## Frontend
- Onglet `cockpit-cogs-filler` (« COGS Filler ») dans CockpitView.
- Sélecteur gamme, tableau saisie par variant (boîtes + cuve), résultats live (COGS lot/boîte/seringue, par variant + global, répartition MP/AC/process), bouton « Rafraîchir prix Odoo » (prix manquant en rouge), panneau paramètres éditable.
- Wiring : Sidebar child, App.tsx title + NAV_ORDER, CockpitView dispatch.

## Vérification
- Revue du moteur par sous-agent (fidélité Excel) ; boucle max 2.
- Cas de contrôle : Louna HAR1 800 boîtes/3L → 2146 sg à répartir → runs PR 4 (à ±1).
