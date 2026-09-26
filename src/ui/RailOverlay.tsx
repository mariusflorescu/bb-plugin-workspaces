import { OverlayBody } from "./OverlayBody";
import { WorkspacesProvider } from "./WorkspacesProvider";

export function RailOverlay() {
  return (
    <WorkspacesProvider>
      <OverlayBody />
    </WorkspacesProvider>
  );
}
