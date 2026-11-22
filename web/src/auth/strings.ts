// Textos de la pantalla de sesión. Los comunes viven en `l10n/es.ts`.

export const authStrings = {
  login: {
    eyebrow: 'Cahier Atelier · Français',
    title: 'Entrar',
    subtitle: 'Tu cuaderno personal de estudio, audio y pronunciación.',
    googleContinue: 'Continuar con Google',
    orEmail: 'o con tu cuenta',
    email: 'Email',
    password: 'Contraseña',
    submit: 'Entrar',
    pendingNotice:
      'Tu cuenta de Google quedó registrada. Espera a que el administrador apruebe tu acceso.',
    googleDenied: 'Cancelaste el inicio de sesión con Google.',
    googleDisabled: 'El acceso con Google no está habilitado en este servidor.',
    oauthState: 'La solicitud expiró por seguridad. Inténtalo de nuevo.',
    googleFailed:
      'No se pudo validar tu cuenta con Google. Inténtalo otra vez.',
    googleUnverified: 'Tu cuenta de Google debe tener el correo verificado.',
    accountDisabled: 'Tu cuenta está deshabilitada. Contacta al administrador.',
    maxUsers:
      'No se creó tu cuenta: se alcanzó el número máximo de usuarios. Contacta al administrador.',
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
