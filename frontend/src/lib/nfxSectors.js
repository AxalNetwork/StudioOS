// The NFX sector taxonomy — what an INVESTOR says they do and do not back.
//
// WHY THIS IS NOT `lib/sectors.js`. That file is Axal's own taxonomy and it
// describes a COMPANY: `components/SectorSelect.jsx` uses it wherever a
// founder classifies what they are building, and its entries are shaped for
// that ('3D Printing / Additive Manufacturing', 'Vertical SaaS'). This list
// describes a THESIS, and it is the vocabulary investors already use to
// state one, so a fund that says "we do Creator/Passion Economy and Gig
// Economy" can say exactly that instead of picking the nearest Axal label.
//
// Merging the two would break both jobs at once: a founder would be offered
// 'General Tech' and 'Impact', which classify nothing, and an investor would
// lose the distinctions their thesis turns on. They stay separate, and this
// comment is why.
//
// THE SAME LIST SERVES THE THESIS AND THE ANTI-THESIS. "We back FinTech" and
// "we will never look at FinTech" are answers to the same question with
// opposite signs, so they must be drawn from the same set — otherwise a
// sector can be excluded that could never have been selected, or worse, one
// can be selected that cannot be excluded.
//
// Supplied verbatim by the user from the nFX signal pre-seed investor lists;
// only the taxonomy was wanted, not the links. Order is the source's own
// (alphabetical, with the source's own casing) and a test pins the count, so
// a quiet edit cannot drop an entry that somebody's saved profile references.

export const NFX_SECTORS = [
  'Advertising',
  'AgTech',
  'AI',
  'Analytics',
  'AR/VR',
  'AudioTech',
  'AutoTech',
  'BioTech',
  'Chemicals',
  'ClimateTech/CleanTech',
  'Cloud Infrastructure',
  'ConstructionTech',
  'Consumer Health',
  'Consumer Internet',
  'Cosmetics',
  'Creator/Passion Economy',
  'Cybersecurity',
  'Data Services',
  'DeepTech',
  'DefenseTech',
  'Developer Tools',
  'Diagnostics',
  'Digital Health',
  'Direct-to-Consumer (DTC)',
  'Drug Delivery',
  'E-commerce',
  'Education',
  'EnergyTech',
  'Enterprise Applications',
  'Enterprise Infrastructure',
  'Enterprise',
  'Entertainment & Sports',
  'Fashion',
  'FinTech',
  'Food and Beverage',
  'Future of Work',
  'Games',
  'Gaming/eSports',
  'General Tech',
  'Generative Tech/AI',
  'Gig Economy',
  'GovTech',
  'Hardware',
  'Health & Hospital Services',
  'Health IT',
  'Human Capital/HRTech',
  'Impact',
  'Insurance',
  'IoT',
  'LegalTech',
  'Local Services',
  'Lodging/Hospitality',
  'Logistics',
  'Manufacturing',
  'MarketingTech',
  'Marketplaces',
  'Material Science',
  'Media/Content',
  'Medical Devices',
  'Messaging',
  'Parenting/Families',
  'Payments',
  'Pharmaceuticals',
  'Real Estate/PropTech',
  'Retail',
  'Robotics',
  'SaaS',
  'Sales & CRM',
  'Security',
  'Semiconductors',
  'Smart Cities/UrbanTech',
  'SMB Software',
  'Social Commerce',
  'Social Networks',
  'Space',
  'Supply Chain Tech',
  'Therapeutics',
  'TransportationTech',
  'Travel',
  'Web3/Blockchain',
  'Web3/Crypto',
  'Wellness & Fitness',
];

export const NFX_SECTOR_SET = new Set(NFX_SECTORS);
