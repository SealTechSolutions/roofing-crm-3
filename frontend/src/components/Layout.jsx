import React, { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LayoutDashboard, Users, Building2, FileSpreadsheet, LogOut, Truck, HardHat, UserCog, Wrench, Receipt, Wallet, Boxes, BookOpen, BookMarked, Trash2, ClipboardCheck, Calendar as CalIcon, CheckSquare, Plug, CalendarClock, Smartphone, HelpCircle, FileText, Sunrise, Camera, Package, Calculator as CalcIcon, FolderKanban, TrendingUp, Wallet as FinanceIcon, Settings } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import GetAppOnPhoneModal from "@/components/GetAppOnPhoneModal";
import { api } from "@/lib/api";
import { toast } from "sonner";

/**
 * Grouped sidebar navigation.
 *
 * Each top-level group has a lightweight header + list of nav items.
 * `adminOnly: true` items get hidden for non-admin users; a group whose
 * ALL items are admin-only will disappear entirely when a non-admin
 * signs in (see filter logic in Layout()).
 *
 * Order matches the field team's day: Dashboard → who we serve →
 * what we build → daily field ops → weekly reports → time & docs →
 * money → back-office. User Guide sits at the very bottom, separated,
 * as an external link.
 */
const NAV_GROUPS = [
  {
    label: null,  // "Dashboard" stands alone at the top with no group header
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, testId: "nav-dashboard" },
    ],
  },
  {
    label: "Contacts",
    icon: Users,
    items: [
      { to: "/contacts",       label: "People & Companies", icon: Users,   testId: "nav-contacts" },
      { to: "/vendors",        label: "Vendors",            icon: Truck,   testId: "nav-vendors" },
      { to: "/subcontractors", label: "Subcontractors",     icon: HardHat, testId: "nav-subcontractors" },
    ],
  },
  {
    label: "Projects",
    icon: FolderKanban,
    items: [
      { to: "/properties", label: "Properties", icon: Building2,       testId: "nav-properties" },
      { to: "/projects",   label: "Deals",      icon: FileSpreadsheet, testId: "nav-projects" },
      { to: "/calculator", label: "Calculator", icon: CalcIcon,        testId: "nav-calculator" },
    ],
  },
  {
    label: "Field",
    icon: Camera,
    items: [
      { to: "/photos",  label: "Photo Timeline",     icon: Camera,          testId: "nav-photos" },
      { to: "/wrap-up", label: "Finish Site Visit",  icon: ClipboardCheck,  testId: "nav-wrap-up" },
    ],
  },
  {
    label: "Reports",
    icon: TrendingUp,
    items: [
      { to: "/assessments", label: "Assessments", icon: ClipboardCheck, testId: "nav-assessments" },
      { to: "/scopes",      label: "Scopes",      icon: FileText,       testId: "nav-scopes" },
      { to: "/maintenance", label: "Maintenance", icon: Wrench,         testId: "nav-maintenance" },
    ],
  },
  {
    label: "Scheduling",
    icon: CalendarClock,
    items: [
      { to: "/calendar",          label: "Calendar",       icon: CalIcon,       testId: "nav-calendar" },
      { to: "/tasks",             label: "Tasks",          icon: CheckSquare,   testId: "nav-tasks" },
      { to: "/settings/schedule", label: "Scheduled Jobs", icon: CalendarClock, testId: "nav-schedule", adminOnly: true },
    ],
  },
  {
    label: "Library",
    icon: BookOpen,
    items: [
      { to: "/library",   label: "Documents",         icon: BookOpen, testId: "nav-library" },
      { to: "/catalog",   label: "Product Materials", icon: Package,  testId: "nav-catalog" },
      { to: "/materials", label: "Sales Materials",   icon: Boxes,    testId: "nav-materials" },
    ],
  },
  {
    label: "Finance",
    icon: FinanceIcon,
    items: [
      { to: "/books",    label: "Books",    icon: BookMarked, testId: "nav-books" },
      { to: "/invoices", label: "Invoices", icon: Receipt,    testId: "nav-invoices" },
      { to: "/payables", label: "Payables", icon: Wallet,     testId: "nav-payables" },
    ],
  },
  {
    label: "Company Info",
    icon: Settings,
    items: [
      { to: "/users",                label: "Users",           icon: UserCog, testId: "nav-users",             adminOnly: true },
      { to: "/settings/integrations",label: "Integrations",    icon: Plug,    testId: "nav-integrations",      adminOnly: true },
      { to: "/settings/equipment-rates", label: "Equipment Rates", icon: Truck, testId: "nav-equipment-rates", adminOnly: true },
      { to: "/trash",                label: "Trash",           icon: Trash2,  testId: "nav-trash",             adminOnly: true },
    ],
  },
];

