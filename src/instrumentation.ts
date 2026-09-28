export async function register() {
  // Sólo en el runtime Node (no en edge) y sólo si nos dan la URL propia.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const selfUrl = process.env.SELF_URL;
  if (!selfUrl) return;

  const minutes = Number(process.env.KEEPALIVE_INTERVAL_MINUTES ?? '10');
  if (!Number.isFinite(minutes) || minutes <= 0) return;

  const base = selfUrl.replace(/\/+$/, '');
  const ping = () => {
    fetch(`${base}/api/health`, { signal: AbortSignal.timeout(10_000) }).catch(() => {
      // Un ping fallido no debe tumbar el servidor: el siguiente reintenta.
    });
  };

  const timer = setInterval(ping, minutes * 60_000);
  timer.unref?.();
}
