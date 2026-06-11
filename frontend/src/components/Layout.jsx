import React from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LayoutDashboard, Users, Building2, FileSpreadsheet, LogOut, HardHat } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, testId: "nav-dashboard" },
  { to: "/contacts", label: "Contacts", icon: Users, testId: "nav-contacts" },
  { to: "/properties", label: "Properties", icon: Building2, testId: "nav-properties" },
  { to: "/deals", label: "Deals", icon: FileSpreadsheet, testId: "nav-deals" },
];

export default function Layout() {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-screen flex bg-zinc-100">
      {/* Sidebar */}
      <aside className="w-64 bg-zinc-950 text-zinc-50 flex flex-col" data-testid="sidebar">
        <div className="p-6 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-orange-600 flex items-center justify-center rounded-sm">
              <HardHat className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="font-heading font-black tracking-tight text-lg leading-none">ROOFLINE</div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mt-1">Commercial CRM</div>
            </div>
          </div>
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
                    ? "bg-orange-600 text-white"
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
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-sm bg-zinc-800 flex items-center justify-center text-orange-500 font-heading font-black">
              {(user?.name || "U")[0].toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-bold truncate" data-testid="current-user-name">{user?.name}</div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 truncate">{user?.email}</div>
            </div>
          </div>
          <button
            data-testid="logout-button"
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-zinc-800 hover:border-orange-600 hover:text-orange-500 text-xs uppercase tracking-wider font-bold transition-colors rounded-sm"
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
    </div>
  );
}
