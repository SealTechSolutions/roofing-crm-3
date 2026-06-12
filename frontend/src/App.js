import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { Toaster } from "@/components/ui/sonner";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import Contacts from "@/pages/Contacts";
import Properties from "@/pages/Properties";
import Deals from "@/pages/Deals";
import DealDetail from "@/pages/DealDetail";
import Vendors from "@/pages/Vendors";
import UsersPage from "@/pages/Users";
import Maintenance from "@/pages/Maintenance";
import Invoices from "@/pages/Invoices";
import "@/App.css";

const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Loading...</div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
};

const PublicRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/" replace />;
  return children;
};

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
            <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />
            <Route
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<Dashboard />} />
              <Route path="/contacts" element={<Contacts />} />
              <Route path="/properties" element={<Properties />} />
              <Route path="/projects" element={<Deals />} />
              <Route path="/projects/:id" element={<DealDetail />} />
              <Route path="/deals" element={<Deals />} />
              <Route path="/deals/:id" element={<DealDetail />} />
              <Route path="/vendors" element={<Vendors kind="Vendor" />} />
              <Route path="/subcontractors" element={<Vendors kind="Subcontractor" />} />
              <Route path="/maintenance" element={<Maintenance />} />
              <Route path="/invoices" element={<Invoices />} />
              <Route path="/users" element={<UsersPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
        <Toaster position="top-right" />
      </AuthProvider>
    </div>
  );
}

export default App;
