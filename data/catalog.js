// Biological treatment catalog. The analysis layer picks the optimal product
// per zone from this list — it is NOT an on-hand inventory, and nothing here
// constrains quantity. Whatever the plan recommends is what we buy.
//
// Kept in sync with BIOLOGICAL_CATALOG in server.js (browser needs it for the
// offline mock plan; the server needs it for the Claude prompt).

const TREATMENT_CATALOG = [
  {
    id: 'bt_kurstaki',
    name: 'Bacillus thuringiensis kurstaki',
    rate_gal_per_acre: 1.0,
    color: '#E8A33D',
    targets: 'lepidopteran larvae — armyworm, corn borer, earworm'
  },
  {
    id: 'beauveria',
    name: 'Beauveria bassiana',
    rate_gal_per_acre: 1.5,
    color: '#7B4B94',
    targets: 'aphids, thrips, whitefly, beetle adults'
  },
  {
    id: 'metarhizium',
    name: 'Metarhizium anisopliae',
    rate_gal_per_acre: 1.25,
    color: '#5AD4C8',
    targets: 'soil-dwelling larvae — rootworm, grubs, weevils'
  },
  {
    id: 'spinosad',
    name: 'Spinosad',
    rate_gal_per_acre: 0.75,
    color: '#D07EA8',
    targets: 'thrips, leafminers, spotted-wing drosophila'
  }
];
