// Loaded only by PublicLayout. Native modal focus handling keeps the page inert.
const dialog = document.querySelector<HTMLDialogElement>(".public-site #mobile-nav");
const trigger = document.querySelector<HTMLButtonElement>(".public-site #burger");
const closeButton = document.querySelector<HTMLButtonElement>(".public-site #mobile-close");
const dropdowns = document.querySelectorAll<HTMLDetailsElement>(".public-site .nav-dropdown");

if (dialog && trigger && closeButton) {
  trigger.hidden = false;
  trigger.addEventListener("click", () => {
    dialog.showModal();
    document.body.classList.add("public-menu-open");
    trigger.setAttribute("aria-expanded", "true");
  });
  closeButton.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    document.body.classList.remove("public-menu-open");
    trigger.setAttribute("aria-expanded", "false");
    if (trigger.getClientRects().length) trigger.focus({ preventScroll: true });
  });
  dialog.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a")) dialog.close();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const controls = [...dialog.querySelectorAll<HTMLElement>("a[href], button, summary")]
      .filter((element) => element.getClientRects().length && !element.closest("details:not([open]) .public-mobile-submenu"));
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first && last) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last && first) {
      event.preventDefault(); first.focus();
    }
  });
  window.matchMedia("(min-width: 1100px)").addEventListener("change", (event) => {
    if (event.matches && dialog.open) dialog.close();
  });
}

dropdowns.forEach((dropdown) => {
  dropdown.addEventListener("toggle", () => {
    if (dropdown.open) dropdowns.forEach((other) => { if (other !== dropdown) other.open = false; });
  });
  dropdown.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && dropdown.open) {
      dropdown.open = false;
      dropdown.querySelector("summary")?.focus();
      event.stopPropagation();
    }
  });
  dropdown.addEventListener("focusout", (event) => {
    if (!(event.relatedTarget instanceof Node) || !dropdown.contains(event.relatedTarget)) dropdown.open = false;
  });
});
document.addEventListener("click", (event) => {
  dropdowns.forEach((dropdown) => {
    if (event.target instanceof Node && !dropdown.contains(event.target)) dropdown.open = false;
  });
});
