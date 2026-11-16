import type { ComponentType } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { masStrings } from './strings';

// Hueco de administración de P11. La sección solo se monta si el rol que
// devolvió el servidor en `/api/auth/me` es `admin` y si el módulo existe.
// El glob se resuelve en build: antes de P11 está vacío y no se renderiza nada.
export interface AdminSectionModule {
  default: ComponentType;
}

export type AdminModules = Record<string, AdminSectionModule>;

const ADMIN_MODULES = import.meta.glob('../../admin/AdminSection.tsx', {
  eager: true,
}) as AdminModules;

export function AdminSlot({
  modules = ADMIN_MODULES,
}: {
  modules?: AdminModules;
}) {
  const { user } = useAuth();
  const AdminSection = modules['../../admin/AdminSection.tsx']?.default;

  if (user?.role !== 'admin' || AdminSection === undefined) return null;

  return (
    <section className="stack" aria-labelledby="mas-admin-title">
      <div className="section-title">
        <h2 id="mas-admin-title">{masStrings.admin.title}</h2>
      </div>
      <AdminSection />
    </section>
  );
}

export default AdminSlot;
