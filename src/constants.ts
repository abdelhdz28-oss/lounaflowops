export const FLUX_DEFAULTS = {
  'Hydragel_A1': { 
      name: 'Hydragel A1', 
      steps: ['-', 'Formul.', 'Mirage', 'Condi Sec.', 'Libération'],
      durations: { '-': 1, 'Formul.': 1, 'Mirage': 3, 'Condi Sec.': 2, 'Libération': 1 }
  },
  'Hydragel_A2': { 
      name: 'Hydragel A2', 
      steps: ['-', 'Formul.', 'Mirage', 'Condi Sec.', 'Libération'],
      durations: { '-': 1, 'Formul.': 1, 'Mirage': 3, 'Condi Sec.': 2, 'Libération': 1 }
  },
  'Hydragel_A3': { 
      name: 'Hydragel A3', 
      steps: ['-', 'Formul.', 'Mirage', 'Condi Sec.', 'Finition', 'Libération'],
      durations: { '-': 1, 'Formul.': 1, 'Mirage': 3, 'Condi Sec.': 2, 'Finition': 1, 'Libération': 1 }
  },
  'Hydragel_A2_Seringue': { 
      name: 'Hydragel A2 Seringue', 
      steps: ['-', 'Formul.', 'Mirage', 'Blister', 'Boite', 'Libération'],
      durations: { '-': 1, 'Formul.': 1, 'Mirage': 3, 'Blister': 2, 'Boite': 1, 'Libération': 1 }
  },
  'HAR_Louna': { 
      name: 'HAR - Louna Fillers', 
      steps: ['-', 'Formul.', 'Répart.', 'Mirage', 'Blister', 'Boite', 'Libération'],
      durations: { '-': 1, 'Formul.': 1, 'Répart.': 2, 'Mirage': 3, 'Blister': 2, 'Boite': 1, 'Libération': 1 }
  },
  'HAR_Essentyal': { 
      name: 'HAR - Essentyal', 
      steps: ['-', 'Formul.', 'Répart.', 'Mirage', 'Blister', 'Boite', 'Libération'],
      durations: { '-': 1, 'Formul.': 1, 'Répart.': 2, 'Mirage': 3, 'Blister': 2, 'Boite': 1, 'Libération': 1 }
  },
  'Hydroxyal': { 
      name: 'Hydroxyal', 
      steps: ['-', 'Formul.', 'Mirage', 'Condi Sec.', 'Libération'],
      durations: { '-': 1, 'Formul.': 1, 'Mirage': 3, 'Condi Sec.': 2, 'Libération': 1 }
  }
};

export const PRODUCT_CATALOG = [
  { name: 'INNOVYAL LIGHTENING', ref: 'DB-ILA' },
  { name: 'INNOVYAL LIGHTENING COS', ref: 'DB-ILA-C' },
  { name: 'INNOVYAL REGENERATIVE', ref: 'DB-IRA' },
  { name: 'INNOVYAL REGENERATIVE COS', ref: 'DB-IRA-C' },
  { name: 'INNOVYAL REGENERATIVE LIFT', ref: 'DB-IRA-S' },
  { name: 'INNOVYAL HAIR', ref: 'DB-IHA' },
  { name: 'INNOVYAL HAIR COS', ref: 'DB-IHA-C' },
  { name: 'LOUNA FILLER INSTANT REFINE', ref: 'DF-HAR1-2U' },
  { name: 'LOUNA FILLER SHAPE & VOLUME', ref: 'DF-HAR2-2U' },
  { name: 'LOUNA FILLER GLOSSY LIPS', ref: 'DF-HAR2-L-2U' },
  { name: 'LOUNA FILLER MAXI LIFT', ref: 'DF-HAR3-2U' },
  { name: 'ESSENTYAL TOUCH', ref: 'DF-HAR1-1U' },
  { name: 'ESSENTYAL LIPS', ref: 'DF-HAR2-L-1U' },
  { name: 'ESSENTYAL VOLUME', ref: 'DF-HAR2-1U' },
  { name: 'ESSENTYAL EXTREME', ref: 'DF-HAR3-1U' }
];
