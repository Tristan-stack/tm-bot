import { PACKAGE_NAME as SHARED } from "@launchbot/shared";
import { PACKAGE_NAME as SIM_ENGINE } from "@launchbot/sim-engine";

/** Placeholder screen: routes, Terms/Privacy pages and the simulation arrive from V1-05. */
export function App() {
  return (
    <main>
      <h1>Launch Bot</h1>
      <p>Mini App skeleton.</p>
      <small>
        {SHARED} · {SIM_ENGINE}
      </small>
    </main>
  );
}