export default function Layout() {
  const { user, logout } = useAuth();
  // Filter out admin-only items for non-admins, then drop groups that
  // end up with zero visible items (e.g. Company Info for regular users).
  const isAdmin = user?.role === "admin";
  const GROUPS = NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.adminOnly || isAdmin) }))
    .filter((g) => g.items.length > 0);
  const [showGetApp, setShowGetApp] = useState(false);
  return (
    <div className="min-h-screen flex bg-zinc-100">
      {/* Sidebar */}
      <aside className="w-64 bg-zinc-950 text-zinc-50 flex flex-col" data-testid="sidebar">
        <div className="p-4 bg-white border-b border-zinc-800">
          <img src="/sealtech-logo.png" alt="SealTech Building Solutions" className="w-full h-auto max-h-16 object-contain" />
        </div>
        <nav className="flex-1 p-3 overflow-y-auto">
          {GROUPS.map((group, gi) => (
            <div key={group.label || `g${gi}`} className={gi === 0 ? "" : "mt-4"}>
              {group.label && (
                <div className="px-3 pb-1.5 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                  {group.icon && <group.icon className="w-3 h-3" />}
                  {group.label}
                </div>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === "/"}
                    data-testid={item.testId}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors ${
                        isActive
                          ? "bg-blue-700 text-white"
                          : "text-zinc-400 hover:text-white hover:bg-zinc-900"
                      }`
                    }
                  >
                    <item.icon className="w-3.5 h-3.5" />
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
          {/* External link to the User Guide on GitHub. Uses a plain <a>
              rather than NavLink because it opens in a new tab and does
              not match any React Router route. Kept visually distinct
              with a subtle top divider so it doesn't blend into the
              app's internal nav. */}
          <a
            href="https://github.com/SealTechSolutions/roofing-crm-3/blob/main/USER_GUIDE.md"
            target="_blank"
            rel="noopener noreferrer"
            data-testid="nav-user-guide"
            className="mt-4 pt-3 border-t border-zinc-800/60 flex items-center gap-2.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors text-zinc-400 hover:text-white hover:bg-zinc-900"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            User Guide
          </a>
        </nav>
        <div className="p-4 border-t border-zinc-800">
          <NavLink
            to="/profile"
            data-testid="nav-profile"
            className={({ isActive }) =>
              `flex items-center gap-3 mb-3 p-2 -m-2 rounded-sm transition-colors ${
                isActive ? "bg-blue-700/20" : "hover:bg-zinc-900"
              }`
            }
            title="Edit my profile"
          >
            <div className="w-9 h-9 rounded-sm bg-blue-700 flex items-center justify-center text-white font-heading font-black">
              {(user?.name || "U")[0].toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold truncate text-white" data-testid="current-user-name">{user?.name}</div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 truncate">{user?.role || "user"}{user?.title ? " · " + user.title : ""}</div>
            </div>
          </NavLink>
          <button
            data-testid="get-app-button"
            onClick={() => setShowGetApp(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 mb-2 border border-blue-700 text-blue-400 hover:bg-blue-700 hover:text-white text-xs uppercase tracking-wider font-bold transition-colors rounded-sm"
          >
            <Smartphone className="w-3.5 h-3.5" />
            Get App on My Phone
          </button>

          {/* Printable how-to PDFs — regenerated live from the backend on every click. */}
          <button
            data-testid="dl-daily-status"
            onClick={async () => {
              const id = toast.loading("Building today's status report…");
              try {
                const r = await api.get("/reports/daily-status.pdf", { responseType: "blob" });
                const u = URL.createObjectURL(r.data);
                const a = document.createElement("a");
                const date = new Date().toISOString().slice(0, 10);
                a.href = u; a.download = `Daily Status - ${date}.pdf`;
                document.body.appendChild(a); a.click(); a.remove();
                setTimeout(() => URL.revokeObjectURL(u), 1000);
                toast.success("Daily Status downloaded", { id });
              } catch (e) {
                toast.error(e?.message || "Could not download", { id });
              }
            }}
            title="Today's pipeline snapshot — where every deal is, what's next, who owns it. Also auto-emails every weekday 7am MT."
            className="w-full flex items-center justify-center gap-2 px-3 py-2 mb-2 border border-amber-500/40 text-amber-300 hover:bg-amber-500 hover:text-zinc-950 hover:border-amber-500 text-xs uppercase tracking-wider font-bold transition-colors rounded-sm"
          >
            <Sunrise className="w-3.5 h-3.5" />
            Today&apos;s Status Report
          </button>

          <div className="grid grid-cols-2 gap-2 mb-2">
            <button
              data-testid="dl-quick-guide"
              onClick={async () => {
                try {
                  const r = await api.get("/docs/quick-guide.pdf", { responseType: "blob" });
                  const u = URL.createObjectURL(r.data);
                  const a = document.createElement("a");
                  a.href = u; a.download = "SealTech CRM - Quick Reference.pdf";
                  document.body.appendChild(a); a.click(); a.remove();
                  setTimeout(() => URL.revokeObjectURL(u), 1000);
                } catch (e) { toast.error(e?.message || "Could not download"); }
              }}
              title="2-page laminate-on-the-truck cheat sheet"
              className="flex items-center justify-center gap-1 px-2 py-2 border border-zinc-800 hover:border-amber-500 hover:text-amber-300 text-zinc-400 text-[10px] uppercase tracking-wider font-bold transition-colors rounded-sm"
            >
              <HelpCircle className="w-3 h-3" />
              Quick Guide
            </button>
            <button
              data-testid="dl-full-manual"
              onClick={async () => {
                try {
                  const r = await api.get("/docs/full-manual.pdf", { responseType: "blob" });
                  const u = URL.createObjectURL(r.data);
                  const a = document.createElement("a");
                  a.href = u; a.download = "SealTech CRM - Full User Manual.pdf";
                  document.body.appendChild(a); a.click(); a.remove();
                  setTimeout(() => URL.revokeObjectURL(u), 1000);
                } catch (e) { toast.error(e?.message || "Could not download"); }
              }}
              title="Full ~11-page user manual covering every feature"
              className="flex items-center justify-center gap-1 px-2 py-2 border border-zinc-800 hover:border-amber-500 hover:text-amber-300 text-zinc-400 text-[10px] uppercase tracking-wider font-bold transition-colors rounded-sm"
            >
              <FileText className="w-3 h-3" />
              Full Manual
            </button>
          </div>
          <button
            data-testid="logout-button"
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-zinc-800 hover:border-blue-700 hover:text-blue-500 text-xs uppercase tracking-wider font-bold transition-colors rounded-sm"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>

      {showGetApp && (
        <GetAppOnPhoneModal
          onClose={() => setShowGetApp(false)}
          redirectPath="/"
          subtitle="Scan to open the CRM on your phone"
        />
      )}
    </div>
  );
}
