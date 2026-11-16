// Entrada única de la web v2 (Task CHG-16). La web v1 se retiró: la
// app real la sirve Caddy (SRV-13) y el demo de Pages usa esta misma entrada
// construida con `--mode demo`.
export async function start(el: HTMLElement): Promise<'v2'> {
  const { bootV2 } = await import('./shell/boot');
  await bootV2(el);
  return 'v2';
}

const root = document.getElementById('root');
if (root !== null) {
  void start(root);
}
