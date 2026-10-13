import Link from 'next/link';
import DetalleEnVivo from '@/components/DetalleEnVivo';
import { datosEnvio } from '@/lib/consultas';

export const dynamic = 'force-dynamic';

export default async function DetalleEnvio({ params }) {
  const id = decodeURIComponent(params.id);
  const datos = await datosEnvio(id);
  if (!datos) {
    return (
      <section className="panel">
        <h1>Envío {id}</h1>
        <p className="vacio">
          No existe (todavía) en la vista. Si lo acabás de crear, esperá un segundo y recargá. <Link href="/">Volver a la torre</Link>
        </p>
      </section>
    );
  }
  return <DetalleEnVivo inicial={datos} />;
}
