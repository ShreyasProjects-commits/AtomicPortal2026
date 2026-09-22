import { supabase } from "./supabase.js";
import { getCurrentUserAndProfile } from "./authz.js";

// Single source of truth for the top nav's links per role. Every page
// includes this script and gets its nav rebuilt on load — the <nav> markup
// baked into each HTML file is only a fallback shown for the instant before
// this runs, and only the logged-out flavour needs to match here.
const NAV_LINKS = {
  guest: [
    { href: "index.html", label: "Home" },
    { href: "about.html", label: "About" },
  ],
  warehouse_worker: [
    { href: "index.html", label: "Home" },
    { href: "worker-orders.html", label: "My Orders" },
    { href: "portfolio-worker.html", label: "Profile" },
  ],
  admin: [
    { href: "index.html", label: "Home" },
    { href: "orders.html", label: "Orders" },
    { href: "add-order.html", label: "Add Order" },
    { href: "integrations.html", label: "Integrations" },
    { href: "portfolio-admin.html", label: "Portfolio" },
    { href: "about.html", label: "About" },
  ],
};

async function renderNav() {
  const nav = document.querySelector(".topnav");
  if (!nav) return;

  const { user, profile } = await getCurrentUserAndProfile();
  const links = user ? (NAV_LINKS[profile?.role] ?? NAV_LINKS.guest) : NAV_LINKS.guest;
  const currentPage = location.pathname.split("/").pop() || "index.html";

  nav.innerHTML = links
    .map(
      (l) =>
        `<a href="${l.href}"${l.href === currentPage ? ' class="active"' : ""}>${l.label}</a>`,
    )
    .join("");

  if (user) {
    const name = profile ? `${profile.first_name} ${profile.last_name}` : user.email;
    const nameEl = document.createElement("span");
    nameEl.className = "nav-user";
    nameEl.textContent = name;

    const roleTag = document.createElement("span");
    roleTag.className = `role-pill role-${profile?.role ?? "unknown"}`;
    roleTag.textContent = profile?.role === "admin" ? "Admin" : "Worker";

    const logoutBtn = document.createElement("a");
    logoutBtn.href = "logout.html";
    logoutBtn.className = "btn btn-sm logout-btn";
    logoutBtn.textContent = "Log out";

    nav.append(roleTag, nameEl, logoutBtn);
  } else {
    const loginLink = document.createElement("a");
    loginLink.href = "login.html";
    loginLink.className = "btn primary-btn login-btn";
    loginLink.textContent = "Login / Sign Up";
    nav.append(loginLink);
  }
}

renderNav();

// Re-render immediately on sign-in/sign-out (e.g. after logout.html calls
// signOut() and this page happened to still be open in another tab).
supabase.auth.onAuthStateChange(() => {
  renderNav();
});

export { renderNav };
/*import { supabase } from "./supabase.js"

// Shows the signed-in user's name + a logout button in the top nav bar.
// Included on every page that has <nav class="topnav">.

async function renderAuthNav() {
    const nav = document.querySelector(".topnav");
    if (!nav) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabase
        .from("profiles")
        .select("first_name, last_name")
        .eq("id", user.id)
        .single();

    const name = profile ? `${profile.first_name} ${profile.last_name}` : user.email;

    const loginLink = nav.querySelector("a.login-btn");
    loginLink?.remove();

    const nameEl = document.createElement("span");
    nameEl.className = "nav-user";
    nameEl.textContent = name;

    const logoutBtn = document.createElement("button");
    logoutBtn.type = "button";
    logoutBtn.className = "btn btn-sm logout-btn";
    logoutBtn.textContent = "Log out";
    logoutBtn.addEventListener("click", async function() {
        await supabase.auth.signOut();
        window.location.href = "index.html";
    });

    nav.append(nameEl, logoutBtn);
}

renderAuthNav();*/
