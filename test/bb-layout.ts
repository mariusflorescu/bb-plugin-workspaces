export function mountBbDesktopLayout(): () => void {
  const root = document.createElement("div");
  root.id = "root";
  root.innerHTML =
    '<div data-testid="app-layout-root"><div data-side="left" data-state="expanded" data-collapsible="">' +
    '<div data-sidebar="gap"></div><div data-sidebar="panel"></div></div><main data-sidebar="inset"></main></div>';
  document.body.prepend(root);
  return () => root.remove();
}

const SHELF_PANEL =
  '<div role="dialog" aria-modal="true" data-sidebar="panel" data-state="open" data-side="left" data-vaul-drawer-direction="left">' +
  '<div data-sidebar="sidebar"></div></div>';

/** The compact shelf structure: the panel sits under main, which slides away from it. */
export function mountBbCompactLayout(): { readonly unmount: () => void; readonly remountPanel: () => void } {
  const root = document.createElement("div");
  root.id = "root";
  root.innerHTML = `<div data-testid="app-layout-root">${SHELF_PANEL}<main data-sidebar="inset"></main></div>`;
  document.body.prepend(root);
  return {
    unmount: () => root.remove(),
    remountPanel: () => {
      root.querySelector('[data-sidebar="panel"]')?.remove();
      root.firstElementChild?.insertAdjacentHTML("afterbegin", SHELF_PANEL);
    },
  };
}
