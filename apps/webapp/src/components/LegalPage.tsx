import { enWebapp } from "@launchbot/shared";
import { TERMS_VERSION } from "../config";
import { legalVersionLine } from "../legal";

type LegalPageProps = {
  title: string;
  /** Provisional body: the parts the full text will cover (V1-41). */
  parts: readonly string[];
};

/** Shared by /terms and /privacy: one `TERMS_VERSION` covers both texts (§11.2). */
export function LegalPage({ title, parts }: LegalPageProps) {
  return (
    <main className="page">
      <h1>{title}</h1>
      <p className="hint">{legalVersionLine(TERMS_VERSION)}</p>
      <ol>
        {parts.map((part) => (
          <li key={part}>{part}</li>
        ))}
      </ol>
      <p className="hint">{enWebapp.legal.draft}</p>
    </main>
  );
}
