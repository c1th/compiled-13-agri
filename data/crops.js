// Crop knowledge base for the pesticide shed: common crops, their usual pest
// complex, and the products growers commonly keep for them. This drives the
// suggestion dropdown instantly and offline; the AI crop-intel endpoint
// (/api/crop-intel) can replace it with a region-specific list when available.
//
// catalog_id links a product to TREATMENT_CATALOG / BIOLOGICAL_CATALOG where
// one of our prescribable biologicals is the same thing the grower has.

const CROP_DB = [
  {
    id: 'corn',
    name: 'Corn (maize)',
    pests: ['corn earworm', 'European corn borer', 'fall armyworm', 'corn rootworm', 'aphids'],
    products: [
      { name: 'Bacillus thuringiensis kurstaki', type: 'biological', catalog_id: 'bt_kurstaki',
        targets: 'earworm, corn borer, armyworm larvae' },
      { name: 'Metarhizium anisopliae', type: 'biological', catalog_id: 'metarhizium',
        targets: 'corn rootworm larvae in soil' },
      { name: 'Chlorantraniliprole (Coragen)', type: 'conventional',
        targets: 'lepidopteran larvae; soft on beneficials' },
      { name: 'Lambda-cyhalothrin (Warrior II)', type: 'conventional',
        targets: 'broad-spectrum — beetles, borers, armyworm' }
    ]
  },
  {
    id: 'soybean',
    name: 'Soybean',
    pests: ['soybean aphid', 'bean leaf beetle', 'stink bugs', 'soybean looper'],
    products: [
      { name: 'Beauveria bassiana', type: 'biological', catalog_id: 'beauveria',
        targets: 'aphids, whitefly, beetle adults' },
      { name: 'Bacillus thuringiensis kurstaki', type: 'biological', catalog_id: 'bt_kurstaki',
        targets: 'looper and other caterpillars' },
      { name: 'Bifenthrin (Brigade)', type: 'conventional',
        targets: 'stink bugs, bean leaf beetle' }
    ]
  },
  {
    id: 'wheat',
    name: 'Wheat / small grains',
    pests: ['cereal aphids', 'armyworm', 'Hessian fly', 'wireworm'],
    products: [
      { name: 'Beauveria bassiana', type: 'biological', catalog_id: 'beauveria',
        targets: 'cereal aphids' },
      { name: 'Bacillus thuringiensis kurstaki', type: 'biological', catalog_id: 'bt_kurstaki',
        targets: 'armyworm outbreaks' },
      { name: 'Lambda-cyhalothrin (Warrior II)', type: 'conventional',
        targets: 'aphids, armyworm — economic-threshold spray' }
    ]
  },
  {
    id: 'rice',
    name: 'Rice',
    pests: ['rice stem borer', 'brown planthopper', 'rice water weevil', 'leaffolder'],
    products: [
      { name: 'Bacillus thuringiensis kurstaki', type: 'biological', catalog_id: 'bt_kurstaki',
        targets: 'stem borer, leaffolder larvae' },
      { name: 'Metarhizium anisopliae', type: 'biological', catalog_id: 'metarhizium',
        targets: 'rice water weevil larvae' },
      { name: 'Buprofezin (Applaud)', type: 'conventional',
        targets: 'planthopper nymphs; spares natural enemies' }
    ]
  },
  {
    id: 'cotton',
    name: 'Cotton',
    pests: ['bollworm', 'cotton aphid', 'thrips', 'whitefly', 'plant bugs'],
    products: [
      { name: 'Bacillus thuringiensis kurstaki', type: 'biological', catalog_id: 'bt_kurstaki',
        targets: 'bollworm larvae' },
      { name: 'Beauveria bassiana', type: 'biological', catalog_id: 'beauveria',
        targets: 'aphids, whitefly, thrips' },
      { name: 'Spinosad', type: 'biological', catalog_id: 'spinosad',
        targets: 'thrips, small bollworm' },
      { name: 'Acephate (Orthene)', type: 'conventional',
        targets: 'plant bugs, aphid flare-ups' }
    ]
  },
  {
    id: 'potato',
    name: 'Potato',
    pests: ['Colorado potato beetle', 'potato aphid', 'wireworm', 'potato tuberworm'],
    products: [
      { name: 'Beauveria bassiana', type: 'biological', catalog_id: 'beauveria',
        targets: 'Colorado potato beetle adults, aphids' },
      { name: 'Metarhizium anisopliae', type: 'biological', catalog_id: 'metarhizium',
        targets: 'wireworm in soil' },
      { name: 'Spinosad', type: 'biological', catalog_id: 'spinosad',
        targets: 'beetle larvae, tuberworm' }
    ]
  },
  {
    id: 'tomato',
    name: 'Tomato / vegetables',
    pests: ['tomato hornworm', 'whitefly', 'thrips', 'leafminers', 'aphids'],
    products: [
      { name: 'Bacillus thuringiensis kurstaki', type: 'biological', catalog_id: 'bt_kurstaki',
        targets: 'hornworm and other caterpillars' },
      { name: 'Spinosad', type: 'biological', catalog_id: 'spinosad',
        targets: 'thrips, leafminers' },
      { name: 'Beauveria bassiana', type: 'biological', catalog_id: 'beauveria',
        targets: 'whitefly, aphids' }
    ]
  },
  {
    id: 'orchard',
    name: 'Apple / stone-fruit orchard',
    pests: ['codling moth', 'oriental fruit moth', 'mites', 'aphids', 'plum curculio'],
    products: [
      { name: 'Bacillus thuringiensis kurstaki', type: 'biological', catalog_id: 'bt_kurstaki',
        targets: 'codling moth, fruit moth larvae' },
      { name: 'Spinosad', type: 'biological', catalog_id: 'spinosad',
        targets: 'codling moth, spotted-wing drosophila' },
      { name: 'Horticultural oil', type: 'conventional',
        targets: 'mites, scale, overwintering aphid eggs' }
    ]
  },
  {
    id: 'vineyard',
    name: 'Grape vineyard',
    pests: ['grape berry moth', 'leafhoppers', 'mealybug', 'spotted-wing drosophila'],
    products: [
      { name: 'Bacillus thuringiensis kurstaki', type: 'biological', catalog_id: 'bt_kurstaki',
        targets: 'berry moth larvae' },
      { name: 'Spinosad', type: 'biological', catalog_id: 'spinosad',
        targets: 'spotted-wing drosophila' },
      { name: 'Beauveria bassiana', type: 'biological', catalog_id: 'beauveria',
        targets: 'leafhoppers, mealybug crawlers' }
    ]
  },
  {
    id: 'leafy',
    name: 'Lettuce / leafy greens',
    pests: ['aphids', 'thrips', 'loopers', 'leafminers'],
    products: [
      { name: 'Spinosad', type: 'biological', catalog_id: 'spinosad',
        targets: 'thrips, leafminers' },
      { name: 'Bacillus thuringiensis kurstaki', type: 'biological', catalog_id: 'bt_kurstaki',
        targets: 'looper caterpillars' },
      { name: 'Beauveria bassiana', type: 'biological', catalog_id: 'beauveria',
        targets: 'aphid colonies' }
    ]
  }
];
