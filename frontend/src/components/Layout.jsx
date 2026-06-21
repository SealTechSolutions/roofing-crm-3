import React, { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LayoutDashboard, Users, Building2, FileSpreadsheet, LogOut, Truck, HardHat, UserCog, Wrench, Receipt, Wallet, Boxes, BookOpen, BookMarked, Trash2, ClipboardCheck, Calendar as CalIcon, CheckSquare, Plug, CalendarClock, Smartphone, HelpCircle, FileText, Sunrise, Camera, Package, Calculator as CalcIcon } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import GetAppOnPhoneModal from "@/components/GetAppOnPhoneModal";
import { api } from "@/lib/api";
import { toast } from "sonner";

const ALL_NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, testId: "nav-dashboard" },
  { to: "/contacts", label: "Contacts", icon: Users, testId: "nav-contacts" },
  { to: "/properties", label: "Properties", icon: Building2, testId: "nav-properties" },
  { to: "/projects", label: "Deals", icon: FileSpreadsheet, testId: "nav-projects" },
  { to: "/calendar", label: "Calendar", icon: CalIcon, testId: "nav-calendar" },
  { to: "/tasks", label: "Tasks", icon: CheckSquare, testId: "nav-tasks" },
  { to: "/field", label: "Field Camera", icon: Camera, testId: "nav-field" },
  { to: "/assessments", label: "Assessments", icon: ClipboardCheck, testId: "nav-assessments" },
  { to: "/catalog", label: "Product Catalog", icon: Package, testId: "nav-catalog" },
  { to: "/calculator", label: "Calculator", icon: CalcIcon, testId: "nav-calculator" },
  { to: "/maintenance", label: "Maintenance", icon: Wrench, testId: "nav-maintenance" },
  { to: "/invoices", label: "Invoices", icon: Receipt, testId: "nav-invoices" },
  { to: "/payables", label: "Payables", icon: Wallet, testId: "nav-payables" },
  { to: "/materials", label: "Materials", icon: Boxes, testId: "nav-materials" },
  { to: "/library", label: "Library", icon: BookOpen, testId: "nav-library" },
  { to: "/books", label: "Books", icon: BookMarked, testId: "nav-books" },
  { to: "/vendors", label: "Vendors", icon: Truck, testId: "nav-vendors" },
  { to: "/subcontractors", label: "Subcontractors", icon: HardHat, testId: "nav-subcontractors" },
  { to: "/users", label: "Users", icon: UserCog, testId: "nav-users", adminOnly: true },
  { to: "/settings/integrations", label: "Integrations", icon: Plug, testId: "nav-integrations", adminOnly: true },
  { to: "/settings/schedule", label: "Schedule", icon: CalendarClock, testId: "nav-schedule", adminOnly: true },
  { to: "/trash", label: "Trash", icon: Trash2, testId: "nav-trash", adminOnly: true },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const NAV = ALL_NAV.filter((item) => !item.adminOnly || user?.role === "admin");
  const [showGetApp, setShowGetApp] = useState(false);
  return (
    <div className="min-h-screen flex bg-zinc-100">
      {/* Sidebar */}
      <aside className="w-64 bg-zinc-950 text-zinc-50 flex flex-col" data-testid="sidebar">
        <div className="p-4 bg-white border-b border-zinc-800">
          <img src="/sealtech-logo.png" alt="SealTech Building Solutions" className="w-full h-auto max-h-24 object-contain" />
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              data-testid={item.testId}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 text-sm font-bold uppercase tracking-wider transition-colors ${
                  isActive
                    ? "bg-blue-700 text-white"
                    : "text-zinc-400 hover:text-white hover:bg-zinc-900"
                }`
              }
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </NavLink>
          ))}
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
          redirectPath="/field"
          subtitle="Scan to open Field Capture"
        />
      )}
    </div>
  );
}
