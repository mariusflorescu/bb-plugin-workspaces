import type { ExperimentalSidebarFooterDisclosureProps } from "@get-bb/plugin-sdk/app";
import { SwitcherPanel } from "./SwitcherPanel";
import { WorkspacesProvider } from "./WorkspacesProvider";

export function SwitcherDisclosure(props: ExperimentalSidebarFooterDisclosureProps) {
  return (
    <WorkspacesProvider>
      <SwitcherPanel {...props} />
    </WorkspacesProvider>
  );
}
