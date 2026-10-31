import { useDarkTheme } from "../../lib/use-theme";

export function BrandLogo({compactOnNarrow=false,decorative=false}:{compactOnNarrow?:boolean;decorative?:boolean}) {
  const base=import.meta.env.BASE_URL;
  const dark=useDarkTheme();
  return <picture className="brand-logo">
    {compactOnNarrow&&<source media="(max-width:350px)" srcSet={`${base}logo-mark.svg`}/>}
    <img src={`${base}${dark ? "logo-dark.svg" : "logo.svg"}`} width={1868} height={500} alt={decorative?"":"ТФлоу"}/>
  </picture>;
}
