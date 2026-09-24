import { withoutTrailingSlash } from "@launchbot/shared";
import { NotFound } from "./routes/NotFound";
import { Privacy } from "./routes/Privacy";
import { Terms } from "./routes/Terms";

/**
 * Every page is opened by a full URL, from a `web_app` button of the bot, and none links to
 * another: a router library would weigh more than the pages it serves. `path` is
 * `location.pathname`, given by the caller so that a test can render any page.
 */
export function App({ path }: { path: string }) {
  const route = withoutTrailingSlash(path);
  if (route === "/terms") return <Terms />;
  if (route === "/privacy") return <Privacy />;
  return <NotFound />;
}
