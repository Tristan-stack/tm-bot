import { withoutTrailingSlash } from "@launchbot/shared";
import { NotFound } from "./routes/NotFound";
import { Privacy } from "./routes/Privacy";
import { SimPlaceholder } from "./routes/SimPlaceholder";
import { Terms } from "./routes/Terms";

const SIM_ROUTE = /^\/sim\/[^/]+$/;

/**
 * Every page is opened by a full URL, from a `web_app` button of the bot, and none links to
 * another: a router library would weigh more than the pages it serves. `path` is
 * `location.pathname`, given by the caller so that a test can render any page.
 */
export function App({ path }: { path: string }) {
  const route = withoutTrailingSlash(path);
  if (route === "/terms") return <Terms />;
  if (route === "/privacy") return <Privacy />;
  if (SIM_ROUTE.test(route)) return <SimPlaceholder />;
  return <NotFound />;
}
