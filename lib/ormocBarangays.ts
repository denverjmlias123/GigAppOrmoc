/**
 * Complete list of all 88 official Barangays and Urban Districts in Ormoc City, Leyte.
 * (29 Urban Districts + 59 Rural Barangays).
 * Used for address validation, marketplace filtering, and deterministic legitimacy scoring.
 */
export const ORMOC_BARANGAYS: readonly string[] = [
  'District 1',
  'District 2',
  'District 3',
  'District 4',
  'District 5',
  'District 6',
  'District 7',
  'District 8',
  'District 9',
  'District 10',
  'District 11',
  'District 12',
  'District 13',
  'District 14',
  'District 15',
  'District 16',
  'District 17',
  'District 18',
  'District 19',
  'District 20',
  'District 21',
  'District 22',
  'District 23',
  'District 24',
  'District 25',
  'District 26',
  'District 27',
  'District 28',
  'District 29',
  'Airport',
  'Alegria',
  'Alta Vista',
  'Bagong',
  'Bagong Buhay',
  'Bantigue',
  'Batuan',
  'Cabintan',
  'Cabulihan',
  'Can-adieng',
  'Can-untog',
  'Catmon',
  'Cogon Combado',
  'Curva',
  'Danao',
  'Dayhagan',
  'Dolores',
  'Domonar',
  'Don Felipe Larrazabal',
  'Doña Feliza Z. Mejia',
  'Donghol',
  'Esperanza',
  'Hibunawon',
  'Hugpa',
  'Ipil',
  'Lao',
  'Libertad',
  'Linao',
  'Luna',
  'Mabini',
  'Macabug',
  'Magaswi',
  'Mahayag',
  'Mahayahay',
  'Margen',
  'Mas-in',
  'Matica-a',
  'Milagro',
  'Monterico',
  'Nasunogan',
  'Naungan',
  'Nueva Sociedad',
  'Patag',
  'Punta',
  'Quezon Jr.',
  'Rufina M. Tan',
  'Sabang Bao',
  'Salvacion',
  'San Antonio',
  'San Isidro',
  'San Jose',
  'San Juan',
  'San Pablo',
  'San Vicente',
  'Santo Niño',
  'Sumangga',
  'Tambulilid',
  'Tongonan',
  'Valencia',
] as const;

/**
 * Checks whether a given string is a recognized Ormoc City barangay.
 * Case-insensitive comparison with whitespace trimmed.
 */
export function isOrmocBarangay(name: string | null | undefined): boolean {
  if (!name || typeof name !== 'string') {
    return false;
  }
  const normalized = name.trim().toLowerCase();
  return ORMOC_BARANGAYS.some(
    (b) => b.toLowerCase() === normalized
  );
}
