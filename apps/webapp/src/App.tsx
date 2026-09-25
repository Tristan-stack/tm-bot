import { NotFound } from "./routes/NotFound";

/**
 * The Mini App serves no page since the Terms and Privacy pages were removed (decision of
 * 25/09/2026): it answers "Page not found" to every path, and the skeleton (theme, API client)
 * stays for a page to come. Such a page would be opened by a full URL, from a `web_app` button
 * of the bot: a switch on `location.pathname` here, no router library.
 */
export function App() {
  return <NotFound />;
}
