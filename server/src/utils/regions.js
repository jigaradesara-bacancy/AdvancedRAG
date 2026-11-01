// Query-side vocabulary used to tag chunks and detect regional intent. Edit to add other entity types.
export const REGIONS = [
  { name: 'East Asia and Pacific', aliases: ['east asia and pacific', 'east asia', 'eap'] },
  { name: 'Europe and Central Asia', aliases: ['europe and central asia', 'eca'] },
  { name: 'Latin America and the Caribbean', aliases: ['latin america and the caribbean', 'latin america', 'lac'] },
  { name: 'Middle East and North Africa', aliases: ['middle east and north africa', 'middle east', 'mena'] },
  { name: 'South Asia', aliases: ['south asia', 'sar'] },
  { name: 'Sub-Saharan Africa', aliases: ['sub-saharan africa', 'sub saharan africa', 'ssa'] },
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function detectRegion(text = '') {
  const t = text.toLowerCase();
  for (const r of REGIONS) {
    for (const a of r.aliases) {
      if (new RegExp(`\\b${esc(a)}\\b`).test(t)) return r.name;
    }
  }
  return null;
}
