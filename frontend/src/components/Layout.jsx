import React from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LayoutDashboard, Users, Building2, FileSpreadsheet, LogOut, Truck } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, testId: "nav-dashboard" },
  { to: "/contacts", label: "Contacts", icon: Users, testId: "nav-contacts" },
  { to: "/properties", label: "Properties", icon: Building2, testId: "nav-properties" },
  { to: "/deals", label: "Deals", icon: FileSpreadsheet, testId: "nav-deals" },
  { to: "/vendors", label: "Vendors", icon: Truck, testId: "nav-vendors" },
];

export default function Layout() {
  const { user, logout } = useAuth();
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
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-sm bg-blue-700 flex items-center justify-center text-white font-heading font-black">
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
    </div>
  );
}
