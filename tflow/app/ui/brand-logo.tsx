export function BrandLogo({compactOnNarrow=false,decorative=false}:{compactOnNarrow?:boolean;decorative?:boolean}) {
  return <picture className="brand-logo">
    {compactOnNarrow&&<source media="(max-width:310px)" srcSet="/logo-mark.svg"/>}
    <img src="/logo.svg" width={1820} height={500} alt={decorative?"":"ТФлоу"}/>
  </picture>;
}
