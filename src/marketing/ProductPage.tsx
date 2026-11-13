import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router';
import { useSiteContent } from '@/lib/site';
import { useSession } from '@/lib/session';
import { PageTitle } from './Editorial';
import { ProductPreview } from './ProductPreview';

export default function ProductPage() {
  const { product } = useSiteContent();
  const { status } = useSession();
  const target = status === 'signed_in' ? '/app' : '/signup';
  return <>
    <PageTitle title="Product" description={product.intro ?? undefined} />
    <header className="atelier-document-intro"><p className="atelier-section-label">The workspace</p><h1>Your AI.<br /><span>In full view.</span></h1><p>See the expensive paths. Test the alternative.<br />Keep the evidence behind every decision.</p><Link to={target} className="atelier-button atelier-button-dark">{status === 'signed_in' ? 'Open workspace' : 'Start optimizing'}<ArrowRight size={18} /></Link></header>
    <section className="atelier-product-window" aria-label="Illustrative workspace preview"><ProductPreview view="Overview" /></section>
    <section className="atelier-product-details"><div><h2>From the first call<br />to the final decision.</h2><p>One workspace for measurement, replay, verification and review.</p></div><div className="atelier-capabilities">{product.features.map(feature => <details key={feature.title}><summary>{feature.title}<span aria-hidden="true">+</span></summary><p>{feature.body}</p></details>)}</div></section>
    <section className="atelier-product-close"><h2>Built around your boundaries.</h2><p>Connect scoped evidence. Inspect the source. Review every change before shipping.</p><Link to="/security">Read the security model<ArrowRight size={17} /></Link></section>
  </>;
}
