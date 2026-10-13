import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function BuscarTracking({ searchParams }) {
  const id = (searchParams?.id ?? '').trim();
  if (id) redirect(`/tracking/${encodeURIComponent(id)}`);
  return (
    <section className="panel tracking">
      <h1>Seguí tu envío</h1>
      <p className="pie">Ingresá el código que te envió el comercio (por ejemplo, RS-XXXX-000123).</p>
      <form className="filtros" action="/tracking">
        <label style={{ flex: 1 }}>
          Código de envío
          <input name="id" placeholder="RS-…" required />
        </label>
        <button type="submit">Buscar</button>
      </form>
    </section>
  );
}
