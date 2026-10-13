import { lazy, Suspense } from "react";
import BrowserOnly from "@docusaurus/BrowserOnly";
import { useColorMode } from "@docusaurus/theme-common";

import "@scalar/api-reference-react/style.css";

// Scalar mounts a browser-only app, so it is loaded on the client and bundled
// with the site rather than fetched from a CDN.
const ApiReferenceReact = lazy(() =>
  import("@scalar/api-reference-react").then((module) => ({ default: module.ApiReferenceReact }))
);

export default function ApiReference({ spec }: { spec: Record<string, unknown> }) {
  const { colorMode } = useColorMode();

  return (
    <BrowserOnly>
      {() => (
        <Suspense fallback={null}>
          <ApiReferenceReact
            configuration={{
              content: spec,
              layout: "classic",
              // Requests from docs.norish.dev to a reader's own server would be
              // cross-origin, so the reference is read-only.
              hideTestRequestButton: true,
              hideClientButton: true,
              forceDarkModeState: colorMode,
              hideDarkModeToggle: true,
              withDefaultFonts: false,
              showToolbar: "never",
              showDeveloperTools: "never",
              telemetry: false,
              agent: { disabled: true },
            }}
          />
        </Suspense>
      )}
    </BrowserOnly>
  );
}
