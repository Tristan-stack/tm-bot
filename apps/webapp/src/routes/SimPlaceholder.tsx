import { enWebapp } from "@launchbot/shared";

/** Replaced by the live simulation screen in V1-24. */
export const SimPlaceholder = () => (
  <main className="page">
    <h1>{enWebapp.sim.title}</h1>
    <p>{enWebapp.sim.comingSoon}</p>
  </main>
);
