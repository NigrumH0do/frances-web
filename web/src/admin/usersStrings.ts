import type { InviteOut, UserOut } from '../contracts/generated';

export type Role = UserOut['role'];
export type InviteState = 'active' | 'used' | 'revoked' | 'expired';

// Textos de las pantallas de usuarios e invitaciones del admin (MGT-06).
export const usersStrings = {
  confirm: 'Confirmar',
  cancel: 'Cancelar',
  users: {
    title: 'Usuarios',
    empty: 'No hay usuarios',
    lastLogin: (date: string) => `Último acceso: ${date}`,
    neverLoggedIn: 'Nunca ha iniciado sesión',
    active: 'Activo',
    disabled: 'Deshabilitado',
    disable: (name: string) => `Deshabilitar ${name}`,
    enable: (name: string) => `Habilitar ${name}`,
    disableTitle: 'Deshabilitar usuario',
    enableTitle: 'Habilitar usuario',
    disableConfirm: (name: string) =>
      `¿Deshabilitar a ${name}? Se cerrarán sus sesiones y no podrá entrar hasta que lo habilites.`,
    enableConfirm: (name: string) =>
      `¿Habilitar a ${name}? Podrá volver a iniciar sesión.`,
    disabledNotice: (name: string) => `${name} quedó deshabilitado.`,
    enabledNotice: (name: string) => `${name} quedó habilitado.`,
  },
  invites: {
    title: 'Invitaciones',
    empty: 'No hay invitaciones',
    create: 'Crear invitación',
    createTitle: 'Crear invitación',
    role: 'Rol',
    note: 'Nota',
    noteHint: 'Opcional. Solo la ve el administrador.',
    ttl: 'Vigencia',
    ttl24: '24 horas',
    ttl72: '72 horas',
    ttl168: '7 días',
    createSubmit: 'Crear enlace',
    linkTitle: 'Invitación creada',
    linkLabel: 'Enlace de invitación',
    linkOnce: 'Este enlace solo se muestra una vez. Cópialo ahora.',
    copy: 'Copiar enlace',
    copied: 'Enlace copiado.',
    copyError: 'No se pudo copiar. Selecciona el enlace y cópialo a mano.',
    close: 'Cerrar',
    noNote: 'Sin nota',
    expires: (date: string) => `Vence: ${date}`,
    revoke: 'Revocar',
    revokeTitle: 'Revocar invitación',
    revokeConfirm: '¿Revocar esta invitación? El enlace dejará de funcionar.',
    revokedNotice: 'Invitación revocada.',
    statusActive: 'Vigente',
    statusUsed: 'Usada',
    statusRevoked: 'Revocada',
    statusExpired: 'Vencida',
  },
} as const;

const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrador',
  user: 'Usuario',
};

export function roleLabel(role: Role): string {
  return ROLE_LABELS[role];
}

export function userStatusLabel(disabled: boolean): string {
  return disabled ? usersStrings.users.disabled : usersStrings.users.active;
}

// El estado se deriva de las fechas del contrato; el servidor lista también
// las invitaciones vencidas y las usadas/revocadas.
export function inviteState(
  invite: InviteOut,
  now: number = Date.now(),
): InviteState {
  if (invite.used_at !== null) return 'used';
  if (invite.revoked_at !== null) return 'revoked';
  if (Date.parse(invite.expires_at) <= now) return 'expired';
  return 'active';
}

const INVITE_STATE_LABELS: Record<InviteState, string> = {
  active: usersStrings.invites.statusActive,
  used: usersStrings.invites.statusUsed,
  revoked: usersStrings.invites.statusRevoked,
  expired: usersStrings.invites.statusExpired,
};

export function inviteStateLabel(state: InviteState): string {
  return INVITE_STATE_LABELS[state];
}
