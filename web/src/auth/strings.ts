// Textos de la pantalla de sesión. Los comunes viven en `l10n/es.ts`.

export const authStrings = {
  login: {
    title: 'Entrar',
    email: 'Email',
    password: 'Contraseña',
    submit: 'Entrar',
    badCredentials: 'Email o contraseña incorrectos.',
    rateLimited: 'Demasiados intentos; espera un minuto',
    offline: 'Sin conexión. Vuelve a intentarlo cuando tengas red.',
    demoHint: 'Demo: demo@example.com · demo-demo-demo',
    demoButton: 'Entrar al demo',
  },
  invite: {
    title: 'Aceptar invitación',
    checking: 'Comprobando el enlace…',
    invalid: 'El enlace no vale o caducó.',
    offline: 'Sin conexión. Vuelve a intentarlo cuando tengas red.',
    email: 'Email',
    displayName: 'Nombre visible',
    password: 'Contraseña',
    confirm: 'Confirmar contraseña',
    submit: 'Crear cuenta',
    rateLimited: 'Demasiados intentos; espera un minuto',
  },
  password: {
    title: 'Cambiar contraseña',
    current: 'Contraseña actual',
    next: 'Nueva contraseña',
    confirm: 'Confirmar contraseña',
    submit: 'Cambiar contraseña',
    success: 'Contraseña cambiada; las demás sesiones se cerraron',
    currentWrong: 'La contraseña actual no es correcta.',
    short: 'La contraseña necesita al menos 12 caracteres',
    long: 'La contraseña no puede pasar de 128 caracteres',
    mismatch: 'Las contraseñas no coinciden',
    rateLimited: 'Demasiados intentos; espera un minuto',
    offline: 'Sin conexión. Vuelve a intentarlo cuando tengas red.',
  },
  logout: {
    button: 'Cerrar sesión',
    retry: 'Reintentar',
    discard: 'Cerrar sesión igual',
    pendingBody: 'Se guardarán en tu cuenta cuando vuelvas a tener conexión.',
    pendingTitle: (count: number) =>
      count === 1
        ? 'Hay 1 cambio sin sincronizar'
        : `Hay ${count} cambios sin sincronizar`,
  },
} as const;
