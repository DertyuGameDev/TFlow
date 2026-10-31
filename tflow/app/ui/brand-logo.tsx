export function BrandLogo({compactOnNarrow=false,decorative=false}:{compactOnNarrow?:boolean;decorative?:boolean}) {
  const base=import.meta.env.BASE_URL;
  return <picture className="brand-logo">
    {compactOnNarrow&&<source media="(max-width:350px)" srcSet={`${base}logo-mark.svg`}/>}
    <img src={`${base}logo.svg`} width={1868} height={500} alt={decorative?"":"ТФлоу"}/>
  </picture>;
}
