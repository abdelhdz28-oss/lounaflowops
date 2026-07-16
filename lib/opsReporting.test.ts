import { describe, it, expect } from 'vitest';
import { resolveMoveTarget, reorderIds, extractBilanJson } from './opsReporting';

// F1 — renumérotation des livrables
describe('F1 · resolveMoveTarget', () => {
  it('monte d\'un cran', () => expect(resolveMoveTarget(3, 5, { direction: 'up' })).toBe(2));
  it('descend d\'un cran', () => expect(resolveMoveTarget(3, 5, { direction: 'down' })).toBe(4));
  it('saisie de position 1 → index 0', () => expect(resolveMoveTarget(3, 5, { position: 1 })).toBe(0));
  it('position au-delà de la fin est bornée au dernier index', () => expect(resolveMoveTarget(0, 5, { position: 99 })).toBe(4));
  it('position en dessous de 1 est bornée à 0', () => expect(resolveMoveTarget(4, 5, { position: 0 })).toBe(0));
  it('position non numérique → -1 (invalide)', () => expect(resolveMoveTarget(0, 5, { position: 'abc' })).toBe(-1));
});

describe('F1 · reorderIds', () => {
  it('remonte le 4e (index 3) en tête et décale les autres', () => {
    expect(reorderIds(['a', 'b', 'c', 'd', 'e'], 3, 0)).toEqual(['d', 'a', 'b', 'c', 'e']);
  });
  it('descend le 1er en dernier', () => {
    expect(reorderIds(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });
  it('ne modifie pas le tableau source', () => {
    const src = ['a', 'b', 'c'];
    reorderIds(src, 0, 2);
    expect(src).toEqual(['a', 'b', 'c']);
  });
});

// F4 — parsing/validation du JSON du bilan
describe('F4 · extractBilanJson', () => {
  const valide = { bilan: [{ projet: 'X', avancement: '', faits_marquants: [], risques_retards: [] }], objectifs_hebdo: [] };

  it('parse un JSON strict valide', () => {
    expect(extractBilanJson(JSON.stringify(valide))).toEqual(valide);
  });
  it('tolère les balises ``` autour', () => {
    expect(extractBilanJson('```json\n' + JSON.stringify(valide) + '\n```')).toEqual(valide);
  });
  it('tolère du texte parasite avant/après', () => {
    expect(extractBilanJson('Voici le bilan : ' + JSON.stringify(valide) + ' Merci.')).toEqual(valide);
  });
  it('rejette un JSON invalide → null', () => {
    expect(extractBilanJson('{ bilan: [ oops')).toBeNull();
  });
  it('rejette un JSON valide mais mal formé (clés manquantes) → null', () => {
    expect(extractBilanJson(JSON.stringify({ bilan: 'pas un tableau' }))).toBeNull();
  });
  it('rejette une chaîne vide → null', () => {
    expect(extractBilanJson('')).toBeNull();
  });
});
