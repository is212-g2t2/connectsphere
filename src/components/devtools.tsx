import { lazy } from "react";

/**
 * Load devtools only in development. Dynamic imports keep their packages and fonts out of the
 * production bundle. Keep this component outside `__root.tsx`; the route-module test allows only
 * the route object in that file.
 */
export const Devtools = import.meta.env.DEV
  ? lazy(async () => {
      const [{ TanStackDevtools }, { formDevtoolsPlugin }, { TanStackRouterDevtoolsPanel }] =
        await Promise.all([
          import("@tanstack/react-devtools"),
          import("@tanstack/react-form-devtools"),
          import("@tanstack/react-router-devtools"),
        ]);

      return {
        default: function DevtoolsPanel() {
          return (
            <TanStackDevtools
              plugins={[
                { name: "TanStack Router", render: <TanStackRouterDevtoolsPanel /> },
                formDevtoolsPlugin(),
              ]}
            />
          );
        },
      };
    })
  : () => null;
