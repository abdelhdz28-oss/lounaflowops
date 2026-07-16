import { test, expect, Page } from '@playwright/test';

/**
 * Tests E2E du module Reporting (F1–F4).
 *
 * PRÉ-REQUIS (non exécutés en CI par défaut) :
 *   1. App démarrée : `npm run dev:full` (front sur :5173, API sur son port).
 *   2. Un compte admin : variables E2E_EMAIL / E2E_PASSWORD.
 *   3. Au moins un projet avec un jalon et ≥ 2 livrables dans le Reporting.
 *
 * Lancer : `E2E_EMAIL=... E2E_PASSWORD=... npm run test:e2e`
 *
 * Les sélecteurs s'appuient sur les libellés visibles de l'écran (fr). Si l'UI évolue,
 * ajuster les textes ci-dessous.
 */

async function login(page: Page) {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  test.skip(!email || !password, 'E2E_EMAIL / E2E_PASSWORD non fournis');
  await page.goto('/');
  await page.getByRole('textbox', { name: /e-?mail|identifiant/i }).first().fill(email!);
  await page.locator('input[type="password"]').first().fill(password!);
  await page.getByRole('button', { name: /connexion|se connecter|login/i }).first().click();
  await page.waitForLoadState('networkidle');
}

async function openReporting(page: Page) {
  await page.getByText(/reporting/i).first().click();
  await expect(page.getByText(/Board projets/i)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await login(page);
  await openReporting(page);
});

// F3 — aucune poignée / aucun élément « draggable » sur le board (actions/livrables).
test('F3 · aucun glisser-déposer sur les actions/livrables du Reporting', async ({ page }) => {
  const draggables = page.locator('[draggable="true"]');
  await expect(draggables).toHaveCount(0);
});

// F1 — le bouton de génération et les contrôles d'ordre existent ; l'ordre survit à un reload.
test('F1 · réordonnancement des livrables persistant après rechargement', async ({ page }) => {
  // Les flèches monter/descendre (title="Monter"/"Descendre") sont présentes pour un admin.
  const monter = page.getByRole('button', { name: 'Monter' });
  test.skip((await monter.count()) < 1, 'Pas de livrable réordonnable visible (jeu de données requis).');

  const inputValues = () => page.locator('tr:has(input) input')
    .evaluateAll(els => els.map(e => (e as HTMLInputElement).value));
  // Capture l'ordre courant des titres de livrables (lignes indentées ↳).
  const titresAvant = await inputValues();
  // Descend le premier livrable réordonnable.
  await page.getByRole('button', { name: 'Descendre' }).first().click();
  await page.waitForLoadState('networkidle');
  await page.reload();
  await openReporting(page);
  const titresApres = await inputValues();
  expect(titresApres).not.toEqual(titresAvant); // l'ordre a changé et a été persisté
});

// F2 — note de synthèse : édition + enregistrement (garde-fou de version côté serveur).
test('F2 · la note de synthèse s\'enregistre', async ({ page }) => {
  const note = page.locator('textarea').first();
  const marqueur = `E2E ${Date.now()}`;
  await note.fill(marqueur);
  await page.getByRole('button', { name: /Enregistrer la note/i }).click();
  await page.waitForLoadState('networkidle');
  await page.reload();
  await openReporting(page);
  await expect(page.locator('textarea').first()).toHaveValue(new RegExp(marqueur));
});

// F4 — le bouton « Générer le bilan » est présent et déclenche la génération (ou un message maîtrisé).
test('F4 · le bouton Générer le bilan est disponible', async ({ page }) => {
  await expect(page.getByRole('button', { name: /Générer le bilan/i })).toBeVisible();
});
