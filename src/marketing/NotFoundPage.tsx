import { Link } from "react-router";
import { ArrowUpRight } from "lucide-react";
import { ZevqoraLogo } from "@/brand/ZevqoraLogo";
import { PageTitle } from "./Editorial";
export default function NotFoundPage() {
  return (
    <main className="not-found">
      <PageTitle title="Page not found" />
      <Link to="/" aria-label="ZEVQORA home">
        <ZevqoraLogo size={25} />
      </Link>
      <strong>404</strong>
      <h1>A little off the path.</h1>
      <p>This page may have moved. Let’s get you back to a clearer view.</p>
      <Link to="/" className="z-button z-button-ink">
        Back to ZEVQORA
        <ArrowUpRight size={15} />
      </Link>
    </main>
  );
}
